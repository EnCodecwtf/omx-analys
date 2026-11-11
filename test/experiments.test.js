import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS, experimentSignal, expOutcome, exitDateFor } from '../lib/experiments.js';

const bar = (d, o, h, l, c) => ({ t: Date.parse(d + 'T12:00:00Z') / 1000, o, h, l, c });
const series = (start, closes) => closes.map((c, i) => { const d = new Date(Date.parse(start + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10); return bar(d, c, c + 1, c - 1, c); });

test('NFP-guld: köp bara när guldet stiger mer än 0,5 % på första fredagen', () => {
  const closes = Array.from({ length: 20 }, () => 4000);
  const bars = series('2026-10-17', [...closes, 4040]); // sista stapeln 2026-11-06 (fredag), +1 %
  const e = experimentSignal(EXPERIMENTS['nfp-gold'], bars, { date: '2026-11-06', nyMin: 14 * 60, fomc: new Set() });
  assert.equal(e.side, 'lång');
  assert.equal(e.exitDate, '2026-11-11');
  assert.ok(e.stop < 4040 && e.tp > 4040);
  // För tidigt (före stängningskursen) eller för liten rörelse: ingen signal.
  assert.equal(experimentSignal(EXPERIMENTS['nfp-gold'], bars, { date: '2026-11-06', nyMin: 12 * 60, fomc: new Set() }), null);
  const flat = series('2026-10-17', [...closes, 4010]);
  assert.equal(experimentSignal(EXPERIMENTS['nfp-gold'], flat, { date: '2026-11-06', nyMin: 14 * 60, fomc: new Set() }), null);
});

test('Fed-vändning: position mot dagens rörelse, säljdag efter tre dagar', () => {
  const bars = series('2026-10-09', [...Array.from({ length: 19 }, () => 50), 51]); // sista 2026-10-28 (onsdag), +2 %
  const e = experimentSignal(EXPERIMENTS['fed-silver'], bars, { date: '2026-10-28', nyMin: 14 * 60, fomc: new Set(['2026-10-28']) });
  assert.equal(e.side, 'kort');
  assert.equal(e.exitDate, exitDateFor('2026-10-28', 3));
  assert.equal(e.exitDate, '2026-11-02'); // lördag → måndag
});

test('utfall: stopp, mål och säljdag', () => {
  const e = { date: '2026-11-06', close: 100, dir: 1, stop: 98, tp: 104, exitDate: '2026-11-11' };
  const up = [bar('2026-11-06', 99, 101, 99, 100), bar('2026-11-09', 101, 105, 100, 104)];
  assert.equal(expOutcome(e, up).why, 'mål');
  const down = [bar('2026-11-06', 99, 101, 99, 100), bar('2026-11-09', 99, 99, 97, 97.5)];
  assert.equal(expOutcome(e, down).why, 'stopp');
  const open = [bar('2026-11-06', 99, 101, 99, 100), bar('2026-11-09', 100, 101, 99, 101)];
  assert.equal(expOutcome(e, open).state, 'öppen');
});
