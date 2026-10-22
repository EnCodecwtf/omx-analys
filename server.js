import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBars } from './lib/data.js';
import { evaluate, backtest, applyGuards, REPORT_BLOCK_DAYS } from './lib/analyze.js';
import { reportDates, nextReport, tradingDaysBetween } from './lib/events.js';
import { buildMacro } from './lib/macro.js';
import { computeIndicators } from './lib/indicators.js';
import { fetchProducts, recommend } from './lib/avanza.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CHART_BARS = 500;
const CACHE_MS = 15 * 60 * 1000;

const symbols = JSON.parse(await fs.readFile(path.join(__dirname, 'symbols.json'), 'utf8'));
const universe = [{ ...symbols.index, isIndex: true }, ...symbols.stocks];
const bySymbol = new Map(universe.map(s => [s.symbol, s]));

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

async function guards(s) {
  const macroAt = await macro();
  const report = s.isIndex ? null : await nextReport(s.symbol);
  return { report, reportDays: report ? tradingDaysBetween(today(), report.date) : null, macro: macroAt(today()) };
}

// Samma regler i backtestet som i appen: rapportspärr och makrofilter.
async function backtestFor(s, bars) {
  const macroAt = await macro();
  const bt = backtest(bars, {
    reports: s.isIndex ? [] : reportDates(s.symbol),
    reportBlock: s.isIndex ? 0 : REPORT_BLOCK_DAYS,
    allow: t => macroAt(dayOf(t)).score >= 0,
  });
  for (const t of bt.trades) t.status = macroAt(dayOf(t.t)).score >= 1 ? 'strong' : 'buy';
  return bt;
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
          plan: ev.plan, blocked: ev.blocked || null, report: ev.guards.report,
          spark: bars.slice(-60).map(b => Math.round(b.c * 100) / 100),
        };
      } catch (err) {
        return { symbol: s.symbol, name: s.name, isIndex: !!s.isIndex, error: err.message };
      }
    });
    return { updated: Date.now(), macro: (await macro())(today()), rows };
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
    return { updated: Date.now(), all: stats(trades), strong: stats(trades.filter(t => t.status === 'strong')), buy: stats(trades.filter(t => t.status === 'buy')) };
  });
}

async function analysis(symbol) {
  return cached(`a:${symbol}`, async () => {
    const meta = bySymbol.get(symbol);
    const all = await fetchBars(symbol);
    const bars = all.slice(-CHART_BARS);
    const ev = applyGuards(evaluate(bars), await guards(meta));
    const ind = computeIndicators(all);
    const off = all.length - bars.length;
    const pick = arr => arr.slice(off).map(v => (v == null ? null : Math.round(v * 100) / 100));
    const bt = await backtestFor(meta, all);
    return {
      symbol, name: meta.name, isIndex: !!meta.isIndex,
      bars: bars.map(b => [b.t, r4(b.o), r4(b.h), r4(b.l), r4(b.c), b.v]),
      ema20: pick(ind.ema20), ema50: pick(ind.ema50), ema200: pick(ind.ema200), rsi: pick(ind.rsi),
      analysis: ev,
      backtest: {
        stats: bt.stats,
        trades: bt.trades.map(t => ({ ...t, exitT: all[t.exitI]?.t })),
      },
    };
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/scan') {
      if (url.searchParams.has('refresh')) cache.clear();
      return send(res, 200, await scan());
    }
    if (url.pathname === '/api/summary') return send(res, 200, await summary());
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
});

server.listen(PORT, () => console.log(`OMX Analys körs på http://localhost:${PORT}`));
