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
| **STARK KÖPSIGNAL** | Poäng ≥ 42, priset under EMA 200, priset testar en stödzon, RSI vänder upp från under 40, MACD-histogrammet vänder upp, det finns en giltig Elliottvågräkning, ingen rapport inom 10 handelsdagar och makropoäng 1 eller mer |
| **BEVAKA** | Bra läge men alla krav är inte uppfyllda, eller signalen är spärrad av rapport eller makro |
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

Bara makropoäng 1 eller mer ger köpsignal:

| Makropoäng | OMXS30-aktier: TP1 | TP2 | Snitt per affär | Nya nordiska aktier: snitt per affär |
|---|---|---|---|---|
| Under 0 | 62 % | 46 % | +0,08 R | – |
| 0 | 64 % | 57 % | +0,22 R | −0,05 R |
| 1 eller mer | 81 % | 75 % | +0,74 R | +0,29 R |

Strategin fungerar bäst när marknaden är rädd. Översålda storbolag studsar då kraftigast.

### Krig och oro (riskfaktor 1 för positionsstorleken)
Två mått sätter positionen till hälften när de slår till:

- **Krigsspik:** geopolitiskt riskindex (GPR, Caldara och Iacoviello, matteoiacoviello.com/gpr.htm) som 7-dagarssnitt minst 15 % över
  medianen för senaste året. GPR räknar artiklar om krig, terror och hot i stora tidningar varje dag.
- **Akut oro:** VIX9D/VIX minst 1,04. Marknaden väntar sig då mer turbulens de närmaste dagarna än den närmaste månaden.

Båda gav sämre studsar i båda perioderna (starka signaler, OMXS30):

| Mått | Gynnsamt läge | Ogynnsamt läge |
|---|---|---|
| GPR mot normalt | Lugnt: +0,54 R (2017–21 +0,43, 2022–26 +0,68) | Spik: +0,21 R (+0,06 / +0,26) |
| VIX9D/VIX | Oron avtar: +0,49 R (+0,44 / +0,51) | Oron stiger akut: +0,22 R (+0,30 / +0,11) |

Ingen konsekvent effekt hade obligationsoro (MOVE), kreditspread (HYG/LQD), oljepriset, VIX-kurvans lutning, GPR:s delindex för
faktiska händelser och hot, samt dollarn när den stiger.

Kontot 2017–2026 med halv position vid krigsspik eller akut oro:

| Grundrisk | Per år 2017–2021 | Per år 2022–2026 | Per år, hela perioden | Största nedgång |
|---|---|---|---|---|
| 4 %, ingen justering | +18 % | +57 % | +36 % | −40 % |
| 4 % | +17 % | +48 % | +31 % | −24 % |
| 6 % | +23 % | +73 % | +46 % | −35 % |
| 7 % | +25 % | +86 % | +52 % | −40 % |

**Förväntningar och utfall:** Historiska konsensusprognoser för makrosiffror är betaldata. Marknadens förväntningar fångas i stället
via VIX, VIX9D och räntebesked i makropoängen.

### Ledig kassa: guld, räntor, krypto
Studsstrategin har bara en del av kontot i marknaden. Testet 2017–2026 lade den lediga delen, högst 50 %, i andra tillgångar.
Studsstrategin körs med 6 % grundrisk och halv position vid oro. Allt är räknat i SEK.

| Ledig kassa | Per år | Största nedgång |
|---|---|---|
| Kontanter med ränta | +47 % | −32 % |
| **50 % guld** | **+56 %** | **−31 %** |
| 50 % statsobligationer 20 år | +45 % | −34 % |
| 50 % statsobligationer 7–10 år | +46 % | −32 % |
| 25 % guld + 25 % statsobligationer 7–10 år | +51 % | −31 % |
| 10 % bitcoin | +56 % | −36 % |
| 40 % guld + 10 % bitcoin | +63 % | −35 % |

**Slutsatser:**
- **Guld** höjde avkastningen och sänkte nedgången något, eftersom det ofta stiger när aktier faller. Guld steg dock ovanligt mycket 2024–2025, så framtiden blir troligen svagare.
- **Statsobligationer** hjälpte inte, eftersom räntechocken 2022 slog mot både aktier och obligationer.
- **Bitcoin** höjde avkastningen men också nedgångarna.

