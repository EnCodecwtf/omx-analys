import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ema, rsi, atr } from '../lib/indicators.js';
import { zigzag, fairValueGaps, fibLevels } from '../lib/structure.js';
import { elliott } from '../lib/elliott.js';
import { evaluate, backtest } from '../lib/analyze.js';

// Bygger staplar som följer en lista med priser linjärt, med lite brus.
function path(points, perLeg = 10) {
  const bars = [];
  let t = 1_600_000_000;
  for (let k = 0; k < points.length - 1; k++) {
    for (let j = 0; j < perLeg; j++) {
      const c = points[k] + (points[k + 1] - points[k]) * (j + 1) / perLeg;
      const o = points[k] + (points[k + 1] - points[k]) * j / perLeg;
      bars.push({ t: t += 86400, o, h: Math.max(o, c) + 0.3, l: Math.min(o, c) - 0.3, c, v: 1000 });
    }
  }
  return bars;
}

test('EMA och RSI', () => {
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[1], null);
  assert.equal(e[2], 2);
  assert.equal(e[4], 4);
  const up = rsi(Array.from({ length: 30 }, (_, i) => i), 14);
  assert.equal(up[29], 100);
});

test('ATR är positiv', () => {
  const bars = path([100, 110, 100], 20);
  const a = atr(bars, 14);
  assert.ok(a[30] > 0);
});

test('ZigZag hittar svängarna', () => {
  const bars = path([100, 130, 115, 150, 135], 15);
  const zz = zigzag(bars, atr(bars), { atrMult: 2.5, minPct: 0.03 });
  const types = zz.map(p => p.type).join('');
  assert.equal(types, 'LHLHL');
  assert.ok(zz[zz.length - 1].tentative);
  assert.ok(Math.abs(zz[1].price - 130.3) < 0.5);
});

test('Bullish FVG hittas och fylls', () => {
  const bars = [
    { t: 1, o: 10, h: 10.5, l: 9.5, c: 10.2, v: 1 },
    { t: 2, o: 10.4, h: 12.5, l: 10.3, c: 12.4, v: 1 },
    { t: 3, o: 12.4, h: 13, l: 11.5, c: 12.8, v: 1 },
  ];
  const a = bars.map(() => 1);
  const gaps = fairValueGaps(bars, a);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].type, 'bull');
  assert.deepEqual([gaps[0].lo, gaps[0].hi], [10.5, 11.5]);
  bars.push({ t: 4, o: 12, h: 12, l: 10.4, c: 10.6, v: 1 });
  assert.equal(fairValueGaps(bars, bars.map(() => 1)).length, 0);
});

test('Fibonacci-nivåer', () => {
  const f = fibLevels(100, 200);
  assert.equal(f.retrace.find(x => x.r === 0.5).price, 150);
  assert.ok(Math.abs(f.ext.find(x => x.r === 1.272).price - 227.2) < 1e-9);
});

test('Elliott: våg 4 i en uppåtimpuls', () => {
  const zz = [
    { i: 0, price: 100, type: 'L' },
    { i: 10, price: 120, type: 'H' },
    { i: 20, price: 108, type: 'L' },
    { i: 30, price: 140, type: 'H' },
    { i: 40, price: 128, type: 'L', tentative: true },
  ];
  const { primary } = elliott(zz);
  const counts = [primary, ...elliott(zz).alternatives];
  const w4 = counts.find(c => c.dir === 'bull' && c.phase === 'w4');
  assert.ok(w4, 'våg 4 ska finnas bland kandidaterna');
  assert.equal(w4.invalidation, 120);
  assert.ok(w4.zone[0] >= 120 && w4.zone[1] <= 140);
});

test('Elliott: våg 4 som överlappar våg 1 är ogiltig', () => {
  const zz = [
    { i: 0, price: 100, type: 'L' },
    { i: 10, price: 120, type: 'H' },
    { i: 20, price: 108, type: 'L' },
    { i: 30, price: 140, type: 'H' },
    { i: 40, price: 115, type: 'L', tentative: true },
  ];
  const all = [elliott(zz).primary, ...elliott(zz).alternatives].filter(Boolean);
  assert.ok(!all.some(c => c.dir === 'bull' && c.phase === 'w4'));
});

