# OMX Analys

Webbapp som gör en teknisk analys av **OMXS30** och de 30 aktierna i indexet varje handelsdag. Den letar efter köplägen och
föreslår en handelsplan med köp, stopp och tre vinstmål.

## Vad appen analyserar

| Del | Hur det räknas |
|---|---|
| **Stöd och motstånd** | Svängtoppar och svängbottnar (fraktaler och ZigZag) som ligger nära varandra i pris slås ihop till zoner. Styrkan beror på antal träffar och hur nya de är. Zoner som har bytt roll, till exempel från motstånd till stöd, markeras. |
| **Fair value gaps (FVG)** | Obalans mellan tre staplar. Appen följer hur mycket av varje gap som har fyllts, och gap som fyllts helt tas bort. |
| **Elliottvågor** | Appen testar alla impulsmönster (våg 0–5) och ABC-korrektioner som slutar i den senaste svängen, i båda riktningarna. Varje räkning måste följa de hårda reglerna: våg 2 bryter inte starten, våg 3 är inte kortast och våg 4 överlappar inte våg 1. Räkningarna poängsätts efter Fibonacci-förhållanden och alternering. Appen visar fasen, köpzonen, nivån där räkningen blir ogiltig och vågmålen. Den visar också en räkning på högre grad. |
| **Fibonacci** | Rekyl- och extensionsnivåer för det senaste benet uppåt. |
| **Indikatorer** | EMA 20/50/200, RSI 14, MACD, ATR 14. |

## Köpsignaler

Poängen (0–100) väger ihop stödzon, Fibonacci-rekyl, Elliottzon, översåld RSI och vändning (RSI som vänder upp,
MACD, stängning över gårdagens topp, engulfing eller hammare, divergens). Överköpt RSI och sen våg 5 ger minuspoäng.

| Status | Krav |
|---|---|
| **STARK KÖPSIGNAL** | Alla krav för köpsignal och makropoäng 1 eller mer: full position |
| **KÖPSIGNAL** | Poäng ≥ 42, priset under EMA 200, priset testar en stödzon, RSI vänder upp från under 40, MACD-histogrammet vänder upp, det finns en giltig Elliottvågräkning och makropoängen är 0: halv position |
| **BEVAKA** | Bra läge men alla krav är inte uppfyllda, eller köpsignalen är spärrad av rapport eller makro |
| **AVVAKTA** | Överköpt eller sen fas |

**Handelsplan:** Stoppet läggs under stödzonen och de senaste fem dagarnas botten, minst 1 ATR bort. Målen tas från
riktiga nivåer: motståndszoner, bearish FVG, tidigare toppar, Fibonacci-extensioner och Elliottmål. Mål vid ett motstånd
läggs strax under motståndet.

- **TP1:** närmaste nivå 0,5–1,2 R bort, annars 0,8 R
- **TP2:** nästa nivå upp till 2 R bort, annars 1,2 R
- **TP3:** nästa tydliga nivå, för den sista tredjedelen

Sälj en tredjedel vid varje mål och flytta stoppet till köpkursen när TP2 är nådd.

### Rapportspärr
Ingen ny affär tas om bolaget rapporterar inom **10 handelsdagar**. Kommande rapportdatum hämtas från Yahoo Finance.
Historiska datum finns i `data/earnings.json`. Om ett datum saknas uppskattas det från samma kvartal året innan.

I backtestet med gap-hantering (se nedan) gav spärren dessa resultat:

| | Utan spärr | Med spärr |
|---|---|---|
| Snitt per affär | +0,35 R | +0,45 R |
| Sämsta affären | −3,2 R | −1,6 R |
| TP2 nådd | 59 % | 64 % |

Att också sälja dagen före rapporten gav inget extra.

### Marknadsläge (makro)

| Faktor | Poäng |
|---|---|
| OMXS30 under EMA 200 | +1 |
| Färre än 40 % av OMXS30-aktierna över EMA 50 | +1 |
| VIX 20 eller högre | +1 |
| VIX under 15 | −1 |
| Räntebesked från Fed (FOMC) inom 7 dagar (`data/fomc.json`) | −1 |

Makropoängen avgör positionsstorleken:

| Makropoäng | Position | TP1 | TP2 | Snitt per affär |
|---|---|---|---|---|
| Under 0 | Inga nya köp | 62 % | 46 % | +0,08 R |
| 0 | Halv | 67 % | 60 % | +0,28 R |
| 1 eller mer | Full | 81 % | 75 % | +0,73 R |

Strategin fungerar bäst när marknaden är rädd. Översålda storbolag studsar då kraftigast.

### Bear (säljsignaler)
Två typer av bear-strategier testades på OMXS30-aktier och index 2022–2026. Båda gick med förlust varje år och ingår därför
inte i signalerna:

| Bear-strategi | Snitt per affär |
|---|---|
| Speglad köpregel: blanka överköpt aktie över EMA 200 | −0,05 R |
| Trendföljande: blanka studs i nedtrend | −0,33 R |

Den trendföljande gick sämst när marknaden var svag (−0,64 R). Det är samma kraftiga studsar som gör köpsignalerna bra.
Backtestet kan köra säljsignaler med `backtest(bars, { side: 'short' })`.

