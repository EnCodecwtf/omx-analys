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

### Truflation (amerikansk inflation varje dag)
Truflations inflationstakt för USA hämtades från TRUF Network (publik ström `st1e321de22ece39a258bc2588dd2871`
från `0x4710a8d8f0d845da110086812a32de6d90d7ff5c`, daglig sedan 2010; före 2021 är serien bakåträknad).
Värdet dagen före signalen användes.

**Appens signaler 2022-11–2026 (makro ≥ 1, rapportspärr):**

| Regel | Signaler/år | TP1 | TP2 | Snitt |
|---|---|---|---|---|
| Som appen | 29 | 82 % | 74 % | +0,71 R |
| Spärr om inflationen stiger mer än 0,3 procentenheter på 30 dagar | 23 | 83 % | 76 % | +0,80 R |
| Spärr om inflationen stiger alls på 30 dagar | 14 | 85 % | 80 % | +0,90 R |
| Spärr om inflationen är över 3 % | 23 | 82 % | 71 % | +0,65 R |
| Neutralt makro räcker om inflationen faller (30 dagar) | 41 | 78 % | 70 % | +0,59 R |
| Neutralt makro räcker om inflationen stiger (motprov) | 36 | 76 % | 69 % | +0,60 R |

**Överlevnadsfritt 2017–2021 / 2022–2026 (356 signaler):** inflationens riktning (30, 60 och 90 dagar) byter tecken
mellan perioderna: fallande inflation gav +0,18 / +0,37 R och stigande +0,45 / +0,16 R. Inflationsnivån över 2,4 % gav
+0,13 / +0,10 R mot +0,36 / +0,69 R under, men på appens egna signaler gav nivån över 2,4 % fortfarande +0,66 R
och över 3 % +0,89 R.

**Slutsats:** inte robust, så Truflation påverkar inte signalerna. Spärrarna som höjer snittet tar bort fler bra
affärer än dåliga (färre R totalt), och att släppa in fler signaler när inflationen faller gav ungefär samma
tillskott som motprovet.

### Klassiska formationer (2017–2026, överlevnadsfritt)
`lib/patterns.js` hittar inverterad head & shoulders, dubbelbotten, cup & handle och stigande triangel (köp när kursen
stänger över halslinjen eller mellantoppen), samt head & shoulders och dubbeltopp (sälj). Mönstren byggs av
ZigZag-svängarna (2,5 ATR). Stoppet ligger under sista bottnen och målet är mönstrets höjd från utbrottet.
Testet gäller bara bolag som var med i OMXS30 på signaldagen. Avgifter: 0,3 % (swing) och 0,2 % (max 5 dagar).

| Mönster | Swing 2017–21 / 2022–26 | Max 5 dagar 2017–21 / 2022–26 |
|---|---|---|
| Inverterad head & shoulders | −0,29 / −0,04 R (27/30) | −0,05 / +0,04 R |
| Dubbelbotten | −0,15 / +0,00 R (38/44) | −0,08 / +0,06 R |
| Cup & handle | −0,38 / −0,35 R (4/4) | −0,12 / +0,02 R |
| Stigande triangel | +0,07 / +0,07 R (8/13) | +0,15 / −0,06 R |
| Alla köpmönster, ingen rapport, makro ≥ 1 | +0,08 / +0,13 R (22/17) | −0,04 / +0,03 R |
| Head & shoulders (sälj) | +0,28 / +0,03 R (21/32) | +0,07 / +0,01 R |
| Dubbeltopp (sälj) | −0,33 / −0,15 R (60/76) | −0,05 / −0,02 R |

Som filter på appens signaler: ett köpmönster som bildas gav +0,25 / +0,10 R mot +0,31 / +0,32 R utan, och ett
säljmönster de senaste 20 dagarna +0,36 / +0,09 R mot +0,26 / +0,36 R utan. Ingen skillnad håller i båda perioderna.

**Slutsats:** formationerna ger ingen fördel efter avgifter och påverkar inte signalerna. De visas i grafen och i
Elliott-kortet som information, när utbrottet skett de senaste 20 dagarna eller kursen är mer än halvvägs mot det.

### Insynshandel och blankning (Finansinspektionen, 2017–2026)
Data från FI: insynsregistret (marknadssok.fi.se, export per bolag och år, 6 774 köp och försäljningar av aktier på
handelsplats, utan aktieprogram) och blankningsregistret (fi.se, historiska och aktuella positioner över 0,5 %, summerade
per bolag och dag). Insynsaffärer räknas från publiceringsdagen, så inget används innan det var känt. Bara bolag som var
med i OMXS30 på dagen. Överavkastning är mot OMXS30 och före avgifter (cirka 0,2 % per affär).

**Som filter på appens signaler (2017–21 / 2022–26, alla: +0,29 / +0,26 R):**

| Läge | Utfall |
|---|---|
| Insynsköp netto senaste 90 dagarna | +0,52 / +0,22 R (övriga +0,15 / +0,32 R) |
| Minst 2 insynsköpare senaste 90 dagarna | +0,36 / +0,17 R |
| Blankning minst 2 % | +0,67 / −0,27 R |
| Blankningen ökat senaste 4 veckorna | +0,47 / −0,18 R |

Alla byter riktning mellan perioderna.

**Egna strategier, köp dagen efter (överavkastning efter 5 / 10 / 20 dagar, 2017–21 → 2022–26):**

