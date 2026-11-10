// Fri analys av valfri tillgång (aktie, råvara, index, krypto): riktning, plan för
// lång eller kort position och MA 44/332. Bygger på samma analys som signalerna
// (evaluate), men reglerna är bara testade på OMXS30- och S&P 500-aktier.

const round = x => (x == null ? null : Math.round(x * 100) / 100);
const day = t => new Date(t * 1000).toISOString().slice(0, 10);

function smaSeries(c, n) {
  const out = new Array(c.length).fill(null);
  let s = 0;
  for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}

// MA 44 mot MA 332 (dagsstänger): läget nu och senaste korsningen.
export function maCross(bars, fast = 44, slow = 332) {
  const c = bars.map(b => b.c);
  if (c.length < slow + 1) return null;
  const A = smaSeries(c, fast), B = smaSeries(c, slow), last = c.length - 1;
  const above = A[last] > B[last];
  let cross = null;
  for (let i = last; i > slow; i--) if ((A[i] > B[i]) !== (A[i - 1] > B[i - 1])) { cross = { date: day(bars[i].t), price: round(c[i]), up: A[i] > B[i], changePct: round((c[last] / c[i] - 1) * 100) }; break; }
  return { fast, slow, maFast: round(A[last]), maSlow: round(B[last]), above, gapPct: round((A[last] / B[last] - 1) * 100), cross };
}

// Plan för en kort position: stopp ovanför närmaste motstånd (eller 2 ATR), mål vid stöden under.
export function shortPlan(ev) {
  const price = ev.price, atr = ev.atr;
  const res = ev.zones.filter(z => z.kind === 'resistance' && z.hi > price && z.hi - price <= 3 * atr).sort((a, b) => a.hi - b.hi)[0];
  const stop = round(res ? Math.max(res.hi + 0.25 * atr, price + atr) : price + 2 * atr);
  const R = stop - price;
  // Kandidater: stöd minst 1 R under kursen och 1,5 / 2,5 / 3,5 R. De tre närmaste med lagom avstånd blir målen.
  const cands = [
    ...ev.zones.filter(z => z.kind === 'support' && z.hi <= price - R).map(z => ({ price: z.hi, why: 'stöd' })),
    ...[1.5, 2.5, 3.5].map(k => ({ price: price - k * R, why: `${String(k).replace('.', ',')} R` })),
  ].filter(t => t.price > 0).sort((a, b) => b.price - a.price);
  const tps = [];
  for (const t of cands) { if (tps.length === 3) break; if (!tps.length ? price - t.price >= R : tps.at(-1).price - t.price >= 0.5 * R) tps.push({ price: round(t.price), why: t.why }); }
  return { side: 'short', entry: round(price), stop, riskPct: round(R / price * 100), tps: tps.map(t => ({ ...t, r: round((price - t.price) / R) })) };
}

// Riktning i klartext utifrån trend och status.
export function direction(ev) {
  const up = ev.trend >= 2, down = ev.trend <= -2;
  if (up && (ev.status === 'strong' || ev.status === 'buy')) return { side: 'long', label: 'Lång', text: 'Upptrend och alla krav för köp är uppfyllda enligt appens regler.' };
  if (up && ev.status === 'watch') return { side: 'long', label: 'Lång – bevaka', text: 'Upptrend med en rekyl. Köp först när vändningen bekräftas (se kraven nedan).' };
  if (up) return { side: 'long', label: 'Lång – avvakta', text: 'Upptrend, men inget köpläge just nu. Vänta på en rekyl mot stöd.' };
  if (down) return { side: 'short', label: 'Kort', text: 'Nedtrend: kurs och EMA 50 under EMA 200. Köp avråds; en kort position följer trenden.' };
  return { side: 'none', label: 'Avvakta', text: 'Sidledes: ingen tydlig trend. Vänta på ett utbrott eller en ny trend.' };
}

export function freeView(ev, bars) {
  const dir = direction(ev);
  return {
    direction: dir,
    shortPlan: dir.side === 'short' ? shortPlan(ev) : null,
    ma: maCross(bars),
    note: 'Fri analys: samma metod som appens signaler, men reglerna är bara testade på OMXS30- och S&P 500-aktier. För den här tillgången är de otestade – se det som ett underlag, inte en signal. Ingen signal loggas.',
  };
}