### Backtest
Krav: TP1 ska nås i minst 60 % av affärerna och TP2 i minst 54 %. Så simuleras affärerna:

- Köp på nästa dags öppning. En aktie kan bara ha en affär åt gången.
- Om stopp och mål nås samma dag räknas stoppet.
- Öppnar kursen under stoppet säljs positionen på öppningskursen. Det gör stora förluster efter rapporter synliga.
- Courtage ingår inte.

| OMXS30 2022–2026, med rapportspärr och makrofilter | Affärer | TP1 | TP2 | TP3 | Snitt per affär |
|---|---|---|---|---|---|
| Alla signaler | 184 | 74,5 % | 67,4 % | 46,2 % | +0,53 R |
| Stark köpsignal | 108 | 81,5 % | 75,0 % | 57,4 % | +0,74 R |
| Köpsignal | 76 | 64,5 % | 56,6 % | 30,3 % | +0,22 R |

### Kontosimulering
Simuleringen gäller 10 000 kr, 2023 till oktober 2026, och använder OMXS30-aktierna:

- **Positionsstorlek efter risk:** varje affär storleksanpassas så att en förlust vid stopp är den valda andelen av kontot.
- **Hävstång:** via minifutures, med högst 10 samtidiga positioner.
- **Kostnad:** 0,3 % av exponeringen per affär för spread och finansiering.

| Risk per affär | Avkastning per år | Största nedgång |
|---|---|---|
| 2 % | +35 % | −19 % |
| 3 % | +53 % | −27 % |
| 4 % | +71 % | −34 % |
| 6 % | +107 % | −48 % |

**Varning:** Reglerna, rapportspärren och makropoängen är framtagna på samma period som de testas på. På aktier
från USA och DAX som reglerna inte sett var fördelen per affär ungefär en tredjedel så stor. Räkna med klart lägre avkastning
framåt. Alla Stockholmsaktier faller dessutom ofta samtidigt, så flera stopp kan nås samma dag.

**Det här är inte investeringsrådgivning.**

## Hävstång på Avanza
För varje aktie och för index hämtar appen alla långa minifutures, turbos och bull-certifikat från Avanzas produktlista.
Den rekommenderar sedan **3 minifutures/turbos** och **2 bull-certifikat** som alternativ. Så väljs papperna:

| Krav | Varför |
|---|---|
| Det finns både köp- och säljkurs | Papper som är slutsålda eller saknar säljkurs sorteras bort |
| Spread högst 1,5 % | Hög spread gör att man förlorar pengar redan vid köpet |
| Knock-out minst 1 ATR under signalens stopp | Stoppet på underliggande nås långt innan pappret kan slås ut |
| Hävstång högst 12x (index) eller 6x (aktie) | Begränsar risken |
| Förlust vid stopp högst 35 % av insatsen | Hävstång × avståndet till stoppet |
| Bull-certifikat högst 5x (index) eller 3x (aktie) | Daglig hävstång tappar värde när kursen svänger mycket |

Papper som klarar kraven rankas efter spread, hur nära hävstången ligger 7x (index) eller 4x (aktie), omsättning och om det
är en Avanza Markets-produkt (AVA). Rekommendationerna har olika hävstång, så att det finns alternativ om ett papper blir
slutsålt. För varje papper visas knock-out-nivå, ungefärlig förlust vid stopp och ungefärlig vinst vid TP1 och TP2.

Datan kommer från Avanzas inofficiella webb-API (`/_api/market-warrant-filter`, `/_api/market-certificate-filter`), som kan
ändras utan förvarning. Kurserna kan vara fördröjda. Kontrollera alltid köp- och säljkurs hos Avanza innan du handlar.

## Köra
Kräver Node 18 eller senare och har inga andra beroenden.

    npm start      # http://localhost:3000
    npm test

Data hämtas från Yahoo Finance (dagsdata, 5 år) och cachas i 15 minuter. Knappen Uppdatera hämtar ny data direkt.

### Ändra aktierna
Listan finns i `symbols.json` och följer revideringen av OMXS30 i juli 2025. Nasdaq reviderar indexet i januari och juli. Uppdatera
listan när bolag går in eller ut (Yahoo-symbol med `.ST` på slutet).

### Publicera
`render.yaml` gör att appen kan köras på Render: skapa en ny Blueprint från repot.

## Struktur
- `lib/indicators.js`: EMA, RSI, ATR, MACD
- `lib/structure.js`: ZigZag, fraktaler, stöd/motstånd, FVG, Fibonacci
- `lib/elliott.js`: Elliottvågor
- `lib/analyze.js`: poäng, handelsplan och backtest
- `lib/avanza.js`: urval av minifutures och certifikat på Avanza
- `lib/events.js`: rapportdatum (Yahoo Finance) och räntebesked
- `lib/macro.js`: marknadsläge (OMXS30-trend, bredd, VIX, FOMC)
- `data/`: historiska rapportdatum och FOMC-kalender
- `server.js`: API (`/api/scan`, `/api/analysis?symbol=`, `/api/products?symbol=`, `/api/summary`, `/api/macro`) och statiska filer
- `public/`: gränssnittet med en egen canvas-graf (dra för att panorera, scrolla eller nyp för att zooma, dubbelklicka för att återställa)