| Händelse | 5 dagar | 10 dagar | 20 dagar |
|---|---|---|---|
| Insynsköp netto samma dag (747) | +0,11 → +0,22 % | +0,33 → +0,21 % | +0,46 → +0,12 % |
| Insynsköp minst 1 Mkr (366) | −0,26 → +0,25 % | −0,38 → +0,50 % | −0,24 → +0,49 % |
| VD eller ordförande köper minst 0,5 Mkr (232) | −0,70 → −0,02 % | −0,81 → −0,15 % | −1,49 → −0,35 % |
| Kluster: minst 2 köpare inom 30 dagar (427) | −0,03 → +0,00 % | +0,46 → +0,11 % | +0,39 → −0,29 % |
| Hög blankning (minst 3 %) som minskar minst 0,5 procentenheter på 4 veckor (106) | +0,45 → +0,02 % | +0,16 → +0,99 % | +2,15 → +0,38 % |

Täckande blankare såg lovande ut veckovis, men med en händelse per tillfälle (20 dagars spärr) är inget t-värde över cirka
2. Resultatet drivs av några få stora rörelser i SBB och Sinch, och 12 varianter av gränserna ger blandade tecken.

**Slutsats:** varken insynsköp eller blankning ger en robust fördel efter avgifter, varken som filter eller som egen strategi.
Inget av det används i appen.

### Krypto: fler signaler, även på helger (2016–2026)
Daglig data från Yahoo (BTC-USD, ETH-USD, SOL-USD). Kostnad 0,2 % per affär på en kryptobörs, 0,5 % för ETP:er på Avanza.

**Appens regler på bitcoin:** köpsignalen (rekyl vid stöd) gav −0,20 / −0,21 R (2017–21 / 2022–26), säljsignalen
−0,38 / −0,25 R. Rekylstrategin fungerar inte på krypto.

**Utbrott till ny 20-dagarstopp när kursen är över EMA 200, sälj efter 7 dagar** (snitt per affär efter avgifter, jämfört
med att äga samma antal dagar över EMA 200):

| | 2017–19 | 2020–21 | 2022–23 | 2024–26 |
|---|---|---|---|---|
| Bitcoin, utbrott | +4,80 % | +4,05 % | +2,49 % | +1,19 % |
| Bitcoin, alla dagar över EMA 200 | +3,17 % | +1,75 % | +0,47 % | +0,71 % |
| Ether, utbrott | −0,54 % (6) | +5,11 % | +0,01 % | +2,33 % |
| Ether, alla dagar över EMA 200 | −1,53 % | +2,94 % | +0,18 % | +0,98 % |

Bitcoin slår jämförelsen i alla fyra perioderna, med 13 affärer om året och 25 % av tiden i marknaden. Ether slår den i
tre av fyra. Utan hävstång gav bitcoin 45 %/år med största nedgång −53 % (köp och behåll: 60 %/år, −83 %). Med 2x
hävstång: 2022 −2 %, 2023 +110 %, 2024 +20 %, 2025 +30 %, 2026 −15 %. 3x gav sämre resultat än 2x. Bara vardagar
(Avanza-ETP, 0,5 %) gav 29 %/år utan hävstång. RSI(2) under 10 över EMA 200 gav +0,7 % per affär i alla perioder på
bitcoin men inte på ether. Fredag–måndag (helgeffekt) gav +0,50 / −0,05 %.

**Slutsats:** utbrott i upptrend är det första korta upplägget som håller i alla perioder, men bara på krypto, med stora
svängningar (spridning 10 % per affär, sämsta −25 %) och svagare de senaste åren.

**En signal i veckan:** OMX-signalerna (överlevnadsfritt) gav 0,78 signaler per vecka 2018–2026. Med bitcoin- och
ether-utbrotten blir det 1,18 per vecka, minst en signal i 51 % av veckorna och längsta tomma period 14 veckor (39 med
bara OMX). Kontosimulering från 10 000 kr 2018 (OMX 6 % risk per R med appens riskfaktorer, krypto 30 % av kontot per affär,
utan hävstång):

| Kombination | Slutvärde | Per år | Största nedgång |
|---|---|---|---|
| Bara OMX | 78 666 kr | +26 % | −45 % |
| OMX + bitcoin | 145 213 kr | +35 % | −49 % |
| OMX + bitcoin + ether | 286 131 kr | +46 % | −45 % |

År för OMX + bitcoin + ether: 2018 −5 %, 2019 +78 %, 2020 +54 %, 2021 +127 %, 2022 −33 %, 2023 +100 %, 2024 +76 %,
2025 +84 %, 2026 +12 %. Simuleringen bokar varje affär när den stängs och tar inte hänsyn till att affärer överlappar.

**I appen:** bitcoin och ether finns i skannern som "Krypto". Signalen kommer när dygnets stängning (UTC) är på ny
20-dagarstopp över EMA 200, och planen är att köpa och sälja efter 7 dagar med 30 % av kontot. Skanningen körs varje kväll,
även helger, och kryptosignalerna sparas i signalloggen med utfall i procent (`lib/crypto.js`).

### Råvaror: guld, olja, naturgas och kakao med väder och krig (2010–2026)
Terminspriser från Yahoo (GC=F, BZ=F, NG=F, CC=F) och fonderna UNG och BNO som kontroll, eftersom de har kostnaden för att
rulla kontrakten inräknad. Väder från NASA POWER: nederbörd på fem orter i Elfenbenskusten och Ghana (kakao) och temperatur
i sex amerikanska storstäder (uppvärmnings- och kylbehov, naturgas), jämfört med samma period de tio föregående åren.
Krig och oro från GPR-indexet. Snitt per affär efter avgift, 2010–17 / 2018–26.

| Strategi | Guld | Olja | Naturgas | Kakao |
|---|---|---|---|---|
| Köp och behåll 7 dagar (jämförelse) | −0,16 / +0,13 % | −0,14 / +0,22 % | −0,41 / +0,20 % | −0,44 / +0,09 % |
| 20-dagars utbrott upp, 7 dagar | +0,20 / −0,12 % | +0,58 / +0,53 % | −1,00 / −1,02 % | −0,41 / +0,21 % |
| 20-dagars utbrott ned, blanka 7 dagar | +0,33 / −0,95 % | +0,40 / −0,29 % | −2,18 / −2,24 % | −1,00 / −1,77 % |
| RSI(2) under 10 över EMA 200 | −0,31 / +0,01 % | −1,20 / +0,65 % | +0,63 / −0,47 % | −1,20 / −0,43 % |