**Bitcoins halveringscykel** (`lib/cycle.js`): Regeln äger bitcoin från 12 månader före en halvering till 18 månader efter,
och har kontanter annars. Räknat i SEK:

| 2015–2026 | Per år | Största nedgång |
|---|---|---|
| Köp och behåll | +63 % | −82 % |
| Cykel 12 mån före till 18 mån efter | +86 % | −61 % |
| Cykel 12 mån före till 15 mån efter | +65 % | −61 % |

Regeln var utanför marknaden under kraschen 2018 och 2022. Det finns bara tre cykler att testa på, och resultatet är känsligt för
exakt datum. I portföljen gav cykeln:

| Ledig kassa | Per år | Största nedgång |
|---|---|---|
| 40 % guld + 10 % bitcoin, köp och behåll | +63 % | −35 % |
| 40 % guld + 10 % bitcoin-cykel | +65 % | −33 % |
| 30 % guld + 20 % bitcoin-cykel | +75 % | −37 % |

Nästa köpfönster öppnar 2027-04-15 (halveringen väntas runt april 2028). Läget visas i marknadspanelen.

**Portfölj 50/40/10** (start 10 000 kr): 50 % guld hela tiden, 40 % bitcoin inom cykelns köpfönster och guld utanför, samt
10 % tradingkonto för studsstrategin. Risken är 6 % av tradingkontot per affär, och säkerheten för minifutures på 5x får inte
överstiga tradingkontot. Ombalansering sker varje månad. Kostnader för byten (0,5 %), ombalansering (0,2 %) och affärer ingår.

| Start | Slutvärde 2026-10-22 | Per år | Största nedgång | Utan trading | OMXS30 |
|---|---|---|---|---|---|
| 2015-07-09 (första cykeln) | ca 800 000 kr | +47 % | −28 % | +45 % | +7 % |
| 2019-05-11 (andra cykeln) | ca 108 000 kr | +38 % | −28 % | +34 % | +10 % |
| 2023-04-20 (tredje cykeln) | ca 27 000 kr | +33 % | −19 % | +29 % | +10 % |

Nästan hela avkastningen kommer från guld och bitcoin. Tradingdelen lägger till 2–4 procentenheter per år. Om 6 % risk tas av
hela portföljen i stället för av tradingkontot blir siffrorna mycket högre i teorin (96 % per år). Det kräver dock säkerhet
långt över de 10 %, alltså hävstång på 15–20x, och går inte att genomföra med upplägget.

**Portfölj 30/20/50:** 30 % guld hela tiden, 20 % bitcoin inom cykeln och guld utanför, samt 50 % tradingkonto. Risken är
6 % av hela portföljen per affär, och säkerheten får inte överstiga tradingkontot.

| Start | Minifutures 5x | Minifutures 10x | 5x med 4 % risk | 50/40/10 (ovan) |
|---|---|---|---|---|
| 2015-07-09 | 248 000 kr, +33 %/år, −38 % | 457 000 kr, +40 %/år, −41 % | 269 000 kr, +34 %/år, −30 % | 800 000 kr, +47 %/år, −28 % |
| 2019-05-11 | 83 000 kr, +33 %/år, −38 % | 141 000 kr, +43 %/år, −41 % | 84 000 kr, +33 %/år, −30 % | 108 000 kr, +38 %/år, −28 % |
| 2023-04-20 | 31 000 kr, +39 %/år, −27 % | 45 000 kr, +53 %/år, −30 % | 29 000 kr, +35 %/år, −23 % | 27 000 kr, +33 %/år, −19 % |

Det sista talet i varje ruta är största nedgång. Med 6 % risk och ett stopp på cirka 4 % behöver en affär en exponering på cirka
150 % av portföljen. Därför begränsas många affärer av säkerheten vid 5x. 10x ger plats för fler affärer, men är över appens
säkerhetsgräns för aktier (6x).

**Naturgas, kakao, kaffe** (studsstrategin, 10 år):

