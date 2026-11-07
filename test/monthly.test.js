import test from 'node:test';
import assert from 'node:assert/strict';
import { lastTradingDay, rebalanceDays, momentum, decide, pickMini, miniGrowth, changeText } from '../lib/monthly.js';

test('sista handelsdagen tar hänsyn till helger och NYSE-helgdagar', () => {
  assert.equal(lastTradingDay('2026-11'), '2026-11-30');
  assert.equal(lastTradingDay('2027-05'), '2027-05-28'); // Memorial Day 31 maj
  assert.equal(lastTradingDay('2029-03'), '2029-03-29'); // Långfredag 30 mars
  assert.equal(lastTradingDay('2026-10'), '2026-10-30');
});

test('bytesdagen räknas i New York-tid', () => {
  assert.equal(rebalanceDays(new Date('2026-11-30T20:00:00Z')).isToday, true);
  const after = rebalanceDays(new Date('2026-11-30T22:00:00Z'));
  assert.equal(after.last, '2026-11-30');
  assert.equal(after.next, '2026-12-31');
});

test('12-1-momentum hoppar över senaste månaden', () => {
  const monthly = [{ m: '2025-10', c: 100 }, { m: '2026-09', c: 150 }, { m: '2026-10', c: 300 }];
  assert.equal(momentum(monthly, '2026-11'), 0.5);
});

const flat = (n, v) => Array.from({ length: n }, () => v);
test('beslutet: behåll inom topp 4, hoppa över raserade aktier, kassa under SMA 200', () => {
  const ranked = ['A', 'B', 'C', 'D', 'E'].map((symbol, i) => ({ symbol, name: symbol, mom: 1 - i / 10 }));
  const closes = s => s === 'A' ? [...flat(250, 100), 60] : flat(260, 50);
  const spyUp = [...flat(200, 100), 110];
  // Som i testet: en raserad etta tar en plats och lämnar den åt kassaläget.
  const d = decide({ ranked, held: ['D'], spy: spyUp, closes });
  assert.deepEqual(d.stocks.map(s => s.symbol), ['D']);
  assert.equal(d.cashShare, 0.5);
  const d1 = decide({ ranked: ranked.slice(1), held: ['D'], spy: spyUp, closes });
  assert.deepEqual(d1.stocks.map(s => s.symbol), ['D', 'B']);
  const d2 = decide({ ranked, held: [], spy: spyUp, closes });
  assert.deepEqual(d2.stocks.map(s => s.symbol), ['B']); // A har fallit 40 % – platsen går till kassaläget
  assert.equal(d2.cashShare, 0.5);
  const d3 = decide({ ranked, held: ['B'], spy: [...flat(200, 100), 90], closes });
  assert.equal(d3.mode, 'kassa');
  assert.deepEqual(d3.sold, ['B']);
  assert.match(changeText({ stocks: [{ symbol: 'B', name: 'B' }], cashShare: 0.5 }, d3), /Sälj B/);
});

test('mini med högre hävstång köps för en del av beloppet, AVA före andra', () => {
  const w = [
    { orderbookId: '1', name: 'MINI L X NORDNET', issuer: 'N', subType: 'MINI_FUTURE', leverage: 1.7, buyPrice: 10, sellPrice: 10.01 },
    { orderbookId: '2', name: 'MINI L X AVA 1', issuer: 'MS', subType: 'MINI_FUTURE', leverage: 3.4, buyPrice: 10, sellPrice: 10.01 },
  ];
  const p = pickMini(w, { target: 1.7 });
  assert.equal(p.id, '2');
  assert.equal(p.share, 0.5);
  assert.equal(p.exposure, 1.7);
});

test('minins värde, lång och kort', () => {
  assert.ok(Math.abs(miniGrowth(100, 110, 2) - 1.2) < 1e-9);
  assert.ok(Math.abs(miniGrowth(100, 90, 2, 'short') - 1.2) < 1e-9);
});
