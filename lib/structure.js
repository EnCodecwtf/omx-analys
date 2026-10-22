// Marknadsstruktur: svängpunkter (ZigZag), stöd/motstånd, fair value gaps
// och Fibonacci-nivåer.

// ZigZag med ATR-baserad tröskel. Den är kausal: en svängpunkt bekräftas
// först när priset har vänt minst `thr` från extrempunkten, och index för
// bekräftelsen sparas i `confirmedAt`. Den sista extrempunkten tas med som
// obekräftad (`tentative: true`).
export function zigzag(bars, atrArr, { atrMult = 2.5, minPct = 0.02 } = {}) {
  const pivots = [];
  if (bars.length < 2) return pivots;
  const thrAt = i => Math.max((atrArr[i] ?? (bars[i].h - bars[i].l)) * atrMult, bars[i].c * minPct);

  let dir = 0;
  let hiI = 0, loI = 0;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const thr = thrAt(i);
    if (dir === 0) {
      if (b.h > bars[hiI].h) hiI = i;
      if (b.l < bars[loI].l) loI = i;
      if (bars[hiI].h - bars[loI].l >= thr) {
        if (hiI > loI) {
          pivots.push({ i: loI, price: bars[loI].l, type: 'L', confirmedAt: i });
          dir = 1;
        } else {
          pivots.push({ i: hiI, price: bars[hiI].h, type: 'H', confirmedAt: i });
          dir = -1;
        }
      }
      continue;
    }
    if (dir === 1) {
      if (b.h >= bars[hiI].h) hiI = i;
      else if (b.l <= bars[hiI].h - thr) {
        pivots.push({ i: hiI, price: bars[hiI].h, type: 'H', confirmedAt: i });
        dir = -1;
        loI = i;
      }
    } else {
      if (b.l <= bars[loI].l) loI = i;
      else if (b.h >= bars[loI].l + thr) {
        pivots.push({ i: loI, price: bars[loI].l, type: 'L', confirmedAt: i });
        dir = 1;
        hiI = i;
      }
    }
  }
  if (dir === 1) pivots.push({ i: hiI, price: bars[hiI].h, type: 'H', confirmedAt: null, tentative: true });
  if (dir === -1) pivots.push({ i: loI, price: bars[loI].l, type: 'L', confirmedAt: null, tentative: true });
  return pivots;
}

// Klassiska fraktaler: en topp/botten som är högst/lägst inom `n` staplar
// åt båda håll.
export function fractals(bars, n = 3) {
  const out = [];
  for (let i = n; i < bars.length - n; i++) {
    let isH = true, isL = true;
    for (let k = 1; k <= n; k++) {
      if (bars[i - k].h >= bars[i].h || bars[i + k].h > bars[i].h) isH = false;
      if (bars[i - k].l <= bars[i].l || bars[i + k].l < bars[i].l) isL = false;
    }
    if (isH) out.push({ i, price: bars[i].h, type: 'H' });
    if (isL) out.push({ i, price: bars[i].l, type: 'L' });
  }
  return out;
}