| Råvara | Snitt per affär | Kommentar |
|---|---|---|
| Naturgas | +0,05 R | Ingen fördel. Volatilitet 70 % per år. Börshandlade produkter tappar dessutom värde vid byte av terminskontrakt |
| Kakao | +0,15 R köp, +0,95 R blankning | Blankningarna är bara 30 affärer, nästan alla i boomen och kraschen 2024–2025. Inte pålitligt |
| Kaffe | +0,01 R | Ingen fördel |

### Makroparametrar: räntor, dollar, olja, Fed (2017–2026)
24 parametrar testades på 376 starka signaler. Gränserna (tredjedelar) sattes bara på 2017–2021, och resultatet kontrollerades
sedan på 2022–2026. En parameter räknas som robust om den pekar åt samma håll med minst 0,15 R skillnad i båda perioderna.

**Robusta parametrar:**

| Parameter | Dåligt läge | Bra läge |
|---|---|---|
| Dagar till Feds räntebesked | Under 15 dagar: +0,07 / +0,09 R | Över 34 dagar: +0,46 / +0,51 R |
| Dollar (DXY) mot 50-dagarssnitt | Över: +0,19 / +0,26 R | Under: +0,57 / +0,70 R |
| Dollar, 200-dagarssnitt, DXY 20 dagar, USD/SEK 20 dagar | Samma mönster som ovan, eftersom det är samma faktor | |
| GPR (krig) mot normalt | Hög: +0,35 / +0,29 R | Låg: +0,51 / +0,69 R |

Siffrorna är 2017–2021 / 2022–2026.

**Inte robusta:** 10-årsräntans nivå och förändring, räntekurvan (10 år − 3 mån), 3-månadersräntan, Brent (20 dagar,
5 dagar och mot 200-dagarssnittet), guld 20 dagar, koppar mot guld, OMXS30 5 och 20 dagar, VIX-nivå, VIX9D/VIX ensam,
antal Fed-tal de närmaste 3 dagarna, om Fed-ordföranden talar inom 3 dagar, samt S&P 500 mot 200-dagarssnittet.
Fed-talen kommer från federalreserve.gov/json/ne-speeches.json.

**Positionsstorlek i appen:** Tre riskfaktorer halverar var och en positionen:
1. Krigsspik eller akut oro.
2. Räntebesked inom 15 dagar.
3. Dollar över 50-dagarssnittet.

| Regel | 2017–2021 (regler valda här) | 2022–2026 (test) | Hela perioden |
|---|---|---|---|
| Bara krig/oro, 6 % grundrisk | +22 %/år, största nedgång −32 % | +73 %/år, −27 % | +45 %/år, −32 % |
| Alla tre, 6 % grundrisk | +23 %/år, −17 % | +53 %/år, −21 % | +37 %/år, −21 % |
| Alla tre, 8 % grundrisk | +29 %/år, −22 % | +72 %/år, −28 % | +49 %/år, −28 % |
| Alla tre, 10 % grundrisk | +35 %/år, −27 % | +91 %/år, −34 % | +60 %/år, −34 % |

Bara cirka 10 % av affärerna får full storlek.

**Rättning:** `data/fomc.json` saknade räntebesked före 2022, så makropoängen drog aldrig av för räntebesked 2017–2021.
Datum för 2015–2021 är nu tillagda från Feds historiska sidor (fomchistorical<år>.htm), inklusive extramötena i mars 2020.

### Nyheter
Rubriker från Google Nyheter visas för varje bolag, för börsen och för krig och geopolitik (högst 2 per källa). Varje rubrik märks med
Geopolitik, Makro, Rapport, Bud eller Analys. Rubrikerna påverkar inte signalerna, eftersom det inte finns någon gratis historik att
testa dem mot. För bolag med tvetydiga namn finns en egen sökfråga i `symbols.json` (`newsQuery`).

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

| 2022–2026, starka köpsignaler | Affärer | TP1 | TP2 | TP3 | Snitt per affär |
|---|---|---|---|---|---|
| OMXS30 (reglerna togs fram här) | 114 | 81,6 % | 73,7 % | 55,3 % | +0,71 R |
| 82 nordiska storbolag som reglerna aldrig sett | 280 | 71 % | 59 % | – | +0,29 R |