test('Handelsplanen har stopp under och stigande mål över köpkursen', () => {
  const bars = path([100, 140, 118, 160, 135, 170, 150, 165, 145], 12);
  const ev = evaluate(bars);
  const { entry, stop, tps } = ev.plan;
  assert.ok(stop < entry);
  assert.equal(tps.length, 3);
  assert.ok(tps[0].price > entry);
  assert.ok(tps[0].price < tps[1].price && tps[1].price < tps[2].price);
  assert.ok(tps[0].r >= 0.5);
  assert.ok(['strong', 'buy', 'watch', 'neutral', 'avoid'].includes(ev.status));
});

test('Backtest kör utan att titta framåt', () => {
  const bars = path([100, 140, 118, 160, 135, 170, 150, 190, 160, 200, 170, 215, 185, 230], 25);
  const bt = backtest(bars, { start: 210 });
  for (const t of bt.trades) assert.ok(t.exitI > t.i);
  assert.ok(typeof bt.stats.n === 'number');
});

test('Avanza: bara papper med säker hävstång rekommenderas', async () => {
  const { recommend } = await import('../lib/avanza.js');
  const plan = { entry: 100, stop: 96, tps: [{ price: 103 }, { price: 106 }] };
  const mini = (name, fin, ko, bid, ask, extra = {}) => ({ orderbookId: name, name, issuer: 'X', subType: 'MINI_FUTURE',
    financingLevel: fin, stopLoss: ko, buyPrice: bid, sellPrice: ask, leverage: 100 / (100 - fin), totalValueTraded: 1000, ...extra });
  const r = recommend({
    minis: [
      mini('OK', 75, 78, 25, 25.1),
      mini('KO för nära', 92, 95, 8, 8.03),
      mini('Slutsåld', 70, 73, 30, null),
      mini('Hög spread', 72, 75, 28, 29),
    ],
    bulls: [
      { orderbookId: 'B5', name: 'BULL X5', issuer: 'X', leverage: 5, buyPrice: 10, sellPrice: 10.01, totalValueTraded: 1 },
      { orderbookId: 'B2', name: 'BULL X2', issuer: 'X', leverage: 2, buyPrice: 10, sellPrice: 10.01, totalValueTraded: 1 },
    ],
  }, { plan, atr: 2, isIndex: false });
  assert.deepEqual(r.minis.map(m => m.name), ['OK']);
  assert.deepEqual(r.bulls.map(b => b.name), ['BULL X2']);
  assert.equal(r.rejected.soldOut, 1);
  assert.equal(r.rejected.spread, 1);
  assert.equal(r.rejected.knockout, 1);
  assert.ok(r.minis[0].knockout <= plan.stop - 2);
});

test('Backtest av säljsignaler: stopp över och mål under köpkursen', async () => {
  const { invertBars } = await import('../lib/analyze.js');
  const bars = path([200, 150, 175, 130, 150, 110, 125, 95, 110, 80, 95, 70, 80, 60], 25);
  const inv = invertBars(bars, 10000);
  assert.ok(Math.abs(inv[0].c - 10000 / bars[0].c) < 1e-9);
  assert.ok(inv[0].h >= inv[0].l);
  const bt = backtest(bars, { start: 210, side: 'short' });
  for (const t of bt.trades) {
    assert.equal(t.side, 'short');
    assert.ok(t.stop > t.entry);
    assert.ok(t.tps[0] < t.entry);
  }
});

test('Rapportspärr och makrofilter gör köpsignaler till BEVAKA', async () => {
  const { applyGuards } = await import('../lib/analyze.js');
  const base = () => ({ status: 'buy', warnings: [] });
  const r1 = applyGuards(base(), { report: { date: '2026-11-02' }, reportDays: 5, macro: { score: 1, size: 1 } });
  assert.equal(r1.status, 'watch');
  assert.equal(r1.blocked, 'buy');
  const r2 = applyGuards(base(), { report: { date: '2027-01-30' }, reportDays: 60, macro: { score: -1, size: 0 } });
  assert.equal(r2.status, 'watch');
  const r3 = applyGuards(base(), { report: { date: '2027-01-30' }, reportDays: 60, macro: { score: 0, size: 0.5 } });
  assert.equal(r3.status, 'watch');
  assert.equal(applyGuards(base(), { macro: { score: 2, size: 1 } }).status, 'strong');
});

