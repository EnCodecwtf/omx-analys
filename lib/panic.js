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

// Lägger till n vardagar (helgdagar räknas inte bort, så säljdagen är ungefärlig).
export function addTradingDays(d, n) {
  const x = new Date(d + 'T12:00:00Z');
  while (n > 0) { x.setUTCDate(x.getUTCDate() + 1); if (x.getUTCDay() % 6) n--; }
  return x.toISOString().slice(0, 10);
}

// stocks: [{ symbol, name, bars }], vixBars: dagsstaplar för ^VIX, date: signaldagen (OMX).
export function panicPicks({ stocks, vixBars, date }) {
  const prev = vixBars.filter(b => day(b.t) < date);
  const vix = prev.length ? round(prev[prev.length - 1].c) : null;
  const rows = [];
  for (const s of stocks) {
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
  return { state: t + PANIC_DAYS <= bars.length - 1 ? 'stängd' : 'öppen', entry: round(buy), pct, exitDate: day(bars[exitI].t), last: bars[bars.length - 1].c };
}
