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
| **STARK KÖPSIGNAL** | Poäng ≥ 50, RSI vänder upp från under 40, och priset testar en stödzon |
| **KÖPSIGNAL** | Poäng ≥ 42 och RSI vänder upp, eller stöd + MACD vänder upp |
| **BEVAKA** | Bra läge men ingen vändning ännu |
| **AVVAKTA** | Överköpt eller sen fas |

**Handelsplan:** Stoppet läggs under stödzonen och de senaste fem dagarnas botten, minst 1 ATR bort. Vinstmålen tas från
riktiga nivåer: motståndszoner, bearish FVG, tidigare toppar, Fibonacci-extensioner och Elliottmål. TP1 ligger minst 1 R bort, och
ett mål som ligger vid ett motstånd läggs strax under motståndet. Om det inte finns någon nivå används R-multiplar.

### Kalibrering och backtest
Vikterna är satta efter ett backtest på OMXS30-aktierna för 2022–2026. Varje signal köps på nästa dags öppning, en tredjedel
säljs vid varje mål och stoppet flyttas till köpkursen efter TP1. Om stopp och mål nås samma dag räknas stoppet.

| | Affärer | Nådde TP1 | Snitt per affär |
|---|---|---|---|
| Första versionen (trendföljande) | 251 | 33 % | −0,02 R |
| Nuvarande version | 695 | 54 % | +0,28 R |

Det som har fungerat bäst på storbolagen i OMXS30 är att köpa en översåld rekyl som vänder upp vid ett stöd. Att jaga en redan
stark trend har fungerat sämre. Vikterna är kalibrerade på samma data som de testas på, och courtage ingår inte, så räkna med
sämre resultat i verkligheten. Appen visar backtestet för varje aktie och markerar historiska signaler i grafen.

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
