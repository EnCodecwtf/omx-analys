// Samlar ihop indikatorer, struktur och Elliottvågor till en köpsignal med
// stopp och tre vinstmål, och kör ett backtest av signalerna bakåt i tiden.

import { computeIndicators } from './indicators.js';
import { zigzag, supportResistance, fairValueGaps, fibLevels } from './structure.js';
import { elliott } from './elliott.js';

const round = x => (x == null ? null : Math.round(x * 100) / 100);

// Analys av senaste stapeln i `bars`. Använder bara data fram till och med
// den stapeln, så den kan köras på historiska utsnitt i backtestet.
export function evaluate(bars, opts = {}) {
  const n = bars.length;
  const last = n - 1;
  const ind = opts.ind || computeIndicators(bars);
  const b = bars[last], prev = bars[last - 1];
  const price = b.c;
  const atrv = ind.atr[last] ?? (b.h - b.l);

  const zz = zigzag(bars, ind.atr, { atrMult: 2.5 });
  const zzMajor = zigzag(bars, ind.atr, { atrMult: 5 });
  const zones = supportResistance(bars, ind.atr, zz);
  const fvgs = fairValueGaps(bars, ind.atr);

  const e20 = ind.ema20[last], e50 = ind.ema50[last], e200 = ind.ema200[last];
  const e200old = ind.ema200[last - 20];
  let trend = 0;
  if (e200 != null) {
    if (price > e200) trend++; else trend--;
    if (e50 > e200) trend++; else trend--;
    if (e200old != null) { if (e200 > e200old) trend++; else trend--; }
  }
  const trendLabel = trend >= 2 ? 'Upptrend' : trend <= -2 ? 'Nedtrend' : 'Sidledes';

  const ew = elliott(zz, { trendBias: Math.sign(trend) });
  const ewMajor = elliott(zzMajor, { trendBias: Math.sign(trend) });

  const reasons = [];
  const warnings = [];
  // Poängen är kalibrerad mot ett backtest på OMXS30-aktierna (se README).
  // Det som har fungerat bäst är att köpa en översåld rekyl som vänder vid
  // ett stöd. Att jaga en redan stark trend har gett sämre resultat.
  let setupScore = 0;
  let trigScore = 0;
  const add = (pts, text) => { setupScore += pts; reasons.push({ pts: Math.round(pts), text }); };

  if (trend <= -2) warnings.push('Nedtrend under EMA 200 – handla mindre och följ stoppet strikt.');

  const recentLow = Math.min(...bars.slice(-3).map(x => x.l));
  const lastPivot = zz[zz.length - 1];

  // 1. Stödzon
  const support = zones
    .filter(z => recentLow <= z.hi + atrv * 0.25 && recentLow >= z.lo - atrv * 0.5 && price >= z.lo)
    .sort((a, c) => c.score - a.score)[0];
  if (support) {
    add(10 + 8 * support.score / 100,
      `Testar stödzon ${round(support.lo)}–${round(support.hi)} (${support.touches} träffar${support.flipped ? ', tidigare motstånd' : ''})`);
  }

  // 2. Fair value gap
  const fvg = fvgs.find(g => g.type === 'bull' && recentLow <= g.hi && recentLow >= g.lo - atrv * 0.1 && price >= g.lo);
  if (fvg) add(2, `Har testat en ofylld bullish FVG ${round(fvg.lo)}–${round(fvg.hi)}`);

  // 3. Fibonacci-rekyl av senaste benet upp
  let fib = null;
  if (zz.length >= 3 && lastPivot.type === 'L') {
    const from = zz[zz.length - 3], to = zz[zz.length - 2];
    if (from.type === 'L' && to.type === 'H') {
      fib = { from: { i: from.i, price: round(from.price) }, to: { i: to.i, price: round(to.price) }, ...fibLevels(from.price, to.price) };
      const r = (to.price - lastPivot.price) / (to.price - from.price);
      fib.depth = round(r);
      if (r >= 0.6 && r <= 0.68) add(8, `Rekyl till Fibonacci "golden pocket" (${Math.round(r * 100)} %)`);
      else if (r >= 0.5 && r <= 0.8) add(8, `Rekyl till Fibonacci ${Math.round(r * 100)} % av senaste uppgången`);
      else if (r >= 0.38 && r < 0.5) add(4, `Grund rekyl (${Math.round(r * 100)} %)`);
    }
  }

  // 4. Elliottvågor
  const p = ew.primary;
  if (p) {
    if (p.bias > 0 && p.setup && p.zone) {
      const inZone = recentLow <= p.zone[1] + atrv * 0.3 && recentLow >= p.zone[0] - atrv * 0.5;
      if (inZone) add(6 + 8 * p.confidence / 100, `Elliott: ${p.label} – priset är i köpzonen`);
    } else if (p.bias < 0) {
      warnings.push(`Elliott: ${p.label}.`);
    } else if (p.phase === 'w5' && p.dir === 'bull') {
      add(-10, 'Elliott: våg 5 uppåt – sen fas i uppgången');
    }
  }

  // 5. Översålt läge
  const rsiNow = ind.rsi[last], rsiPrev = ind.rsi[last - 1];
  if (rsiNow < 35) add(10, `Översåld (RSI ${Math.round(rsiNow)})`);
  else if (rsiNow < 45) add(5, `Svag RSI (${Math.round(rsiNow)}) – rekyl`);
  else if (rsiNow > 70) add(-15, `Överköpt (RSI ${Math.round(rsiNow)}) – vänta på rekyl`);

  // 6. Vändning (trigger)
  const body = Math.abs(b.c - b.o);
  const range = b.h - b.l || 1e-9;
  const lowerWick = Math.min(b.c, b.o) - b.l;
  const triggers = [];
  const rsiMin = Math.min(...ind.rsi.slice(-6).filter(x => x != null));
  // Läge: 'reversion' köper en översåld rekyl under EMA 200, 'trend' köper en
  // rekyl i en etablerad trend (används för bear-signaler på speglad kurs).
  const mode = opts.mode || 'reversion';
  const rsiTurn = rsiMin < (mode === 'trend' ? 50 : 40) && rsiNow > rsiPrev;
  if (rsiTurn) { trigScore += 15; triggers.push(`RSI vänder upp från ${Math.round(rsiMin)}`); }
  const h = ind.macd.hist;
  if (h[last] != null && h[last - 1] != null && h[last - 1] < 0 && h[last] > h[last - 1]) { trigScore += 5; triggers.push('MACD-histogram vänder upp'); }
  if (prev && b.c > prev.h) { trigScore += 4; triggers.push('Stängning över gårdagens topp'); }
  if (prev && prev.c < prev.o && b.c > b.o && b.c >= prev.o && b.o <= prev.c) { trigScore += 4; triggers.push('Bullish engulfing'); }
  else if (lowerWick >= 2 * body && (b.c - b.l) / range >= 0.66) { trigScore += 4; triggers.push('Hammare'); }
  // Bullish divergens: lägre botten i pris men högre botten i RSI
  const lows = zz.filter(q => q.type === 'L');
  if (lows.length >= 2) {
    const a = lows[lows.length - 2], c = lows[lows.length - 1];
    if (c.price < a.price && ind.rsi[c.i] != null && ind.rsi[a.i] != null && ind.rsi[c.i] > ind.rsi[a.i] + 2 && last - c.i <= 5) {
      trigScore += 5; triggers.push('Bullish RSI-divergens');
    }
  }
  trigScore = Math.min(trigScore, 25);
  if (triggers.length) reasons.push({ pts: trigScore, text: `Vändning: ${triggers.join(', ')}` });

  const score = Math.max(0, Math.min(100, Math.round(setupScore + trigScore)));

  // --- Handelsplan: insteg, stopp och vinstmål ---
  const entry = price;
  let stopBase = Math.min(...bars.slice(-5).map(x => x.l));
  if (support) stopBase = Math.min(stopBase, support.lo);
  let stop = stopBase - atrv * 0.25;
  if (entry - stop < atrv) stop = entry - atrv;
  const R = entry - stop;

  const cands = [];
  const addT = (price, label, kind) => { if (price > entry + atrv * 0.3) cands.push({ price, label, kind }); };
  for (const z of zones) if (z.kind === 'resistance') addT(z.lo, `Motståndszon ${round(z.lo)}–${round(z.hi)}`, 'obstacle');
  for (const g of fvgs) if (g.type === 'bear') addT(g.lo, `Bearish FVG ${round(g.lo)}–${round(g.hi)}`, 'obstacle');
  for (const q of zz) if (q.type === 'H' && q.i >= n - 250 && !q.tentative) addT(q.price, 'Tidigare svängtopp', 'swing');
  if (fib) for (const x of fib.ext.slice(0, 2)) addT(x.price, `Fibonacci-extension ${x.r}`, 'fib');
  if (p && p.bias > 0) for (const t of p.targets) addT(t.price, `Elliott: ${t.label}`, 'elliott');
  cands.sort((a, c) => a.price - c.price);

  // Slå ihop mål som ligger nära varandra.
  const merged = [];
  for (const c of cands) {
    const m = merged[merged.length - 1];
    if (m && c.price - m.price < atrv * 0.5) { if (!m.labels.includes(c.label)) m.labels.push(c.label); if (c.kind === 'obstacle') m.obstacle = true; }
    else merged.push({ price: c.price, labels: [c.label], obstacle: c.kind === 'obstacle' });
  }

  // Målen är satta för hög träffsäkerhet: TP1 på närmaste nivå 0,5–1,2 R
  // bort och TP2 på nästa nivå upp till 2 R. Utan nivå där används 0,8 R
  // respektive 1,2 R. TP3 är nästa tydliga nivå för resten av positionen.
  const nearestObstacle = merged.find(m => m.obstacle);
  const levelPx = m => (m.obstacle ? m.price - atrv * 0.1 : m.price);
  const above = merged.map(m => ({ px: levelPx(m), why: m.labels })).filter(m => m.px > entry);
  const mk = (px, why) => ({ price: round(px), r: round((px - entry) / R), why });
  const rLabel = k => [`${String(k).replace('.', ',')} R (ingen nivå i närheten)`];
  const l1 = above.find(m => m.px >= entry + R * 0.5 && m.px <= entry + R * 1.2);
  const tp1 = l1 ? mk(l1.px, l1.why) : mk(entry + R * 0.8, rLabel(0.8));
  const l2 = above.find(m => m.px >= tp1.price + Math.max(R * 0.3, atrv * 0.5) && m.px <= entry + R * 2);
  const tp2 = l2 ? mk(l2.px, l2.why) : mk(Math.max(entry + R * 1.2, tp1.price + R * 0.3), rLabel(1.2));
  const l3 = above.find(m => m.px >= tp2.price + Math.max(R * 0.5, atrv) && m.px <= entry + atrv * 10);
  const tp3 = l3 ? mk(l3.px, l3.why) : mk(tp2.price + (tp2.price - entry) * 0.6, ['Förlängning av TP2']);
  const tps = [tp1, tp2, tp3];
  const rr = tp1.r;
  if (nearestObstacle && nearestObstacle.price < entry + R * 0.5) {
    warnings.push(`Motstånd redan vid ${round(nearestObstacle.price)} (under 0,5 R) – begränsad uppsida.`);
  }

  // --- Klassning ---
  const macdTurn = triggers.includes('MACD-histogram vänder upp');
  let status = 'neutral';
  // Rekyler under EMA 200 har gett klart högre träffsäkerhet än rekyler i en
  // redan stark trend. Över EMA 200 krävs därför en högre poäng.
  const deep = mode === 'trend'
    ? e200 != null && price > e200 && e50 > e200
    : e200 != null && price < e200;
  const minScore = opts.minScore ?? 42;
  const trigger = rsiTurn || (support && macdTurn);
  const qualified = score >= minScore && trigger && (deep || (mode === 'reversion' && score >= 55)) && !!p;
  const confirmed = qualified && deep && support && rsiTurn && macdTurn;
  // Villkoren för köpsignal som en lista, så att appen kan visa vad som
  // fattas när läget ännu inte är en signal.
  const below = zones.filter(z => z.hi < price).sort((a, c) => c.hi - a.hi)[0];
  const hNow = h[last], hPrev = h[last - 1];
  const checklist = [
    mode === 'trend'
      ? { key: 'trend', ok: deep, text: 'Upptrend: kursen och EMA 50 över EMA 200', now: `EMA 50 ${round(e50)}, EMA 200 ${round(e200)}` }
      : { key: 'trend', ok: deep, text: 'Kursen under EMA 200 (rekyl att köpa)', now: e200 == null ? 'för kort historik' : `${round(price)} mot EMA 200 ${round(e200)}` },
    { key: 'support', ok: !!support, text: 'Kursen testar en stödzon',
      now: support ? `stöd ${round(support.lo)}–${round(support.hi)}`
        : below ? `närmaste stöd ${round(below.lo)}–${round(below.hi)}, ${Math.round((price - below.hi) / price * 1000) / 10} % lägre` : 'inget stöd under kursen' },
    { key: 'rsi', ok: rsiTurn, text: `RSI har varit under ${mode === 'trend' ? 50 : 40} och vänder upp`,
      now: `RSI ${Math.round(rsiNow)}, lägst ${Math.round(rsiMin)} senaste 6 dagarna – ${rsiMin >= (mode === 'trend' ? 50 : 40) ? 'inte tillräckligt låg' : rsiNow > rsiPrev ? 'vänder upp' : 'faller fortfarande'}` },
    { key: 'macd', ok: macdTurn, text: 'MACD-histogrammet är under noll och vänder upp',
      now: hNow == null || hPrev == null ? 'för kort historik' : hPrev >= 0 ? 'histogrammet är över noll' : hNow > hPrev ? 'vänder upp' : 'faller fortfarande' },
    { key: 'score', ok: score >= minScore, text: `Poäng minst ${minScore}`, now: `poäng ${score}` },
    { key: 'elliott', ok: !!p, text: 'Det finns en giltig Elliott-räkning', now: p ? p.label : 'ingen giltig räkning' },
  ];
  if (confirmed && rsiMin < 32) status = 'strong';
  else if (confirmed) status = 'buy';
  else if (setupScore >= 25 || qualified || (score >= 42 && trigger)) status = 'watch';
  else if (setupScore <= -10) status = 'avoid';

  return {
    t: b.t,
    price: round(price),
    atr: round(atrv),
    trend, trendLabel,
    rsi: round(rsiNow),
    ema: { e20: round(e20), e50: round(e50), e200: round(e200) },
    score, setupScore: Math.round(setupScore), status,
    reasons, warnings, triggers, checklist,
    plan: { entry: round(entry), stop: round(stop), riskPct: round((R / entry) * 100), tps, rr,
      levels: merged.map(m => ({ price: round(m.price), obstacle: m.obstacle, labels: m.labels })) },
    zones: zones.map(z => ({ lo: round(z.lo), hi: round(z.hi), kind: z.kind, score: z.score, touches: z.touches, flipped: z.flipped })),
    fvgs: fvgs.map(g => ({ type: g.type, lo: round(g.lo), hi: round(g.hi), i: g.i, fillPct: g.fillPct })),
    zigzag: zz.map(q => ({ i: q.i, price: round(q.price), type: q.type, tentative: !!q.tentative })),
    elliott: ew,
    elliottMajor: ewMajor,
    fib,
    support: support ? { lo: round(support.lo), hi: round(support.hi) } : null,
  };
}

