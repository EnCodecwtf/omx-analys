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
  assert.ok(tps[0].r >= 1);
  assert.ok(['strong', 'buy', 'watch', 'neutral', 'avoid'].includes(ev.status));
});

test('Backtest kör utan att titta framåt', () => {
  const bars = path([100, 140, 118, 160, 135, 170, 150, 190, 160, 200, 170, 215, 185, 230], 25);
  const bt = backtest(bars, { start: 210 });
  for (const t of bt.trades) assert.ok(t.exitI > t.i);
  assert.ok(typeof bt.stats.n === 'number');
});
