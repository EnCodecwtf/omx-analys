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

test('Asien-guld: följer nattens rörelse 02.00 → 09.30, stopp 1 %', async () => {
  const { asiaSignal, asiaOutcome } = await import('../lib/experiments.js');
  // Timstaplar från 19.00 kvällen före till 10.00 (New York), priset stiger under natten.
  const base = Date.parse('2026-11-10T00:00:00Z') / 1000;
  const hours = [];
  for (let k = 0; k <= 15; k++) { const hm = (19 + k) % 24 * 60, d = 19 + k < 24 ? '2026-11-10' : '2026-11-11'; const p = 4000 + k * 3; hours.push({ t: base + k * 3600, d, hm, o: p, h: p + 2, l: p - 2, c: p + 1 }); }
  const e = asiaSignal(hours, { date: '2026-11-11', nyMin: 2 * 60 + 10 });
  assert.equal(e.side, 'lång');
  assert.equal(e.exitAt, '15.30');
  const o = asiaOutcome(e, hours);
  assert.equal(o.state, 'stängd');
  assert.equal(o.why, 'säljdag');
  assert.ok(o.pct > 0);
  // Helg och fel tid: ingen signal.
  assert.equal(asiaSignal(hours, { date: '2026-11-11', nyMin: 60 }), null);
});

test('Fed-natten: signal 15.20–15.58 dagen före beslut, sälj på öppningen beslutsdagen', async () => {
  const { fedNightSignal, fedNightOutcome } = await import('../lib/experiments.js');
  const t = d => Date.parse(d + 'T14:30:00Z') / 1000;
  const bars = [{ t: t('2026-12-08'), o: 600, h: 606, l: 598, c: 605 }, { t: t('2026-12-09'), o: 607, h: 610, l: 600, c: 602 }];
  assert.equal(fedNightSignal(bars, { date: '2026-12-08', nyMin: 15 * 60, fedDay: '2026-12-09' }), null); // för tidigt
  assert.equal(fedNightSignal(bars, { date: '2026-12-08', nyMin: 15 * 60 + 30, fedDay: null }), null); // inget beslut i morgon
  const e = fedNightSignal(bars, { date: '2026-12-08', nyMin: 15 * 60 + 30, fedDay: '2026-12-09' });
  assert.equal(e.exp, 'fed-night'); assert.equal(e.exitDate, '2026-12-09'); assert.equal(e.close, 605);
  const o = fedNightOutcome(e, bars);
  assert.equal(o.state, 'stängd'); assert.equal(o.last, 607);
  assert.ok(Math.abs(o.pct - (607 / 605 - 1 - 0.0006) * 100) < 0.01);
  assert.equal(fedNightOutcome(e, bars.slice(0, 1)).state, 'öppen');
});
