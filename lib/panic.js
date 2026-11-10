// Panikvecka: när VIX är minst 25 köps de tre OMXS30-aktier som fallit mest de
// senaste 5 handelsdagarna, och de säljs efter 5 handelsdagar. Det var det enda
// korta upplägget (en vecka) som höll i båda perioderna 2017–2026, se README.
// VIX-värdet är gårdagens stängning, eftersom VIX stänger först efter Stockholm.

export const PANIC_VIX = 25;
export const PANIC_N = 3;
export const PANIC_DAYS = 5;
export const PANIC_SIZE = 0.1; // andel av kontot per aktie, utan hävstång
export const PANIC_COST = 0.002;

const day = t => new Date(t * 1000).toISOString().slice(0, 10);
const round = x => Math.round(x * 100) / 100;

// Helgdagar då Stockholmsbörsen är stängd.
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
}
const iso = x => x.toISOString().slice(0, 10);
const shift = (x, n) => { const y = new Date(x); y.setUTCDate(y.getUTCDate() + n); return y; };
const seCache = new Map();
export function stockholmHolidays(y) {
  if (seCache.has(y)) return seCache.get(y);
  const e = easter(y);
  // Midsommarafton: fredagen 19–25 juni.
  let mid = new Date(Date.UTC(y, 5, 19)); while (mid.getUTCDay() !== 5) mid = shift(mid, 1);
  const set = new Set([`${y}-01-01`, `${y}-01-06`, iso(shift(e, -2)), iso(shift(e, 1)), `${y}-05-01`, iso(shift(e, 39)), `${y}-06-06`, iso(mid),
    `${y}-12-24`, `${y}-12-25`, `${y}-12-26`, `${y}-12-31`]);
  seCache.set(y, set);
  return set;
}
export const isStockholmDay = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w !== 0 && w !== 6 && !stockholmHolidays(+d.slice(0, 4)).has(d); };

// Lägger till n handelsdagar på Stockholmsbörsen (helger och helgdagar räknas inte).
export function addTradingDays(d, n) {
  let x = d;
  while (n > 0) { x = iso(shift(new Date(x + 'T12:00:00Z'), 1)); if (isStockholmDay(x)) n--; }
  return x;
}

// stocks: [{ symbol, name, bars }], vixBars: dagsstaplar för ^VIX, date: signaldagen (OMX).
// exclude: aktier som redan ägs i en annan affär – då tas nästa mest fallna.
export function panicPicks({ stocks, vixBars, date, exclude = new Set() }) {
  const prev = vixBars.filter(b => day(b.t) < date);
  const vix = prev.length ? round(prev[prev.length - 1].c) : null;
  const rows = [];
  for (const s of stocks) {
    if (exclude.has(s.symbol)) continue;
    const i = s.bars.findIndex(b => day(b.t) === date);
    if (i < PANIC_DAYS) continue;
    rows.push({ symbol: s.symbol, name: s.name, price: round(s.bars[i].c), ret5: round((s.bars[i].c / s.bars[i - PANIC_DAYS].c - 1) * 100) });
  }
  rows.sort((a, b) => a.ret5 - b.ret5);
  return {
    date, vix, need: PANIC_VIX, active: vix != null && vix >= PANIC_VIX,
    picks: rows.slice(0, PANIC_N), exitDate: addTradingDays(date, PANIC_DAYS), days: PANIC_DAYS, size: PANIC_SIZE,
  };
}

// Utfallet för en loggad panikaffär: köp på öppningen dagen efter, sälj på
// stängningen 5 handelsdagar efter signaldagen. Procent efter avgift.
export function panicOutcome(entry, bars) {
  const t = bars.findIndex(b => day(b.t) === entry.date);
  if (t < 0) return { state: 'okänd' };
  if (t + 1 >= bars.length) return { state: 'väntar på köp' };
  const buy = bars[t + 1].o;
  const exitI = Math.min(t + PANIC_DAYS, bars.length - 1);
  const pct = round(((bars[exitI].c / buy - 1) - PANIC_COST) * 100);
  const closed = t + PANIC_DAYS <= bars.length - 1;
  // Säljdagen är den planerade (5 handelsdagar efter signalen), inte senaste kursdagen.
  const exitDate = closed ? day(bars[exitI].t) : entry.exitDate || addTradingDays(entry.date, PANIC_DAYS);
  return { state: closed ? 'stängd' : 'öppen', entry: round(buy), buyDate: day(bars[t + 1].t), pct, exitDate, last: bars[bars.length - 1].c };
}
