import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMorning } from '../lib/morning.js';

test('Morgonsoffan bygger bara på given data', () => {
  const now = new Date('2026-11-06T06:30:00Z');
  const m = buildMorning({
    now,
    moves: [
      { group: 'us', symbol: '^GSPC', name: 'S&P 500', price: 7000, change: -3.9, date: '2026-11-05' },
      { group: 'asia', symbol: '^N225', name: 'Nikkei (Tokyo)', price: 60000, change: -1.8, date: '2026-11-06' },
      { group: 'risk', symbol: '^VIX', name: 'VIX', price: 27.4, change: 60, date: '2026-11-05' },
    ],
    macro: { score: 1, need: 1 },
    calendar: { events: [{ kind: 'macro', days: 0, time: '14.30', label: 'USA:s jobbsiffror', last: { text: '29 tusen jobb', period: 'oktober 2026' } }] },
    trades: [{ name: 'Lifco B', coach: { lines: ['TP1 är taget på Lifco B.', 'Strukturen håller.'] } }],
    signals: [], near: [{ name: 'Volvo B', missingText: 'RSI' }], panic: { active: false }, news: { market: [], geo: [] },
  });
  const text = JSON.stringify(m);
  assert.match(m.intro, /fredag 6 november/);
  assert.match(text, /USA stängde tungt senast: S&P 500 −3,9 %/);
  assert.match(text, /VIX står på 27,4/);
  assert.match(text, /Kl 14\.30: USA:s jobbsiffror – förra utfallet 29 tusen jobb/);
  assert.match(text, /TP1 är taget på Lifco B\. Strukturen håller\./);
  assert.match(text, /Volvo B \(saknar RSI\)/);
  assert.match(text, /kan panikveckan slå till/);
});