**Krig och oro:** guld efter en ny krigsspik (GPR över 1,3) gav +0,23 / −0,25 % på 5 dagar och −1,13 / +0,27 % på 20 dagar.
Olja −0,74 / +0,09 % och −0,29 / +1,35 %. Hög GPR förbättrade inte utbrotten i guld eller olja.

**Kakao och nederbörd:** torrt (under 70 % av normalt på 30 dagar) gav +0,09 / +0,44 % per vecka, normalt −0,69 / −0,27 %
och blött −0,14 / +0,53 %. Köp när torka börjar (60 dagar under 70 %): +2,10 / +7,47 % på 40 dagar men bara 6 och 11 fall
(t under 1).

**Naturgas och temperatur:** kallare vinter än normalt de senaste 7 dagarna gav +0,46 / −5,89 % per vecka. Varmare än
normalt −1,21 / +1,17 %. Säsong per månad byter tecken mellan perioderna utom juni–juli (negativa) och april (positiv).
Väderdatan är faktiskt utfall. Marknaden handlar på prognoser, så utfallet är redan inräknat i priset.

**Enda mönstret som håller:** naturgas faller tillbaka efter en 20-dagarstopp. Att blanka UNG i 7 dagar efter en ny
20-dagarstopp gav +1,08 / +1,88 / +1,23 / +1,27 % i fyra delperioder (jämförelse att alltid blanka: +0,50 / +0,97 / +0,17 /
−0,33 %), men bara cirka 6 affärer om året och t 1,5 totalt.

**Slutsats:** väder och krig ger ingen robust fördel på råvarorna. Inget läggs in i appen.

### Lönings- och månadsskifteseffekten (OMXS30, 2010–2026)
Svenska löner betalas den 25:e (vardagen före vid helg), och mycket månadssparande i fonder dras då. Snittavkastning per dag
i OMXS30 (stängning till stängning) och i XACT OMXS30 (från 2013), 2010–17 / 2018–26. En vanlig dag gav +0,03 / +0,04 %.

| Dag | OMXS30 | XACT OMXS30 |
|---|---|---|
| Löningsdagen | +0,15 / +0,09 % | +0,04 / +0,15 % |
| Dagen efter | +0,13 / +0,13 % | +0,13 / +0,17 % |
| Två dagar efter | +0,26 / +0,04 % | +0,07 / +0,03 % |

Att äga index löningsdagen till två dagar efter (efter 0,1 % avgift): +0,44 / +0,16 % per månad (t 2,4 / 1,1)
i OMXS30 och +0,13 / +0,25 % (t 0,4 / 1,7) i XACT, cirka 2–5 % om året med 3 dagar i marknaden per månad.
Månadsskiftet (dag −1 till +2) gav −0,20 / −0,02 % och byter tecken mellan indexet och fonden.

**Slutsats:** löningsdagen och dagen efter är positiva i alla fyra mätningar, men effekten är liten (cirka 0,1 % extra per
dag) och inte statistiskt säker i varje period för sig. Används inte i appen.

### Stoppet: bredare, inget eller tidigare (2017–2026)
Samma signaler (dagens OMXS30-bolag, 387 st) med olika stopphantering. Resultat i R mot appens stoppavstånd, 2017–21 / 2022–26.

| Variant | Vinst | Till stopp | Sämsta | Snitt | Snitt per riskerad krona |
|---|---|---|---|---|---|
| Som appen (1R, break-even efter TP2) | 58 / 58 % | 32 / 31 % | −1,6 R | +0,32 / +0,35 R | +0,33 |
| Break-even efter TP1 | 67 / 65 % | 32 / 31 % | −1,6 R | +0,27 / +0,26 R | +0,27 |
| Stopp 1,5R | 68 / 66 % | 24 / 24 % | −2,8 R | +0,39 / +0,38 R | +0,26 |
| Stopp 2R | 75 / 73 % | 18 / 17 % | −3,0 R | +0,45 / +0,49 R | +0,24 |
| Inget stopp, sälj efter 20 dagar | 76 / 73 % | 0 % | −11,8 R | +0,56 / +0,47 R | – |
| Inget stopp, sälj efter 60 dagar | 91 / 86 % | 0 % | −11,0 R | +1,02 / +0,83 R | – |
| Tidsstopp: sälj om TP1 inte nåtts på 5 dagar | 52 / 58 % | 22 / 18 % | −1,6 R | +0,14 / +0,28 R | +0,21 |
| Stopp 0,5R | 39 / 42 % | 50 / 51 % | −1,3 R | +0,20 / +0,19 R | +0,39 |

Ett bredare stopp kräver en mindre position för samma risk i kronor, så snittet ska delas med stoppets bredd.

**Bolag som senare åkte ur OMXS30** (82 signaler medan de var med): som appen −0,02 R, stopp 1,5R −0,22 R, stopp 2R −0,16 R,
inget stopp 20 dagar −0,11 R (sämsta −8,1 R), inget stopp 60 dagar −0,01 R (sämsta −13 R).

**Tätare stopp, efter 0,3 % avgift per affär** (per riskerad krona, dagens bolag 2017–21 / 2022–26 och bolag som åkte ur):

| Stopp | Vinst | Till stopp | Per riskerad krona | Bolag som åkte ur |
|---|---|---|---|---|
| 1R (som appen) | 58 / 58 % | 32 / 31 % | +0,23 / +0,27 | −0,08 |
| 0,75R | 48 / 50 % | 39 / 39 % | +0,22 / +0,27 | −0,13 |
| 0,5R | 39 / 42 % | 50 / 51 % | +0,23 / +0,22 | −0,17 |
| 0,33R | 32 / 30 % | 63 / 65 % | −0,03 / +0,07 | −0,27 |

