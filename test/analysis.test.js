import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ema, rsi, atr } from '../lib/indicators.js';
import { zigzag, fairValueGaps, fibLevels } from '../lib/structure.js';
import { elliott } from '../lib/elliott.js';
import { evaluate, backtest } from '../lib/analyze.js';

// Bygger staplar som följer en lista med priser linjärt, med lite brus.
function path(points, perLeg = 10) {
  const bars = [];
  let t = 1_600_000_000;
  for (let k = 0; k < points.length - 1; k++) {
    for (let j = 0; j < perLeg; j++) {
      const c = points[k] + (points[k + 1] - points[k]) * (j + 1) / perLeg;
      const o = points[k] + (points[k + 1] - points[k]) * j / perLeg;
      bars.push({ t: t += 86400, o, h: Math.max(o, c) + 0.3, l: Math.min(o, c) - 0.3, c, v: 1000 });
    }
  }
  return bars;
}

test('EMA och RSI', () => {
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[1], null);
  assert.equal(e[2], 2);
  assert.equal(e[4], 4);
  const up = rsi(Array.from({ length: 30 }, (_, i) => i), 14);
  assert.equal(up[29], 100);
});

test('ATR är positiv', () => {
  const bars = path([100, 110, 100], 20);
  const a = atr(bars, 14);
  assert.ok(a[30] > 0);
});

test('ZigZag hittar svängarna', () => {
  const bars = path([100, 130, 115, 150, 135], 15);
  const zz = zigzag(bars, atr(bars), { atrMult: 2.5, minPct: 0.03 });
  const types = zz.map(p => p.type).join('');
  assert.equal(types, 'LHLHL');
  assert.ok(zz[zz.length - 1].tentative);
  assert.ok(Math.abs(zz[1].price - 130.3) < 0.5);
});

test('Bullish FVG hittas och fylls', () => {
  const bars = [
    { t: 1, o: 10, h: 10.5, l: 9.5, c: 10.2, v: 1 },
    { t: 2, o: 10.4, h: 12.5, l: 10.3, c: 12.4, v: 1 },
    { t: 3, o: 12.4, h: 13, l: 11.5, c: 12.8, v: 1 },
  ];
  const a = bars.map(() => 1);
  const gaps = fairValueGaps(bars, a);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].type, 'bull');
  assert.deepEqual([gaps[0].lo, gaps[0].hi], [10.5, 11.5]);
  bars.push({ t: 4, o: 12, h: 12, l: 10.4, c: 10.6, v: 1 });
  assert.equal(fairValueGaps(bars, bars.map(() => 1)).length, 0);
});

test('Fibonacci-nivåer', () => {
  const f = fibLevels(100, 200);
  assert.equal(f.retrace.find(x => x.r === 0.5).price, 150);
  assert.ok(Math.abs(f.ext.find(x => x.r === 1.272).price - 227.2) < 1e-9);
});

test('Elliott: våg 4 i en uppåtimpuls', () => {
  const zz = [
    { i: 0, price: 100, type: 'L' },
    { i: 10, price: 120, type: 'H' },
    { i: 20, price: 108, type: 'L' },
    { i: 30, price: 140, type: 'H' },
    { i: 40, price: 128, type: 'L', tentative: true },
  ];
  const { primary } = elliott(zz);
  const counts = [primary, ...elliott(zz).alternatives];
  const w4 = counts.find(c => c.dir === 'bull' && c.phase === 'w4');
  assert.ok(w4, 'våg 4 ska finnas bland kandidaterna');
  assert.equal(w4.invalidation, 120);
  assert.ok(w4.zone[0] >= 120 && w4.zone[1] <= 140);
});

test('Elliott: våg 4 som överlappar våg 1 är ogiltig', () => {
  const zz = [
    { i: 0, price: 100, type: 'L' },
    { i: 10, price: 120, type: 'H' },
    { i: 20, price: 108, type: 'L' },
    { i: 30, price: 140, type: 'H' },
    { i: 40, price: 115, type: 'L', tentative: true },
  ];
  const all = [elliott(zz).primary, ...elliott(zz).alternatives].filter(Boolean);
  assert.ok(!all.some(c => c.dir === 'bull' && c.phase === 'w4'));
});

test('Handelsplanen har stopp under och stigande mål över köpkursen', () => {
  const bars = path([100, 140, 118, 160, 135, 170, 150, 165, 145], 12);
  const ev = evaluate(bars);
  const { entry, stop, tps } = ev.plan;
  assert.ok(stop < entry);
  assert.equal(tps.length, 3);
  assert.ok(tps[0].price > entry);
  assert.ok(tps[0].price < tps[1].price && tps[1].price < tps[2].price);
  assert.ok(tps[0].r >= 0.5);
  assert.ok(['strong', 'buy', 'watch', 'neutral', 'avoid'].includes(ev.status));
});

