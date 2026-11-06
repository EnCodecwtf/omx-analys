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

// Maskininlärning för beslutet vid TP1: logistisk regression tränad på 2017–2021 och
// testad på 2022–2026 (229 affärer som nådde TP1, de bolag som faktiskt var med i OMXS30).
// Den bedömer chansen att det lönar sig att låta resten löpa mot TP2/TP3 med stoppet på
// köpkursen, i stället för att sälja allt vid TP1. Test 2022–26: +83,2 R mot +80,1 R för att
// alltid hålla och +76,5 R för att alltid sälja (88 % av bootstrap-simuleringarna positiva,
// men skillnaden ligger inom slumpen). Se README.
export const TP1_MODEL = {
  names: ['RSI', 'avstånd EMA20 (ATR)', 'EMA20-lutning', 'ATR %', 'dagar till TP1', 'TP2-avstånd (R)', 'makropoäng', 'VIX', 'stängning i dagens spann', 'stängning (R)'],
  mu: [0.50133, 0.29441, -0.01002, 2.63457, 6.29897, 0.59694, 1.13402, 1.18976, 0.65209, 0.80435],
  sd: [0.08084, 1.0381, 0.01794, 1.35729, 8.09374, 0.26049, 1.22372, 0.63249, 0.28103, 0.43357],
  w: [0.8022, -0.4098, -0.2375, 0.164, 0.461, 0.0313, 0.1464, -0.0166, 0.1531, 0.4293],
  b0: -0.1002, threshold: 0.38,
};
export function tp1Hold(x) {
  const m = TP1_MODEL;
  const v = m.b0 + x.reduce((a, xi, f) => a + m.w[f] * (xi - m.mu[f]) / m.sd[f], 0);
  return 1 / (1 + Math.exp(-v));
}

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
// productFor(signal) → det papper AI:n valt bland appens förslag (fiktivt), eller null.
// Minifuture: värdet följer (kurs − finansieringsnivå), och knock-out ger nästan noll.
// Bull-certifikat: daglig hävstång, värdet räknas om varje stängning.
// Utan papper räknas en minifuture med 5x hävstång.
export function runAiTrader(entries, barsFor, reportsFor = () => [], { start = AI_START_CAPITAL, productFor = () => null, macroFor = () => 1, vixFor = () => 20 } = {}) {
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
  // Pappers värde som andel av köpvärdet vid underliggande kurs S (samma dag).
  const mult = (p, S) => {
    const pr = p.product;
    if (pr?.type === 'mini') return S <= pr.knockout ? Math.max(0, (pr.knockout - pr.financing) / (p.entry - pr.financing)) : (S - pr.financing) / (p.entry - pr.financing);
    if (pr?.type === 'bull') return p.m * (1 + pr.leverage * (S / p.prevC - 1));
    return 1 + AI_LEVERAGE * (S / p.entry - 1);
  };
  const value = p => p.left * p.amount * Math.max(0, p.mNow);
  const equity = () => cash + open.reduce((a, p) => a + value(p), 0);
  const note = (date, p, action, text, extra = {}) => log.push({ date, symbol: p.symbol, name: p.name, action, text, ...extra });
  const sell = (date, p, frac, price, why, action) => {
    const part = Math.min(frac, p.left);
    if (part <= 0) return;
    const ret = Math.max(0, mult(p, price)) - 1;
    const kronor = part * p.amount * (1 + ret);
    const what = part >= 0.999 ? 'allt' : part >= p.left - 0.001 ? 'resten' : `${Math.round(part * 100)} % av positionen`;
    cash += kronor - part * p.amount * p.cost / 2;
    p.realized += kronor - part * p.amount - part * p.amount * p.cost / 2;
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
      const pr = productFor(e);
      // Minifuture som redan skulle vara utslagen vid öppningen kan inte köpas.
      const product = pr && !(pr.type === 'mini' && entry <= pr.knockout) ? pr : null;
      const cost = product?.spreadPct != null ? product.spreadPct / 100 + 0.002 : AI_COST;
      cash -= amount + amount * cost / 2;
      const p = { ...stub, signal: e.date, market: e.market || 'OMX', entry, stop: e.stop, sl: e.stop, tps: e.tps, amount, left: 1, hit: 0, realized: -amount * cost / 2, opened: d, bestClose: entry, trailing: false, last: entry, product, cost, m: 1, mNow: 1, prevC: entry };
      open.push(p);
      const lev = product?.type === 'mini' ? r2(entry / (entry - product.financing)) : product?.leverage ?? AI_LEVERAGE;
      note(d, p, 'köper', `Köper ${product ? `${product.name} (${product.type === 'mini' ? 'minifuture' : 'bull-certifikat'}, ${String(lev).replace('.', ',')}x${product.type === 'mini' ? `, knock-out ${px(product.knockout)}` : ''})` : `${e.name} (simulerad minifuture 5x)`} för ${kr(amount)} (${Math.round(amount / equity() * 100)} % av kontot). Aktiens stopp ${px(e.stop)}, mål ${e.tps.map(px).join(' / ')}.${product?.late ? ' Pappret valdes i efterhand bland dagens förslag.' : ''}`, { price: r2(entry) });
    }

    // 2. Beslut i öppna affärer.
    for (const p of [...open]) {
      const s = series.get(p.symbol);
      const i = s.idx.get(d);
      if (i == null) continue;
      const b = s.bars[i];
      const strong = b.c > s.e20[i] && s.rsi[i] > (s.rsi[i - 1] ?? 0);
      const R = p.entry - p.stop;
      // Knock-out (ska inte hända, eftersom knock-out ligger minst 1 ATR under stoppet, men kan vid ett gap).
      if (p.product?.type === 'mini' && b.l <= p.product.knockout) {
        sell(d, p, p.left, p.product.knockout, 'Knock-out: kursen gick ned till pappret knock-out-nivå.', 'stopp');
      } else if (b.l <= p.sl) {
        sell(d, p, p.left, Math.min(p.sl, b.o), p.trailing ? 'Glidande stopp nåddes – trenden har vänt.' : p.hit ? 'Kursen föll tillbaka till det flyttade stoppet.' : 'Stoppet nåddes. En del av spelet.', 'stopp');
      } else {
        // Målen, i ordning.
        while (p.hit < 3 && p.left > 0 && b.h >= p.tps[p.hit]) {
          const tp = p.tps[p.hit];
          p.hit++;
          if (p.hit === 1) {
            // Maskininlärningsmodellen avgör: låta resten löpa eller sälja allt.
            const sigI = s.idx.get(p.signal) ?? s.idx.get(p.opened) - 1;
            const x = [s.rsi[i] / 100, (b.c - s.e20[i]) / (s.atr[i] || R), s.e20[i] / s.e20[i - 5] - 1, (s.atr[i] || R) / b.c * 100, i - sigI,
              (p.tps[1] - p.tps[0]) / R, macroFor(d), vixFor(d) / 20, (b.c - b.l) / ((b.h - b.l) || 1), (b.c - p.entry) / R];
            const prob = tp1Hold(x), pc = Math.round(prob * 100);
            if (prob >= TP1_MODEL.threshold) {
              sell(d, p, 1 / 3, tp, `TP1 nådd. Modellen bedömer ${pc} % chans att det lönar sig att låta resten löpa (gräns ${Math.round(TP1_MODEL.threshold * 100)} %) – behåller två tredjedelar.`, 'tp1');
              p.sl = Math.max(p.sl, p.entry);
              note(d, p, 'flyttar stopp', `Flyttar stoppet till köpkursen ${px(p.entry)}. Affären kan inte längre gå med förlust.`);
            } else {
              sell(d, p, p.left, tp, `TP1 nådd. Modellen bedömer bara ${pc} % chans att det lönar sig att vänta på TP2 – tar hem hela vinsten nu.`, 'tp1');
            }
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
      p.mNow = mult(p, b.c);
      p.m = p.mNow; p.prevC = b.c;
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
      product: p.product && { name: p.product.name, type: p.product.type, url: p.product.url, issuer: p.product.issuer, knockout: p.product.knockout ?? null,
        leverage: p.product.type === 'mini' ? r2(p.entry / (p.entry - p.product.financing)) : p.product.leverage, late: !!p.product.late, valueMult: r2(p.mNow) },
      value: r2(value(p)), pnl: r2(p.realized + value(p) - p.left * p.amount), pnlPct: r2((p.realized + value(p) - p.left * p.amount) / p.amount * 100), trailing: p.trailing })),
    closed: closed.map(p => ({ symbol: p.symbol, name: p.name, product: p.product?.name || null, opened: p.opened, closedOn: p.closedOn, entry: r2(p.entry), amount: r2(p.amount), pnl: p.pnl, pnlPct: p.pnlPct, hit: p.hit })).reverse(),
    log: log.reverse(), curve,
    stats: { trades: closed.length, wins: closed.filter(p => p.realized > 0).length },
  };
}