Ett tätare stopp ger mindre förluster per affär men fler förluster, större position för samma risk och högre avgift per
riskerad krona. Det blir inte bättre än appens stopp.

**Slutsats:** fler vinnande affärer utan stopp är en effekt av att testet bara har med bolag som klarade sig. Med bolagen som
föll blir det sämre, och en enda affär kan kosta 8–13 gånger den planerade risken. Appens stopp ger bäst resultat per riskerad
krona. Break-even efter TP1 ger fler vinnande affärer (65–67 %) men lägre snitt.

### Vad är normalt? och nedgångsregeln
Panelen "Vad är normalt?" under backtestet visar andel förluster, längsta förlustsvit, djupaste nedgång (R) och längsta tid
utan ny topp: för 10 år med alla indexbolag (356 affärer: 44 % förluster, 10 i rad, −23,6 R, 112 affärer utan ny topp),
för appens backtest och för signalloggen just nu. Om läget nu blir sämre än något som hänt i testerna säger panelen det.

Nedgångsregeln: fyll i kontots högsta värde under grafen. När kontot är 20 % under toppen halveras risken i
positionsstorleken, vid 30 % blir den en fjärdedel. Toppen uppdateras automatiskt när kontot når en ny högsta nivå.

Bitcoin och Ether visas bara under fliken Krypto, så att listan i övrigt är ren OMX.

### Vinstmål och RR (2017–2026)
378 signaler (dagens bolag 2017–21 / 2022–26 och bolag som åkte ur), snitt per affär i R efter 0,3 % avgift.

| Mål | Vinst | Snitt 2017–21 / 2022–26 / åkte ur | Summa | Förluster i rad | Nedgång |
|---|---|---|---|---|---|
| Som appen (nivåer, cirka 0,8 / 1,5 / 2,5R) | 57 / 58 / 46 % | +0,23 / +0,27 / −0,08 R | 69 R | 12 | −31 R |
| 1 / 2 / 3R | 51 / 51 / 38 % | +0,29 / +0,33 / −0,02 R | 91 R | 15 | −37 R |
| 1,5 / 3 / 4,5R | 48 / 46 / 33 % | +0,42 / +0,41 / +0,01 R | 124 R | 16 | −39 R |
| Allt vid 3R | 46 / 45 / 33 % | +0,51 / +0,47 / −0,01 R | 142 R | 16 | −44 R |
| TP1 som appen, resten följer 2 ATR | 67 / 64 / 54 % | +0,13 / +0,18 / −0,09 R | – | – | – |

Att bara ta signaler där TP2 ligger minst 1,5R bort gav +0,13 / +0,64 / −0,53 R och håller inte.
Nedgången är summan i R utan riskfaktorer och utan hänsyn till att affärer överlappar, så den ska bara jämföras mellan raderna.

**Slutsats:** högre mål ger klart mer per affär i alla tre grupperna, men färre vinnande affärer och längre förlustsviter.
Appens mål är valda för hög träffsäkerhet (TP1 över 60 %, TP2 minst 54 %). Att låta vinnarna löpa med följande stopp
gav sämre resultat.

### Upp- och nedtrend: köp i upptrend, blanka i nedtrend (2017–2026)
Regim = OMXS30 över eller under EMA 200 på signaldagen. Aktier inklusive bolag som åkte ur OMXS30, efter avgift
(2017–21 / 2022–26 / bolag som åkte ur).

| Strategi | Utfall | Signaler/år |
|---|---|---|
| Som appen: rekyl köp, makro ≥ 1 | +0,27 / +0,25 / −0,08 R | 37 |
| Rekyl köp i alla lägen | +0,20 / +0,21 / −0,11 R | 58 |
| Rekyl köp, bara upptrend | +0,12 / +0,26 / −0,14 R | 34 |
| Rekyl köp, bara nedtrend | +0,28 / +0,18 / −0,08 R | 28 |
| Upptrend: köp rekyl i stark aktie (trend-läge) | −0,14 / +0,07 / −0,08 R | 54 |
| Nedtrend: blanka studs i svag aktie | −0,44 / −0,21 / −0,20 R | 19 |
| Upptrend: köp ny 20-dagarstopp, 7 dagar | −0,16 / −0,28 / −0,31 % | 229 |
| Nedtrend: blanka ny 20-dagarsbotten, 7 dagar | −0,29 / +0,09 / +0,79 % | 88 |

OMXS30-index 2017–2026: köp och behåll +7,8 %/år (största nedgång −32 %), lång över EMA 200 annars kassa +4,0 % (−19 %),
lång över och kort under EMA 200 −0,1 % (−33 %).

**Slutsats:** att blanka i nedtrend förlorar i alla varianter. Rekylköpen fungerar i både upp- och nedtrend, så trenden
behöver inte vända strategin. De 21 extra signalerna om året utan makrofilter gav cirka +0,05 / +0,14 R per affär och
−0,16 R i bolagen som åkte ur, alltså nästan ingen fördel.

### Råvaror: studs på trendlinje och rekyler i upptrend (2010–2026)
Guld, silver, olja (Brent), naturgas och kakao, terminer och fonderna GLD, SLV, BNO och UNG. Stopp och mål 2R, max 20 dagar,
i R efter avgift (0,2–0,4 %), 2010–17 / 2018–26.

