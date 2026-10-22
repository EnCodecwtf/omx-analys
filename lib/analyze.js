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
  const rsiTurn = rsiMin < 40 && rsiNow > rsiPrev;
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

  const nearestObstacle = merged.find(m => m.obstacle);
  const maxDist = atrv * 10;
  const tps = [];
  let floor = entry + R;
  for (const m of merged) {
    if (tps.length === 3) break;
    if (m.price < floor || m.price > entry + maxDist) continue;
    // Sälj strax under ett motstånd i stället för mitt i det.
    const px = m.obstacle ? m.price - atrv * 0.1 : m.price;
    tps.push({ price: round(px), r: round((px - entry) / R), why: m.labels });
    floor = px + Math.max(R * 0.5, atrv);
  }
  while (tps.length < 3) {
    const mult = [1.5, 2.5, 3.5][tps.length];
    const px = Math.max(entry + R * mult, (tps.length ? tps[tps.length - 1].price : 0) + atrv);
    tps.push({ price: round(px), r: round((px - entry) / R), why: [`${round((px - entry) / R)} R (inget tydligt motstånd)`] });
  }
  const rr = tps[0].r;
  if (nearestObstacle && nearestObstacle.price < entry + R) {
    warnings.push(`Motstånd redan vid ${round(nearestObstacle.price)} (under 1 R) – begränsad uppsida.`);
  }

  // --- Klassning ---
  const macdTurn = triggers.includes('MACD-histogram vänder upp');
  let status = 'neutral';
  if (score >= 50 && rsiTurn && support) status = 'strong';
  else if (score >= 42 && (rsiTurn || (support && macdTurn))) status = 'buy';
  else if (setupScore >= 25) status = 'watch';
  else if (setupScore <= -10) status = 'avoid';

  return {
    t: b.t,
    price: round(price),
    atr: round(atrv),
    trend, trendLabel,
    rsi: round(rsiNow),
    ema: { e20: round(e20), e50: round(e50), e200: round(e200) },
    score, setupScore: Math.round(setupScore), status,
    reasons, warnings, triggers,
    plan: { entry: round(entry), stop: round(stop), riskPct: round((R / entry) * 100), tps, rr },
    zones: zones.map(z => ({ lo: round(z.lo), hi: round(z.hi), kind: z.kind, score: z.score, touches: z.touches, flipped: z.flipped })),
    fvgs: fvgs.map(g => ({ type: g.type, lo: round(g.lo), hi: round(g.hi), i: g.i, fillPct: g.fillPct })),
    zigzag: zz.map(q => ({ i: q.i, price: round(q.price), type: q.type, tentative: !!q.tentative })),
    elliott: ew,
    elliottMajor: ewMajor,
    fib,
    support: support ? { lo: round(support.lo), hi: round(support.hi) } : null,
  };
}

// Simulerar varje köpsignal: köp på nästa dags öppning, sälj en tredjedel
// vid varje vinstmål och flytta stoppet till inköpspris efter första målet.
// Om stopp och mål nås samma dag räknas stoppet (försiktigt antagande).
export function backtest(bars, { start = 260, window = 400, maxHold = 60 } = {}) {
  const trades = [];
  let busyUntil = -1;
  for (let t = start; t < bars.length - 1; t++) {
    if (t <= busyUntil) continue;
    const slice = bars.slice(Math.max(0, t - window + 1), t + 1);
    const ev = evaluate(slice);
    if (ev.status !== 'buy' && ev.status !== 'strong') continue;
    const entry = bars[t + 1].o;
    const { stop, tps } = ev.plan;
    if (entry <= stop) continue;
    const R = entry - stop;
    let sl = stop, hit = 0, result = 0, exitI = null;
    for (let j = t + 1; j < bars.length && j <= t + maxHold; j++) {
      const x = bars[j];
      if (x.l <= sl) { result += ((sl - entry) / R) * (3 - hit) / 3; exitI = j; break; }
      while (hit < 3 && x.h >= tps[hit].price) {
        result += ((tps[hit].price - entry) / R) / 3;
        hit++;
        sl = Math.max(sl, entry);
      }
      if (hit === 3) { exitI = j; break; }
    }
    const open = exitI == null && t + maxHold >= bars.length - 1;
    if (exitI == null) {
      exitI = Math.min(bars.length - 1, t + maxHold);
      result += ((bars[exitI].c - entry) / R) * (3 - hit) / 3;
    }
    trades.push({ i: t, t: bars[t].t, status: ev.status, score: ev.score, entry: round(entry), stop: round(stop),
      tps: tps.map(x => x.price), hit, r: round(result), exitI, open });
    busyUntil = exitI;
  }
  const closed = trades.filter(x => !x.open);
  const sum = closed.reduce((s, x) => s + x.r, 0);
  const stats = (list) => ({
    n: list.length,
    tp1Rate: list.length ? Math.round(100 * list.filter(x => x.hit >= 1).length / list.length) : null,
    winRate: list.length ? Math.round(100 * list.filter(x => x.r > 0).length / list.length) : null,
    avgR: list.length ? round(list.reduce((s, x) => s + x.r, 0) / list.length) : null,
  });
  return {
    trades,
    stats: { ...stats(closed), totalR: round(sum), strong: stats(closed.filter(x => x.status === 'strong')) },
  };
}