Testet på aldrig sedda aktier är det ärligaste måttet. Det omfattar resten av Large Cap Stockholm samt Oslo, Helsingfors och
Köpenhamn. Fördelen höll i både 2022–2024 och 2025–2026, men den var ungefär 40 % av vad OMX-testet visar.

### Kontosimulering
Simuleringen gäller 10 000 kr, 2023 till oktober 2026, och använder bara starka köpsignaler:

- **Positionsstorlek efter risk:** varje affär storleksanpassas så att en förlust vid stopp är den valda andelen av kontot.
- **Hävstång:** via minifutures, med högst 10 samtidiga positioner.
- **Kostnad:** 0,3 % av exponeringen per affär.

| Risk per affär | OMXS30 | Största nedgång | Nya nordiska aktier | Största nedgång |
|---|---|---|---|---|
| 2 % | +30 %/år | −17 % | +9 %/år | −24 % |
| 3 % | +45 %/år | −24 % | +11 %/år | −35 % |
| 4 % | +61 %/år | −31 % | +12 %/år | −44 % |
| 6 % | +92 %/år | −44 % | +9 %/år | −60 % |

Räkna med ett resultat mellan kolumnerna. **100 % per år går inte att nå med rimlig risk.** Signalerna kommer i klungor när
marknaden är rädd. Om marknaden fortsätter ned förlorar många positioner samtidigt.

**Testat men inte infört, eftersom inget förbättrade resultatet:**

| Förändring | Resultat |
|---|---|
| Följande stopp efter TP2 (2–3 ATR) i stället för TP3 | +0,52–0,53 R mot +0,525 R, lägre avkastning per år |
| Tidsgräns 10–15 dagar om TP1 inte nås | Lägre TP1-träff och lägre avkastning |
| Tak för total risk (12–30 %) | Stryker de bästa signalerna, som kommer i klungor. 20 % tak gav 32 %/år mot 99 % utan tak, med samma nedgång |
| Fler aktier (Large Cap och övriga Norden) | Fler affärer men svagare. Avkastningen blev lägre än med bara OMXS30 |
| Olika risk för olika signalnivåer | Liten förbättring. Ersattes av regeln att bara starka signaler handlas |

### Signallogg (framåttest)
Varje stark köpsignal sparas när dagens stängningskurs är klar, efter 18.00 svensk tid. Servern kör skannern varje timme.
Utfallet räknas sedan med samma regler som backtestet. Loggen visas under "Signallogg" i appen och är det enda riktiga beviset
på hur strategin fungerar framåt.

Loggen sparas i `data/signal-log.json` (eller `LOG_FILE`). Med `UPSTASH_REDIS_REST_URL` och `UPSTASH_REDIS_REST_TOKEN` sparas
den i stället i Upstash Redis. Det rekommenderas på gratis hosting, där filer försvinner vid omstart.

### Andra strategier (testade 2017–2026)
Klassiska strategier testades med standardparametrar på 10 års data. Kostnaderna är 0,05 % spread per köp och sälj plus
3 % finansiering per år på exponeringen:

| Strategi | Avkastning per år | Största nedgång |
|---|---|---|
| OMXS30 köp och behåll (prisindex, med finansieringskostnad) | +4,5 % | −32 % |
| Trendföljning 55/20, 10 marknader, lång och kort | −5 % | −67 % |
| Trendföljning 55/20, 10 marknader, bara lång | +12 % | −38 % |
| Trendföljning 20/10, bara lång | +11 % | −41 % |
| Månadsskiftet på OMXS30 | −0,6 % | −21 % |
| Momentum topp 5 OMXS30-aktier, månadsvis | +2,4 % | −36 % |

De 10 marknaderna i trendtestet är OMX, DAX, Nasdaq 100, S&P 500, Euro Stoxx 50, guld, silver, Brent, koppar och bitcoin.
Momentum är testat på dagens indexbolag, så resultatet är snarare för bra.

Ingen av strategierna slog studsstrategin, och ingen ingår i appen. Trendföljningens blankningar och snabba utbrott förlorade på
de många V-formade vändningarna 2019–2026.

