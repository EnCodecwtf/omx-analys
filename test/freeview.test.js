import test from 'node:test';
import assert from 'node:assert/strict';
import { shortPlan, direction, maCross } from '../lib/freeview.js';

test('kort plan: stopp över kursen och tre mål under, i fallande ordning', () => {
  const ev = { price: 100, atr: 2, zones: [{ kind: 'resistance', lo: 102, hi: 103 }, { kind: 'support', lo: 90, hi: 91 }] };
  const p = shortPlan(ev);
  assert.ok(p.stop > 100);
  assert.equal(p.tps.length, 3);
  assert.ok(p.tps.every((t, i) => t.price < 100 && (i === 0 || t.price < p.tps[i - 1].price)));
});

test('riktning följer trenden', () => {
  assert.equal(direction({ trend: 3, status: 'buy' }).side, 'long');
  assert.equal(direction({ trend: -3, status: 'neutral' }).side, 'short');
  assert.equal(direction({ trend: 0, status: 'neutral' }).side, 'none');
});

test('MA 44/332 hittar senaste korsningen', () => {
  const bars = Array.from({ length: 700 }, (_, i) => ({ t: 1.6e9 + i * 86400, c: i < 400 ? 100 - i * 0.05 : 80 + (i - 400) * 0.3 }));
  const m = maCross(bars);
  assert.equal(m.above, true);
  assert.equal(m.cross.up, true);
});