test('Rapportdatum uppskattas från förra året och handelsdagar räknas', async () => {
  const { projectReports, tradingDaysBetween } = await import('../lib/events.js');
  const p = projectReports(['2024-04-18', '2024-07-18'], new Date('2025-12-31'));
  assert.ok(p.includes('2025-04-17') && p.includes('2025-07-17'));
  assert.equal(tradingDaysBetween('2026-10-23', '2026-10-30'), 5); // fre -> fre
});

test('Makropoäng', async () => {
  const { buildMacro } = await import('../lib/macro.js');
  const mk = (n, f) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 86400, c: f(i) }));
  const omxBars = mk(300, i => 300 - i * 0.5);            // fallande index -> under EMA 200
  const vixBars = mk(300, () => 25);                       // hög VIX
  const stockBars = [mk(300, i => 100 - i * 0.1)];         // svag bredd
  const m = buildMacro({ omxBars, vixBars, stockBars })(new Date((1_700_000_000 + 299 * 86400) * 1000).toISOString().slice(0, 10));
  assert.ok(m.score >= 2);
  assert.ok(m.size >= 1 || m.fomcDays <= 7);
});

test('Signalloggen följer utfallet med samma regler som backtestet', async () => {
  const { outcome } = await import('../lib/log.js');
  const day = i => new Date((1_700_000_000 + i * 86400) * 1000).toISOString().slice(0, 10);
  const bars = Array.from({ length: 10 }, (_, i) => ({ t: 1_700_000_000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i }));
  const e = { date: day(0), stop: 95, tps: [103, 106, 120] };
  const o = outcome(e, bars);
  assert.equal(o.entry, 101);
  assert.equal(o.hit, 2);
  assert.equal(o.state, 'öppen');
  assert.equal(outcome({ ...e, date: day(9) }, bars).state, 'väntar på köp');
});

test('Krigsspik eller akut oro ger halv position', async () => {
  const { applyGuards } = await import('../lib/analyze.js');
  const { gprLevel } = await import('../lib/stress.js');
  const ev = applyGuards({ status: 'buy', warnings: [] }, { macro: { score: 1, size: 1 }, stress: { stressed: true, factors: 1, size: 0.5 } });
  assert.equal(ev.status, 'strong');
  assert.equal(ev.guards.size, 0.5);
  const series = {};
  for (let i = 0; i < 400; i++) series[new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10)] = { gpr: 100, ma7: 100 };
  series['2026-02-05'] = { gpr: 200, ma7: 130 };
  const g = gprLevel(series, '2026-02-05');
  assert.ok(Math.abs(g.rel - 1.3) < 1e-9);
});

test('Bitcoins halveringscykel', async () => {
  const { btcCycle } = await import('../lib/cycle.js');
  assert.equal(btcCycle('2023-06-01').inWindow, true);   // 12 mån före halveringen 2024
  assert.equal(btcCycle('2025-09-30').inWindow, true);   // 17 mån efter
  const out = btcCycle('2026-10-22');
  assert.equal(out.inWindow, false);
  assert.equal(out.until, '2027-04-15');
});

test('Avisering skickas bara när ett ämne är satt', async () => {
  const { notifySignal } = await import('../lib/notify.js');
  const e = { symbol: 'VOLV-B.ST', name: 'Volvo B', close: 300, stop: 290, tps: [306, 312, 320], size: 0.5 };
  assert.equal(await notifySignal(e, { topic: '' }), false);
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  try {
    assert.equal(await notifySignal(e, { topic: 'mitt-amne', appUrl: 'https://exempel.se' }), true);
  } finally { globalThis.fetch = orig; }
  assert.equal(calls[0].url, 'https://ntfy.sh/mitt-amne');
  assert.equal(calls[0].init.headers.Title, 'Stark köpsignal: Volvo B');
  assert.equal(calls[0].init.headers.Click, 'https://exempel.se/#VOLV-B.ST');
  assert.match(calls[0].init.body, /Halv position/);
});

