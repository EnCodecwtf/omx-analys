import test from 'node:test';
import assert from 'node:assert/strict';
import { runAiTrader } from '../lib/aitrader.js';

test('AI-tradern: flyttar ut ur OMX-delen tas från kontanterna', () => {
  const t0 = Date.UTC(2026, 0, 5) / 1000;
  const bars = Array.from({ length: 30 }, (_, i) => ({ t: t0 + i * 86400, o: 100, h: 101, l: 99, c: 100 }));
  const day = i => new Date((t0 + i * 86400) * 1000).toISOString().slice(0, 10);
  const entries = [{ symbol: 'X', name: 'X', date: day(1), stop: 90, tps: [110, 120, 130], close: 100 }];
  const a = runAiTrader(entries, () => bars, () => [], { start: 30000, transfers: [{ date: day(5), amount: -24000 }] });
  assert.equal(Math.round(a.moved), -24000);
  assert.ok(Math.abs(a.equity - 6000) < 400);
  // Mer än kontanterna: resten väntar.
  const b = runAiTrader(entries, () => bars, () => [], { start: 30000, transfers: [{ date: day(5), amount: -40000 }] });
  assert.ok(b.pendingMoves < -9000);
});

test('AI-tradern: det som ännu inte kunnat flyttas ut räknas av från värdet', () => {
  const t0 = Date.UTC(2026, 0, 5) / 1000;
  const bars = Array.from({ length: 10 }, (_, i) => ({ t: t0 + i * 86400, o: 100, h: 101, l: 99, c: 100 }));
  const day = i => new Date((t0 + i * 86400) * 1000).toISOString().slice(0, 10);
  const entries = [{ symbol: 'X', name: 'X', date: day(1), stop: 90, tps: [110, 120, 130], close: 100 }];
  const a = runAiTrader(entries, () => bars, () => [], { start: 30000, transfers: [{ date: day(5), amount: -29500 }] });
  assert.ok(a.pendingMoves < -100); // en affär är öppen, kontanterna räcker inte
  assert.ok(Math.abs(a.equity - 500) < 400); // värdet är netto efter skulden
});