test('Backtest kör utan att titta framåt', () => {
  const bars = path([100, 140, 118, 160, 135, 170, 150, 190, 160, 200, 170, 215, 185, 230], 25);
  const bt = backtest(bars, { start: 210 });
  for (const t of bt.trades) assert.ok(t.exitI > t.i);
  assert.ok(typeof bt.stats.n === 'number');
});

test('Avanza: bara papper med säker hävstång rekommenderas', async () => {
  const { recommend } = await import('../lib/avanza.js');
  const plan = { entry: 100, stop: 96, tps: [{ price: 103 }, { price: 106 }] };
  const mini = (name, fin, ko, bid, ask, extra = {}) => ({ orderbookId: name, name, issuer: 'X', subType: 'MINI_FUTURE',
    financingLevel: fin, stopLoss: ko, buyPrice: bid, sellPrice: ask, leverage: 100 / (100 - fin), totalValueTraded: 1000, ...extra });
  const r = recommend({
    minis: [
      mini('OK', 75, 78, 25, 25.1),
      mini('KO för nära', 92, 95, 8, 8.03),
      mini('Slutsåld', 70, 73, 30, null),
      mini('Hög spread', 72, 75, 28, 29),
    ],
    bulls: [
      { orderbookId: 'B5', name: 'BULL X5', issuer: 'X', leverage: 5, buyPrice: 10, sellPrice: 10.01, totalValueTraded: 1 },
      { orderbookId: 'B2', name: 'BULL X2', issuer: 'X', leverage: 2, buyPrice: 10, sellPrice: 10.01, totalValueTraded: 1 },
    ],
  }, { plan, atr: 2, isIndex: false });
  assert.deepEqual(r.minis.map(m => m.name), ['OK']);
  assert.deepEqual(r.bulls.map(b => b.name), ['BULL X2']);
  assert.equal(r.rejected.soldOut, 1);
  assert.equal(r.rejected.spread, 1);
  assert.equal(r.rejected.knockout, 1);
  assert.ok(r.minis[0].knockout <= plan.stop - 2);
});

test('Backtest av säljsignaler: stopp över och mål under köpkursen', async () => {
  const { invertBars } = await import('../lib/analyze.js');
  const bars = path([200, 150, 175, 130, 150, 110, 125, 95, 110, 80, 95, 70, 80, 60], 25);
  const inv = invertBars(bars, 10000);
  assert.ok(Math.abs(inv[0].c - 10000 / bars[0].c) < 1e-9);
  assert.ok(inv[0].h >= inv[0].l);
  const bt = backtest(bars, { start: 210, side: 'short' });
  for (const t of bt.trades) {
    assert.equal(t.side, 'short');
    assert.ok(t.stop > t.entry);
    assert.ok(t.tps[0] < t.entry);
  }
});

test('Rapportspärr och makrofilter gör köpsignaler till BEVAKA', async () => {
  const { applyGuards } = await import('../lib/analyze.js');
  const base = () => ({ status: 'buy', warnings: [] });
  const r1 = applyGuards(base(), { report: { date: '2026-11-02' }, reportDays: 5, macro: { score: 1, size: 1 } });
  assert.equal(r1.status, 'watch');
  assert.equal(r1.blocked, 'buy');
  const r2 = applyGuards(base(), { report: { date: '2027-01-30' }, reportDays: 60, macro: { score: -1, size: 0 } });
  assert.equal(r2.status, 'watch');
  const r3 = applyGuards(base(), { report: { date: '2027-01-30' }, reportDays: 60, macro: { score: 0, size: 0.5 } });
  assert.equal(r3.status, 'watch');
  assert.equal(applyGuards(base(), { macro: { score: 2, size: 1 } }).status, 'strong');
});

test('Rapportdatum uppskattas från förra året och handelsdagar räknas', async () => {
  const { projectReports, tradingDaysBetween } = await import('../lib/events.js');
  const p = projectReports(['2024-04-18', '2024-07-18'], new Date('2025-12-31'));
  assert.ok(p.includes('2025-04-17') && p.includes('2025-07-17'));
  assert.equal(tradingDaysBetween('2026-10-23', '2026-10-30'), 5); // fre -> fre
});

test('Makropoäng', async () => {
  const { buildMacro } = await import('../lib/macro.js');
  const mk = (n, f) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 86400, c: f(i) }));
  const omxBars = mk(300, i => 300 - i * 0.5);            // fallande index -> under EMA 200
  const vixBars = mk(300, () => 25);                       // hög VIX
  const stockBars = [mk(300, i => 100 - i * 0.1)];         // svag bredd
  const m = buildMacro({ omxBars, vixBars, stockBars })(new Date((1_700_000_000 + 299 * 86400) * 1000).toISOString().slice(0, 10));
  assert.ok(m.score >= 2);
  assert.ok(m.size >= 1 || m.fomcDays <= 7);
});