test('Kravlistan förklarar varför en signal inte är redo', async () => {
  const { applyGuards } = await import('../lib/analyze.js');
  const bars = path([100, 140, 120, 160, 110, 130, 95, 125, 90, 115, 85, 120], 12);
  for (let n = 220; n <= bars.length; n++) {
    const ev = evaluate(bars.slice(0, n));
    const allOk = ev.checklist.every(c => c.ok);
    assert.equal(allOk, ev.status === 'buy' || ev.status === 'strong', `stapel ${n}`);
    for (const c of ev.checklist) assert.ok(c.text && c.now);
  }
  const g = applyGuards({ status: 'buy', warnings: [], checklist: [] }, { report: { date: '2026-11-02' }, reportDays: 5, macro: { score: 1, size: 1, label: 'Gynnsamt' } });
  assert.deepEqual(g.checklist.map(c => [c.key, c.ok]), [['report', false], ['macro', true]]);
});

test('Formationer: inverterad head & shoulders, dubbelbotten och dubbeltopp', async () => {
  const { detectPatterns } = await import('../lib/patterns.js');
  const found = (pts, type, dir) => {
    const bars = path(pts, 10);
    for (let n = 60; n <= bars.length; n++) {
      const p = detectPatterns(bars.slice(0, n)).find(x => x.type === type && x.dir === dir && x.breakout);
      if (p) return p;
    }
    return null;
  };
  const ihs = found([150, 140, 150, 130, 110, 120, 100, 120, 110, 130], 'ihs', 'bull');
  assert.ok(ihs, 'inverterad H&S hittas');
  assert.ok(ihs.target > ihs.level && ihs.stop < ihs.level);
  const dbl = found([150, 140, 150, 130, 110, 125, 110, 135], 'dbl', 'bull');
  assert.ok(dbl && Math.abs(dbl.level - 125.3) < 1, 'dubbelbotten bryter mellantoppen');
  const top = found([100, 110, 100, 120, 140, 125, 140, 115], 'dbl', 'bear');
  assert.ok(top && top.target < top.level && top.stop > top.level, 'dubbeltopp är ett säljmönster');
  assert.equal(found([100, 120, 100, 120, 100, 120, 100, 120], 'ihs', 'bull'), null);
});

test('Krypto-utbrott: signal, backtest och utfall', async () => {
  const { cryptoSignal, cryptoBacktest, cryptoOutcome, completeBars } = await import('../lib/crypto.js');
  // Stigande kurs med rekyler: över EMA 200 och nya 20-dagarstoppar.
  const bars = path([100, 150, 140, 200, 185, 260, 240, 330], 40);
  const sig = cryptoSignal(bars);
  assert.equal(sig.status, 'strong');
  assert.ok(sig.checklist.every(c => c.ok));
  const bt = cryptoBacktest(bars);
  assert.ok(bt.stats.n > 0);
  for (let k = 1; k < bt.trades.length; k++) assert.ok(bt.trades[k].i > bt.trades[k - 1].exitI, 'affärerna överlappar inte');
  const t = bt.trades[0];
  assert.equal(t.exitI - t.i, 7);
  const date = new Date(t.t * 1000).toISOString().slice(0, 10);
  const o = cryptoOutcome({ date }, bars);
  assert.equal(o.state, 'stängd');
  assert.equal(o.pct, t.pct);
  // Fallande kurs: ingen signal.
  assert.notEqual(cryptoSignal(path([300, 200, 220, 150, 160, 100], 40)).status, 'strong');
  // Dagens ofärdiga stapel tas bort.
  const now = new Date(bars[bars.length - 1].t * 1000);
  assert.equal(completeBars(bars, now).length, bars.length - 1);
});