| Signal | Guld | Silver | Olja | Naturgas | Kakao |
|---|---|---|---|---|---|
| Appens rekylsignal | +0,02 / −0,14 | +1,65 / −0,41 | −0,15 / +0,20 | −0,09 / +0,01 | +0,61 / +0,04 |
| Appens trend-läge | −0,18 / +0,06 | +0,16 / −0,20 | −0,12 / −0,20 | −0,21 / −0,13 | +0,07 / −0,22 |
| Studs på stigande trendlinje (två senaste bottnarna) | −0,45 / +0,36 | +0,01 / −0,40 | −0,06 / −0,66 | +0,15 / +0,01 | −0,24 / +0,07 |
| Studs på EMA 50 i upptrend | −0,24 / −0,03 | −0,22 / −1,26 | −0,07 / −0,26 | −0,35 / +0,03 | −0,02 / +0,20 |
| RSI(2) under 10 i upptrend | −0,07 / +0,20 | −0,13 / +0,06 | −0,24 / +0,12 | −0,10 / −0,11 | −0,29 / −0,38 |
| Jämförelse: var 10:e dag i upptrend | −0,01 / +0,05 | −0,36 / +0,09 | −0,04 / +0,02 | −0,07 / −0,05 | −0,28 / +0,09 |

Fonderna gav samma bild. Inget t-värde är över 2 i båda perioderna, och 15–30 affärer per period och råvara är för få.

**Slutsats:** studsar på trendlinjer och rekyler i upptrend ger ingen fördel på råvarorna. Inget läggs in i appen.

### Proffsdata: COT-positioner och EIA-lager (2011–2026)
**CFTC Commitments of Traders** (cftc.gov, veckovis sedan 2008): nettopositioner för producenter, stora spekulanter och små
aktörer i guld, silver, olja (WTI), naturgas, kakao, koppar och S&P 500. Index = läget inom de tre senaste årens spann.
Rapporten gäller tisdag och publiceras fredag, så köp sker första handelsdagen efter fredagen. Överavkastning mot marknadens
snitt för samma period, alla sju marknader, en signal i taget per marknad, 2011–17 / 2018–26:

| Signal | 5 dagar | 20 dagar |
|---|---|---|
| Producenter extremt långa, köp | −0,06 / +0,40 % | −0,70 / +1,08 % |
| Producenter extremt korta, sälj | +0,28 / −0,23 % | +0,20 / −0,27 % |
| Spekulanter extremt korta, köp | +0,29 / +0,02 % | −0,06 / +0,57 % |
| Spekulanter extremt långa, sälj | −0,03 / −0,33 % | +0,60 / −0,62 % |
| Småspararna extremt långa, sälj | +0,38 / −0,18 % | +0,79 / −0,93 % |

Inget t-värde över 1,2 och nästan alla byter tecken mellan perioderna.

**EIA veckolager** (eia.gov): naturgas i lager och råoljelager, jämfört med femårssnittet för samma vecka, och veckans
förändring jämfört med normal förändring. Publiceringsdagen räknas in. Bästa resultat: naturgaslager över 5 % under
femårssnittet, köp UNG i 5 dagar +1,61 % (t 2,4), men bara mätbart 2018–26. Råolja: alla varianter byter tecken mellan
perioderna eller har t under 1,7.

**Slutsats:** inte heller COT- och lagerdata ger en fördel som håller. Det som saknas nu är betald data: analytikernas
förväntningar inför lagerrapporterna (för att mäta överraskningar), orderflöde och optionsdata.

### Motsatt affär och blankning efter stopp (2017–2026)
378 signaler (dagens bolag 2017–21 / 2022–26 / bolag som åkte ur), R efter avgift. 133 gick till stoppet.

| Variant | Utfall |
|---|---|
| Appens köp | +0,23 (t 2,2) / +0,27 (t 2,8) / −0,08 R |
| Motsatt affär till alla signaler | −0,41 (t −4,0) / −0,44 (t −4,6) / −0,05 R |
| Blanka efter stopp, mål 1R, max 5 dagar | −0,19 / −0,17 / −0,04 R |
| Blanka efter stopp, mål 2R, max 20 dagar | −0,50 / −0,43 / +0,00 R |
| Appens köp plus blankning efter stopp | +0,17 / +0,18 / −0,10 R |

**Nytt köp efter stoppet** (köp på öppningen dagen efter, nytt stopp 1R under):

| Variant | Utfall |
|---|---|
| Mål = gamla köpkursen, max 20 dagar | +0,03 / +0,02 / −0,23 R (vinst 60 / 63 / 43 %) |
| Gamla TP-nivåerna, max 20 dagar | +0,39 / +0,10 / −0,30 R |
| Mål 1R och 2R, max 20 dagar | +0,22 / −0,01 / −0,18 R |
| Totalt per signal, köp plus nytt köp | +0,24 / +0,27 / −0,18 R (utan nytt köp +0,23 / +0,27 / −0,08 R) |

Ett nytt köp efter stoppet ger ungefär noll i de bolag som klarade sig och förlust i bolagen som åkte ur. Det dubblar
risken utan att höja resultatet.

**Slutsats:** att vända efter ett stopp förlorar. Aktier som gått under stoppet studsar oftare tillbaka än fortsätter ned,
samma rekyleffekt som strategin bygger på.

### Live under dagen
Under börsdagen (09.00–17.30) räknas signaler och kravlistor på dagens kurs så här långt, märkta *preliminär*. Appen
uppdateras var femte minut när den är öppen. Yahoo ligger cirka 15 minuter efter.

Köp vid stängningen gav samma resultat som köp på öppningen nästa dag (+0,23 / +0,26 R mot +0,23 / +0,27 R, 2017–21 /
2022–26). Att köpa på en preliminär signal strax före stängningen, med 0,2 % sämre pris, gav +0,17 / +0,19 R. Köpet sker
därför fortfarande på öppningen dagen efter att signalen bekräftats.

**Beslut under dagen med timdata** (aug 2024–maj 2026, dagens 31 instrument): varje timme räknas signalen med dagens
stapel så här långt, och om den är stark köps det direkt till timmens kurs (0,1 % sämre pris). Stopp och mål följs timvis.

