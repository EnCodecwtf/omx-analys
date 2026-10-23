// Klassiska formationer: inverterad head & shoulders, dubbelbotten, cup &
// handle och stigande triangel (köp vid utbrott), samt head & shoulders och
// dubbeltopp (sälj). Mönstren byggs av ZigZag-svängarna och kräver bara data
// fram till sista stapeln, så de kan användas i backtest utan att titta framåt.
//
// Säljmönstren hittas som köpmönster på en speglad kurs (K / pris), så att
// samma regler gäller åt båda hållen.

import { atr } from './indicators.js';
import { zigzag } from './structure.js';

const round = x => Math.round(x * 100) / 100;

function mirror(bars) {
  const k = bars[bars.length - 1].c ** 2;
  return { k, bars: bars.map(b => ({ t: b.t, o: k / b.o, h: k / b.l, l: k / b.h, c: k / b.c, v: b.v })) };
}

// Köpmönster på staplarna `bars`. Returnerar mönster vars utbrottsnivå är
// relevant för sista stapeln: `breakout` är sant om stängningen i dag gick
// över nivån för första gången.
export function bullishPatterns(bars, a) {
  const n = bars.length, last = n - 1;
  if (n < 60) return [];
  const atrv = a[last] ?? (bars[last].h - bars[last].l);
  const zz = zigzag(bars, a, { atrMult: 2.5 }).filter(p => !p.tentative);
  const c = bars[last].c, cPrev = bars[last - 1].c;
  const lowSince = i => { let m = i; for (let j = i; j <= last; j++) if (bars[j].l < bars[m].l) m = j; return m; };
  const crossed = level => c > level && cPrev <= level;
  const out = [];
  // levelAt ger utbrottsnivån vid stapel i (halslinjen kan luta).
  const add = (p, levelAt, stopPx, height, from) => {
    const level = levelAt(last), stop = stopPx - atrv * 0.25;
    let brokeI = null;
    for (let j = from + 1; j <= last; j++) if (bars[j].c > levelAt(j)) { brokeI = j; break; }
    out.push({ ...p, level: round(level), stop: round(stop), target: round(level + height), height: round(height),
      breakout: crossed(level), above: c > level, brokeAgo: brokeI == null ? null : last - brokeI,
      progress: round((c - stopPx) / (level - stopPx)) });
  };

  // Svängarna från slutet: ... L H L H. Den sista bottnen efter sista toppen
  // behöver inte vara bekräftad, den är lägsta kursen sedan dess.
  const piv = zz.slice(-8);
  const lastH = [...piv].reverse().find(p => p.type === 'H');
  if (!lastH || last - lastH.i > 60) return out;
  const hIdx = piv.indexOf(lastH);
  const l3i = lowSince(lastH.i + 1);
  if (l3i <= lastH.i) return out;
  const L3 = { i: l3i, price: bars[l3i].l };

  // Inverterad head & shoulders: L1 H1 L2 H2 L3 med L2 lägst och L1 ≈ L3.
  if (hIdx >= 3) {
    const [L1, H1, L2, H2] = piv.slice(hIdx - 3, hIdx + 1);
    if (L1.type === 'L' && H1.type === 'H' && L2.type === 'L'
      && L2.price < L1.price - atrv * 0.5 && L2.price < L3.price - atrv * 0.5
      && Math.abs(L1.price - L3.price) <= atrv * 1.5 && L3.i - L1.i <= 150) {
      const slope = (H2.price - H1.price) / (H2.i - H1.i);
      const neck = i => H1.price + slope * (i - H1.i);
      if (Math.abs(slope) * (H2.i - H1.i) <= atrv * 2.5) {
        add({ type: 'ihs', dir: 'bull', label: 'Inverterad head & shoulders',
          points: [L1, H1, L2, H2, L3].map(p => ({ i: p.i, price: round(p.price) })),
          neck: [{ i: H1.i, price: round(H1.price) }, { i: last, price: round(neck(last)) }] },
        neck, L3.price, neck(L2.i) - L2.price, L3.i);
      }
    }
  }

  // Dubbelbotten: L1 H1 L2 med L1 ≈ L2 och minst 2 ATR upp till mellantoppen.
  if (hIdx >= 1) {
    const L1 = piv[hIdx - 1], H1 = lastH;
    const lo = Math.min(L1.price, L3.price);
    if (L1.type === 'L' && Math.abs(L1.price - L3.price) <= atrv * 1.0 && H1.price - lo >= atrv * 2
      && L3.i - L1.i >= 10 && L3.i - L1.i <= 120) {
      add({ type: 'dbl', dir: 'bull', label: 'Dubbelbotten',
        points: [L1, H1, L3].map(p => ({ i: p.i, price: round(p.price) })),
        neck: [{ i: H1.i, price: round(H1.price) }, { i: last, price: round(H1.price) }] },
      () => H1.price, L3.price, H1.price - lo, L3.i);
    }
  }

  // Cup & handle: vänster kant H0, botten C, höger kant H1 ≈ H0 och ett
  // grunt handtag efter H1 (högst halva koppens djup).
  if (hIdx >= 2) {
    const H0 = piv[hIdx - 2], C = piv[hIdx - 1], H1 = lastH;
    const depth = Math.min(H0.price, H1.price) - C.price;
    const handle = H1.price - L3.price;
    if (H0.type === 'H' && C.type === 'L' && depth >= atrv * 3 && depth / H0.price <= 0.35
      && Math.abs(H0.price - H1.price) <= Math.max(atrv, H0.price * 0.03) && H1.i - H0.i >= 25 && H1.i - H0.i <= 250
      && handle <= depth * 0.5 && L3.i - H1.i >= 3 && L3.i - H1.i <= (H1.i - H0.i) / 2) {
      add({ type: 'cup', dir: 'bull', label: 'Cup & handle',
        points: [H0, C, H1, L3].map(p => ({ i: p.i, price: round(p.price) })),
        neck: [{ i: H1.i, price: round(H1.price) }, { i: last, price: round(H1.price) }] },
      () => H1.price, L3.price, depth, L3.i);
    }
  }

  // Stigande triangel: två toppar på samma nivå och stigande bottnar.
  if (hIdx >= 2) {
    const H0 = piv[hIdx - 2], L1 = piv[hIdx - 1], H1 = lastH;
    if (H0.type === 'H' && L1.type === 'L' && Math.abs(H0.price - H1.price) <= atrv * 0.5
      && L3.price > L1.price + atrv * 0.5 && H1.i - H0.i <= 120) {
      const top = Math.max(H0.price, H1.price);
      add({ type: 'tri', dir: 'bull', label: 'Stigande triangel',
        points: [H0, L1, H1, L3].map(p => ({ i: p.i, price: round(p.price) })),
        neck: [{ i: H0.i, price: round(top) }, { i: last, price: round(top) }] },
      () => top, L3.price, top - L1.price, L3.i);
    }
  }
  return out;
}