test('Förlustsviter och nedgångar för panelen "Vad är normalt?"', async () => {
  const { equityStats } = await import('../lib/analyze.js');
  const s = equityStats([1, -1, -1, -1, 2, -0.5, 3, -1, -1]);
  assert.equal(s.trades, 9);
  assert.equal(s.longestLosing, 3);
  assert.equal(s.maxDD, -3);
  assert.equal(s.currentLosing, 2);
  assert.equal(s.currentDD, -2);
  assert.equal(s.sinceHigh, 2);
  assert.equal(s.longestNoHigh, 5);
  assert.equal(s.lossShare, 67);
  assert.equal(equityStats([]).lossShare, null);
});

test('Makroläget förklarar vad som saknas', async () => {
  const { buildMacro } = await import('../lib/macro.js');
  const up = path([100, 140], 260);
  const m = buildMacro({ omxBars: up, vixBars: up.map(b => ({ ...b, c: 18 })), stockBars: [up] })(new Date(up[up.length - 1].t * 1000).toISOString().slice(0, 10));
  assert.equal(m.score, 0);
  assert.match(m.summary, /kräver poäng 1, så 1 poäng saknas/);
  const omx = m.parts.find(p => p.text.startsWith('OMXS30'));
  assert.match(omx.need, /\+1 om OMXS30 faller .* % till under EMA 200/);
  assert.match(m.parts.find(p => p.text.startsWith('VIX')).need, /\+1 om VIX stiger till 20 \(2 enheter upp\)/);
});

test('Live-notiser: mål och stopp skickas med rätt text', async () => {
  const { notifyEvent } = await import('../lib/notify.js');
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { sent.push({ url, ...opts }); return { ok: true }; };
  try {
    const e = { name: 'Volvo B', symbol: 'VOLV-B.ST', close: 250, stop: 240, tps: [258, 265, 275], date: '2026-10-20', days: 7 };
    assert.equal(await notifyEvent(e, 'tp2', { entry: 251 }, { topic: 't', server: 'https://ntfy.example' }), true);
    assert.match(sent[0].body, /flytta stoppet till köpkursen \(251,00\)/);
    await notifyEvent(e, 'stop', { hit: 0, r: -1 }, { topic: 't', server: 'https://ntfy.example' });
    assert.match(sent[1].body, /Stoppet \(240,00\) är nått.*Resultat −?-1 R/);
    assert.equal(await notifyEvent(e, 'okänd', {}, { topic: 't', server: 'https://ntfy.example' }), false);
    assert.equal(await notifyEvent(e, 'tp1', {}, { topic: '' }), false);
  } finally { globalThis.fetch = realFetch; }
});

test('Makrokalender och förklaring i klartext', async () => {
  const { upcomingMacro } = await import('../lib/events.js');
  const cal = upcomingMacro('2026-10-26', 4);
  assert.equal(cal.length, 4);
  assert.ok(cal.every((e, k) => k === 0 || e.date >= cal[k - 1].date));
  assert.ok(cal.some(e => e.kind === 'fomc' && e.scored));
  const { buildMacro } = await import('../lib/macro.js');
  const up = path([100, 140], 260);
  const m = buildMacro({ omxBars: up, vixBars: up.map(b => ({ ...b, c: 18 })), stockBars: [up] })(new Date(up[up.length - 1].t * 1000).toISOString().slice(0, 10));
  assert.match(m.comment, /lugn och stigande/);
});

test('USA: köpsignal kräver makropoäng 3', async () => {
  const { applyGuards } = await import('../lib/analyze.js');
  const base = () => ({ status: 'buy', warnings: [], checklist: [] });
  const two = applyGuards(base(), { macro: { score: 2, need: 3, size: 0, label: 'Neutralt', summary: 'Poäng 2' } });
  assert.equal(two.status, 'watch');
  assert.equal(two.checklist.find(c => c.key === 'macro').ok, false);
  assert.match(two.warnings[0], /makropoäng 3/);
  assert.equal(applyGuards(base(), { macro: { score: 3, need: 3, size: 1 } }).status, 'strong');
  // OMX oförändrat: poäng 1 räcker
  assert.equal(applyGuards(base(), { macro: { score: 1, size: 1 } }).status, 'strong');
});

