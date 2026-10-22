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
| **STARK KÖPSIGNAL** | Samma krav som KÖPSIGNAL, och dessutom har RSI varit under 32 de senaste dagarna |
| **KÖPSIGNAL** | Poäng ≥ 42, priset under EMA 200, priset testar en stödzon, RSI vänder upp från under 40, MACD-histogrammet vänder upp och det finns en giltig Elliottvågräkning |
| **BEVAKA** | Bra läge men alla krav är inte uppfyllda än |
| **AVVAKTA** | Överköpt eller sen fas |

**Handelsplan:** Stoppet läggs under stödzonen och de senaste fem dagarnas botten, minst 1 ATR bort. Målen tas från
riktiga nivåer: motståndszoner, bearish FVG, tidigare toppar, Fibonacci-extensioner och Elliottmål. Mål vid ett motstånd
läggs strax under motståndet.

- **TP1:** närmaste nivå 0,5–1,2 R bort, annars 0,8 R
- **TP2:** nästa nivå upp till 2 R bort, annars 1,2 R
- **TP3:** nästa tydliga nivå, för den sista tredjedelen

Sälj en tredjedel vid varje mål och flytta stoppet till köpkursen när TP2 är nådd.

### Backtest
Krav: TP1 ska nås i minst 60 % av affärerna och TP2 i minst 54 %. Simuleringen köper på nästa dags öppning. Om stopp och
mål nås samma dag räknas stoppet. En aktie kan bara ha en affär åt gången. Courtage ingår inte.

| OMXS30 2022–2026 | Affärer | TP1 | TP2 | TP3 | Snitt per affär |
|---|---|---|---|---|---|
| Alla signaler | 270 | 71,5 % | 60,0 % | 40,4 % | +0,40 R |
| Stark köpsignal | 139 | 70,5 % | 59,0 % | 38,1 % | +0,43 R |
| Köpsignal | 131 | 72,5 % | 61,1 % | 42,7 % | +0,38 R |

Reglerna valdes på data för 2022–2024 och kontrollerades på 2025–2026, och träffsäkerheten blev ungefär lika hög i båda
perioderna. Det viktigaste filtret är att priset ligger under EMA 200. Rekyler i aktier som redan ligger i stark upptrend
nådde TP2 i bara cirka 47 % av fallen.

Resultatet varierar mellan åren: 2023 nådde 59 % av signalerna TP2 och 2026 hittills 52 %. Appen visar
backtestet per aktie och för alla signaler tillsammans, och markerar historiska signaler i grafen.

**Det här är inte investeringsrådgivning.**

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
- `server.js`: API (`/api/scan`, `/api/analysis?symbol=`) och statiska filer
- `public/`: gränssnittet med en egen canvas-graf (dra för att panorera, scrolla eller nyp för att zooma, dubbelklicka för att återställa)
