import test from 'node:test';
import assert from 'node:assert/strict';
import { addTradingDays, panicOutcome } from '../lib/panic.js';

const bar = (d, c) => ({ t: Date.parse(d + 'T15:30:00Z') / 1000, o: c, h: c, l: c, c });

test('handelsdagar hoppar över helger och svenska helgdagar', () => {
  assert.equal(addTradingDays('2026-11-06', 5), '2026-11-13'); // fredag → fredag
  assert.equal(addTradingDays('2026-12-22', 3), '2026-12-29'); // jul och annandag
  assert.equal(addTradingDays('2027-03-24', 2), '2027-03-30'); // långfredag 26/3, annandag påsk 29/3
  assert.equal(addTradingDays('2026-06-18', 1), '2026-06-22'); // midsommarafton 19/6
});

test('öppen panikaffär behåller den planerade säljdagen', () => {
  const bars = [bar('2026-11-05', 100), bar('2026-11-06', 100), bar('2026-11-09', 101)];
  const o = panicOutcome({ date: '2026-11-06', exitDate: '2026-11-13' }, bars);
  assert.equal(o.state, 'öppen');
  assert.equal(o.exitDate, '2026-11-13');
  assert.equal(o.buyDate, '2026-11-09');
});
