import test from 'node:test';
import assert from 'node:assert/strict';
import { lastTradingDay, rebalanceDays, momentum, decide, pickMini, miniGrowth, changeText, allocate } from '../lib/monthly.js';

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

test('hela beloppet i pappret med hävstång närmast målet, AVA först', () => {
  const w = [
    { orderbookId: '1', name: 'MINI L X NORDNET', issuer: 'N', subType: 'MINI_FUTURE', leverage: 1.7, buyPrice: 10, sellPrice: 10.01 },
    { orderbookId: '2', name: 'MINI L X AVA 1', issuer: 'MS', subType: 'MINI_FUTURE', leverage: 1.9, buyPrice: 10, sellPrice: 10.01 },
    { orderbookId: '3', name: 'MINI L X AVA 2', issuer: 'MS', subType: 'MINI_FUTURE', leverage: 3.4, buyPrice: 10, sellPrice: 10.01 },
  ];
  const p = pickMini(w, { target: 1.7, money: 1500 });
  assert.equal(p.id, '2');
  assert.equal(p.order, 1500);
  // Inget AVA-papper med låg hävstång: närmast målet, med varning om courtage.
  const q = pickMini(w.filter(x => x.orderbookId !== '2'), { target: 1.7, money: 1500 });
  assert.equal(q.id, '1');
  assert.match(q.note, /courtage/);
  assert.equal(pickMini(w, { target: 1.7, money: 800 }), null);
});

test('minins värde, lång och kort', () => {
  assert.ok(Math.abs(miniGrowth(100, 110, 2) - 1.2) < 1e-9);
  assert.ok(Math.abs(miniGrowth(100, 90, 2, 'short') - 1.2) < 1e-9);
});

test('fördelningen: 3 300 kr blir tre order på 1 100 kr, 2 500 kr tar bort olja kort', () => {
  const p = (lev, ava = true) => [{ id: 'x', name: ava ? 'MINI AVA' : 'MINI', ava, leverage: lev, spreadPct: 0.1 }];
  const lists = { stockLists: { A: p(1.8) }, gold: p(1.6), oil: p(1.5) };
  const st = { stocks: [{ symbol: 'A', name: 'A' }], cashShare: 0.5 };
  assert.deepEqual(allocate(st, 3300, lists).map(l => [l.kind, Math.round(l.money)]), [['stock', 1100], ['gold', 1100], ['oil', 1100]]);
  assert.deepEqual(allocate(st, 2500, lists).map(l => [l.kind, Math.round(l.money)]), [['stock', 1250], ['gold', 1250]]);
  assert.deepEqual(allocate(st, 4000, lists).map(l => [l.kind, Math.round(l.money)]), [['stock', 2000], ['gold', 1000], ['oil', 1000]]);
});

test('säljregeln: minst 10 % på en dag, och en såld aktie låses på säljkursen', async () => {
  const { jumpHit, periodReturn, RULES } = await import('../lib/monthly.js');
  assert.equal(jumpHit(110, 100), true);
  assert.equal(jumpHit(109.9, 100), false);
  const h = { stocks: [{ symbol: 'A', price: 100, entry: 100, sold: { price: 120 } }, { symbol: 'B', price: 100, entry: 100 }], cashShare: 0 };
  const r = periodReturn(h, { prices: { A: 90, B: 100 } });
  assert.ok(Math.abs(r.raw - 0.1) < 1e-9); // A räknas på 120, inte 90
  assert.ok(r.lev > r.raw);
  // En såld aktie räknas inte som ägd i bytestexten.
  const t = changeText({ stocks: [{ symbol: 'A', name: 'A', sold: { price: 120 } }], cashShare: 0.5 }, { stocks: [{ symbol: 'A', name: 'A' }, { symbol: 'C', name: 'C' }], cashShare: 0 });
  assert.match(t, /Köp A och C/);
  assert.equal(RULES.jumpSell, 0.1);
});

test('VIX-stegen: 1,8x lugnt, 1,25x normalt, 1x oroligt – och byte av mini när hävstången ändras', async () => {
  const { levForVix, changeText, periodReturn } = await import('../lib/monthly.js');
  assert.equal(levForVix(12), 1.8);
  assert.equal(levForVix(15), 1.25);
  assert.equal(levForVix(24.9), 1.25);
  assert.equal(levForVix(25), 1);
  assert.equal(levForVix(null), 1.8);
  const t = changeText({ stocks: [{ symbol: 'A', name: 'A' }], cashShare: 0.5, lev: 1.8 }, { stocks: [{ symbol: 'A', name: 'A' }], cashShare: 0.5, lev: 1.25, vix: 18 });
  assert.match(t, /Byt minin i A till en med cirka 1,25x/);
  assert.match(t, /VIX är 18/);
  assert.doesNotMatch(t, /Inget byte/);
  const same = changeText({ stocks: [{ symbol: 'A', name: 'A' }], cashShare: 0.5, lev: 1.25 }, { stocks: [{ symbol: 'A', name: 'A' }], cashShare: 0.5, lev: 1.25, vix: 18 });
  assert.match(same, /Behåll A/);
  // Värderingen använder aktiens egen hävstång.
  const h = { stocks: [{ symbol: 'A', price: 100, entry: 100, lev: 1 }, { symbol: 'B', price: 100, entry: 100, lev: 1 }], cashShare: 0 };
  const r = periodReturn(h, { prices: { A: 110, B: 110 } });
  assert.ok(Math.abs(r.lev - 0.1) < 1e-9);
});