test('Panikvecka: tre mest fallna när gårdagens VIX är minst 25', async () => {
  const { panicPicks, panicOutcome, addTradingDays } = await import('../lib/panic.js');
  const mk = (pts) => path(pts, 10);
  const stocks = [[100, 110, 120], [100, 110, 90], [100, 110, 80], [100, 110, 100], [100, 110, 70]].map((p, k) => ({ symbol: 'S' + k, name: 'Aktie ' + k, bars: mk(p) }));
  const date = new Date(stocks[0].bars[12].t * 1000).toISOString().slice(0, 10);
  const vix = v => stocks[0].bars.map(b => ({ ...b, c: v }));
  const on = panicPicks({ stocks, vixBars: vix(30), date });
  assert.equal(on.active, true);
  assert.deepEqual(on.picks.map(p => p.symbol), ['S4', 'S2', 'S1']);
  assert.equal(panicPicks({ stocks, vixBars: vix(20), date }).active, false);
  assert.equal(addTradingDays('2026-10-30', 5), '2026-11-06'); // fredag + 5 vardagar
  const o = panicOutcome({ date }, stocks[4].bars);
  assert.equal(o.state, 'stängd');
  assert.ok(Math.abs(o.pct - ((stocks[4].bars[17].c / stocks[4].bars[13].o - 1 - 0.002) * 100)) < 0.01);
  const { idOf } = await import('../lib/log.js');
  assert.notEqual(idOf({ date, symbol: 'S1' }), idOf({ date, symbol: 'S1', kind: 'panic' }));
});

test('Webbnotiser: kryptering enligt RFC 8291 och VAPID-signatur', async () => {
  const crypto = await import('node:crypto');
  const { encrypt, vapidAuth } = await import('../lib/push.js');
  // Webbläsarens nycklar (mottagaren)
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const body = encrypt(sub, JSON.stringify({ title: 'Test', body: 'Hej' }));
  // Dekryptera som webbläsaren gör
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  assert.equal(body.readUInt32BE(16), 4096);
  const shared = ua.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  assert.deepEqual(JSON.parse(plain.subarray(0, -1).toString()), { title: 'Test', body: 'Hej' });
  // VAPID: signaturen ska gå att verifiera med den publika nyckeln
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  const h = vapidAuth(sub.endpoint, { publicKey: pub, jwk: { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y } });
  const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, pub);
  const [hh, cc, ss] = t.split('.');
  assert.equal(JSON.parse(Buffer.from(cc, 'base64url')).aud, 'https://push.example.com');
  const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${hh}.${cc}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(ss, 'base64url')));
});

test('blankning: teknik hittar nedtrend med studs som vänder ned', async () => {
  const { technical } = await import('../lib/shortlab.js');
  // Lång uppgång, sedan nedtrend, en studs upp mot EMA 20 och ett fall igen.
  const bars = path([120, 130, 80, 88, 85], 60);
  const t = technical(bars);
  assert.equal(t.down, true);
  assert.ok(t.plan.stop > t.price);
  const R = t.plan.stop - t.price;
  assert.ok(R >= t.atr * 0.99 && R <= t.atr * 4.01, 'stoppet ligger 1–4 ATR över kursen');
  assert.ok(Math.abs(t.plan.tps[0].price - (t.price - R)) < 0.02);
});

