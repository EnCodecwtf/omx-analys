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
  assert.match(text, /USA stängde tungt i går: S&P 500 −3,9 %/);
  assert.match(text, /VIX står på 27,4/);
  assert.match(text, /Kl 14\.30: USA:s jobbsiffror – förra utfallet 29 tusen jobb/);
  assert.match(text, /TP1 är taget på Lifco B\. Strukturen håller\./);
  assert.match(text, /Volvo B \(saknar RSI\)/);
  assert.match(text, /kan panikveckan slå till/);
});

test('Morgonsoffan på en måndag: fredagens ras märks som fredag och stängda börser räknas inte', async () => {
  const { buildMorning } = await import('../lib/morning.js');
  const mk = (group, symbol, name, change, date, price = 100) => ({ group, symbol, name, change, date, price });
  const T = '2026-11-23', F = '2026-11-20';
  const m = buildMorning({ now: new Date('2026-11-23T06:30:00Z'), moves: [
    mk('asia', '^N225', 'Nikkei (Tokyo)', -5.1, F), mk('asia', '^HSI', 'Hang Seng (Hongkong)', 0.2, T),
    mk('us', '^GSPC', 'S&P 500', -3.7, F), mk('us', '^IXIC', 'Nasdaq', -5.3, F),
    mk('fut', 'ES=F', 'S&P 500-terminen', 2.1, T), mk('fut', 'NQ=F', 'Nasdaq-terminen', 3.1, T), mk('se', '^OMX', 'OMXS30', -2.5, F, 3175)],
    overnight: null, macro: null, calendar: { events: [] }, trades: [], panic: null, levels: [], fearGreed: null, signals: [], near: [], news: {} });
  const all = JSON.stringify(m);
  assert.match(all, /USA stängde tungt i fredags/);
  assert.match(all, /Stängt i dag: Nikkei \(senast i fredags −5,1 %\)/);
  assert.match(m.intro, /USA föll kraftigt i fredags, men i morse studsar terminerna/);
  assert.doesNotMatch(m.intro, /motvind/);
  assert.match(all, /Men i morse har det vänt/);
  assert.match(all, /Tokyo är stängt i dag/);
});