| Sätt | Affärer | TP1 | Vinst | Snitt | Summa |
|---|---|---|---|---|---|
| Köp direkt under dagen | 83 | 78 % | 66 % | +0,34 R | 28 R |
| Som appen: signal på stängningen, köp nästa öppning | 71 | 82 % | 69 % | +0,52 R | 37 R |

Av köpen under dagen var 43 samma dag som en stängningssignal (+0,48 R) och 40 signaler som försvann före stängningen
(+0,19 R). Köp i dagens första timme gav +0,57 R (44 st), övriga timmar blandat.

**Bättre köp och stopp under dagen** (bekräftade signaler, timdata aug 2024–mar 2026, 71 affärer):

| Variant | Snitt | Summa |
|---|---|---|
| Köp på öppningen, stopp vid beröring (som nu) | +0,63 R | 45 R |
| Köp kl. 10 | +0,64 R | 45 R |
| Limitorder 0,2 ATR under signalkursen, annars köp 17.00 | +0,75 R | 53 R |
| Stopp bara om en timme stänger under | +0,65 R | 46 R |
| Stopp bara om dagen stänger under | +0,68 R | 47 R |
| Limitorder 0,2 ATR plus stopp på timstängning | +0,77 R | 55 R |

**Samma regler över 10 år med dagsdata** (378 signaler, 2017–21 / 2022–26 / bolag som åkte ur):

| Variant | Utfall |
|---|---|
| Som nu | +0,23 / +0,27 / −0,08 R |
| Limitorder 0,2 ATR under, annars stängningen | +0,22 / +0,30 / −0,10 R |
| Stopp på dagsstängning | +0,23 / +0,33 / −0,28 R |
| Båda | +0,21 / +0,37 / −0,28 R |

Förbättringen de senaste två åren håller inte över tio år. Stopp på stängningen gav mycket större förluster i bolagen som
föll. Inget av det läggs in i appen. Det som görs live är bevakningen av öppna affärer
(notis vid TP1, TP2, TP3 och stopp) och en förvarning inför stängningen, se *Publicera på Vercel*.

### Flytta stoppet stegvis (2017–2026)
378 signaler, R efter avgift (2017–21 / 2022–26 / bolag som åkte ur).

| Regel | Utfall | Vinst | Summa | Förluster i rad |
|---|---|---|---|---|
| Som nu: stopp till köpkursen efter TP2 | +0,24 / +0,27 / −0,08 R | 57 / 58 / 46 % | 69 R | 12 |
| Stopp till köpkursen efter TP1 | +0,19 / +0,17 / −0,10 R | 66 / 62 / 54 % | 43 R | 7 |
| Köpkursen efter TP1, TP1 efter TP2 | +0,16 / +0,16 / −0,11 R | 66 / 62 / 54 % | 39 R | 7 |
| Samma, sista tredjedelen följer 2,5 % efter TP3 | +0,15 / +0,16 / −0,12 R | 66 / 62 / 54 % | 36 R | 7 |
| Som nu, sista tredjedelen följer 2,5 % efter TP3 | +0,24 / +0,26 / −0,07 R | 57 / 58 / 45 % | 68 R | 12 |

**Stoppet 1–3 % under nivån** (per riskerad krona, 2017–21 / 2022–26 / bolag som åkte ur):

| Regel | Utfall | Summa | Förluster i rad |
|---|---|---|---|
| Som nu, stopp på köpkursen efter TP2 | +0,24 / +0,27 / −0,08 R | 69 R | 12 |
| Som nu, stopp 1 % under köpkursen efter TP2 | +0,26 / +0,27 / −0,08 R | 72 R | 12 |
| Som nu, stopp 2 % under köpkursen efter TP2 | +0,27 / +0,27 / −0,07 R | 73 R | 12 |
| Stegvis, 1 % under köpkursen och TP1 | +0,16 / +0,24 / −0,10 R | 52 R | 9 |
| Stegvis, 2 % under | +0,18 / +0,27 / −0,08 R | 62 R | 13 |
| Ursprungligt stopp 1 % lägre | +0,22 / +0,25 / −0,16 R | 57 R | 12 |
| Ursprungligt stopp 2 % lägre | +0,25 / +0,21 / −0,19 R | 50 R | 12 |

Stegvis stopp ger fler vinnande affärer och kortare förlustsviter men cirka 40 % mindre vinst totalt, eftersom många
affärer studsar ned till köpkursen efter TP1 innan de når TP2. Att låta sista tredjedelen löpa efter TP3 ger ingenting.

### Förklaring av makroläget och makrokalender
Makropanelen förklarar i klartext varför läget är bra eller dåligt för strategin och visar kommande makrobesked:
Feds räntebesked (ingår i poängen, −1 veckan före), USA:s inflation (KPI) och jobbsiffror samt Riksbankens räntebesked
(bara information). Datumen ligger i `data/macro-calendar.json` (från bls.gov och riksbank.se) och `data/fomc.json`, och
behöver fyllas på när nya kalendrar publiceras.

### Fler aktier: Large Cap Stockholm och S&P 500 (2017–2026)
Appens regler oförändrade, utan rapportspärr (rapportdatum saknas för de nya bolagen), dagens bolag i listorna
(överlevnadsfel åt det positiva hållet). Svenska bolag med OMXS30:s makroläge, amerikanska med S&P 500, VIX och Fed.

| Bolag | 2017–21 | 2022–26 | Signaler/år |
|---|---|---|---|
| OMXS30, makrofilter | +0,22 R (157) | +0,21 R (236) | 47 |
| Large Cap utom OMXS30, makrofilter | +0,21 R (430) | −0,01 R (877) | 148 |
| S&P 500, makrofilter | +0,15 R (2 099) | +0,07 R (3 872) | 689 |

