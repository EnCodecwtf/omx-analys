import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchBars } from './lib/data.js';
import { evaluate, backtest, applyGuards, equityStats, REPORT_BLOCK_DAYS } from './lib/analyze.js';
import { reportDates, nextReport, tradingDaysBetween } from './lib/events.js';
import { buildMacro } from './lib/macro.js';
import * as signalLog from './lib/log.js';
import { notifySignal } from './lib/notify.js';
import { stressNow } from './lib/stress.js';
import { btcCycle } from './lib/cycle.js';
import { news, companyQuery, MARKET_QUERY, GEO_QUERY } from './lib/news.js';
import { computeIndicators } from './lib/indicators.js';
import { fetchProducts, recommend, avanzaUrl } from './lib/avanza.js';
import { relevantPatterns } from './lib/patterns.js';
import { cryptoSignal, cryptoBacktest, cryptoOutcome, completeBars } from './lib/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CHART_BARS = 500;
const CACHE_MS = 15 * 60 * 1000;

const symbols = JSON.parse(await fs.readFile(path.join(__dirname, 'symbols.json'), 'utf8'));
const universe = [{ ...symbols.index, isIndex: true }, ...symbols.stocks];
const cryptos = (symbols.crypto || []).map(s => ({ ...s, isCrypto: true }));
const bySymbol = new Map([...universe, ...cryptos].map(s => [s.symbol, s]));

const r4 = x => Math.round(x * 1e4) / 1e4;
const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);

// Marknadsläget byggs av OMXS30, VIX och alla aktiers kurser.
async function macro() {
  return cached('macro', async () => {
    const [omxBars, vixBars] = await Promise.all([fetchBars(symbols.index.symbol), fetchBars('^VIX')]);
    const stockBars = await mapLimit(symbols.stocks, 6, s => fetchBars(s.symbol).catch(() => []));
    return buildMacro({ omxBars, vixBars, stockBars });
  });
}

async function stress() {
  return cached('stress', stressNow);
}

async function guards(s) {
  const macroAt = await macro();
  const st = await stress();
  const report = s.isIndex ? null : await nextReport(s.symbol);
  return { report, reportDays: report ? tradingDaysBetween(today(), report.date) : null, macro: macroAt(today()), stress: st };
}

// Samma regler i backtestet som i appen: rapportspärr och makrofilter.
async function backtestFor(s, bars) {
  const macroAt = await macro();
  const bt = backtest(bars, {
    reports: s.isIndex ? [] : reportDates(s.symbol),
    reportBlock: s.isIndex ? 0 : REPORT_BLOCK_DAYS,
    allow: t => macroAt(dayOf(t)).score >= 1,
  });
  for (const t of bt.trades) t.status = 'strong';
  return bt;
}

// En stapel är slutgiltig när dagen är slut på Stockholmsbörsen (efter 18.00).
function isFinal(t) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  const todaySthlm = `${parts.year}-${parts.month}-${parts.day}`;
  return dayOf(t) < todaySthlm || +parts.hour >= 18;
}