// Stöd- och motståndszoner. Svängpunkter som ligger nära varandra i pris
// slås ihop till en zon. Styrkan ökar med antalet träffar, hur nya de är och
// om punkten var en större sväng (ZigZag) eller en mindre (fraktal).
export function supportResistance(bars, atrArr, zz, { lookback = 500, maxZones = 10 } = {}) {
  const last = bars.length - 1;
  const atrNow = atrArr[last] ?? (bars[last].h - bars[last].l);
  const price = bars[last].c;
  const from = Math.max(0, bars.length - lookback);
  const halfLife = 180;

  const points = [];
  for (const p of fractals(bars, 3)) {
    if (p.i >= from) points.push({ ...p, w: 1 });
  }
  for (const p of zz) {
    if (p.i >= from && !p.tentative) points.push({ ...p, w: 2.5 });
  }
  if (!points.length) return [];
  points.sort((a, b) => a.price - b.price);

  const tol = atrNow * 0.6;
  const clusters = [];
  let cur = [points[0]];
  for (let k = 1; k < points.length; k++) {
    const p = points[k];
    const mean = cur.reduce((s, q) => s + q.price, 0) / cur.length;
    if (p.price - mean <= tol) cur.push(p);
    else { clusters.push(cur); cur = [p]; }
  }
  clusters.push(cur);

  const zones = clusters.map(c => {
    let lo = Math.min(...c.map(p => p.price));
    let hi = Math.max(...c.map(p => p.price));
    const minW = atrNow * 0.3;
    if (hi - lo < minW) { const m = (hi + lo) / 2; lo = m - minW / 2; hi = m + minW / 2; }
    const strength = c.reduce((s, p) => s + p.w * Math.pow(0.5, (last - p.i) / halfLife), 0);
    const touches = new Set(c.map(p => p.i)).size;
    const hasH = c.some(p => p.type === 'H'), hasL = c.some(p => p.type === 'L');
    const lastTouch = Math.max(...c.map(p => p.i));
    return { lo, hi, mid: (lo + hi) / 2, strength, touches, flipped: hasH && hasL, lastTouch };
  }).filter(z => z.touches >= 2 || z.strength >= 2);

  for (const z of zones) {
    z.kind = z.hi < price ? 'support' : z.lo > price ? 'resistance' : 'inside';
  }

  // Ta de starkaste zonerna, men se till att det finns zoner både under och
  // över priset.
  const below = zones.filter(z => z.kind !== 'resistance').sort((a, b) => b.hi - a.hi);
  const above = zones.filter(z => z.kind === 'resistance').sort((a, b) => a.lo - b.lo);
  const pick = (arr, n) => arr.slice(0, n * 2).sort((a, b) => b.strength - a.strength).slice(0, n);
  const half = Math.ceil(maxZones / 2);
  const selected = [...pick(below, half), ...pick(above, half)];
  const maxS = Math.max(...selected.map(z => z.strength), 1);
  for (const z of selected) z.score = Math.round((z.strength / maxS) * 100);
  return selected.sort((a, b) => b.mid - a.mid);
}

// Fair value gaps (obalans med tre staplar). En bullish FVG uppstår när
// stapel i:s botten ligger över stapel i-2:s topp. Gapet fylls gradvis när
// priset senare handlas in i det; helt fyllda gap tas bort.
export function fairValueGaps(bars, atrArr, { lookback = 300, minAtr = 0.15 } = {}) {
  const from = Math.max(2, bars.length - lookback);
  const gaps = [];
  for (let i = from; i < bars.length; i++) {
    const a = atrArr[i] ?? (bars[i].h - bars[i].l);
    const b0 = bars[i - 2], b2 = bars[i];
    if (b2.l > b0.h && b2.l - b0.h >= a * minAtr) {
      gaps.push({ type: 'bull', lo: b0.h, hi: b2.l, i: i - 1, origLo: b0.h, origHi: b2.l });
    } else if (b2.h < b0.l && b0.l - b2.h >= a * minAtr) {
      gaps.push({ type: 'bear', lo: b2.h, hi: b0.l, i: i - 1, origLo: b2.h, origHi: b0.l });
    }
  }
  const open = [];
  for (const g of gaps) {
    let filled = false;
    for (let j = g.i + 2; j < bars.length; j++) {
      const b = bars[j];
      if (g.type === 'bull') {
        if (b.l <= g.lo) { filled = true; break; }
        if (b.l < g.hi) g.hi = b.l;
      } else {
        if (b.h >= g.hi) { filled = true; break; }
        if (b.h > g.lo) g.lo = b.h;
      }
    }
    if (!filled) {
      g.fillPct = Math.round((1 - (g.hi - g.lo) / (g.origHi - g.origLo)) * 100);
      open.push(g);
    }
  }
  return open;
}

export const FIB_RETRACE = [0.236, 0.382, 0.5, 0.618, 0.65, 0.786];
export const FIB_EXT = [1.272, 1.618, 2.0, 2.618];

// Fibonacci-nivåer för ett ben från `from` till `to` (pris). Retracement
// räknas tillbaka från `to`, extension räknas från `to` i benets riktning
// (mätt från startpunkten).
export function fibLevels(from, to) {
  const d = to - from;
  return {
    retrace: FIB_RETRACE.map(r => ({ r, price: to - d * r })),
    ext: FIB_EXT.map(r => ({ r, price: from + d * r })),
  };
}

// Senaste större benet uppåt (L -> H) och nedåt (H -> L) enligt ZigZag,
// inklusive det obekräftade sista benet.
export function lastLegs(zz) {
  let up = null, down = null;
  for (let k = zz.length - 1; k > 0; k--) {
    const a = zz[k - 1], b = zz[k];
    if (!up && a.type === 'L' && b.type === 'H') up = { from: a, to: b };
    if (!down && a.type === 'H' && b.type === 'L') down = { from: a, to: b };
    if (up && down) break;
  }
  return { up, down };
}