// Rapportspärr och marknadsläge. En köpsignal blir BEVAKA om en rapport
// kommer inom 10 handelsdagar eller om makroläget är ogynnsamt (poäng under
// 0). Båda reglerna höjde träffsäkerheten i backtestet.
export const REPORT_BLOCK_DAYS = 10;
export function applyGuards(ev, { report = null, reportDays = null, macro = null, stress = null } = {}) {
  const signal = ev.status === 'buy' || ev.status === 'strong';
  if (report && reportDays != null && reportDays <= REPORT_BLOCK_DAYS) {
    ev.warnings.unshift(`Rapport ${report.date} (om ${reportDays} handelsdagar) – rapportspärr, inga nya köp.`);
    if (signal) { ev.blocked = ev.status; ev.status = 'watch'; }
  } else if (macro && macro.score < 0 && signal) {
    ev.warnings.unshift(`Makroläget är ogynnsamt (poäng ${macro.score}) – inga nya köp.`);
    ev.blocked = ev.status; ev.status = 'watch';
  } else if (macro && signal && macro.score < 1) {
    // Med neutralt makroläge hade signalerna ingen fördel på aktier som
    // reglerna inte tagits fram på. Bara gynnsamt läge ger köpsignal.
    ev.warnings.unshift('Neutralt makroläge – bara bevaka. Köpsignaler kräver makropoäng 1 eller mer.');
    ev.blocked = ev.status; ev.status = 'watch';
  } else if (macro && signal) {
    ev.status = 'strong';
  }
  if (stress?.factors && ev.status === 'strong') {
    const why = [stress.stressed && 'krig eller akut oro', stress.fomcNear && 'räntebesked inom 15 dagar', stress.dollarStrong && 'stark dollar'].filter(Boolean).join(', ');
    ev.warnings.unshift(`Mindre position (${stress.size === 0.5 ? 'halv' : stress.size === 0.25 ? 'en fjärdedel' : 'en åttondel'}): ${why}.`);
  }
  ev.checklist = ev.checklist || [];
  ev.checklist.push(
    { key: 'report', ok: !(report && reportDays != null && reportDays <= REPORT_BLOCK_DAYS), text: `Ingen rapport inom ${REPORT_BLOCK_DAYS} handelsdagar`,
      now: report ? `rapport ${report.date}, om ${reportDays} handelsdagar` : 'ingen rapport inom synhåll' },
  );
  if (macro) ev.checklist.push({ key: 'macro', ok: macro.score >= 1, text: 'Makropoäng minst 1', now: `${macro.label} (poäng ${macro.score})` });
  ev.guards = { report: report ? { ...report, days: reportDays } : null, macro, stress,
    size: (macro ? macro.size : 1) * (stress ? stress.size : 1) };
  return ev;
}