**S&P 500 per amerikansk makropoäng:** 1: +0,12 / −0,03 R, 2: −0,17 / −0,10 R, 3: +0,62 / +0,33 R (vinst 72 / 61 %).
Poäng 3 (S&P under EMA 200, under 40 % av aktierna över EMA 50, VIX minst 20 och inget räntebesked inom 7 dagar) gav
plus varje år: 2018 +0,60, 2019 +1,09, 2020 +0,60, 2022 +0,26, 2023 +0,50, 2025 +0,64, 2026 +0,14 R. Men signalerna kom
under bara 61 av cirka 510 veckor (2018: 13, 2020: 6, 2022: 24, 2023: 7, 2025: 7, 2026: 3). Att välja de 1–3 med högst
poäng per vecka gav sämre resultat än att ta alla. För OMX-signalerna gav makropoäng 3 inget tydligt mönster
(1: +0,22 / +0,57, 2: +0,04 / +0,11, 3: +0,64 / +0,20 R).

**Slutsats:** fler aktier ger fler signaler i samma oroliga perioder, inte jämnare över året. Large Cap utanför OMXS30
höll inte 2022–26. S&P 500 vid full rädsla (poäng 3) fungerar bra men kommer klumpvis.

### USA-fliken
S&P 500-bolag med minst tre långa hävstångspapper på Avanza (284 bolag i `data/sp500.json`, kopplade till Avanzas id via
namnet i Avanzas produktfilter). Samma regler som för OMX, med två skillnader från testet ovan:

1. **Makropoäng 3 krävs** (amerikanskt läge: S&P 500 under EMA 200, under 40 % av bolagen i listan över EMA 50, VIX minst 20
   och inget räntebesked inom 7 dagar). Bara då gav signalerna en fördel: +0,63 / +0,34 R för bolag med Avanza-papper.
2. **Minst tre säkra hävstångspapper:** när alla andra krav är uppfyllda hämtas Avanzas produkter och samma säkerhetsregler
   som för OMX används (knock-out minst 1 ATR under stoppet, spread högst 1,5 %, högst 6x hävstång, högst 35 % förlust vid
   stopp). Klarar färre än tre papper kraven blir det ingen signal.

Ingen rapportspärr. Test med historiska rapportdatum från Yahoo (273 bolag, kompletta till februari 2025), signaler vid
makropoäng 3: rapport inom 14 dagar +0,07 R (31 st) mot +0,69 R utan (2017–21), och +0,30 R (63 st) mot +0,31 R
(2022–feb 2025). Skillnaden syns bara i den första perioden och gäller cirka 10 % av signalerna. Listan hämtas när fliken öppnas. Vercel Cron kör `/api/cron/us` kl. 21.30 UTC,
efter USA-börsens stängning, och sparar nya signaler i signalloggen (märkta USA) och skickar notis. Live-bevakningen av
mål och stopp för USA-affärer gäller 15.30–22.00 svensk tid.

### Appens regler på kortare tidsramar
Samma signal, stopp och mål räknat på timstaplar (2 år) och 15-minutersstaplar (60 dagar), OMXS30-bolagen:

| Tidsram | Affärer/år | Stoppavstånd | Före avgifter | Efter 0,3 % avgift | Vinst |
|---|---|---|---|---|---|
| Dag (som appen) | cirka 40 | cirka 4–6 % | – | +0,25 R | 56 % |
| 60 min | cirka 960 | 1,3 % | +0,05 R | −0,32 R | 46 % |
| 15 min | cirka 2 800 | 0,6 % | −0,01 R | −0,65 R | 36 % |

På kortare tidsramar försvinner fördelen redan före avgifter, och eftersom stoppet ligger mycket närmare blir avgiften
en stor del av risken (0,3 % av 1,3 % är nästan en fjärdedel av R).

**Omräkning med lägre avgift och strängare urval** (timgraf, 1 913 affärer, delat vid juni 2025, första / andra halvan).
För minifutures är spreaden räknad på underliggande ofta 0,05–0,1 %, så 0,3 % var för högt för kort handel.

| Urval | Utan avgift | 0,05 % | 0,1 % |
|---|---|---|---|
| Alla signaler | +0,07 / +0,04 R | −0,00 / −0,01 R | −0,07 / −0,07 R |
| Poäng minst 55 | −0,07 / +0,12 R | −0,19 / +0,06 R | −0,32 / −0,00 R |
| Makro minst 1 | +0,04 / +0,02 R | −0,01 / −0,03 R | −0,06 / −0,07 R |
| Stoppavstånd minst 2 % | +0,18 / +0,02 R | +0,16 / +0,00 R | +0,14 / −0,01 R |
| Makro minst 1 och poäng minst 55 | −0,12 / +0,26 R | −0,18 / +0,21 R | −0,23 / +0,16 R |

Även med låg avgift blir det ingen fördel som håller i båda halvorna.

### Veckovis återgång vid panik (OMXS30, 2017–2026)
Varje vecka köps de aktier i OMXS30 (bolag som var med i indexet just då) som fallit mest de senaste 5 handelsdagarna och
säljs 5 handelsdagar senare. Avkastning per vecka efter 0,2 % avgift, 2017–21 / 2022–26.

| VIX vid köpet | 1 aktie | 3 aktier | 5 aktier |
|---|---|---|---|
| Alla lägen | +0,44 / −0,69 % | +0,27 / −0,07 % | +0,23 / −0,02 % |
| VIX minst 18 | +0,66 / −0,36 % | +0,85 / +0,31 % | +0,74 / +0,23 % |
| VIX minst 20 | +1,13 / −0,40 % | +1,23 / +0,44 % | +0,97 / +0,29 % |
| VIX minst 25 | +0,62 / +1,18 % | +1,36 / +0,89 % | +1,12 / +1,10 % |
| VIX minst 30 | +1,24 / +2,37 % | +1,41 / +2,22 % | +1,28 / +2,45 % |