async function scan() {
  return cached('scan', async () => {
    const rows = await mapLimit(universe, 6, async s => {
      try {
        const bars = await fetchBars(s.symbol);
        const ev = applyGuards(evaluate(bars.slice(-CHART_BARS)), await guards(s));
        const prevClose = bars[bars.length - 2]?.c;
        return {
          symbol: s.symbol, name: s.name, isIndex: !!s.isIndex,
          price: ev.price, changePct: prevClose ? Math.round((ev.price / prevClose - 1) * 10000) / 100 : null,
          t: ev.t, status: ev.status, score: ev.score, trend: ev.trend, trendLabel: ev.trendLabel, rsi: ev.rsi,
          elliott: ev.elliott.primary ? { label: ev.elliott.primary.label, bias: ev.elliott.primary.bias } : null,
          plan: ev.plan, blocked: ev.blocked || null, missing: ev.checklist.filter(c => !c.ok).map(c => c.key), checks: ev.checklist.length, report: ev.guards.report, size: ev.guards.size,
          spark: bars.slice(-60).map(b => Math.round(b.c * 100) / 100),
        };
      } catch (err) {
        return { symbol: s.symbol, name: s.name, isIndex: !!s.isIndex, error: err.message };
      }
    });
    for (const s of cryptos) {
      try {
        const all = completeBars(await fetchBars(s.symbol));
        const ev = evaluate(all.slice(-CHART_BARS));
        const cs = cryptoSignal(all);
        rows.push({
          symbol: s.symbol, name: s.name, isCrypto: true,
          price: cs.price, changePct: Math.round((cs.price / all[all.length - 2].c - 1) * 10000) / 100,
          t: all[all.length - 1].t, status: cs.status, score: ev.score, trend: ev.trend, trendLabel: ev.trendLabel, rsi: ev.rsi, elliott: null,
          crypto: cs, missing: cs.checklist.filter(c => !c.ok).map(c => c.key), checks: cs.checklist.length, size: cs.size,
          spark: all.slice(-60).map(b => Math.round(b.c * 100) / 100),
        });
      } catch (err) {
        rows.push({ symbol: s.symbol, name: s.name, isCrypto: true, error: err.message });
      }
    }
    const signals = rows.filter(r => r.status === 'strong' && (r.isCrypto || isFinal(r.t)));
    if (signals.length) {
      const added = await signalLog.record(signals.map(r => r.isCrypto
        ? { kind: 'crypto', date: dayOf(r.t), symbol: r.symbol, name: r.name, close: r.price, exitDate: r.crypto.exitDate, days: r.crypto.days, size: r.size, loggedAt: new Date().toISOString() }
        : { date: dayOf(r.t), symbol: r.symbol, name: r.name, close: r.price, stop: r.plan.stop,
          tps: r.plan.tps.map(x => x.price), size: r.size, avanzaUrl: avanzaUrl(bySymbol.get(r.symbol)), loggedAt: new Date().toISOString() }));
      for (const e of added) await notifySignal(e);
    }
    return { updated: Date.now(), macro: (await macro())(today()), stress: await stress(), cycle: btcCycle(today()), rows };
  });
}

// Samlat backtest för alla instrument. Tar några sekunder, så det räknas i
// bakgrunden och hämtas separat av gränssnittet.
async function summary() {
  return cached('summary', async () => {
    const trades = [];
    for (const s of universe) {
      try {
        const bt = await backtestFor(s, await fetchBars(s.symbol));
        trades.push(...bt.trades.filter(t => !t.open));
      } catch { /* instrumentet hoppas över */ }
      await new Promise(r => setImmediate(r));
    }
    const rate = (list, k) => list.length ? Math.round(1000 * list.filter(x => x.hit >= k).length / list.length) / 10 : null;
    const stats = list => ({
      n: list.length, tp1Rate: rate(list, 1), tp2Rate: rate(list, 2), tp3Rate: rate(list, 3),
      avgR: list.length ? Math.round(100 * list.reduce((a, x) => a + x.r, 0) / list.length) / 100 : null,
    });
    const ct = [];
    for (const s of cryptos) {
      try { ct.push(...cryptoBacktest(completeBars(await fetchBars(s.symbol))).trades.filter(t => !t.open)); } catch { /* hoppas över */ }
    }
    const crypto = { n: ct.length, winRate: ct.length ? Math.round(1000 * ct.filter(t => t.pct > 0).length / ct.length) / 10 : null,
      avgPct: ct.length ? Math.round(100 * ct.reduce((a, t) => a + t.pct, 0) / ct.length) / 100 : null };
    const normal = equityStats(trades.slice().sort((a, b) => a.t - b.t).map(t => t.r));
    return { updated: Date.now(), normal, all: stats(trades), strong: stats(trades.filter(t => t.status === 'strong')), buy: stats(trades.filter(t => t.status === 'buy')), crypto };
  });
}