// Hur en serie affärer (resultat i R, i tidsordning) har gått: andel förluster,
// längsta förlustsvit, djupaste nedgång och längsta tid utan ny topp, både
// största historiskt och läget just nu. Används för panelen "Vad är normalt?".
export function equityStats(results) {
  let run = 0, longestLosing = 0, cum = 0, peak = 0, maxDD = 0, sinceHigh = 0, longestNoHigh = 0;
  for (const r of results) {
    run = r < 0 ? run + 1 : 0;
    longestLosing = Math.max(longestLosing, run);
    cum += r;
    if (cum > peak) { peak = cum; sinceHigh = 0; } else sinceHigh++;
    longestNoHigh = Math.max(longestNoHigh, sinceHigh);
    maxDD = Math.min(maxDD, cum - peak);
  }
  const r2 = x => Math.round(x * 10) / 10;
  return {
    trades: results.length,
    lossShare: results.length ? Math.round(100 * results.filter(r => r < 0).length / results.length) : null,
    longestLosing, maxDD: r2(maxDD), longestNoHigh,
    currentLosing: run, currentDD: r2(cum - peak), sinceHigh,
  };
}

// Följer en affär från signalen på stapel `t`: köp på nästa dags öppning,
// en tredjedel säljs vid varje mål och stoppet flyttas till köpkursen efter
// TP2. Öppnar kursen under stoppet blir försäljningen på öppningskursen. Om
// stopp och mål nås samma dag räknas stoppet. Används av både backtestet och
// signalloggen.
export function simulateTrade(bars, t, plan, { maxHold = 60, rep = Infinity, trail = 0, timeExit = 0, atr = 0 } = {}) {
  if (t + 1 >= bars.length) return null;
  const entry = bars[t + 1].o;
  const { stop, tps } = plan;
  if (entry <= stop) return null;
  const R = entry - stop;
  let sl = stop, hit = 0, result = 0, exitI = null, high = entry;
  const lastTp = trail ? 2 : 3;
  for (let j = t + 1; j < bars.length && j <= t + maxHold; j++) {
    const x = bars[j];
    if (timeExit && hit === 0 && j - t > timeExit) { result += (bars[j - 1].c - entry) / R; exitI = j - 1; break; }
    if (j >= rep) { result += ((bars[j - 1].c - entry) / R) * (3 - hit) / 3; exitI = j - 1; break; }
    if (x.l <= sl) { result += ((Math.min(sl, x.o) - entry) / R) * (3 - hit) / 3; exitI = j; break; }
    while (hit < lastTp && x.h >= tps[hit].price) {
      result += ((tps[hit].price - entry) / R) / 3;
      hit++;
      if (hit === 2) sl = Math.max(sl, entry);
    }
    if (hit === 3) { exitI = j; break; }
    high = Math.max(high, x.h);
    if (trail && hit >= 2) sl = Math.max(sl, high - trail * atr);
  }
  const open = exitI == null && t + maxHold >= bars.length - 1;
  if (exitI == null) {
    exitI = Math.min(bars.length - 1, t + maxHold);
    result += ((bars[exitI].c - entry) / R) * (3 - hit) / 3;
  }
  return { entry, stop, tps, hit, result, exitI, open };
}