### Hög hävstång (10–20x)
10–15 % risk per affär motsvarar ungefär att köra 10–20x hävstång. Så här gick det med starka köpsignaler:

| | 10 % risk | 15 % risk |
|---|---|---|
| OMXS30 (kalibrerat) | +150 %/år, största nedgång −64 % | +142 %/år, största nedgång −81 % |
| Nya nordiska aktier | −6 %/år, största nedgång −83 % (2025: +196 %, 2026: −72 %) | −34 %/år, största nedgång −90 % |

Ett enskilt år på flera hundra procent går alltså att få med samma signaler, men följande år kan radera det.

### 10 år och cyklisk kombination (2017–2026)
**Studsstrategin på 10 år** (starka köpsignaler, OMXS30):

| Period | Affärer | TP1 | TP2 | Snitt per affär |
|---|---|---|---|---|
| 2017–2021 (aldrig sett) | 163 | 67 % | 55 % | +0,31 R |
| 2022–2026 (kalibrerat) | 226 | 67 % | 56 % | +0,35 R |

Aktielistan är dagens indexbolag. Det kallas överlevnadsfel och gör de tidiga åren något för bra.

**Kontot med studsstrategin** och 4 % risk gav +51 % per år 2018–2026 med största nedgång −39 %. Åren som
reglerna aldrig sett gav betydligt mindre:

| År | 2018 | 2019 | 2020 | 2021 |
|---|---|---|---|---|
| Avkastning | −4 % | +66 % | +3 % | +56 % |

Det är i snitt cirka +27 % per år.

**Hävstång på index med trendfilter** (köp när indexet är över sitt 200-dagars medel) minskade nedgångarna men
också avkastningen 2017–2026, på grund av V-formade vändningar. Med 3x hävstång:

| Index | Köp och behåll | Med trendfilter |
|---|---|---|
| OMX | +4 %/år | −1 %/år |
| S&P 500 | +20 %/år | +12 %/år |
| Nasdaq 100 | +34 %/år | +30 %/år |

**Kombination** av index (uppgångsfaser) och studsaffärer (rädda faser) på samma konto:

| Kombination | Avkastning per år | Största nedgång |
|---|---|---|
| S&P 500 1x + studs 3 % | +49 % | −51 % |
| Nasdaq 100 1x + studs 3 % | +57 % | −50 % |

Avkastningen blir högre, men nedgångarna blir djupare (2018 och 2022). Nasdaq är vald i efterhand som den bästa marknaden.

## Korta affärer (1–5 dagar)
Strategin ovan håller affärer i median 16 dagar. Följande testades för affärer på 1–5 dagar, 2017–2026, med kostnader
(0,1 % per köp och sälj samt 3 % finansiering per år) och med det faktiska indexinnehållet.

**Swingsignalerna med kort hålltid** gav +0,05 R per affär vid max 2–3 dagar och +0,09 R vid max 5 dagar. Det räcker inte till
kostnaderna, som är cirka 0,07 R.

**Klassiska kortsiktiga strategier** (RSI(2), IBS, Double 7):

| Marknad | 1x hävstång | 3x hävstång |
|---|---|---|
| OMXS30-index och DAX | −7 till −1 %/år | −14 till +1 %/år |
| S&P 500 och Nasdaq 100 | −6 till +2 %/år | upp till +14 %/år (IBS på Nasdaq) |
| OMXS30-aktier | −8 till 0 %/år, även med makrofilter | −29 till −11 %/år |

**Maskininlärning** (ridge-regression och gradient boosting) med 38 egenskaper för varje aktie och dag: tekniska mått,
OMXS30, bredd, VIX, VIX9D/VIX, S&P 500 och Nasdaq från dagen innan, dollarn, USD/SEK, krigsrisk (GPR), räntebesked,
rapportdatum och kalender. Modellen tränades bara på åren före varje testår (2019–2026), och prognoserna gällde 1–3 dagar.

| Test | Resultat |
|---|---|
| Aktier | Den översta tiondelen av prognoserna gav 0,2–0,3 % på 2–3 dagar, ungefär lika mycket som kostnaderna. Alla handelsvarianter blev minus eller runt noll |
| OMXS30-index, lång och kort | Rätt riktning i 48–50 % av fallen, alltså ingen förmåga att förutse |

