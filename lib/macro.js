// Marknadsläge (makro). Köpsignalerna har fungerat bäst när marknaden är
// rädd, och sämst när den är lugn eller när ett räntebesked från Fed är nära.
//
//   +1  OMXS30 under EMA 200
//   +1  färre än 40 % av OMXS30-aktierna över EMA 50 (svag bredd)
//   +1  VIX 20 eller högre
//   -1  VIX under 15
//   -1  räntebesked (FOMC) inom 7 dagar
//
// Bara poäng 1 eller mer ger köpsignal. Med poäng 0 hade signalerna ingen
// fördel på aktier som reglerna inte tagits fram på.

import { ema } from './indicators.js';
import { FOMC } from './events.js';

const day = t => new Date(t * 1000).toISOString().slice(0, 10);

function lastAtOrBefore(sortedDays, map, d) {
  let lo = 0, hi = sortedDays.length - 1, ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDays[mid] <= d) { ans = sortedDays[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans == null ? null : map.get(ans);
}

// Bygger en funktion som ger marknadsläget för ett datum ('ÅÅÅÅ-MM-DD').
// Använder bara data fram till och med det datumet.
export function buildMacro({ omxBars, vixBars, stockBars }) {
  const omxE = ema(omxBars.map(b => b.c), 200);
  const omx = new Map(omxBars.map((b, i) => [day(b.t), { c: b.c, e200: omxE[i] }]));
  const omxDays = [...omx.keys()];
  const vix = new Map(vixBars.map(b => [day(b.t), b.c]));
  const vixDays = [...vix.keys()];
  const above = new Map(), count = new Map();
  for (const bars of stockBars) {
    const e = ema(bars.map(b => b.c), 50);
    bars.forEach((b, i) => {
      if (e[i] == null) return;
      const d = day(b.t);
      count.set(d, (count.get(d) || 0) + 1);
      if (b.c > e[i]) above.set(d, (above.get(d) || 0) + 1);
    });
  }
  const breadth = new Map([...count].map(([d, n]) => [d, (above.get(d) || 0) / n]));
  const breadthDays = [...breadth.keys()].sort();

  return function macroAt(d) {
    const o = lastAtOrBefore(omxDays, omx, d);
    const v = lastAtOrBefore(vixDays, vix, d);
    const br = lastAtOrBefore(breadthDays, breadth, d);
    const nf = FOMC.find(f => f >= d);
    const fomcDays = nf ? Math.round((new Date(nf) - new Date(d)) / 86400000) : null;
    const parts = [];
    let score = 0;
    if (o?.e200 != null) {
      const down = o.c < o.e200;
      if (down) score++;
      parts.push({ ok: down, pts: down ? 1 : 0, text: `OMXS30 ${down ? 'under' : 'över'} EMA 200` });
    }
    if (br != null) {
      const weak = br < 0.4;
      if (weak) score++;
      parts.push({ ok: weak, pts: weak ? 1 : 0, text: `${Math.round(br * 100)} % av aktierna över EMA 50` });
    }
    if (v != null) {
      const pts = v >= 20 ? 1 : v < 15 ? -1 : 0;
      score += pts;
      parts.push({ ok: pts > 0, bad: pts < 0, pts, text: `VIX ${v.toFixed(1)}` });
    }
    if (fomcDays != null) {
      const near = fomcDays <= 7;
      if (near) score--;
      parts.push({ ok: false, bad: near, pts: near ? -1 : 0, text: `Räntebesked från Fed ${nf} (om ${fomcDays} dagar)` });
    }
    const size = score >= 1 ? 1 : 0;
    const label = score < 0 ? 'Ogynnsamt – inga nya köp' : score === 0 ? 'Neutralt – bara bevaka' : 'Gynnsamt – köpsignaler gäller';
    return { date: d, score, size, label, parts, vix: v, breadth: br, fomc: nf, fomcDays };
  };
}
