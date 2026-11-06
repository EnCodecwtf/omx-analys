// AI-tradern: ett fiktivt konto som tar alla signaler som släpps och fattar egna
// beslut under affärens gång. Kontot startar med 30 000 kr, har högst 3 affärer
// igång och satsar cirka 10 % av kontot per affär (minst 1 000 kr) i en simulerad
// minifuture med 5x hävstång. Allt räknas om från början på dagsdata, så varje
// beslut går att följa och upprepa.
//
// "AI" här är en regelbaserad beslutsmodell som väger ihop läget varje dag:
//   • Stoppet nås            → sälj allt.
//   • TP1 nås                → stark trend (över EMA 20, RSI stiger): sälj 1/3 och låt
//                              resten löpa; svag trend: sälj hälften. Stoppet till köpkursen.
//   • TP2 nås                → sälj hälften av det som är kvar, stoppet till TP1.
//   • TP3 nås                → stark trend: behåll sista delen med glidande stopp
//                              (1,5 ATR under högsta stängning); annars sälj allt.
//   • Tillbaka efter TP1     → stänger under EMA 20 och nära köpkursen: sälj resten.
//   • Rapport om ≤ 2 dagar   → i vinst: sälj hälften före rapporten.
//   • Kommer inte igång      → 20 handelsdagar utan TP1: sälj på stängningen.

import { ema, rsi, atr } from './indicators.js';

export const AI_START_CAPITAL = 30000;
export const AI_MAX_OPEN = 3;
export const AI_SIZE = 0.10;
export const AI_MIN_AMOUNT = 1000;
export const AI_LEVERAGE = 5;
export const AI_COST = 0.005; // spread och courtage per affär, andel av beloppet