const BEAR_LABEL = { ihs: 'Head & shoulders', dbl: 'Dubbeltopp' };

// Alla mönster för sista stapeln. Säljmönstren har priser i vanlig skala.
export function detectPatterns(bars, atrArr = atr(bars, 14)) {
  const bull = bullishPatterns(bars, atrArr);
  const m = mirror(bars);
  const back = x => round(m.k / x);
  const bear = bullishPatterns(m.bars, atr(m.bars, 14))
    .filter(p => BEAR_LABEL[p.type])
    .map(p => ({
      ...p, dir: 'bear', label: BEAR_LABEL[p.type], level: back(p.level), stop: back(p.stop), target: back(p.target),
      height: round(back(p.level) - back(p.level + p.height)),
      points: p.points.map(q => ({ i: q.i, price: back(q.price) })),
      neck: p.neck.map(q => ({ i: q.i, price: back(q.price) })),
    }));
  return [...bull, ...bear];
}

// Mönster som är värda att visa: utbrott de senaste 20 dagarna, eller ett
// mönster där kursen har kommit mer än halvvägs från bottnen mot utbrottet.
export function relevantPatterns(bars) {
  return detectPatterns(bars).filter(p => (p.brokeAgo != null && p.brokeAgo <= 20) || (p.brokeAgo == null && p.progress >= 0.5));
}