**Slutsats:** Med fri data finns ingen fördel för 1–3-dagarsaffärer i svenska storbolag eller OMXS30 som klarar
kostnaderna. Fördelen som finns tar 1–3 veckor att spela ut.

### Fyra parallella forskningsspår (1–5 dagar)
Alla spår förregistrerade sina varianter, valde regler på 2017–2021 och testade oförändrat på 2022–2026, med kostnader.

| Spår | Testade varianter | Resultat |
|---|---|---|
| Data inom dagen (timdata 2023–2026): öppningsintervall, gap, intradagsmomentum, natt/dag, USA-öppningen | ca 260 | Inget lönsamt i testperioden. Förutsägbara rörelser 0–0,05 % per affär mot 0,1–0,2 % i kostnad |
| Index: natt/dag, ledning från USA, pre-FOMC, månadsskifte, helgdagar, optionslösen, VIX-panik | 46 | Inget handlingsbart. Pre-FOMC (köp dagen före Feds besked) är positivt i båda perioderna men bara ca +1 %/år. USA:s rörelse syns direkt i OMX-öppningen och sedan finns inget kvar |
| Händelser i aktier: rapportgap, drift efter rapport, gap utan rapport, utdelning, fall på −5 %, indexändringar | 116 | Inget robust. Det som klarade urvalet var negativt i det nordiska testet. Drift efter rapport fungerade 2017–2021 men vände till förlust från 2022 |
| Parhandel: A/B-aktier (16 par) och liknande bolag (18 par) | 960 | Ingen fördel efter kostnader. Den skenbara vinsten när köp räknas på signalens stängningskurs är ett mätfel orsakat av spreaden i illikvida A-aktier |

Datavarning: Yahoos öppningskurser för ^OMX är felaktiga fram till februari 2020 (öppning ≈ gårdagens stängning).

## Slutligt test av hela systemet
Testet omfattar 10 000 kr, 2017-01-02 till 2026-10-22. Det använder alla regler: rapportspärr, makrofilter, de tre
riskfaktorerna och 8 % grundrisk. Säkerheten för minifutures får aldrig överstiga tradingkontot.

**Utan överlevnadsfel:** Testet använder bara bolag som faktiskt var med i OMXS30 på signaldagen. Indexändringarna är
rekonstruerade från sv.wikipedia.org/wiki/OMXS30. Det betyder att bolag som senare åkte ur (Autoliv, Securitas, SSAB, Lundin,
Electrolux, Getinge, Kinnevik, SBB, Sinch, Atlas Copco B) är med under sin tid i indexet. Bolag som kom in senare (Saab, Nibe,
Evolution och de som kom in 2025) är med först från inträdet. Swedish Match (med till november 2022) och Fingerprint Cards (med
till juli 2018) saknas, eftersom kursdata inte finns.

| Starka signaler | 2017–2021 | 2022–2026 |
|---|---|---|
| Dagens 30 bolag (överlevnadsfel) | +0,31 R, TP1 67 %, TP2 55 % | +0,37 R, TP1 67 %, TP2 56 % |
| Faktiskt indexinnehåll | +0,29 R, TP1 64 %, TP2 52 % | +0,26 R, TP1 62 %, TP2 51 % |

Bolag som senare åkte ur gav −0,02 R när de var med.

**Portföljer, faktiskt indexinnehåll:**

| Upplägg | Slutvärde | Per år | Största nedgång | Sämsta år |
|---|---|---|---|---|
| **50/40/10** (50 % guld, 40 % bitcoin-cykel/guld, 10 % trading, 8 % av tradingkontot) | **413 000 kr** | **+46 %** | **−27 %** | +3 % (2026) |
| 30/20/50, 8 % av hela portföljen, 10x | 433 000 kr | +47 % | −52 % | −38 % (2022) |
| 40/30/30, 8 % av hela, 10x | 359 000 kr | +44 % | −43 % | −30 % (2022) |
| Bara studsstrategin, 8 %, 10x | 176 000 kr | +34 % | −51 % | −31 % (2022) |
| 50/40/10 utan trading | 338 000 kr | +43 % | −26 % | 0 % (2026) |
| OMXS30 köp och behåll | 21 000 kr | +8 % | −32 % | −16 % (2022) |

