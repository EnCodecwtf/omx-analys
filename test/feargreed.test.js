import test from 'node:test';
import assert from 'node:assert/strict';
import { fearGreed, fgLabel } from '../lib/feargreed.js';

test('Fear & Greed: stigande börs och fallande VIX ger girighet, ras ger rädsla', () => {
  const days = Array.from({ length: 700 }, (_, i) => new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10));
  const mk = f => days.map((d, i) => ({ d, c: f(i) }));
  const calm = i => 100 * (1 + 0.0004 * i + 0.01 * Math.sin(i / 7));
  const crash = i => (i < 680 ? calm(i) : calm(679) * (1 - 0.02 * (i - 679)));
  const up = fearGreed({ SPY: mk(calm), RSP: mk(calm), IEF: mk(() => 100), HYG: mk(calm), VIX: mk(i => 20 - 0.01 * i + Math.sin(i / 5)) });
  const down = fearGreed({ SPY: mk(crash), RSP: mk(crash), IEF: mk(i => 100 + (i >= 680 ? i - 679 : 0)), HYG: mk(crash), VIX: mk(i => (i < 680 ? 18 + Math.sin(i / 5) : 40)) });
  assert.ok(down.at(-1).value < 20, `ras gav ${down.at(-1).value}`);
  assert.ok(up.at(-1).value > down.at(-1).value);
  assert.equal(fgLabel(10), 'extrem rädsla'); assert.equal(fgLabel(50), 'neutralt'); assert.equal(fgLabel(80), 'extrem girighet');
});