// Speglar kursen (k / pris, där k väljs så att priserna behåller sin
// storleksordning). En köpsignal på speglade staplar är en säljsignal
// (bear) på de riktiga.
export function invertBars(bars, k = bars[bars.length - 1].c ** 2) {
  return bars.map(b => ({ t: b.t, o: k / b.o, h: k / b.l, l: k / b.h, c: k / b.c, v: b.v }));
}

// Simulerar varje köpsignal: köp på nästa dags öppning, sälj en tredjedel
// vid varje vinstmål och flytta stoppet till inköpspris efter andra målet.
// Om stopp och mål nås samma dag räknas stoppet (försiktigt antagande).
//
// Rapportskydd: `reports` är rapportdatum ('ÅÅÅÅ-MM-DD'). Ingen ny affär tas
// om en rapport kommer inom `reportBlock` handelsdagar, och med `reportExit`
// säljs resten av positionen vid stängning dagen före rapporten.
// `allow(t)` kan stoppa signaler, till exempel efter marknadsläget.
// `trail`: efter TP2 följer stoppet för sista tredjedelen högsta kursen minus
// `trail` × ATR, i stället för att sälja vid TP3. `timeExit`: sälj allt vid
// stängning om TP1 inte är nådd efter så många dagar.
export function backtest(input, { start = 260, window = 400, maxHold = 60, side = 'long', mode, minScore,
  reports = [], reportBlock = 0, reportExit = false, allow = null, trail = 0, timeExit = 0 } = {}) {
  const k = input[input.length - 1].c ** 2;
  const bars = side === 'short' ? invertBars(input, k) : input;
  const back = x => (side === 'short' ? round(k / x) : round(x));
  const day = t => new Date(t * 1000).toISOString().slice(0, 10);
  const reportIdx = [...new Set(reports.map(d => bars.findIndex(b => day(b.t) >= d)).filter(i => i > 0))].sort((a, b) => a - b);
  const nextReport = i => reportIdx.find(r => r >= i) ?? Infinity;
  const trades = [];
  let busyUntil = -1;
  for (let t = start; t < bars.length - 1; t++) {
    if (t <= busyUntil) continue;
    if (reportBlock && nextReport(t + 1) - (t + 1) <= reportBlock) continue;
    if (allow && !allow(bars[t].t, t)) continue;
    const slice = bars.slice(Math.max(0, t - window + 1), t + 1);
    const ev = evaluate(slice, { mode, minScore });
    if (ev.status !== 'buy' && ev.status !== 'strong') continue;
    const rep = reportExit ? nextReport(t + 1) : Infinity;
    if (rep <= t + 1) continue;
    const sim = simulateTrade(bars, t, ev.plan, { maxHold, rep, trail, timeExit, atr: ev.atr });
    if (!sim) continue;
    const { entry, stop, tps, hit, result, exitI, open } = sim;
    trades.push({ i: t, t: bars[t].t, side, status: ev.status, score: ev.score, entry: back(entry), stop: back(stop),
      tps: tps.map(x => back(x.price)), hit, r: round(result), riskPct: (entry - stop) / entry, exitI, open,
      rsi: ev.rsi, trend: ev.trend });
    busyUntil = exitI;
  }
  const closed = trades.filter(x => !x.open);
  const sum = closed.reduce((s, x) => s + x.r, 0);
  const stats = (list) => ({
    n: list.length,
    tp1Rate: list.length ? Math.round(100 * list.filter(x => x.hit >= 1).length / list.length) : null,
    tp2Rate: list.length ? Math.round(100 * list.filter(x => x.hit >= 2).length / list.length) : null,
    tp3Rate: list.length ? Math.round(100 * list.filter(x => x.hit >= 3).length / list.length) : null,
    winRate: list.length ? Math.round(100 * list.filter(x => x.r > 0).length / list.length) : null,
    avgR: list.length ? round(list.reduce((s, x) => s + x.r, 0) / list.length) : null,
  });
  return {
    trades,
    stats: { ...stats(closed), totalR: round(sum), strong: stats(closed.filter(x => x.status === 'strong')) },
  };
}