Med dagens 30 bolag gav 30/20/50 med 10x +53 % per år och −32 % som största nedgång, utan minusår. Med det faktiska
indexinnehållet blev 2022 i stället −38 %. Förlusterna kom tidigt i björnmarknaden, när många positioner var öppna samtidigt i
Kinnevik, Sinch, Electrolux och Atlas Copco B. Summan av alla affärer 2022 var ändå +9 R. Upplägg där tradingen tar en
stor del av risken är alltså känsliga för vilka aktier som ingår. 50/40/10 påverkas nästan inte.

**Rekommendation:** 50/40/10. Det har den jämnaste kurvan och har klarat alla tester. Nästan hela avkastningen kommer från guld
och bitcoin-cykeln, som är testade på få cykler och en period med ovanligt starka år.

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

### Publicera på Vercel (gratis)
1. **Vercel:** Add New → Project → välj repot `omx-analys` → Deploy. Inga byggsteg behövs. `vercel.json` skickar alla anrop
   till `api/index.js` och tar med `public/`, `symbols.json` och `data/`.
2. **Upstash Redis (gratis):** Storage → Upstash for Redis, eller ett eget konto på console.upstash.com. Lägg in
   `UPSTASH_REDIS_REST_URL` och `UPSTASH_REDIS_REST_TOKEN` under Settings → Environment Variables. Vercels egna namn
   (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) fungerar också. Utan Redis kan signalloggen inte sparas på Vercel.
3. **Aviseringar:** installera appen *ntfy* på mobilen och prenumerera på ett eget, svårgissat ämne. Lägg samma ämne i
   `NTFY_TOPIC` och appens adress i `APP_URL`. Gör en ny deploy efter att variablerna är satta.
4. **Daglig skanning:** Vercel Cron anropar `/api/cron/scan` vardagar kl. 17 UTC (18–19 svensk tid). Det fungerar på
   gratisplanen, men körningen kan ske när som helst inom timmen. Nya starka köpsignaler sparas i signalloggen och skickas som notis.

Lokalt körs appen som vanlig server med `npm start`.

| Miljövariabel | Vad den gör |
|---|---|
| `PORT` | Port, standard 3000 |
| `APP_URL` | Appens adress, används för länken i notiser |
| `NTFY_TOPIC` | ntfy-ämne för aviseringar. Utan den skickas inga notiser |
| `NTFY_URL` | Egen ntfy-server, standard https://ntfy.sh |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Sparar signalloggen i Upstash Redis |
| `LOG_FILE` | Fil för signalloggen utan Redis, standard `data/signal-log.json` (lokalt) |

## Struktur
- `lib/indicators.js`: EMA, RSI, ATR, MACD
- `lib/structure.js`: ZigZag, fraktaler, stöd/motstånd, FVG, Fibonacci
- `lib/elliott.js`: Elliottvågor
- `lib/analyze.js`: poäng, handelsplan och backtest
- `lib/avanza.js`: urval av minifutures och certifikat på Avanza
- `lib/events.js`: rapportdatum (Yahoo Finance) och räntebesked
- `lib/macro.js`: marknadsläge (OMXS30-trend, bredd, VIX, FOMC)
- `lib/log.js`: signallogg för framåttest
- `lib/stress.js`: krigsrisk (GPR, läser Stata-fil) och akut oro (VIX9D/VIX)
- `lib/news.js`: nyhetsrubriker från Google Nyheter
- `lib/cycle.js`: bitcoins halveringscykel
- `lib/notify.js`: aviseringar via ntfy
- `data/`: historiska rapportdatum och FOMC-kalender
- `api/index.js`, `vercel.json`: körning på Vercel
- `server.js`: API (`/api/scan`, `/api/analysis?symbol=`, `/api/products?symbol=`, `/api/summary`, `/api/macro`, `/api/log`, `/api/news`) och statiska filer
- `public/`: gränssnittet med en egen canvas-graf (dra för att panorera, scrolla eller nyp för att zooma, dubbelklicka för att återställa)