test('Signalloggen följer utfallet med samma regler som backtestet', async () => {
  const { outcome } = await import('../lib/log.js');
  const day = i => new Date((1_700_000_000 + i * 86400) * 1000).toISOString().slice(0, 10);
  const bars = Array.from({ length: 10 }, (_, i) => ({ t: 1_700_000_000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i }));
  const e = { date: day(0), stop: 95, tps: [103, 106, 120] };
  const o = outcome(e, bars);
  assert.equal(o.entry, 101);
  assert.equal(o.hit, 2);
  assert.equal(o.state, 'öppen');
  assert.equal(outcome({ ...e, date: day(9) }, bars).state, 'väntar på köp');
});

test('Krigsspik eller akut oro ger halv position', async () => {
  const { applyGuards } = await import('../lib/analyze.js');
  const { gprLevel } = await import('../lib/stress.js');
  const ev = applyGuards({ status: 'buy', warnings: [] }, { macro: { score: 1, size: 1 }, stress: { stressed: true, factors: 1, size: 0.5 } });
  assert.equal(ev.status, 'strong');
  assert.equal(ev.guards.size, 0.5);
  const series = {};
  for (let i = 0; i < 400; i++) series[new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10)] = { gpr: 100, ma7: 100 };
  series['2026-02-05'] = { gpr: 200, ma7: 130 };
  const g = gprLevel(series, '2026-02-05');
  assert.ok(Math.abs(g.rel - 1.3) < 1e-9);
});

test('Bitcoins halveringscykel', async () => {
  const { btcCycle } = await import('../lib/cycle.js');
  assert.equal(btcCycle('2023-06-01').inWindow, true);   // 12 mån före halveringen 2024
  assert.equal(btcCycle('2025-09-30').inWindow, true);   // 17 mån efter
  const out = btcCycle('2026-10-22');
  assert.equal(out.inWindow, false);
  assert.equal(out.until, '2027-04-15');
});

test('Avisering skickas bara när ett ämne är satt', async () => {
  const { notifySignal } = await import('../lib/notify.js');
  const e = { symbol: 'VOLV-B.ST', name: 'Volvo B', close: 300, stop: 290, tps: [306, 312, 320], size: 0.5 };
  assert.equal(await notifySignal(e, { topic: '' }), false);
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  try {
    assert.equal(await notifySignal(e, { topic: 'mitt-amne', appUrl: 'https://exempel.se' }), true);
  } finally { globalThis.fetch = orig; }
  assert.equal(calls[0].url, 'https://ntfy.sh/mitt-amne');
  assert.equal(calls[0].init.headers.Title, 'Stark köpsignal: Volvo B');
  assert.equal(calls[0].init.headers.Click, 'https://exempel.se/#VOLV-B.ST');
  assert.match(calls[0].init.body, /Halv position/);
});

test('Kravlistan förklarar varför en signal inte är redo', async () => {
  const { applyGuards } = await import('../lib/analyze.js');
  const bars = path([100, 140, 120, 160, 110, 130, 95, 125, 90, 115, 85, 120], 12);
  for (let n = 220; n <= bars.length; n++) {
    const ev = evaluate(bars.slice(0, n));
    const allOk = ev.checklist.every(c => c.ok);
    assert.equal(allOk, ev.status === 'buy' || ev.status === 'strong', `stapel ${n}`);
    for (const c of ev.checklist) assert.ok(c.text && c.now);
  }
  const g = applyGuards({ status: 'buy', warnings: [], checklist: [] }, { report: { date: '2026-11-02' }, reportDays: 5, macro: { score: 1, size: 1, label: 'Gynnsamt' } });
  assert.deepEqual(g.checklist.map(c => [c.key, c.ok]), [['report', false], ['macro', true]]);
});

test('Formationer: inverterad head & shoulders, dubbelbotten och dubbeltopp', async () => {
  const { detectPatterns } = await import('../lib/patterns.js');
  const found = (pts, type, dir) => {
    const bars = path(pts, 10);
    for (let n = 60; n <= bars.length; n++) {
      const p = detectPatterns(bars.slice(0, n)).find(x => x.type === type && x.dir === dir && x.breakout);
      if (p) return p;
    }
    return null;
  };
  const ihs = found([150, 140, 150, 130, 110, 120, 100, 120, 110, 130], 'ihs', 'bull');
  assert.ok(ihs, 'inverterad H&S hittas');
  assert.ok(ihs.target > ihs.level && ihs.stop < ihs.level);
  const dbl = found([150, 140, 150, 130, 110, 125, 110, 135], 'dbl', 'bull');
  assert.ok(dbl && Math.abs(dbl.level - 125.3) < 1, 'dubbelbotten bryter mellantoppen');
  const top = found([100, 110, 100, 120, 140, 125, 140, 115], 'dbl', 'bear');
  assert.ok(top && top.target < top.level && top.stop > top.level, 'dubbeltopp är ett säljmönster');
  assert.equal(found([100, 120, 100, 120, 100, 120, 100, 120], 'ihs', 'bull'), null);
});