Med VIX minst 25 och 3 aktier var resultatet positivt i båda perioderna oavsett veckodag för köpet (+0,16 till +1,54 %),
cirka 7 veckor om året, 60 % vinstveckor, sämsta vecka −20 %. År för år: 2018 −0,10, 2019 +9,03 (1 vecka), 2020 +0,93,
2021 +3,93, 2022 +0,57, 2023 −5,36, 2024 +1,18, 2025 +3,34, 2026 +0,51 % per vecka. Med VIX minst 20 berodde resultatet
2022–26 på veckodagen (−0,22 till +0,70 %). Med VIX minst 28 var alla år positiva men bara cirka 4 veckor om året.

Med gårdagens VIX (som är känt när signalen ges, VIX stänger efter Stockholm) och VIX minst 25: +0,95 till +1,78 % per vecka
2017–21 och +0,36 till +2,28 % 2022–26 beroende på veckodag, 63 % vinstveckor.

**Slutsats:** det första korta upplägget (en vecka) som håller i båda perioderna, men bara vid hög rädsla och med stora
svängningar. Samma grundidé som appens rekylstrategi.

**I appen (Panikvecka):** rutan under makroläget visar läget varje dag. När gårdagens VIX är minst 25 och ingen panikvecka
redan är öppen sparas de tre mest fallna OMXS30-aktierna (de 5 senaste handelsdagarna) i signalloggen och aviseras: köp på
öppningen, sälj på stängningen 5 handelsdagar efter signaldagen, 10 % av kontot per aktie, utan hävstång och utan stopp.
Påminnelse om säljdagen kommer kvällen före. `lib/panic.js`.

### Blanka i toppen av en bearish FVG (2017–2026)
Signal: kursen går upp i en ofylld bearish FVG och stänger under den samma dag. Blanka på nästa öppning, stopp 0,25 ATR över
FVG:n, mål 1R, 2R eller tredjedelar, max 20 dagar. Jämförelse: köp när kursen går ned i en bullish FVG och stänger över den.
Bolag som var med i OMXS30 på signaldagen, 6 842 signaler. Stoppet låg i snitt 3,7 % bort.

| Signal (mål 1R) | Före avgift | 0,1 % | 0,3 % |
|---|---|---|---|
| Blanka vid bearish FVG | −0,10 / −0,11 R (t −3,8 / −4,6) | −0,14 / −0,16 R | −0,24 / −0,27 R |
| Blanka vid bearish FVG under EMA 200 | −0,14 / −0,12 R | −0,18 / −0,16 R | −0,26 / −0,23 R |
| Köp vid bullish FVG | +0,01 / −0,02 R | −0,04 / −0,07 R | −0,14 / −0,18 R |

2017–21 / 2022–26. Med målen 2R och tredjedelar blev det lika dåligt. **Slutsats:** att blanka vid en bearish FVG förlorar
redan före avgifter i båda perioderna, även i nedtrend. FVG ensam ger ingen signal åt något håll. I appen används FVG bara
som en av flera faktorer i poängen (+2) för köpsignalerna.

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
3. **Aviseringar:** tryck på **Notiser** i appen. Webbläsaren frågar om lov och skickar en testnotis. Det fungerar i Chrome,
   Edge och Firefox på dator och Android. På iPhone (iOS 16.4 eller senare): öppna appen i Safari, Dela → *Lägg till på
   hemskärmen*, öppna den från hemskärmen och tryck på Notiser där. Kräver Upstash Redis (punkt 2), där prenumerationerna och
   VAPID-nycklarna sparas (eller sätt `VAPID_PUBLIC_KEY` och `VAPID_PRIVATE_KEY`). Vill du ha notiser via appen *ntfy* i
   stället eller också: lägg ett eget ämne i `NTFY_TOPIC` och appens adress i `APP_URL`.
4. **Daglig skanning:** Vercel Cron anropar `/api/cron/scan` varje dag kl. 17 UTC (18–19 svensk tid) och `/api/cron/us`
   kl. 21.30 UTC (efter USA-börsens stängning). Det fungerar på
   gratisplanen, men körningen kan ske när som helst inom timmen. Nya starka köpsignaler sparas i signalloggen och skickas
   som notis, och dagens mål och stopp för öppna affärer kontrolleras.
5. **Live under dagen:** Vercels gratisplan tillåter bara en schemalagd körning per dag. Skapa därför ett gratis jobb på
   cron-job.org som anropar `https://<din-app>.vercel.app/api/cron/live?key=<CRON_SECRET>` var 10:e minut vardagar
   09.00–17.40 (tidszon Europe/Stockholm), och lägg samma hemliga nyckel i `CRON_SECRET` i Vercel. Då skickas notis när en
   öppen affär når TP1, TP2, TP3 eller stoppet, på säljdagen för krypto, och 16.30–17.30 en förvarning när en köpsignal
   är uppfylld med kursen just nu (bekräftas vid stängningen).

Lokalt körs appen som vanlig server med `npm start`.

| Miljövariabel | Vad den gör |
|---|---|
| `PORT` | Port, standard 3000 |
| `APP_URL` | Appens adress, används för länken i notiser |
| `NTFY_TOPIC` | ntfy-ämne för aviseringar. Utan den skickas inga notiser |
| `NTFY_URL` | Egen ntfy-server, standard https://ntfy.sh |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Sparar signalloggen i Upstash Redis |
| `LOG_FILE` | Fil för signalloggen utan Redis, standard `data/signal-log.json` (lokalt) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Egna nycklar för webbnotiser (annars skapas de och sparas i Redis) |
| `CRON_SECRET` | Nyckel som krävs för `/api/cron/live` (rekommenderas när den anropas utifrån) |

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