// Signalloggen med utfall räknat från kurserna efter signaldagen.
async function logView() {
  const list = await signalLog.entries();
  const out = [];
  for (const e of list) {
    let o;
    try {
      const bars = await fetchBars(e.symbol);
      o = e.kind === 'crypto' ? cryptoOutcome(e, completeBars(bars)) : signalLog.outcome(e, bars);
    } catch { o = { state: 'okänd' }; }
    out.push({ ...e, ...o });
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  // R gäller OMX-signalerna. Kryptosignalerna räknas i procent för sig.
  const closed = out.filter(x => x.state === 'stängd' && x.kind !== 'crypto');
  const cClosed = out.filter(x => x.state === 'stängd' && x.kind === 'crypto');
  const current = equityStats(closed.slice().sort((a, b) => a.date.localeCompare(b.date)).map(x => x.r));
  const pct = k => closed.length ? Math.round(1000 * closed.filter(x => x.hit >= k).length / closed.length) / 10 : null;
  return {
    entries: out,
    stats: { n: out.length, closed: closed.length, current, open: out.filter(x => x.state === 'öppen').length, tp1Rate: pct(1), tp2Rate: pct(2),
      avgR: closed.length ? Math.round(100 * closed.reduce((s, x) => s + x.r, 0) / closed.length) / 100 : null,
      crypto: { closed: cClosed.length, avgPct: cClosed.length ? Math.round(100 * cClosed.reduce((s, x) => s + x.pct, 0) / cClosed.length) / 100 : null } },
  };
}

async function analysis(symbol) {
  return cached(`a:${symbol}`, async () => {
    const meta = bySymbol.get(symbol);
    if (meta.isCrypto) return cryptoAnalysis(meta);
    const all = await fetchBars(symbol);
    const bars = all.slice(-CHART_BARS);
    const ev = applyGuards(evaluate(bars), await guards(meta));
    const ind = computeIndicators(all);
    const off = all.length - bars.length;
    const pick = arr => arr.slice(off).map(v => (v == null ? null : Math.round(v * 100) / 100));
    const bt = await backtestFor(meta, all);
    return {
      symbol, name: meta.name, isIndex: !!meta.isIndex, avanzaUrl: avanzaUrl(meta),
      bars: bars.map(b => [b.t, r4(b.o), r4(b.h), r4(b.l), r4(b.c), b.v]),
      ema20: pick(ind.ema20), ema50: pick(ind.ema50), ema200: pick(ind.ema200), rsi: pick(ind.rsi),
      analysis: ev,
      // Formationer visas som information. De klarade inte backtestet (se README).
      patterns: relevantPatterns(bars),
      backtest: {
        stats: bt.stats,
        trades: bt.trades.map(t => ({ ...t, exitT: all[t.exitI]?.t })),
      },
    };
  });
}

// Kryptosidan: samma graf och analys av strukturen, men signalen kommer från
// utbrottsstrategin och backtestet räknas i procent.
async function cryptoAnalysis(meta) {
  const all = completeBars(await fetchBars(meta.symbol));
  const bars = all.slice(-CHART_BARS);
  const ev = evaluate(bars);
  const cs = cryptoSignal(all);
  // Rekylstrategins stopp och mål gäller inte här, så handelsplanen ritas inte.
  Object.assign(ev, { status: cs.status, checklist: cs.checklist, crypto: cs, warnings: [], blocked: null, plan: null });
  const ind = computeIndicators(all);
  const off = all.length - bars.length;
  const pick = arr => arr.slice(off).map(v => (v == null ? null : Math.round(v * 100) / 100));
  const bt = cryptoBacktest(all);
  return {
    symbol: meta.symbol, name: meta.name, isCrypto: true,
    bars: bars.map(b => [b.t, r4(b.o), r4(b.h), r4(b.l), r4(b.c), b.v]),
    ema20: pick(ind.ema20), ema50: pick(ind.ema50), ema200: pick(ind.ema200), rsi: pick(ind.rsi),
    analysis: ev,
    patterns: relevantPatterns(bars),
    backtest: { stats: bt.stats, trades: bt.trades.map(t => ({ ...t, r: t.pct })) },
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  // Vercel skickar alla sökvägar till /api och lägger den riktiga i __path.
  if (url.searchParams.has('__path')) {
    url.pathname = url.searchParams.get('__path');
    url.searchParams.delete('__path');
  }
  try {
    if (url.pathname === '/api/scan') {
      if (url.searchParams.has('refresh')) cache.clear();
      return send(res, 200, await scan());
    }
    // Anropas av Vercel Cron varje kväll (krypto handlas även på helger): sparar
    // nya starka köpsignaler i signalloggen och skickar avisering.
    if (url.pathname === '/api/cron/scan') {
      cache.delete('scan');
      const before = (await signalLog.entries()).length;
      const s = await scan();
      const after = (await signalLog.entries()).length;
      return send(res, 200, { ok: true, signals: s.rows.filter(r => r.status === 'strong').map(r => r.symbol), logged: after - before });
    }
    if (url.pathname === '/api/summary') return send(res, 200, await summary());
    if (url.pathname === '/api/news') {
      const meta = bySymbol.get(url.searchParams.get('symbol'));
      if (meta && !meta.isIndex) return send(res, 200, { items: await news(meta.newsQuery || companyQuery(meta.name)) });
      const [market, geo] = await Promise.all([news(MARKET_QUERY, { limit: 8 }), news(GEO_QUERY, { limit: 30 })]);
      const perSource = {};
      const geoItems = geo.filter(n => n.tags.includes('Geopolitik') && (perSource[n.source] = (perSource[n.source] || 0) + 1) <= 2);
      return send(res, 200, { market, geo: geoItems.slice(0, 8) });
    }
    if (url.pathname === '/api/log') return send(res, 200, await logView());
    if (url.pathname === '/api/macro') return send(res, 200, (await macro())(today()));
    if (url.pathname === '/api/products') {
      const meta = bySymbol.get(url.searchParams.get('symbol'));
      if (!meta?.avanzaId) return send(res, 404, { error: 'Okänd symbol' });
      const bars = await fetchBars(meta.symbol);
      const ev = applyGuards(evaluate(bars.slice(-CHART_BARS)), await guards(meta));
      const products = await fetchProducts(meta.avanzaId);
      return send(res, 200, { status: ev.status, stop: ev.plan.stop, size: ev.guards.size, updated: products.at, ...recommend(products, { plan: ev.plan, atr: ev.atr, isIndex: !!meta.isIndex }) });
    }
    if (url.pathname === '/api/analysis') {
      const symbol = url.searchParams.get('symbol');
      if (!bySymbol.has(symbol)) return send(res, 404, { error: 'Okänd symbol' });
      return send(res, 200, await analysis(symbol));
    }
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.normalize(path.join(__dirname, 'public', file));
    if (!full.startsWith(path.join(__dirname, 'public'))) return send(res, 403, 'Forbidden', 'text/plain');
    const data = await fs.readFile(full);
    send(res, 200, data, MIME[path.extname(full)] || 'application/octet-stream');
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, 'Hittades inte', 'text/plain; charset=utf-8');
    console.error(err);
    send(res, 500, { error: err.message });
  }
}

// Lokalt (npm start) körs en vanlig server. På Vercel används handler som
// serverlös funktion via api/index.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  http.createServer(handler).listen(PORT, () => console.log(`OMX Analys körs på http://localhost:${PORT}`));
  // Kör skannern varje timme så att signaler loggas även när ingen har appen öppen.
  setInterval(() => { cache.delete('scan'); scan().catch(err => console.error('Skanningen misslyckades:', err.message)); }, 60 * 60 * 1000).unref();
}