test('blankning: poäng och kravlista', async () => {
  const { scoreShort, SHORT_MIN_SCORE } = await import('../lib/shortlab.js');
  const tech = { down: true, rejection: true, notOversold: true, fading: true, rsi: 52, price: 90, ema20: 92, ema200: 110 };
  const weak = { epsChange90: -0.12, revUp: 0, revDown: 5, surprises: [-0.05, -0.04, 0.01, -0.06], price: 90, target: 85, recMean: 3, analysts: 12,
    revenueGrowth: -0.04, earningsGrowth: -0.2, debtToEquity: 200, fcf: -1 };
  const s = scoreShort({ f: weak, si: { pct: 6, change4w: 1 }, nw: { neg: [1, 2], pos: [] }, tech, report: { date: '2099-01-01', days: 30 } });
  assert.ok(s.score >= SHORT_MIN_SCORE);
  assert.equal(s.status, 'short');
  // Rapport snart stoppar blankningen även om allt annat stämmer.
  assert.equal(scoreShort({ f: weak, si: null, nw: null, tech, report: { date: '2099-01-01', days: 3 } }).status, 'watch');
  // Starka prognoser ger ingen kandidat.
  const strong = { ...weak, epsChange90: 0.1, revUp: 6, revDown: 0, surprises: [0.05], target: 120, recMean: 1.8, revenueGrowth: 0.1, earningsGrowth: 0.2 };
  assert.equal(scoreShort({ f: strong, si: null, nw: null, tech, report: null }).status, 'none');
});

test('blankning: utfall med mål, stopp till ingången och avgift', async () => {
  const { shortOutcome } = await import('../lib/shortlab.js');
  const d = i => 1_700_000_000 + i * 86400;
  const day = i => new Date(d(i) * 1000).toISOString().slice(0, 10);
  const e = { date: day(0), stop: 110, tps: [90, 80, 70] };
  // In på 100. TP1 och TP2 nås, sedan tillbaka till ingången: +1/3 + 2/3 = +1 R före avgift.
  const bars = [{ t: d(0), o: 100, h: 101, l: 99, c: 100 }, { t: d(1), o: 100, h: 101, l: 89, c: 90 }, { t: d(2), o: 90, h: 91, l: 79, c: 80 }, { t: d(3), o: 80, h: 101, l: 79, c: 100 }];
  const o = shortOutcome(e, bars);
  assert.equal(o.state, 'stängd');
  assert.equal(o.hit, 2);
  assert.ok(Math.abs(o.r - (1 - 0.003 * 100 / 10)) < 0.01);
  // Stoppet direkt: −1 R.
  const s = shortOutcome(e, [bars[0], { t: d(1), o: 100, h: 111, l: 99, c: 108 }]);
  assert.ok(Math.abs(s.r - (-1 - 0.03)) < 0.01);
});

test('ODS-läsaren läser rader och upprepade celler', async () => {
  const zlib = await import('node:zlib');
  const { readOds } = await import('../lib/ods.js');
  const xml = '<office:document-content><office:body><office:spreadsheet><table:table table:name="A"><table:table-row><table:table-cell office:value-type="string"><text:p>Bolag &amp; Co</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2" office:value-type="float" office:value="1.5"><text:p>1,5</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>';
  const name = Buffer.from('content.xml'), data = zlib.deflateRawSync(Buffer.from(xml));
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const cdOff = local.length + name.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length + name.length, 12); end.writeUInt32LE(cdOff, 16);
  const rows = readOds(Buffer.concat([local, name, data, cd, name, end]));
  assert.deepEqual(rows, [['Bolag & Co', '1.5', '1.5']]);
});

test('Avanza: korta papper räknas spegelvänt', async () => {
  const { recommend } = await import('../lib/avanza.js');
  const plan = { entry: 100, stop: 104, tps: [{ price: 96 }, { price: 92 }, { price: 88 }] };
  const mini = (id, fin, ko) => ({ orderbookId: id, name: `MINI S X AVA ${id}`, subType: 'MINI_FUTURE', financingLevel: fin, stopLoss: ko, buyPrice: 10, sellPrice: 10.05, totalValueTraded: 1e5 });
  const r = recommend({ minis: [mini(1, 125, 120), mini(2, 105, 103)], bulls: [{ orderbookId: 3, name: 'BEAR X X2 AVA', leverage: 2, buyPrice: 5, sellPrice: 5.02 }] }, { plan, atr: 2, isIndex: false, side: 'short' });
  assert.equal(r.minis.length, 1, 'knock-out under stoppet + 1 ATR sorteras bort');
  assert.equal(r.minis[0].id, 1);
  assert.equal(r.minis[0].leverage, 4);
  assert.equal(r.minis[0].lossAtStopPct, 16);
  assert.equal(r.bulls[0].kind, 'Bear (daglig hävstång)');
});
