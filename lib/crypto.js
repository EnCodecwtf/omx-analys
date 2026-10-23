// Krypto-utbrott: köp bitcoin eller ether när kursen stänger på ny
// 20-dagarstopp och ligger över EMA 200, sälj på stängningen 7 dagar senare.
// Det är en annan sorts strategi än OMX-signalerna (utbrott i stället för
// rekyl) och den enda korta strategin som slog jämförelsen i alla perioder
// 2017–2026 (se README). Inget stopp: backtestet säljer alltid efter 7 dagar.

import { ema } from './indicators.js';

export const CRYPTO_LOOKBACK = 20;
export const CRYPTO_DAYS = 7;
export const CRYPTO_SIZE = 0.3; // andel av kontot per affär, utan hävstång
export const CRYPTO_COST = 0.002; // avgift och spread på en kryptobörs, tur och retur

const day = t => new Date(t * 1000).toISOString().slice(0, 10);
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);
const round = x => Math.round(x * 100) / 100;

// Dagens stapel är inte klar förrän dygnet är slut (UTC), så den tas bort.
export function completeBars(bars, now = new Date()) {
  return bars.length && day(bars[bars.length - 1].t) >= now.toISOString().slice(0, 10) ? bars.slice(0, -1) : bars;
}

// Signalen för sista stapeln, med kraven som en lista.
export function cryptoSignal(bars) {
  const c = bars.map(b => b.c);
  const last = c.length - 1;
  const e200 = ema(c, 200)[last];
  const high = Math.max(...c.slice(last - CRYPTO_LOOKBACK, last));
  const price = c[last];
  const up = e200 != null && price > e200;
  const breakout = price > high;
  const date = day(bars[last].t);
  const checklist = [
    { key: 'trend', ok: up, text: 'Kursen över EMA 200', now: e200 == null ? 'för kort historik' : `${round(price)} mot EMA 200 ${round(e200)}` },
    { key: 'breakout', ok: breakout, text: `Stängning på ny ${CRYPTO_LOOKBACK}-dagarstopp`,
      now: breakout ? `stängde ${round(price)}, över förra toppen ${round(high)}` : `stängde ${round(price)}, toppen är ${round(high)} (${round((high / price - 1) * 100)} % upp)` },
  ];
  const status = up && breakout ? 'strong' : up && price >= high * 0.97 ? 'watch' : 'neutral';
  return { status, checklist, price: round(price), level: round(high), ema200: round(e200), date,
    exitDate: addDays(date, CRYPTO_DAYS + 1), days: CRYPTO_DAYS, size: CRYPTO_SIZE };
}

// Backtest med samma regler: köp på öppningen dagen efter signalen, sälj på
// stängningen 7 dagar senare. Avkastningen är i procent efter avgift.
export function cryptoBacktest(bars, { start = 201 } = {}) {
  const c = bars.map(b => b.c), e = ema(c, 200);
  const trades = [];
  for (let i = start; i < bars.length - 1; i++) {
    if (!(e[i] != null && c[i] > e[i] && c[i] > Math.max(...c.slice(i - CRYPTO_LOOKBACK, i)))) continue;
    const exitI = Math.min(i + CRYPTO_DAYS, bars.length - 1);
    const open = i + CRYPTO_DAYS > bars.length - 1;
    const entry = bars[i + 1].o;
    trades.push({ i, t: bars[i].t, exitI, exitT: bars[exitI].t, entry: round(entry), exit: round(c[exitI]), open,
      pct: round(((c[exitI] / entry - 1) - CRYPTO_COST) * 100), status: 'strong' });
    i = exitI;
  }
  const closed = trades.filter(t => !t.open);
  const stats = {
    n: closed.length,
    winRate: closed.length ? Math.round(1000 * closed.filter(t => t.pct > 0).length / closed.length) / 10 : null,
    avgPct: closed.length ? round(closed.reduce((a, t) => a + t.pct, 0) / closed.length) : null,
  };
  return { trades, stats };
}

// Utfallet för en loggad kryptosignal.
export function cryptoOutcome(entry, bars) {
  const t = bars.findIndex(b => day(b.t) === entry.date);
  if (t < 0) return { state: 'okänd' };
  if (t + 1 >= bars.length) return { state: 'väntar på köp' };
  const buy = bars[t + 1].o;
  const exitI = Math.min(t + CRYPTO_DAYS, bars.length - 1);
  const pct = round(((bars[exitI].c / buy - 1) - CRYPTO_COST) * 100);
  return { state: t + CRYPTO_DAYS <= bars.length - 1 ? 'stängd' : 'öppen', entry: round(buy), pct, exitDate: day(bars[exitI].t), last: bars[bars.length - 1].c };
}