const day = t => new Date(t * 1000).toISOString().slice(0, 10);
const weekdaysBetween = (a, b) => { let n = 0; for (let x = new Date(a + 'T12:00:00Z'); x.toISOString().slice(0, 10) < b;) { x.setUTCDate(x.getUTCDate() + 1); if (x.getUTCDay() % 6) n++; } return n; };
const r2 = x => Math.round(x * 100) / 100;
const kr = v => `${Math.round(v).toLocaleString('sv-SE')} kr`;
const px = v => v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// entries: signalloggen (OMX- och USA-signaler med stopp och mål).
// barsFor(symbol) → dagsstaplar. reportsFor(symbol) → rapportdatum ('ÅÅÅÅ-MM-DD').
export function runAiTrader(entries, barsFor, reportsFor = () => [], { start = AI_START_CAPITAL } = {}) {
  const signals = entries.filter(e => !e.kind && e.stop != null && e.tps?.length === 3).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const series = new Map();
  for (const e of signals) if (!series.has(e.symbol)) {
    const bars = barsFor(e.symbol);
    if (!bars?.length) continue;
    const c = bars.map(b => b.c);
    series.set(e.symbol, { bars, e20: ema(c, 20), rsi: rsi(c, 14), atr: atr(bars, 14), idx: new Map(bars.map((b, i) => [day(b.t), i])) });
  }
  const days = [...new Set([...series.values()].flatMap(s => s.bars.map(b => day(b.t))))].filter(d => d >= (signals[0]?.date || '9999')).sort();

  let cash = start;
  const open = [], closed = [], log = [], curve = [];
  const value = p => p.left * p.amount * Math.max(0, 1 + AI_LEVERAGE * (p.last / p.entry - 1));
  const equity = () => cash + open.reduce((a, p) => a + value(p), 0);
  const note = (date, p, action, text, extra = {}) => log.push({ date, symbol: p.symbol, name: p.name, action, text, ...extra });
  const sell = (date, p, frac, price, why, action) => {
    const part = Math.min(frac, p.left);
    if (part <= 0) return;
    const ret = AI_LEVERAGE * (price / p.entry - 1);
    const kronor = part * p.amount * Math.max(0, 1 + ret);
    const what = part >= 0.999 ? 'allt' : part >= p.left - 0.001 ? 'resten' : `${Math.round(part * 100)} % av positionen`;
    cash += kronor - part * p.amount * AI_COST / 2;
    p.realized += kronor - part * p.amount - part * p.amount * AI_COST / 2;
    p.left = p.left - part <= 0.001 ? 0 : p.left - part;
    note(date, p, action, `${why} Säljer ${what} vid ${px(price)} (${ret >= 0 ? '+' : ''}${(ret * 100).toFixed(1).replace('.', ',')} % på pappret).`, { price: r2(price) });
  };

  for (const d of days) {
    // 1. Nya köp: signaler från föregående handelsdag köps på dagens öppning.
    for (const e of signals) {
      const s = series.get(e.symbol);
      const i = s?.idx.get(d);
      if (i == null || i === 0 || day(s.bars[i - 1].t) !== e.date) continue;
      const stub = { symbol: e.symbol, name: e.name };
      if (open.some(p => p.symbol === e.symbol)) continue;
      if (open.length >= AI_MAX_OPEN) { note(d, stub, 'avstår', `Ny signal i ${e.name}, men tre affärer är redan igång. Avstår för att inte ta för stor risk.`); continue; }
      const entry = s.bars[i].o;
      if (entry <= e.stop) { note(d, stub, 'avstår', `${e.name} öppnade under stoppet (${px(e.stop)}). Avstår, signalen gäller inte längre.`); continue; }
      const amount = Math.min(cash, Math.max(AI_MIN_AMOUNT, AI_SIZE * equity()));
      if (amount < AI_MIN_AMOUNT) { note(d, stub, 'avstår', `Signal i ${e.name}, men för lite kontanter (${kr(cash)}).`); continue; }
      cash -= amount + amount * AI_COST / 2;
      const p = { ...stub, signal: e.date, market: e.market || 'OMX', entry, stop: e.stop, sl: e.stop, tps: e.tps, amount, left: 1, hit: 0, realized: -amount * AI_COST / 2, opened: d, bestClose: entry, trailing: false, last: entry };
      open.push(p);
      note(d, p, 'köper', `Köper ${e.name} på öppningen för ${kr(amount)} (${Math.round(amount / equity() * 100)} % av kontot). Stopp ${px(e.stop)}, mål ${e.tps.map(px).join(' / ')}.`, { price: r2(entry) });
    }

    // 2. Beslut i öppna affärer.
    for (const p of [...open]) {
      const s = series.get(p.symbol);
      const i = s.idx.get(d);
      if (i == null) continue;
      const b = s.bars[i];
      const strong = b.c > s.e20[i] && s.rsi[i] > (s.rsi[i - 1] ?? 0);
      const R = p.entry - p.stop;
      // Stoppet (även glidande eller flyttat).
      if (b.l <= p.sl) {
        sell(d, p, p.left, Math.min(p.sl, b.o), p.trailing ? 'Glidande stopp nåddes – trenden har vänt.' : p.hit ? 'Kursen föll tillbaka till det flyttade stoppet.' : 'Stoppet nåddes. En del av spelet.', 'stopp');
      } else {
        // Målen, i ordning.
        while (p.hit < 3 && p.left > 0 && b.h >= p.tps[p.hit]) {
          const tp = p.tps[p.hit];
          p.hit++;
          if (p.hit === 1) {
            sell(d, p, strong ? 1 / 3 : 0.5, tp, strong ? 'TP1 nådd och trenden är stark (över EMA 20, RSI stiger). Låter mer löpa.' : 'TP1 nådd men momentum är svagt. Säkrar mer än vanligt.', 'tp1');
            p.sl = Math.max(p.sl, p.entry);
            note(d, p, 'flyttar stopp', `Flyttar stoppet till köpkursen ${px(p.entry)}. Affären kan inte längre gå med förlust.`);
          } else if (p.hit === 2) {
            sell(d, p, p.left / 2, tp, 'TP2 nådd.', 'tp2');
            p.sl = Math.max(p.sl, p.tps[0]);
            note(d, p, 'flyttar stopp', `Flyttar stoppet till TP1 ${px(p.tps[0])} och låser in vinst.`);
          } else if (strong && b.c < s.e20[i] * 1.15 && s.rsi[i] < 70) {
            p.trailing = true;
            note(d, p, 'håller', `TP3 nådd och trenden är fortfarande stark. Behåller sista delen med glidande stopp 1,5 ATR under högsta stängning.`);
          } else {
            sell(d, p, p.left, tp, 'TP3 nådd. Tar hem hela vinsten.', 'tp3');
          }
        }
        if (p.left > 0) {
          p.bestClose = Math.max(p.bestClose, b.c);
          if (p.trailing) p.sl = Math.max(p.sl, p.bestClose - 1.5 * (s.atr[i] || R));
          const held = i - s.idx.get(p.opened);
          const soon = reportsFor(p.symbol).find(r => r > d && weekdaysBetween(d, r) <= 2);
          if (p.hit >= 1 && !p.trailing && b.c < s.e20[i] && b.c < p.entry + 0.3 * R) {
            sell(d, p, p.left, b.c, 'Kursen föll tillbaka under EMA 20 efter TP1 och är nära köpkursen. Strukturen försvagas – säkrar vinsten i stället för att vänta på stoppet.', 'säljer');
          } else if (soon && !p.reportCut && b.c > p.entry) {
            p.reportCut = true;
            sell(d, p, p.left / 2, b.c, `Rapport ${soon}. Tar hem hälften före rapporten – den kan ge ett hopp åt båda hållen.`, 'minskar');
          } else if (p.hit === 0 && held >= 20) {
            sell(d, p, p.left, b.c, '20 handelsdagar utan att TP1 nåtts. Affären har inte kommit igång – frigör pengarna.', 'säljer');
          }
        }
      }
      p.last = b.c;
      if (p.left <= 0) {
        open.splice(open.indexOf(p), 1);
        closed.push({ ...p, closedOn: d, pnl: r2(p.realized), pnlPct: r2(p.realized / p.amount * 100) });
      }
    }
    curve.push({ date: d, equity: r2(equity()) });
  }

  const eq = equity();
  return {
    start, equity: r2(eq), cash: r2(cash), returnPct: r2((eq / start - 1) * 100), leverage: AI_LEVERAGE, maxOpen: AI_MAX_OPEN,
    open: open.map(p => ({ symbol: p.symbol, name: p.name, market: p.market, signal: p.signal, opened: p.opened, entry: r2(p.entry), last: r2(p.last), stop: r2(p.sl), tps: p.tps, hit: p.hit, left: r2(p.left), amount: r2(p.amount),
      value: r2(value(p)), pnl: r2(p.realized + value(p) - p.left * p.amount), pnlPct: r2((p.realized + value(p) - p.left * p.amount) / p.amount * 100), trailing: p.trailing })),
    closed: closed.map(p => ({ symbol: p.symbol, name: p.name, opened: p.opened, closedOn: p.closedOn, entry: r2(p.entry), amount: r2(p.amount), pnl: p.pnl, pnlPct: p.pnlPct, hit: p.hit })).reverse(),
    log: log.reverse(), curve,
    stats: { trades: closed.length, wins: closed.filter(p => p.realized > 0).length },
  };
}
