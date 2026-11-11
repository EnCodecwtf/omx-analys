import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchBars } from './lib/data.js';
import { evaluate, backtest, applyGuards, equityStats, REPORT_BLOCK_DAYS } from './lib/analyze.js';
import { reportDates, nextReport, tradingDaysBetween, upcomingMacro } from './lib/events.js';
import { buildMacro } from './lib/macro.js';
import * as signalLog from './lib/log.js';
import { notifySignal, notifyEvent, notifyText } from './lib/notify.js';
import * as monthly from './lib/monthly.js';
import { freeView } from './lib/freeview.js';
import { EXPERIMENTS, experimentSignal, expOutcome } from './lib/experiments.js';
import { igStatus, igEnabled, configureIg, igTryLogin } from './lib/ig.js';
import crypto from 'node:crypto';
import { vapidKeys, subscribe, unsubscribe, pushAll } from './lib/push.js';
import { stressNow } from './lib/stress.js';
import { btcCycle } from './lib/cycle.js';
import { news, companyQuery, MARKET_QUERY, GEO_QUERY } from './lib/news.js';
import { computeIndicators } from './lib/indicators.js';
import { fetchProducts, recommend, avanzaUrl } from './lib/avanza.js';
import { relevantPatterns } from './lib/patterns.js';
import { cryptoSignal, cryptoBacktest, cryptoOutcome, completeBars } from './lib/crypto.js';
import { panicPicks, panicOutcome, addTradingDays } from './lib/panic.js';
import { coachTrade, coachTp } from './lib/coach.js';
import { marketMoves, buildMorning } from './lib/morning.js';
import { overnight } from './lib/overnight.js';
import { runAiTrader } from './lib/aitrader.js';
import { buildReport, frozenHash } from './lib/report.js';
import { macroOutcomes, nextKpifDates, fedWatch, OUTCOME_ORDER } from './lib/macrodata.js';
import { fundamentals, shortRegister, shortFor, newsFor, technical, scoreShort, shortOutcome, SHORT_SIZE } from './lib/shortlab.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CHART_BARS = 500;
const CACHE_MS = 15 * 60 * 1000;

const symbols = JSON.parse(await fs.readFile(path.join(__dirname, 'symbols.json'), 'utf8'));
const universe = [{ ...symbols.index, isIndex: true }, ...symbols.stocks];
const cryptos = (symbols.crypto || []).map(s => ({ ...s, isCrypto: true }));
// USA: S&P 500-bolag med minst tre långa hävstångspapper på Avanza (data/sp500.json).
const usStocks = JSON.parse(await fs.readFile(path.join(__dirname, 'data', 'sp500.json'), 'utf8')).stocks.map(s => ({ ...s, isUS: true }));
const bySymbol = new Map([...universe, ...cryptos, ...usStocks].map(s => [s.symbol, s]));
// Månadens aktier: alla S&P 500-bolag (data/momentum-universe.json), med Avanzas id där det finns minifutures.
const momUniverse = JSON.parse(await fs.readFile(path.join(__dirname, 'data', 'momentum-universe.json'), 'utf8')).stocks;
const momBySymbol = new Map(momUniverse.map(s => [s.symbol, s]));

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

// USA: S&P 500, VIX och bredden bland bolagen i USA-listan. Köpsignaler kräver
// poäng 3 (full rädsla), det enda läge där signalerna gav en fördel i backtestet.
async function usMacro() {
  return cached('usmacro', async () => {
    const [idx, vixBars] = await Promise.all([fetchBars('^GSPC'), fetchBars('^VIX')]);
    const stockBars = await mapLimit(usStocks, 8, s => fetchBars(s.symbol).catch(() => []));
    return buildMacro({ omxBars: idx, vixBars, stockBars, index: 'S&P 500', need: 3 });
  });
}

// En amerikansk signal gäller bara om minst tre hävstångspapper på Avanza
// klarar säkerhetsreglerna (knock-out långt under stoppet, låg spread, rimlig hävstång).
const US_MIN_PRODUCTS = 3;
async function usProducts(ev, meta) {
  // Rapportspärren gäller inte USA-listan (rapportdatum saknas och testet gjordes utan den).
  ev.checklist = ev.checklist.filter(c => c.key !== 'report');
  if (ev.status !== 'strong') return ev;
  let n = 0;
  try { const r = recommend(await fetchProducts(meta.avanzaId), { plan: ev.plan, atr: ev.atr, isIndex: false }); n = r.minis.length + r.bulls.length; } catch { n = 0; }
  ev.checklist.push({ key: 'products', ok: n >= US_MIN_PRODUCTS, text: `Minst ${US_MIN_PRODUCTS} säkra hävstångspapper på Avanza`, now: `${n} papper klarar kraven` });
  if (ev.status === 'strong' && n < US_MIN_PRODUCTS) {
    ev.warnings.unshift(`Bara ${n} hävstångspapper på Avanza klarar säkerhetskraven – ingen signal.`);
    ev.blocked = 'strong'; ev.status = 'watch';
  }
  return ev;
}

async function stress() {
  return cached('stress', stressNow);
}

async function guards(s) {
  // Fri tillgång: ingen rapportspärr; marknadsläget för Stockholm eller USA.
  if (s.isFree) return { report: null, reportDays: null, macro: (/\.ST$/.test(s.symbol) ? await macro() : await usMacro())(today()), stress: await stress() };
  if (s.isUS) return { report: null, reportDays: null, macro: (await usMacro())(today()), stress: await stress() };
  const macroAt = await macro();
  const st = await stress();
  const report = s.isIndex ? null : await nextReport(s.symbol);
  return { report, reportDays: report ? tradingDaysBetween(today(), report.date) : null, macro: macroAt(today()), stress: st };
}

// Samma regler i backtestet som i appen: rapportspärr och makrofilter.
async function backtestFor(s, bars) {
  const macroAt = s.isUS ? await usMacro() : await macro();
  const bt = backtest(bars, {
    reports: s.isIndex || s.isUS ? [] : reportDates(s.symbol),
    reportBlock: s.isIndex || s.isUS ? 0 : REPORT_BLOCK_DAYS,
    allow: t => { const m = macroAt(dayOf(t)); return m.score >= m.need; },
  });
  for (const t of bt.trades) t.status = 'strong';
  return bt;
}

// Klockan i Stockholm: datum, minuter efter midnatt och veckodag.
function sthlm(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: +parts.hour * 60 + +parts.minute, weekend: /lör|sön/.test(parts.weekday) };
}

// En stapel är slutgiltig när dagen är slut på Stockholmsbörsen (efter 18.00).
function isFinal(t) {
  const s = sthlm();
  return dayOf(t) < s.date || s.min >= 18 * 60;
}

// USA-börsen stänger 16.00 i New York. Dagens stapel är slutgiltig efter 16.30 där.
function isFinalUS(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return dayOf(t) < `${p.year}-${p.month}-${p.day}` || +p.hour * 60 + +p.minute >= 16 * 60 + 30;
}

// Är senaste stapeln från rätt handelsdag? Om Yahoo släpar eller saknar en dag
// loggas inga signaler för instrumentet – hellre ingen signal än en på gammal data.
function prevWeekday(d) { const x = new Date(d + 'T12:00:00Z'); do x.setUTCDate(x.getUTCDate() - 1); while (x.getUTCDay() % 6 === 0); return x.toISOString().slice(0, 10); }
function isStale(t, { us = false } = {}) {
  const s = sthlm(), last = dayOf(t);
  const opened = !s.weekend && s.min >= (us ? 15 * 60 + 45 : 9 * 60 + 15);
  const expected = opened ? s.date : prevWeekday(s.date + '');
  // Helgdagar saknas i kalendern, så en dag till godtas.
  return last < prevWeekday(expected);
}

// USA-listan. Hämtas separat (fliken USA och den egna kvällskörningen) eftersom
// den har många fler bolag än OMX-listan.
async function usScan() {
  return cached('usscan', async () => {
    const macroAt = await usMacro();
    const m = macroAt(today());
    const rows = await mapLimit(usStocks, 8, async s => {
      try {
        const bars = await fetchBars(s.symbol);
        const ev = await usProducts(applyGuards(evaluate(bars.slice(-CHART_BARS)), { macro: m, stress: await stress() }), s);
        const prevClose = bars[bars.length - 2]?.c;
        return {
          symbol: s.symbol, name: s.name, isUS: true,
          price: ev.price, changePct: prevClose ? Math.round((ev.price / prevClose - 1) * 10000) / 100 : null,
          t: ev.t, status: ev.status, score: ev.score, trend: ev.trend, trendLabel: ev.trendLabel, rsi: ev.rsi,
          elliott: ev.elliott.primary ? { label: ev.elliott.primary.label, bias: ev.elliott.primary.bias } : null,
          plan: ev.plan, blocked: ev.blocked || null, preliminary: !isFinalUS(ev.t), stale: isStale(ev.t, { us: true }),
          missing: ev.checklist.filter(c => !c.ok).map(c => c.key), checks: ev.checklist.length, size: ev.guards.size,
          spark: bars.slice(-60).map(b => Math.round(b.c * 100) / 100),
        };
      } catch (err) {
        return { symbol: s.symbol, name: s.name, isUS: true, error: err.message };
      }
    });
    const signals = rows.filter(r => r.status === 'strong' && !r.preliminary && !r.stale);
    if (signals.length) {
      const added = await recordFree(signals.map(r => ({ date: dayOf(r.t), symbol: r.symbol, name: r.name, close: r.price, stop: r.plan.stop,
        tps: r.plan.tps.map(x => x.price), size: r.size, market: 'USA', avanzaUrl: avanzaUrl(bySymbol.get(r.symbol)), loggedAt: new Date().toISOString() })));
      for (const e of added) await notifySignal(e);
    }
    await markInTrade(rows);
    return { updated: Date.now(), macro: m, rows };
  });
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
          plan: ev.plan, blocked: ev.blocked || null, preliminary: !isFinal(ev.t), stale: !s.isIndex && isStale(ev.t), missing: ev.checklist.filter(c => !c.ok).map(c => c.key), checks: ev.checklist.length, report: ev.guards.report, size: ev.guards.size,
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
    // Panikvecka: tre mest fallna OMXS30-aktier när gårdagens VIX är minst 25.
    let panic = null;
    try {
      const date = dayOf(rows.find(r => r.isIndex)?.t ?? Date.now() / 1000);
      // Aktier som redan ägs i en annan affär hoppas över (en affär per aktie).
      const held = new Set([...(await openSlots()).values()].filter(e => e.kind !== 'panic').map(e => e.symbol));
      panic = panicPicks({ stocks: await mapLimit(symbols.stocks, 6, async s => ({ ...s, bars: await fetchBars(s.symbol) })), vixBars: await fetchBars('^VIX'), date, exclude: held });
      const open = (await signalLog.entries()).some(e => e.kind === 'panic' && e.exitDate >= today());
      panic.holding = open;
      if (panic.active && !open && isFinal(rows.find(r => r.isIndex).t)) {
        const added = await signalLog.record(panic.picks.map(p => ({ kind: 'panic', date, symbol: p.symbol, name: p.name, close: p.price, ret5: p.ret5, vix: panic.vix,
          days: panic.days, exitDate: panic.exitDate, size: panic.size, avanzaUrl: avanzaUrl(bySymbol.get(p.symbol)), loggedAt: new Date().toISOString() })));
        for (const e of added) await notifySignal(e);
      }
    } catch (err) {
      console.error('Panikveckan kunde inte räknas:', err.message);
    }
    const signals = rows.filter(r => r.status === 'strong' && !r.stale && (r.isCrypto || isFinal(r.t)));
    const stale = rows.filter(r => r.stale).map(r => r.name);
    if (stale.length) console.error('Gammal data, inga signaler loggas för:', stale.join(', '));
    if (signals.length) {
      const added = await recordFree(signals.map(r => r.isCrypto
        ? { kind: 'crypto', date: dayOf(r.t), symbol: r.symbol, name: r.name, close: r.price, exitDate: r.crypto.exitDate, days: r.crypto.days, size: r.size, loggedAt: new Date().toISOString() }
        : { date: dayOf(r.t), symbol: r.symbol, name: r.name, close: r.price, stop: r.plan.stop,
          tps: r.plan.tps.map(x => x.price), size: r.size, avanzaUrl: avanzaUrl(bySymbol.get(r.symbol)), loggedAt: new Date().toISOString() }));
      for (const e of added) await notifySignal(e);
      if (added.length) await ensureAiPicks(added);
    }
    await markInTrade(rows, r => r.isCrypto ? 'crypto' : undefined);
    return { updated: Date.now(), realtimeIndex: igEnabled(), macro: (await macro())(today()), calendar: upcomingMacro(today()), stress: await stress(), cycle: btcCycle(today()), panic, rows };
  });
}

// AI-analytiker för blankning: väger analytikernas prognoser, nyckeltal,
// blankningsregistret, nyheter och teknik för varje OMXS30-aktie. En kandidat
// kräver dessutom minst 3 säkra korta hävstångspapper på Avanza. Kandidater
// sparas vid stängningen med frysta nivåer så att träffsäkerheten mäts framåt.
const SHORT_MIN_PRODUCTS = 3;
async function shortScan() {
  return cached('shorts', async () => {
    let reg = null;
    try { reg = await shortRegister(); } catch (err) { console.error('Blankningsregistret kunde inte hämtas:', err.message); }
    const rows = await mapLimit(symbols.stocks, 4, async s => {
      try {
        const bars = await fetchBars(s.symbol);
        const tech = technical(bars);
        const [f, nw, rep] = await Promise.all([
          fundamentals(s.symbol).catch(() => null), newsFor(s.name, s.newsQuery).catch(() => null), nextReport(s.symbol).catch(() => null)]);
        const report = rep ? { date: rep.date, days: tradingDaysBetween(today(), rep.date), estimated: rep.estimated } : null;
        const si = shortFor(reg, s.symbol);
        const sc = scoreShort({ f, si, nw, tech, report });
        let products = null, blocked = null;
        if (sc.status === 'short') {
          try { products = recommend(await fetchProducts(s.avanzaId, 'short'), { plan: tech.plan, atr: tech.atr, isIndex: false, side: 'short' }); } catch { products = { minis: [], bulls: [] }; }
          const n = products.minis.length + products.bulls.length;
          sc.checklist.push({ key: 'products', ok: n >= SHORT_MIN_PRODUCTS, text: `Minst ${SHORT_MIN_PRODUCTS} säkra korta hävstångspapper på Avanza`, now: `${n} papper klarar kraven` });
          if (n < SHORT_MIN_PRODUCTS) { sc.status = 'watch'; blocked = `Bara ${n} korta hävstångspapper på Avanza klarar säkerhetskraven.`; }
        }
        const last = bars[bars.length - 1], prev = bars[bars.length - 2];
        const head = n => ({ title: n.title, link: n.link, source: n.source, date: n.date });
        return {
          symbol: s.symbol, name: s.name, price: tech.price, changePct: prev ? Math.round((last.c / prev.c - 1) * 10000) / 100 : null, t: last.t,
          status: sc.status, score: sc.score, analyst: sc.analyst, parts: sc.parts, checklist: sc.checklist, missing: sc.checklist.filter(c => !c.ok).map(c => c.key),
          plan: tech.plan, rsi: tech.rsi, report, blocked, preliminary: !isFinal(last.t), stale: isStale(last.t), size: SHORT_SIZE,
          analysts: f ? { target: f.target, recMean: f.recMean, n: f.analysts, epsChange90: f.epsChange90 } : null, short: si,
          news: nw ? { neg: nw.neg.slice(0, 4).map(head), pos: nw.pos.slice(0, 2).map(head), total: nw.total } : null,
          products: products && { minis: products.minis, bulls: products.bulls },
          avanzaUrl: avanzaUrl(s), spark: bars.slice(-60).map(b => Math.round(b.c * 100) / 100),
        };
      } catch (err) {
        return { symbol: s.symbol, name: s.name, error: err.message };
      }
    });
    const order = { short: 0, watch: 1, none: 2 };
    rows.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (b.score ?? -1) - (a.score ?? -1));
    const signals = rows.filter(r => r.status === 'short' && !r.preliminary && !r.stale);
    if (signals.length) {
      const added = await recordFree(signals.map(r => ({ kind: 'short', date: dayOf(r.t), symbol: r.symbol, name: r.name, close: r.price, stop: r.plan.stop,
        tps: r.plan.tps.map(x => x.price), size: r.size, score: r.score, avanzaUrl: r.avanzaUrl, loggedAt: new Date().toISOString() })));
      for (const e of added) await notifySignal(e);
    }
    await markInTrade(rows, () => 'short');
    return { updated: Date.now(), register: !!reg, rows };
  });
}

async function outcomeOf(e) {
  try {
    const bars = await fetchBars(e.symbol);
    return e.kind === 'crypto' ? cryptoOutcome(e, completeBars(bars)) : e.kind === 'panic' ? panicOutcome(e, bars) : e.kind === 'exp' ? expOutcome(e, bars) : e.kind === 'short' ? shortOutcome(e, bars) : signalLog.outcome(e, bars);
  } catch { return { state: 'okänd' }; }
}

// Alla loggade signaler med utfall. Signaler som kom medan en tidigare affär i
// samma instrument och strategi var öppen tas bort, eftersom det bara får finnas
// en affär i taget per instrument (som i backtestet).
async function withOutcomes() {
  let out = [];
  for (const e of await signalLog.entries()) out.push({ ...e, ...(await outcomeOf(e)) });
  const { dupes } = signalLog.busy(out);
  if (dupes.length) {
    await signalLog.remove(dupes);
    out = out.filter(e => !dupes.includes(signalLog.idOf(e)));
  }
  return out;
}

// Sparar nya signaler, men bara för instrument utan öppen affär i samma strategi.
async function recordFree(list) {
  // Går loggen inte att läsa sparas ingenting, hellre det än att skriva över den.
  let out;
  try { out = await withOutcomes(); } catch (err) { console.error('Signalloggen kunde inte läsas, inga nya signaler sparas:', err.message); return []; }
  const { until } = signalLog.busy(out);
  return signalLog.record(list.filter(e => !(e.date <= (until.get(signalLog.slotOf(e.symbol, e.kind)) ?? ''))));
}

// Öppna affärer (eller som väntar på köp) per instrument och strategi, med signaldagen.
async function openSlots() {
  const m = new Map();
  let out = [];
  try { out = await withOutcomes(); } catch (err) { console.error('Signalloggen kunde inte läsas:', err.message); }
  for (const e of out) if (e.state === 'öppen' || e.state === 'väntar på köp') m.set(signalLog.slotOf(e.symbol, e.kind), e);
  return m;
}
// Markerar rader där en tidigare signal redan är en öppen affär: ingen ny signal då.
async function markInTrade(rows, kindOf = () => undefined) {
  const slots = await openSlots();
  for (const r of rows) {
    const e = slots.get(signalLog.slotOf(r.symbol, kindOf(r)));
    if (e && r.t && e.date < dayOf(r.t)) r.inTrade = { date: e.date, entry: e.entry ?? null, state: e.state, stop: e.stop, tps: e.tps, hit: e.hit || 0 };
  }
  return rows;
}

// Kalender för de kommande 60 dagarna: rapporter för OMXS30-bolagen (markerade
// om du har en öppen affär eller aktien är nära signal), makrobesked och säljdagar.
async function calendar() {
  return cached('calendar', async () => {
    const from = today(), to = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const live = (await withOutcomes()).filter(e => e.state === 'öppen' || e.state === 'väntar på köp');
    const open = new Set(live.map(e => e.symbol));
    let rows = [];
    try { rows = (await scan()).rows; } catch { /* kalendern visas ändå */ }
    const near = new Set(rows.filter(r => !r.inTrade && r.missing?.length && r.missing.length <= 2).map(r => r.symbol));
    const days = d => tradingDaysBetween(from, d);
    const events = [];
    await mapLimit(symbols.stocks, 6, async s => {
      const rep = await nextReport(s.symbol).catch(() => null);
      if (rep && rep.date >= from && rep.date <= to) events.push({ date: rep.date, kind: 'report', symbol: s.symbol, name: s.name, estimated: !!rep.estimated,
        open: open.has(s.symbol), near: near.has(s.symbol), days: days(rep.date) });
    });
    const [kpifDates, outcomes, fw] = await Promise.all([nextKpifDates(), macroOutcomes().catch(() => ({})),
      fedWatch().catch(err => { console.error('FedWatch kunde inte räknas:', err.message); return null; })]);
    for (const m of upcomingMacro(from, 40, { kpif: kpifDates })) if (m.date <= to) events.push({ ...m, kind: 'macro', macroKind: m.kind, last: outcomes[m.kind] || null,
      fedwatch: m.kind === 'fomc' ? fw?.meetings.find(x => x.date === m.date) || null : undefined, days: days(m.date) });
    for (const e of live) if (e.exitDate && (e.kind === 'panic' || e.kind === 'crypto') && e.exitDate >= from) events.push({ date: e.exitDate, kind: 'exit', symbol: e.symbol, name: e.name, open: true, days: days(e.exitDate) });
    events.sort((a, b) => a.date.localeCompare(b.date) || (b.open - a.open));
    return { from, to, events, outcomes: OUTCOME_ORDER.map(k => outcomes[k]).filter(Boolean), fedwatch: fw };
  });
}

// Volym över dagen: hur stor del av dagens handel som sker i varje kvart, i
// börsens egen tid, i snitt de senaste 60 handelsdagarna (15-minutersdata från Yahoo).
const VOL_MARKETS = {
  omx: { tz: 'Europe/Stockholm', symbols: ['VOLV-B.ST', 'ERIC-B.ST', 'ATCO-A.ST', 'INVE-B.ST', 'SEB-A.ST', 'HM-B.ST', 'SAND.ST', 'ABB.ST', 'ASSA-B.ST', 'NDA-SE.ST'] },
  us: { tz: 'America/New_York', symbols: ['SPY', 'QQQ'] },
};
let volCache = null;
async function volumeProfile() {
  if (volCache && Date.now() - volCache.at < 12 * 3600 * 1000) return volCache.value;
  const out = {};
  for (const [key, m] of Object.entries(VOL_MARKETS)) {
    const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: m.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const slots = new Map();
    let days = 0;
    for (const sym of m.symbols) {
      try {
        const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=60d&interval=15m`, { headers: { 'User-Agent': 'Mozilla/5.0 (omx-analys)' } })).json();
        const r = j.chart.result[0], v = r.indicators.quote[0].volume;
        const byDay = new Map();
        r.timestamp.forEach((t, i) => {
          if (!v[i]) return;
          const p = Object.fromEntries(fmt.formatToParts(new Date(t * 1000)).map(x => [x.type, x.value]));
          const d = `${p.year}-${p.month}-${p.day}`, slot = `${p.hour}:${p.minute}`;
          if (!byDay.has(d)) byDay.set(d, new Map());
          byDay.get(d).set(slot, (byDay.get(d).get(slot) || 0) + v[i]);
        });
        for (const day of byDay.values()) {
          const tot = [...day.values()].reduce((a, x) => a + x, 0);
          if (tot <= 0 || day.size < 8) continue;
          days++;
          for (const [slot, x] of day) slots.set(slot, (slots.get(slot) || 0) + x / tot);
        }
      } catch (err) { console.error('Volymdata saknas för', sym, err.message); }
    }
    out[key] = { tz: m.tz, days, slots: [...slots].sort((a, b) => a[0].localeCompare(b[0])).map(([t, x]) => ({ t, share: Math.round(x / Math.max(1, days) * 10000) / 100 })) };
  }
  volCache = { at: Date.now(), value: out };
  return out;
}

// Morgonsoffan med Glen: skrivs varje vardag kl 07.30 (GitHub Actions anropar
// /api/cron/morning) och sparas, så att alla ser samma session hela dagen.
const MORNING_KEY = 'omx-analys:morning';
async function makeMorning() {
  const [moves, s, cal, log, macroAt, night] = await Promise.all([marketMoves(), scan(), calendar(), logView(), macro(), overnight().catch(() => null)]);
  const live = log.entries.filter(e => e.state === 'öppen' || e.state === 'väntar på köp');
  const label = { trend: 'trend', support: 'stöd', rsi: 'RSI', macd: 'MACD', score: 'poäng', elliott: 'Elliott', report: 'rapport', macro: 'makro' };
  const omxRows = s.rows.filter(r => !r.isCrypto && !r.isIndex && !r.error);
  const [mk, geo] = await Promise.all([news(MARKET_QUERY, { limit: 8 }).catch(() => []), news(GEO_QUERY, { limit: 30 }).catch(() => [])]);
  return buildMorning({
    now: new Date(), moves, overnight: night, macro: macroAt(today()), calendar: cal, fedwatch: cal.fedwatch, trades: live, panic: s.panic,
    signals: omxRows.filter(r => (r.status === 'strong' || r.status === 'buy') && !r.inTrade),
    near: omxRows.filter(r => !r.inTrade && r.missing?.length === 1).slice(0, 4).map(r => ({ name: r.name, missingText: label[r.missing[0]] || r.missing[0] })),
    news: { market: mk, geo: geo.filter(n => n.tags.includes('Geopolitik')) },
  });
}
// Startar GitHub-jobbet som läser in ljudet direkt när sessionen är skriven, i stället
// för att vänta på GitHubs schema (som kan släpa eller utebli). Kräver GITHUB_DISPATCH_TOKEN
// (finkornig token med Actions: läs och skriv för repot).
async function startAudioJob() {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO || 'EnCodecwtf/omx-analys'}/actions/workflows/morning-audio.yml/dispatches`, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'omx-analys', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (!r.ok) console.error('Ljudjobbet kunde inte startas:', r.status);
    return r.ok;
  } catch (err) { console.error('Ljudjobbet kunde inte startas:', err.message); return false; }
}
async function morning({ publish = false } = {}) {
  const saved = await signalLog.kvGet(MORNING_KEY, null);
  const s = sthlm();
  const due = !s.weekend && s.min >= 7 * 60 + 15;
  // En session utan talmanus (skriven före uppläsningen fanns) skrivs om.
  if ((saved?.latest?.date === s.date && saved.latest.talk) || (!publish && !due)) return saved?.latest || null;
  const m = await makeMorning();
  await signalLog.kvSet(MORNING_KEY, { latest: m, list: [m, ...(saved?.list || []).filter(x => x.date !== m.date)].slice(0, 10) });
  await startAudioJob();
  if (publish) { try { await pushAll({ title: '☕ Morgonsoffan med Glen', body: m.summary || 'Dagens morgonsession är klar.', url: '/#morgon', tag: 'morgon' }); } catch { /* notisen är inte avgörande */ } }
  return m;
}

// AI-tradern väljer (fiktivt) ett av papperen som appen föreslår för signalen, samma
// regler som för köp: säker hävstång, knock-out minst 1 ATR under stoppet, låg spread.
// Valet fryses vid signalen och sparas, så att uppföljningen gäller just det pappret.
const AI_PICKS_KEY = 'omx-analys:ai-picks';
async function ensureAiPicks(entries) {
  let picks;
  try { picks = (await signalLog.kvGet(AI_PICKS_KEY, null)) || {}; } catch { return {}; }
  let changed = false;
  for (const e of entries) {
    const id = signalLog.idOf(e);
    if (e.kind || e.stop == null || picks[id] !== undefined) continue;
    const meta = bySymbol.get(e.symbol);
    if (!meta?.avanzaId) { picks[id] = null; changed = true; continue; }
    try {
      const bars = await fetchBars(e.symbol);
      const t = bars.findIndex(b => dayOf(b.t) === e.date);
      const a = computeIndicators(bars.slice(0, t + 1 || bars.length)).atr.at(-1);
      const r = recommend(await fetchProducts(meta.avanzaId), { plan: { entry: e.close, stop: e.stop, tps: e.tps.map(price => ({ price })) }, atr: a, isIndex: !!meta.isIndex });
      const m = r.minis[0], b = r.bulls[0];
      const late = today() > addTradingDays(e.date, 1);
      picks[id] = m ? { type: 'mini', name: m.name, issuer: m.issuer, url: m.url, financing: m.financing, knockout: m.knockout, spreadPct: m.spreadPct, pickedAt: today(), late }
        : b ? { type: 'bull', name: b.name, issuer: b.issuer, url: b.url, leverage: b.leverage, spreadPct: b.spreadPct, pickedAt: today(), late } : null;
      changed = true;
    } catch (err) { console.error('AI-tradern kunde inte välja papper för', e.symbol, err.message); }
  }
  if (changed) { try { await signalLog.kvSet(AI_PICKS_KEY, picks); } catch (err) { console.error('AI-tradern kunde inte spara val:', err.message); } }
  return picks;
}

// IG-uppgifter som kopplas via appen sparas krypterat (AES-256-GCM) i lagringen.
// Nyckeln härleds från lagringens egen hemlighet, så de syns inte i klartext där.
const IG_KEY = 'omx-analys:ig-creds';
const igCipherKey = () => crypto.createHash('sha256').update('omx-analys-ig:' + (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.VAPID_PRIVATE_KEY || 'lokal')).digest();
function seal(obj) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', igCipherKey(), iv); const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]); return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }; }
function unseal(b) { const d = crypto.createDecipheriv('aes-256-gcm', igCipherKey(), Buffer.from(b.iv, 'base64')); d.setAuthTag(Buffer.from(b.tag, 'base64')); return JSON.parse(Buffer.concat([d.update(Buffer.from(b.data, 'base64')), d.final()]).toString('utf8')); }
let igLoadedAt = 0;
async function loadIgCreds(force = false) {
  if (!force && Date.now() - igLoadedAt < 5 * 60 * 1000) return;
  igLoadedAt = Date.now();
  try { const b = await signalLog.kvGet(IG_KEY, null); configureIg(b?.data ? unseal(b) : null); } catch (err) { console.error('IG-uppgifterna kunde inte läsas:', err.message); }
}

// ---------------------------------------------------------------------------
// Analysera valfri tillgång: sök via Yahoo, analysera med samma metod som signalerna.
const ALIASES = [
  [/^(guld|gold)$/i, 'GC=F', 'Guld'], [/^silver$/i, 'SI=F', 'Silver'], [/^(olja|brent|oil)$/i, 'BZ=F', 'Olja (Brent)'], [/^wti$/i, 'CL=F', 'Olja (WTI)'],
  [/^koppar|copper$/i, 'HG=F', 'Koppar'], [/^(naturgas|gas)$/i, 'NG=F', 'Naturgas'], [/^(bitcoin|btc)$/i, 'BTC-USD', 'Bitcoin'], [/^(ethereum|eth)$/i, 'ETH-USD', 'Ethereum'],
  [/^(omx|omxs30)$/i, '^OMX', 'OMX Stockholm 30'], [/^dax$/i, '^GDAXI', 'DAX'], [/^(s&p|s&p 500|sp500|spx)$/i, '^GSPC', 'S&P 500'], [/^nasdaq$/i, '^IXIC', 'Nasdaq'],
  [/^(platina|platinum)$/i, 'PL=F', 'Platina'], [/^vete|wheat$/i, 'ZW=F', 'Vete'], [/^(kronan|usdsek)$/i, 'SEK=X', 'Dollarn mot kronan'],
];
// Avanzas id för underliggande råvaror (minifutures finns på dem).
const AVANZA_COMMODITY = { 'GC=F': '18986', 'SI=F': '18991', 'BZ=F': '155722', 'CL=F': '155497' };
const freeMeta = new Map();
async function searchAssets(q) {
  const out = [];
  for (const [re, symbol, name] of ALIASES) if (re.test(q.trim())) out.push({ symbol, name, type: 'Råvara/index', exchange: '' });
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`, { headers: { 'User-Agent': 'Mozilla/5.0 (omx-analys)' }, signal: AbortSignal.timeout(10000) });
    const TYPES = { EQUITY: 'Aktie', ETF: 'Fond (ETF)', FUTURE: 'Råvara (termin)', INDEX: 'Index', CRYPTOCURRENCY: 'Krypto', CURRENCY: 'Valuta' };
    for (const x of (await r.json()).quotes || []) if (TYPES[x.quoteType] && !out.some(o => o.symbol === x.symbol))
      out.push({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, type: TYPES[x.quoteType], exchange: x.exchDisp || x.exchange || '' });
  } catch { /* bara alias */ }
  for (const o of out) if (!bySymbol.has(o.symbol)) { const m = freeMeta.get(o.symbol); if (m) { m.name = o.name; m.type = o.type; } else freeMeta.set(o.symbol, { symbol: o.symbol, name: o.name, isFree: true, type: o.type }); }
  return out.slice(0, 10);
}
// Avanzas underliggande (namn → id) för att hitta minifutures på en fri tillgång.
let avanzaUnderlyings = null;
async function avanzaIdFor(meta) {
  if (AVANZA_COMMODITY[meta.symbol]) return AVANZA_COMMODITY[meta.symbol];
  const known = momBySymbol.get(meta.symbol)?.avanzaId;
  if (known) return known;
  try {
    if (!avanzaUnderlyings || Date.now() - avanzaUnderlyings.at > 864e5) {
      const r = await fetch('https://www.avanza.se/_api/market-warrant-filter/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (omx-analys)' },
        body: JSON.stringify({ filter: { directions: [], underlyingInstruments: [], subTypes: ['mini_future'], issuers: [], endDates: [], categories: [], exposures: [] }, offset: 0, limit: 1, sortBy: { field: 'totalValueTraded', order: 'desc' } }), signal: AbortSignal.timeout(10000) });
      avanzaUnderlyings = { at: Date.now(), list: ((await r.json()).filterOptions?.underlyingInstruments || []).map(u => ({ id: u.value, n: normName(u.displayName) })) };
    }
    const n = normName(meta.name);
    const hit = avanzaUnderlyings.list.filter(u => u.n && n && (u.n === n || n.startsWith(u.n + ' ') || u.n.startsWith(n + ' ')));
    return hit.length === 1 ? hit[0].id : null;
  } catch { return null; }
}
const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(inc|corp|corporation|co|ltd|plc|the|holdings?|group|ab|ser|publ|sa|nv|ag|se|class|a|b|c)\b/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Månadens aktier (se lib/monthly.js för reglerna).
const MONTHLY_KEY = 'omx-analys:monthly';

// Månadsstänging (justerad för utdelningar) för de senaste två åren.
async function fetchMonthlyCloses(symbol) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1mo`, { headers: { 'User-Agent': 'Mozilla/5.0 (omx-analys)' }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Yahoo svarade ${res.status} för ${symbol}`);
  const r = (await res.json()).chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`Ingen data för ${symbol}`);
  const adj = r.indicators.adjclose?.[0]?.adjclose || r.indicators.quote[0].close;
  const by = new Map();
  r.timestamp.forEach((t, i) => { if (adj[i] != null) by.set(new Date(t * 1000).toISOString().slice(0, 7), adj[i]); });
  return [...by].map(([m, c]) => ({ m, c }));
}

// Rangordningen för en målmånad. Den ändras inte under månaden och sparas därför.
async function monthlyRanks(target) {
  const key = `${MONTHLY_KEY}:ranks:${target}`;
  const hit = await signalLog.kvGet(key, null).catch(() => null);
  if (hit?.top?.length >= 10) return hit;
  const series = (await mapLimit(momUniverse, 16, async s => { try { return { ...s, monthly: await fetchMonthlyCloses(s.symbol) }; } catch { return null; } })).filter(Boolean);
  const ranked = monthly.rank(series, target);
  const value = { target, computed: new Date().toISOString(), universe: momUniverse.length, fetched: series.length,
    top: ranked.slice(0, 40).map(x => ({ ...x, mom: Math.round(x.mom * 1e4) / 1e4 })) };
  // Sparas bara när underlaget är komplett och den sista månaden i beräkningen är slut.
  const done = monthly.addMonths(target, -2) < monthly.nyNow().date.slice(0, 7);
  if (done && series.length >= momUniverse.length * 0.9) await signalLog.kvSet(key, value).catch(() => {});
  return value;
}

// Beslutet för målmånaden med kurser till och med day (null = senaste).
async function monthlyDecision(target, held, day = null) {
  const r = await monthlyRanks(target);
  const want = [...new Set(['SPY', ...held, ...r.top.slice(0, 12).map(x => x.symbol)])];
  const closes = new Map();
  await mapLimit(want, 6, async s => { try { const b = await fetchBars(s, { range: '2y' }); closes.set(s, (day ? b.filter(x => dayOf(x.t) <= day) : b).map(x => x.c)); } catch { /* saknas */ } });
  const spy = closes.get('SPY');
  if (!spy?.length) throw new Error('Kurser för S&P 500 saknas');
  const d = monthly.decide({ ranked: r.top, held, spy, closes: s => closes.get(s) });
  return { target, ...d, top: r.top.slice(0, 10), rankedAt: r.computed, fetched: r.fetched, universe: r.universe };
}

async function closeOn(symbol, day) {
  try { const b = (await fetchBars(symbol, { range: '1y' })).filter(x => !day || dayOf(x.t) <= day); return b.at(-1)?.c ?? null; } catch { return null; }
}

// Fryser bytet när sista handelsdagen i månaden har stängt. Körs av kvällsjobbet och när fliken öppnas.
async function ensureMonthly() {
  const state = (await signalLog.kvGet(MONTHLY_KEY, null)) || { history: [], pushed: {} };
  state.pushed ||= {};
  const rd = monthly.rebalanceDays();
  const target = monthly.addMonths(rd.last.slice(0, 7), 1);
  if (state.history.some(h => h.month === target)) return state;
  const spyBars = await fetchBars('SPY', { range: '2y' });
  if (!spyBars.some(b => dayOf(b.t) === rd.last)) return state;
  const prev = state.history.at(-1);
  const held = prev && prev.month === monthly.addMonths(target, -1) ? prev.stocks.map(s => s.symbol) : [];
  const d = await monthlyDecision(target, held, rd.last);
  const [gold, oil] = await Promise.all([closeOn(monthly.GOLD.yahoo, rd.last), closeOn(monthly.OIL.yahoo, rd.last)]);
  if (prev && !prev.end) {
    prev.end = { date: rd.last, gold, oil, prices: {} };
    for (const s of prev.stocks) prev.end.prices[s.symbol] = d.stocks.find(x => x.symbol === s.symbol)?.price ?? await closeOn(s.symbol, rd.last);
  }
  state.history.push({
    month: target, decided: rd.last, frozenAt: new Date().toISOString(),
    // Beslut som räknats fram i efterhand (t.ex. startpunkten) märks, de publicerades inte i förväg.
    backfilled: rd.today > monthly.nextNyseDay(rd.last),
    mode: d.mode, cashShare: d.cashShare, spy: d.spy, skipped: d.skipped.map(x => ({ symbol: x.symbol, name: x.name, rank: x.rank, fromHigh: x.fromHigh })),
    stocks: d.stocks.map(s => { const old = prev?.stocks.find(x => x.symbol === s.symbol);
      return { symbol: s.symbol, name: s.name, rank: s.rank, mom: s.mom, fromHigh: s.fromHigh, price: s.price, entry: old?.entry ?? s.price, since: old?.since ?? rd.last, kept: !!old }; }),
    gold, oil, top: d.top.map(x => ({ symbol: x.symbol, name: x.name, mom: x.mom })),
  });
  await signalLog.kvSet(MONTHLY_KEY, state);
  cache.delete('monthly');
  return state;
}

async function monthlyMini(id, target, side) {
  if (!id) return null;
  try { return monthly.rankMinis((await fetchProducts(id, side)).minis, { target, side }); } catch { return []; }
}

async function monthlyView() {
  return cached('monthly', async () => {
    const state = await ensureMonthly();
    const rd = monthly.rebalanceDays();
    const cur = state.history.at(-1) || null;
    const nextTarget = monthly.addMonths(rd.next.slice(0, 7), 1);
    let next;
    try { next = await monthlyDecision(nextTarget, cur?.stocks.map(s => s.symbol) || [], null); } catch (err) { next = { error: err.message }; }
    const L = monthly.RULES;
    // Läget just nu för innehaven.
    const live = { prices: {}, gold: await closeOn(monthly.GOLD.yahoo), oil: await closeOn(monthly.OIL.yahoo) };
    for (const s of cur?.stocks || []) live.prices[s.symbol] = await closeOn(s.symbol);
    const withProduct = async s => ({ ...s, avanzaId: momBySymbol.get(s.symbol)?.avanzaId || null, minis: await monthlyMini(momBySymbol.get(s.symbol)?.avanzaId, L.stockLev, 'long') });
    const current = cur && {
      ...cur,
      stocks: await Promise.all(cur.stocks.map(async s => ({ ...(await withProduct(s)), last: live.prices[s.symbol],
        changePct: live.prices[s.symbol] ? Math.round((live.prices[s.symbol] / s.entry - 1) * 1e4) / 100 : null,
        miniPct: live.prices[s.symbol] ? Math.round((monthly.miniGrowth(s.entry, live.prices[s.symbol], L.stockLev) - 1) * 1e4) / 100 : null }))),
      goldNow: live.gold, oilNow: live.oil,
    };
    if (next && !next.error) next.stocks = await Promise.all(next.stocks.map(withProduct));
    const [goldMini, oilMini] = await Promise.all([monthlyMini(monthly.GOLD.id, L.cashLev, 'long'), monthlyMini(monthly.OIL.id, L.cashLev, 'short')]);
    // Beräknat resultat period för period.
    let idx = 1, idxRaw = 1;
    const periods = state.history.map((h, i) => {
      const end = h.end || (i === state.history.length - 1 ? { date: 'nu', prices: live.prices, gold: live.gold, oil: live.oil } : null);
      const r = monthly.periodReturn(h, end);
      if (r) { idx *= 1 + r.lev; idxRaw *= 1 + r.raw; }
      return { month: h.month, decided: h.decided, to: end?.date ?? null, open: !h.end, backfilled: !!h.backfilled, mode: h.mode,
        names: h.stocks.map(s => s.name), retPct: r ? Math.round(r.lev * 1e4) / 100 : null, rawPct: r ? Math.round(r.raw * 1e4) / 100 : null };
    });
    return { updated: Date.now(), rules: { ...L, minOrder: monthly.MIN_ORDER }, rebalance: rd, current, next, cash: { gold: goldMini, oil: oilMini, goldNow: live.gold, oilNow: live.oil },
      periods, totalPct: Math.round((idx - 1) * 1e4) / 100, totalRawPct: Math.round((idxRaw - 1) * 1e4) / 100,
      changeText: next && !next.error ? monthly.changeText(cur, next) : null };
  });
}

// Påminnelser på bytesdagen: en under eftermiddagen och en strax före stängningen.
async function monthlyNotify(kind) {
  const rd = monthly.rebalanceDays();
  if (!rd.isToday) return null;
  // Slutligt besked från 13.00 i New York (19.00 svensk tid), handel före 22.00 svensk tid.
  if (kind === 'final' && rd.nyMin < 13 * 60) return null;
  const state = await ensureMonthly();
  const nextTarget = monthly.addMonths(rd.next.slice(0, 7), 1);
  const done = state.pushed[nextTarget];
  if (done === 'final' || (kind === 'reminder' && done)) return null;
  const v = await monthlyView();
  if (!v.changeText) return null;
  const title = kind === 'final' ? 'Månadens aktier: dags att byta nu' : 'Månadens aktier: byte ikväll';
  const body = `${v.changeText}\n${kind === 'final' ? 'Handla före 22.00 svensk tid.' : 'Bytet görs strax före stängningen 22.00 svensk tid. Slutligt besked kommer cirka 21.00.'}`;
  const ok = await notifyText(title, body);
  state.pushed[nextTarget] = kind;
  await signalLog.kvSet(MONTHLY_KEY, state);
  return ok ? kind : null;
}

// AI-tradern förvaltar 10 % av sitt konto enligt Månadens aktier. Den handlar bara vid
// månadsskiftet (bytet), men bevakar innehaven varje dag och skriver ner sina överväganden.
// Beslut mitt i månaden har sänkt resultatet i testet, så den säljer inte i förtid.
const AI_MONTHLY_KEY = 'omx-analys:ai-monthly';
const AI_MONTHLY_SHARE = 0.1;
async function aiMonthly(aiStart) {
  const v = await monthlyView();
  const cur = v.current;
  if (!cur) return null;
  let st = await signalLog.kvGet(AI_MONTHLY_KEY, null);
  const now = today();
  const px = (l, day) => closeOn(l.symbol, day);
  const open = async (state, money, day, why) => {
    const legs = monthly.allocate({ stocks: cur.stocks, cashShare: cur.cashShare }, money, { gold: v.cash.gold || [], oil: v.cash.oil || [] });
    const pos = [];
    let cash = money;
    for (const l of legs) {
      if (!l.pick) continue;
      const entry = await px(l, day);
      if (!entry) continue;
      pos.push({ kind: l.kind, symbol: l.symbol, name: l.name, side: l.side, money: Math.round(l.money), entry, lev: l.pick.leverage, paper: l.pick.name, url: l.pick.url, ava: l.pick.ava, stopLoss: l.pick.stopLoss ?? null });
      cash -= l.money;
    }
    const names = pos.map(p => `${p.name} (${p.paper}, ${String(p.lev).replace('.', ',')}x, ${Math.round(p.money).toLocaleString('sv-SE')} kr)`).join(', ');
    return { ...state, month: cur.month, positions: pos, cash: Math.max(0, cash), shadowCash: Math.max(0, cash), log: [{ date: day === null ? now : (day || now), action: 'köper', name: 'Månadens aktier', text: `${why} Köper ${names}.` }, ...(state.log || [])] };
  };
  // Värde med AI:ns egna försäljningar, och "skuggvärdet" om allt hade legat kvar till bytet.
  const valueAt = async (state, day = null) => {
    let val = state.cash || 0, shadow = state.shadowCash ?? state.cash ?? 0;
    const rows = [];
    for (const p of state.positions) {
      const last = await closeOn(p.symbol, day);
      const g = last ? monthly.miniGrowth(p.entry, last, p.lev, p.side) : 1;
      shadow += p.money * g;
      if (p.sold) { rows.push({ ...p, last: p.sold.price, value: 0, pct: p.sold.pct, rawPct: p.sold.rawPct }); continue; }
      rows.push({ ...p, last, value: p.money * g, pct: Math.round((g - 1) * 1000) / 10, rawPct: last ? Math.round((last / p.entry - 1) * 1000) / 10 : null });
      val += p.money * g;
    }
    return { val, shadow, rows };
  };
  let changed = false;
  if (!st) {
    const amount = Math.round(aiStart * AI_MONTHLY_SHARE);
    st = await open({ started: now, amount, log: [] }, amount, null, `Startar med ${amount.toLocaleString('sv-SE')} kr (10 % av kontot) i Månadens aktier, på dagens kurser.`);
    changed = true;
  } else if (st.month !== cur.month) {
    // Månadsbyte: allt säljs på bytesdagens stängning och den nya fördelningen köps.
    const { val, shadow } = await valueAt(st, cur.decided);
    st.edge = (st.edge || 0) + (val - shadow);
    const sold = st.positions.filter(p => !p.sold).map(p => p.name).join(', ');
    st.log = [{ date: cur.decided, action: 'säljer', name: 'Månadens aktier', text: `Månadsbyte. Säljer ${sold || 'inget'}; värdet är ${Math.round(val).toLocaleString('sv-SE')} kr.` }, ...(st.log || [])];
    st = await open(st, val, cur.decided, 'Ny månad enligt reglerna.');
    changed = true;
  }
  // Daglig bevakning. AI:n får sälja när den vill, men bara på kraftiga varningssignaler:
  // i testet sänkte vanliga säljregler mitt i månaden resultatet, medan sällsynta
  // nödbromsar (−30 % på en månad, 35 % från toppen under 50-dagars snitt) låg kvar på samma nivå.
  // Varje beslut jämförs med att bara följa reglerna till bytet (skuggvärdet).
  st.seen ||= {};
  const T = monthly.INTRAMONTH_TEST;
  const think = (key, text, action = 'håller') => { const k = `${cur.month}|${key}`; if (st.seen[k]) return; st.seen[k] = now; st.log.unshift({ date: now, action, name: 'Månadens aktier', text }); changed = true; };
  const sell = (p, last, why) => {
    const g = monthly.miniGrowth(p.entry, last, p.lev, p.side), value = p.money * g;
    p.sold = { date: now, price: last, value, pct: Math.round((g - 1) * 1000) / 10, rawPct: Math.round((last / p.entry - 1) * 1000) / 10, why };
    st.cash = (st.cash || 0) + value;
    st.log.unshift({ date: now, action: 'säljer', name: 'Månadens aktier', text: `Säljer ${p.name} (${p.paper}) för ${Math.round(value).toLocaleString('sv-SE')} kr (${p.sold.pct > 0 ? '+' : ''}${String(p.sold.pct).replace('.', ',')} %). ${why} Pengarna ligger som kontanter till nästa byte.` });
    changed = true;
  };
  let spyBelow = false;
  try { const spy = (await fetchBars('SPY', { range: '2y' })).map(b => b.c); spyBelow = spy.at(-1) < spy.slice(-200).reduce((a, x) => a + x, 0) / 200; } catch { /* hoppas över */ }
  if (spyBelow) think('spy', `S&P 500 har gått under sitt 200-dagars snitt. Jag säljer inte på det: i testet sänkte det resultatet från ${T.none.cagr} % till ${T.spyBelow.cagr} % per år. Jag säljer bara på kraftigare varningar.`);
  for (const p of st.positions) {
    if (p.sold) continue;
    let c;
    try { c = (await fetchBars(p.symbol, { range: '2y' })).map(b => b.c); } catch { continue; }
    const last = c.at(-1), raw = last / p.entry - 1, dir = p.side === 'short' ? -1 : 1;
    const yr = c.slice(-252), fromHigh = last / Math.max(...yr) - 1, sma50 = c.slice(-50).reduce((a, x) => a + x, 0) / 50;
    const pct = Math.round((monthly.miniGrowth(p.entry, last, p.lev, p.side) - 1) * 1000) / 10;
    // Nära pappers knock-out: sälj hellre än att pappret löses ut.
    if (p.stopLoss && dir * (last - p.stopLoss) / last < 0.1) { sell(p, last, `Kursen är mindre än 10 % från pappers knock-out (${p.stopLoss}).`); continue; }
    if (p.kind === 'stock' && raw <= -0.3) { sell(p, last, 'Aktien har fallit mer än 30 % sedan köpet – nödbroms.'); continue; }
    if (p.kind === 'stock' && fromHigh <= -0.35 && last < sma50) { sell(p, last, `Aktien ligger ${Math.round(-fromHigh * 100)} % under årshögsta och under sitt 50-dagars snitt – trenden är bruten.`); continue; }
    if (p.kind === 'oil' && raw >= 0.2) { sell(p, last, `Oljan har stigit ${Math.round(raw * 100)} % sedan köpet – en kort position kan förlora mycket snabbt, så jag stänger.`); continue; }
    if (p.kind === 'gold' && raw <= -0.15) { sell(p, last, 'Guldet har fallit mer än 15 % sedan köpet – nödbroms.'); continue; }
    if (p.kind === 'stock' && fromHigh < -0.25) think(`hi-${p.symbol}`, `${p.name} ligger ${Math.round(-fromHigh * 100)} % under sitt årshögsta. Jag håller: att sälja vid 25 % sänkte resultatet i testet till ${T.fromHigh25.cagr} % per år mot ${T.none.cagr} %. Jag säljer om den når 35 % och går under sitt 50-dagars snitt.`);
    if (pct <= -10) think(`down-${p.symbol}`, `${p.name} är ${String(pct).replace('.', ',')} % i pappret. Jag håller – vanliga stopp gav sämre resultat i testet. Nödbromsen går vid ${p.kind === 'stock' ? '−30 % i aktien' : p.kind === 'gold' ? '−15 % i guldet' : '+20 % i oljan'}.`);
    if (pct >= 20) think(`up-${p.symbol}`, `${p.name} är upp ${String(pct).replace('.', ',')} % i pappret. Jag låter den löpa – några få stora vinnare står för det mesta av avkastningen.`);
  }
  const { val, shadow, rows } = await valueAt(st);
  if (changed) { st.log = st.log.slice(0, 60); await signalLog.kvSet(AI_MONTHLY_KEY, st); }
  const edge = (st.edge || 0) + (val - shadow);
  return { started: st.started, amount: st.amount, value: Math.round(val), pnl: Math.round(val - st.amount), pnlPct: Math.round((val / st.amount - 1) * 1000) / 10,
    month: st.month, next: v.rebalance.next, positions: rows.map(r => ({ ...r, value: Math.round(r.value) })), cash: Math.round(st.cash || 0), log: st.log,
    edge: Math.round(edge), shadowValue: Math.round(val - edge) };
}

// AI-tradern: fiktivt konto som tar alla OMX- och USA-signaler i loggen.
async function aiTrader() {
  return cached('aitrader', async () => {
    const list = await signalLog.entries();
    const picks = await ensureAiPicks(list);
    const bars = new Map(), reports = new Map();
    for (const e of list) if ((!e.kind || e.kind === 'panic') && !bars.has(e.symbol)) {
      try { bars.set(e.symbol, await fetchBars(e.symbol)); } catch { /* hoppas över */ }
      const meta = bySymbol.get(e.symbol);
      if (meta && !meta.isUS && !meta.isIndex) { const r = await nextReport(e.symbol).catch(() => null); reports.set(e.symbol, [...reportDates(e.symbol), ...(r ? [r.date] : [])]); }
    }
    const [macroAt, vix] = await Promise.all([macro(), fetchBars('^VIX').catch(() => [])]);
    const vixAt = new Map(vix.map(b => [dayOf(b.t), b.c]));
    const a = runAiTrader(list, s => bars.get(s), s => reports.get(s) || [], {
      productFor: e => picks[signalLog.idOf(e)] || null, macroFor: d => macroAt(d).score, vixFor: d => vixAt.get(d) ?? 20 });
    // 10 % av kontot ligger i Månadens aktier (tas från kontanterna när delen startar).
    let m = null;
    try { m = await aiMonthly(a.start); } catch (err) { console.error('AI-tradern, Månadens aktier:', err.message); }
    if (m) { a.equity = Math.round((a.equity - m.amount + m.value) * 100) / 100; a.cash = Math.round((a.cash - m.amount) * 100) / 100; a.returnPct = Math.round((a.equity / a.start - 1) * 1e4) / 100; }
    return { updated: Date.now(), ...a, monthly: m };
  });
}

// Experiment som mäts framåt (lib/experiments.js). Loggas i signalloggen som kind 'exp'.
const fomcDays = new Set(JSON.parse(await fs.readFile(path.join(__dirname, 'data', 'fomc.json'), 'utf8')).decisionDays);
async function experimentCheck() {
  const ny = monthly.nyNow(), added = [];
  for (const x of Object.values(EXPERIMENTS)) {
    const isEvent = x.event === 'nfp' ? (new Date(ny.date + 'T12:00:00Z').getUTCDay() === 5 && +ny.date.slice(8) <= 7) : fomcDays.has(ny.date);
    if (!isEvent || ny.min < x.settle + 10) continue;
    const e = experimentSignal(x, await fetchBars(x.symbol), { date: ny.date, nyMin: ny.min, fomc: fomcDays });
    if (!e) continue;
    const rec = await recordFree([e]);
    for (const r of rec) { await notifySignal(r); added.push(r); }
  }
  return added;
}

// Live under dagen: bevakar öppna affärer i signalloggen och skickar notis när
// ett mål eller stoppet nås, påminner om säljdagen för krypto och förvarnar när
// en köpsignal är på väg inför stängningen. Körs var 10–15:e minut av en extern
// schemaläggare (Vercel Hobby tillåter bara en körning per dag).
async function liveCheck({ force = false } = {}) {
  const s = sthlm();
  const open = force || (!s.weekend && s.min >= 9 * 60 && s.min <= 17 * 60 + 40);
  // USA-börsen är öppen cirka 15.30–22.00 svensk tid.
  const usOpen = force || (!s.weekend && s.min >= 15 * 60 + 30 && s.min <= 22 * 60 + 10);
  const sent = [];
  for (const e of await signalLog.entries()) {
    const id = signalLog.idOf(e);
    try {
      if (e.kind === 'panic') {
        // Påminnelse kvällen före säljdagen (efter 17.00) eller på säljdagen.
        const now = sthlm();
        if (now.date >= e.exitDate || (addTradingDays(now.date, 1) === e.exitDate && now.min >= 17 * 60)) for (const k of await signalLog.markAlerts(id, ['exit'])) if (await notifyEvent(e, k)) sent.push(`${e.symbol} ${k}`);
        continue;
      }
      if (e.kind === 'exp') {
        // Experiment: notis vid stopp eller mål, och påminnelse på säljdagen.
        const o = expOutcome(e, await fetchBars(e.symbol));
        const ny = monthly.nyNow();
        const kinds = o.state === 'stängd' && o.why !== 'säljdag' ? [o.why === 'mål' ? 'tp' : 'stop'] : o.state === 'öppen' && ny.date >= e.exitDate ? ['exit'] : [];
        if (o.state === 'stängd' && o.exitDate < new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)) { await signalLog.markAlerts(id, kinds); continue; }
        for (const k of await signalLog.markAlerts(id, kinds)) if (await notifyEvent(e, k, o)) sent.push(`${e.symbol} ${k}`);
        continue;
      }
      if (e.kind === 'crypto') {
        if (today() >= e.exitDate) for (const k of await signalLog.markAlerts(id, ['exit'])) if (await notifyEvent(e, k)) sent.push(`${e.symbol} ${k}`);
        continue;
      }
      if (!(e.market === 'USA' ? usOpen : open)) continue;
      const o = e.kind === 'short' ? shortOutcome(e, await fetchBars(e.symbol)) : signalLog.outcome(e, await fetchBars(e.symbol));
      if (o.state !== 'öppen' && o.state !== 'stängd') continue;
      const kinds = ['tp1', 'tp2', 'tp3'].slice(0, o.hit || 0);
      if (o.state === 'stängd' && o.hit < 3) kinds.push('stop');
      // Affärer som stängdes för flera dagar sedan markeras utan notis.
      if (o.state === 'stängd' && o.exitDate < new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)) { await signalLog.markAlerts(id, kinds); continue; }
      const fresh = await signalLog.markAlerts(id, kinds);
      // Coachen: ett eget meddelande första gången varje mål nås (en tredjedel, nästa mål, hinder).
      const tpCoach = {};
      if (fresh.some(k => /^tp\d$/.test(k))) {
        try {
          const bars = await fetchBars(e.symbol), ev = evaluate(bars.slice(-CHART_BARS));
          const meta = bySymbol.get(e.symbol);
          const rep = meta && !meta.isIndex && !meta.isUS ? await nextReport(e.symbol).catch(() => null) : null;
          const report = rep ? { date: rep.date, days: tradingDaysBetween(today(), rep.date) } : null;
          for (const k of fresh.filter(k => /^tp\d$/.test(k))) tpCoach[k] = coachTp({ ...e, ...o }, +k.slice(2), bars, ev, report);
          await saveTpCoach(e, tpCoach);
        } catch (err) { console.error('Coachen vid mål misslyckades för', e.symbol, err.message); }
      }
      for (const k of fresh) if (await notifyEvent(e, k, { ...o, coach: tpCoach[k] || null })) sent.push(`${e.symbol} ${k}`);
    } catch (err) {
      console.error('Live-kontrollen misslyckades för', e.symbol, err.message);
    }
  }
  // Förvarning 16.30–17.30: köpsignal med kursen just nu, bekräftas vid stängningen.
  if (!s.weekend && s.min >= 16 * 60 + 30 && s.min <= 17 * 60 + 30) {
    cache.delete('scan');
    for (const r of (await scan()).rows.filter(r => r.status === 'strong' && r.preliminary && !r.inTrade)) {
      if (await signalLog.markWarning(`${s.date}|${r.symbol}`) && await notifyEvent({ name: r.name, symbol: r.symbol, close: r.price }, 'warn')) sent.push(`${r.symbol} warn`);
    }
  }
  // Coachens omgång (09.30, 12.30, 15.30, 18.00) skapas här om ingen har öppnat appen.
  if (!s.weekend) { try { await logView(); } catch (err) { console.error('Coachens omgång misslyckades:', err.message); } }
  // Experimenten (NFP-guld, Fed-vändning): signal när stängningskursen är satt i New York.
  try { for (const e of await experimentCheck()) sent.push(`${e.symbol} experiment`); } catch (err) { console.error('Experimenten:', err.message); }
  // Månadens aktier: slutligt besked strax före stängningen på bytesdagen.
  try { for (const kind of ['final', 'reminder']) { const k = await monthlyNotify(kind); if (k) sent.push(`månadens aktier ${k}`); } } catch (err) { console.error('Månadens aktier:', err.message); }
  return { ok: true, marketOpen: open, sent };
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
// Coachens meddelanden sparas som separata meddelanden, ungefär var tredje timme under
// handelsdagen: 09.30, 12.30, 15.30 och efter stängningen 18.00. Ett nytt meddelande
// skapas bara om läget har ändrats sedan förra, och en notis skickas per omgång.
const COACH_KEY = 'omx-analys:coach';
const COACH_SLOTS = [9 * 60 + 30, 12 * 60 + 30, 15 * 60 + 30, 18 * 60];
const slotLabel = m => `${String(Math.floor(m / 60)).padStart(2, '0')}.${String(m % 60).padStart(2, '0')}`;
// Coachens meddelande vid ett nått mål sparas som eget meddelande i samma logg som omgångarna.
async function saveTpCoach(e, byKind) {
  const list = Object.entries(byKind); if (!list.length) return;
  const saved = (await signalLog.kvGet(COACH_KEY, null)) || { messages: [] };
  const s = sthlm(), at = new Date().toISOString(), trade = signalLog.idOf(e);
  const add = list.filter(([k]) => !saved.messages.some(m => m.id === `${trade}|${k}`))
    .map(([k, c]) => ({ id: `${trade}|${k}`, at, slot: k.toUpperCase(), date: s.date, trade, symbol: e.symbol, name: e.name, tone: c.tone, lines: c.lines, tp: +k.slice(2) }));
  if (!add.length) return;
  saved.messages = [...add.reverse(), ...saved.messages].slice(0, 300);
  await signalLog.kvSet(COACH_KEY, saved);
}
async function coachRound(entries) {
  let saved;
  try { saved = (await signalLog.kvGet(COACH_KEY, null)) || { messages: [] }; } catch { return { messages: [] }; }
  const s = sthlm();
  const slot = s.weekend ? null : [...COACH_SLOTS].reverse().find(m => s.min >= m);
  if (slot == null) return saved;
  const slotId = `${s.date}|${String(slot).padStart(4, '0')}`;
  if ((saved.lastSlot || '') >= slotId) return saved;
  const at = new Date().toISOString(), added = [];
  for (const e of entries) {
    if (!e.coach?.lines?.length || (e.state !== 'öppen' && e.state !== 'väntar på köp')) continue;
    const trade = signalLog.idOf(e);
    const prev = saved.messages.find(m => m.trade === trade);
    if (prev && prev.lines.join('|') === e.coach.lines.join('|')) continue;
    added.push({ id: `${slotId}|${trade}`, at, slot: slotLabel(slot), date: s.date, trade, symbol: e.symbol, name: e.name, tone: e.coach.tone, lines: e.coach.lines });
  }
  saved = { lastSlot: slotId, messages: [...added, ...saved.messages].slice(0, 300) };
  try { await signalLog.kvSet(COACH_KEY, saved); } catch (err) { console.error('Coachens meddelanden kunde inte sparas:', err.message); return saved; }
  if (added.length) {
    try { await pushAll({ title: `🧭 Coachen ${slotLabel(slot)}`, body: added.map(m => m.lines[0]).join('\n').slice(0, 400), url: '/#affarer', tag: 'coach' }); } catch { /* notisen är inte avgörande */ }
  }
  return saved;
}

async function logView() {
  const out = await withOutcomes();
  // Coachens kommentarer för öppna affärer, byggda på riktiga data.
  for (const e of out) {
    if (e.state !== 'öppen' && e.state !== 'väntar på köp') continue;
    try {
      const bars = await fetchBars(e.symbol);
      const meta = bySymbol.get(e.symbol);
      const rep = meta && !meta.isIndex && !meta.isUS && !meta.isCrypto ? await nextReport(e.symbol).catch(() => null) : null;
      e.coach = coachTrade(e, bars, evaluate(bars.slice(-CHART_BARS)), rep ? { date: rep.date, days: tradingDaysBetween(today(), rep.date) } : null);
    } catch (err) { console.error('Coachen kunde inte räkna', e.symbol, err.message); }
  }
  // Mål som nåtts men saknar coachens mål-meddelande (t.ex. nådda innan funktionen fanns) får det en gång.
  for (const e of out) {
    if (e.state !== 'öppen' || !e.hit || e.kind || !e.tps) continue;
    try {
      const saved = (await signalLog.kvGet(COACH_KEY, null)) || { messages: [] }, trade = signalLog.idOf(e);
      const missing = [1, 2, 3].filter(k => k <= e.hit && !saved.messages.some(m => m.id === `${trade}|tp${k}`));
      if (!missing.length) continue;
      const bars = await fetchBars(e.symbol), ev = evaluate(bars.slice(-CHART_BARS));
      const meta = bySymbol.get(e.symbol);
      const rep = meta && !meta.isIndex && !meta.isUS ? await nextReport(e.symbol).catch(() => null) : null;
      const report = rep ? { date: rep.date, days: tradingDaysBetween(today(), rep.date) } : null;
      // Bara det senaste nådda målet beskriver läget nu; tidigare mål får en kort rad.
      const by = {};
      for (const k of missing) by[`tp${k}`] = k === e.hit ? coachTp(e, k, bars, ev, report) : { tone: 'good', lines: [`🎯 TP${k} nåddes tidigare på ${e.name} (${e.tps[k - 1]}). En tredjedel skulle säljas där.`] };
      await saveTpCoach(e, by);
    } catch (err) { console.error('Coachen (mål i efterhand) misslyckades för', e.symbol, err.message); }
  }
  const coachLog = await coachRound(out);
  for (const e of out) {
    if (e.state !== 'öppen' && e.state !== 'väntar på köp') continue;
    e.coachLog = coachLog.messages.filter(m => m.trade === signalLog.idOf(e)).slice(0, 12);
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  // R gäller OMX-signalerna. Kryptosignalerna räknas i procent för sig.
  const closed = out.filter(x => x.state === 'stängd' && !x.kind);
  const cClosed = out.filter(x => x.state === 'stängd' && x.kind === 'crypto');
  const pClosed = out.filter(x => x.state === 'stängd' && x.kind === 'panic');
  const sClosed = out.filter(x => x.state === 'stängd' && x.kind === 'short');
  const current = equityStats(closed.slice().sort((a, b) => a.date.localeCompare(b.date)).map(x => x.r));
  const pct = k => closed.length ? Math.round(1000 * closed.filter(x => x.hit >= k).length / closed.length) / 10 : null;
  return {
    entries: out,
    stats: { n: out.length, closed: closed.length, current, open: out.filter(x => x.state === 'öppen').length, tp1Rate: pct(1), tp2Rate: pct(2),
      avgR: closed.length ? Math.round(100 * closed.reduce((s, x) => s + x.r, 0) / closed.length) / 100 : null,
      crypto: { closed: cClosed.length, avgPct: cClosed.length ? Math.round(100 * cClosed.reduce((s, x) => s + x.pct, 0) / cClosed.length) / 100 : null },
      short: { closed: sClosed.length, wins: sClosed.filter(x => x.r > 0).length, tp1Rate: sClosed.length ? Math.round(1000 * sClosed.filter(x => x.hit >= 1).length / sClosed.length) / 10 : null,
        avgR: sClosed.length ? Math.round(100 * sClosed.reduce((s, x) => s + x.r, 0) / sClosed.length) / 100 : null },
      panic: { closed: pClosed.length, avgPct: pClosed.length ? Math.round(100 * pClosed.reduce((s, x) => s + x.pct, 0) / pClosed.length) / 100 : null } },
  };
}

async function analysis(symbol) {
  return cached(`a:${symbol}`, async () => {
    const meta = bySymbol.get(symbol) || freeMeta.get(symbol);
    if (meta.isCrypto) return cryptoAnalysis(meta);
    const all = await fetchBars(symbol);
    const bars = all.slice(-CHART_BARS);
    let ev = applyGuards(evaluate(bars), await guards(meta));
    if (meta.isUS) ev = await usProducts(ev, meta);
    const ind = computeIndicators(all);
    const off = all.length - bars.length;
    const pick = arr => arr.slice(off).map(v => (v == null ? null : Math.round(v * 100) / 100));
    const bt = await backtestFor(meta, all);
    const [it] = await markInTrade([{ symbol, t: bars[bars.length - 1].t }], () => (meta.isCrypto ? 'crypto' : undefined));
    // Öppen affär: planen visar de frysta nivåerna från signalen, inte dagens beräkning.
    if (it.inTrade?.tps) {
      const e = it.inTrade, entry = e.entry ?? e.close, R = entry - e.stop, rd = x => Math.round(x * 100) / 100;
      ev.warnings.unshift(`Öppen affär från signalen ${e.date}. Stopp och mål är frysta från den signalen. Ingen ny signal: en affär i taget per aktie.`);
      ev.plan = { ...ev.plan, entry, stop: e.hit >= 2 ? entry : e.stop, riskPct: e.hit >= 2 ? 0 : rd((entry - e.stop) / entry * 100), frozen: e.date, hit: e.hit,
        tps: e.tps.map((p, k) => ({ price: p, r: rd((p - entry) / R), why: [k < e.hit ? 'Nådd' : `Fryst från signalen ${e.date}`] })) };
    }
    if (meta.isFree) meta.avanzaId ??= await avanzaIdFor(meta);
    return {
      inTrade: it.inTrade || null,
      // Riktning och MA 44/332 visas för alla; tested = aktien ingår i appens testade listor.
      free: { ...freeView(ev, all), tested: !meta.isFree, type: meta.type || null, hasProducts: !!meta.avanzaId },
      symbol, name: meta.name, isIndex: !!meta.isIndex, isUS: !!meta.isUS, avanzaUrl: avanzaUrl(meta), preliminary: !(meta.isUS ? isFinalUS : isFinal)(bars[bars.length - 1].t),
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

// JSON-kroppen i en POST. På Vercel kan den redan vara inläst (req.body).
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e5) throw new Error('För stor'); }
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Uppdatera-knappen får tömma cachen högst varannan minut, så att ingen kan
// tvinga fram en ström av anrop mot Yahoo och Avanza.
let lastRefresh = 0;
const mayRefresh = () => { if (Date.now() - lastRefresh < 120000) return false; lastRefresh = Date.now(); return true; };

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  // Vercel skickar alla sökvägar till /api och lägger den riktiga i __path.
  if (url.searchParams.has('__path')) {
    url.pathname = url.searchParams.get('__path');
    url.searchParams.delete('__path');
  }
  try {
    await loadIgCreds();
    // Schemalagda körningar skriver i loggen och skickar notiser. När CRON_SECRET
    // är satt krävs den (Vercel Cron skickar den som Bearer, GitHub som ?key=).
    if (url.pathname.startsWith('/api/cron/')) {
      const secret = process.env.CRON_SECRET;
      if (secret && url.searchParams.get('key') !== secret && req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: 'Fel nyckel' });
    }
    if (url.pathname === '/api/scan') {
      if (url.searchParams.has('refresh') && mayRefresh()) cache.clear();
      return send(res, 200, await scan());
    }
    // Anropas av Vercel Cron varje kväll (krypto handlas även på helger): sparar
    // nya starka köpsignaler i signalloggen och skickar avisering.
    if (url.pathname === '/api/cron/scan') {
      cache.delete('scan');
      const before = (await signalLog.entries().catch(() => [])).length;
      const s = await scan();
      const after = (await signalLog.entries().catch(() => [])).length;
      // Dagens sista kontroll av mål och stopp, även om ingen extern schemaläggare används.
      const live = await liveCheck({ force: true });
      return send(res, 200, { ok: true, signals: s.rows.filter(r => r.status === 'strong').map(r => r.symbol), logged: after - before, alerts: live.sent });
    }
    if (url.pathname === '/api/cron/live') {
      return send(res, 200, await liveCheck());
    }
    // Webbnotiser: publik nyckel, prenumeration och testnotis till den egna enheten.
    if (url.pathname === '/api/push/key') return send(res, 200, { key: (await vapidKeys()).publicKey });
    if (url.pathname === '/api/push/subscribe' && req.method === 'POST') return send(res, 200, { ok: true, count: await subscribe(await readJson(req)) });
    if (url.pathname === '/api/push/unsubscribe' && req.method === 'POST') { await unsubscribe((await readJson(req)).endpoint); return send(res, 200, { ok: true }); }
    if (url.pathname === '/api/push/test' && req.method === 'POST') {
      const { endpoint } = await readJson(req);
      const n = await pushAll({ title: 'OMX Analys', body: 'Notiserna fungerar. Du får besked om köpsignaler, mål, stopp och säljdagar.', url: '/' }, { only: endpoint });
      return send(res, 200, { ok: n > 0 });
    }
    if (url.pathname === '/api/us/scan') {
      if (url.searchParams.has('refresh') && mayRefresh()) { cache.delete('usscan'); cache.delete('usmacro'); }
      return send(res, 200, await usScan());
    }
    // Kvällskörning efter USA-börsens stängning: sparar nya USA-signaler och kontrollerar mål och stopp.
    if (url.pathname === '/api/cron/us') {
      cache.delete('usscan'); cache.delete('usmacro');
      const s = await usScan();
      const live = await liveCheck({ force: true });
      await ensureMonthly().catch(err => console.error('Månadens aktier:', err.message));
      return send(res, 200, { ok: true, signals: s.rows.filter(r => r.status === 'strong').map(r => r.symbol), alerts: live.sent });
    }
    // Egen kvällskörning för blankningsanalytikern (hämtar mycket data per bolag).
    if (url.pathname === '/api/cron/shorts') {
      cache.delete('shorts');
      const s = await shortScan();
      return send(res, 200, { ok: true, candidates: s.rows.filter(r => r.status === 'short').map(r => r.symbol) });
    }
    if (url.pathname === '/api/shorts') {
      if (url.searchParams.has('refresh') && mayRefresh()) cache.delete('shorts');
      return send(res, 200, await shortScan());
    }
    // Månadsrapport: alla signaler i månaden, ärligt räknat. ?month=ÅÅÅÅ-MM (standard: innevarande).
    if (url.pathname === '/api/report') {
      const out = await withOutcomes();
      // Månader med avslutade affärer (rapporten räknar efter säljdatum).
      const months = [...new Set(out.filter(e => e.exitDate && e.state !== 'öppen' && e.state !== 'väntar på köp').map(e => e.exitDate.slice(0, 7)))].sort().reverse();
      const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : today().slice(0, 7);
      const [ai, omx, mv] = await Promise.all([aiTrader().catch(() => null), fetchBars('^OMX').catch(() => []), monthlyView().catch(() => null)]);
      // Månadens aktier: perioden för rapportens månad (beslutad vid förra månadsskiftet) och AI-traderns del.
      const per = mv?.periods.find(p => p.month === month) || null;
      const monthlyPart = per ? { ...per, rules: mv.rules, aiPart: ai?.monthly && ai.monthly.month === month ? { value: ai.monthly.value, amount: ai.monthly.amount, pnlPct: ai.monthly.pnlPct, edge: ai.monthly.edge } : null } : null;
      return send(res, 200, { months: months.includes(today().slice(0, 7)) ? months : [today().slice(0, 7), ...months], ...buildReport({ month, entries: out, ai, omx }), monthly: monthlyPart });
    }
    // Det som publicerades (frysta nivåer och tid), för ögonblicksbilderna på GitHub.
    if (url.pathname === '/api/log-frozen') {
      const list = await signalLog.entries();
      const frozen = list.map(e => ({ date: e.date, symbol: e.symbol, name: e.name, kind: e.kind || null, market: e.market || null, close: e.close, stop: e.stop ?? null, tps: e.tps ?? null, exitDate: e.kind ? e.exitDate ?? null : null, loggedAt: e.loggedAt ?? null }));
      const months = {};
      for (const m of new Set(list.map(e => e.date.slice(0, 7)))) months[m] = frozenHash(list.filter(e => e.date.startsWith(m)));
      return send(res, 200, { generated: new Date().toISOString(), count: frozen.length, monthHashes: months, entries: frozen });
    }
    if (url.pathname === '/api/ai-trader') return send(res, 200, await aiTrader());
    if (url.pathname === '/api/monthly') {
      if (url.searchParams.has('refresh') && mayRefresh()) cache.delete('monthly');
      return send(res, 200, await monthlyView());
    }
    // Körs två gånger per vardag av Vercel (cirka 15–16 och 20–21 svensk tid): räknar fram nästa
    // månads rangordning och skickar påminnelsen och det slutliga beskedet på bytesdagen.
    if (url.pathname === '/api/cron/monthly') {
      await ensureMonthly();
      const rd = monthly.rebalanceDays();
      await monthlyRanks(monthly.addMonths(rd.next.slice(0, 7), 1));
      const sent = [await monthlyNotify('final'), await monthlyNotify('reminder')].filter(Boolean);
      return send(res, 200, { ok: true, rebalance: rd, sent });
    }
    if (url.pathname === '/api/overnight') return send(res, 200, await overnight());
    if (url.pathname === '/api/morning') return send(res, 200, { morning: await morning() });
    // Ljudfilen från GitHub-jobbet: sparas på dagens session.
    if (url.pathname === '/api/cron/morning-audio' && req.method === 'POST') {
      const a = await readJson(req);
      if (!/^morgon-\d{4}-\d{2}-\d{2}\.mp3$/.test(a.file || '') || !Array.isArray(a.offsets)) return send(res, 400, { error: 'Ogiltig ljudfil' });
      const saved = await signalLog.kvGet(MORNING_KEY, null);
      if (!saved?.latest || saved.latest.date !== a.date) return send(res, 409, { error: 'Ingen session för det datumet' });
      saved.latest.audio = { date: a.date, url: `/api/morning-audio/${a.file}`, offsets: a.offsets.map(Number), duration: +a.duration || null, voice: String(a.voice || '').slice(0, 60) };
      saved.list = (saved.list || []).map(x => (x.date === a.date ? saved.latest : x));
      await signalLog.kvSet(MORNING_KEY, saved);
      return send(res, 200, { ok: true });
    }
    // Spelar upp ljudfilen via appen (rätt filtyp och stöd för spolning, som Safari kräver).
    const audioMatch = url.pathname.match(/^\/api\/morning-audio\/(morgon-\d{4}-\d{2}-\d{2}\.mp3)$/);
    if (audioMatch) {
      const r = await fetch(`https://github.com/${process.env.GITHUB_REPO || 'EnCodecwtf/omx-analys'}/releases/download/morgon-ljud/${audioMatch[1]}`,
        { headers: req.headers.range ? { Range: req.headers.range } : {}, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (!r.ok) return send(res, r.status === 404 ? 404 : 502, { error: 'Ljudet finns inte' });
      const headers = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
      for (const h of ['content-length', 'content-range']) if (r.headers.get(h)) headers[h.replace(/(^|-)./g, x => x.toUpperCase())] = r.headers.get(h);
      res.writeHead(r.status, headers);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (url.pathname === '/api/cron/morning') {
      const s = sthlm();
      // Schemat körs två gånger (sommar- och vintertid); bara den som träffar 07.15–09.00 publicerar.
      if (s.weekend || s.min < 7 * 60 + 15 || s.min > 9 * 60) return send(res, 200, { ok: true, skipped: 'utanför 07.15–09.00' });
      const m = await morning({ publish: true });
      return send(res, 200, { ok: true, date: m?.date });
    }
    if (url.pathname === '/api/volume-profile') return send(res, 200, await volumeProfile());
    if (url.pathname === '/api/calendar') return send(res, 200, await calendar());
    // Affärerna från tioårstestet (R per affär), för kalkylatorn ränta på ränta.
    if (url.pathname === '/api/trades10y') return send(res, 200, JSON.parse(await fs.readFile(path.join(__dirname, 'data', 'trades-10y.json'), 'utf8')));
    if (url.pathname === '/api/summary') return send(res, 200, await summary());
    if (url.pathname === '/api/news') {
      const meta = bySymbol.get(url.searchParams.get('symbol')) || freeMeta.get(url.searchParams.get('symbol'));
      if (meta && !meta.isIndex) return send(res, 200, { items: await news(meta.newsQuery || companyQuery(meta.name)) });
      const [market, geo] = await Promise.all([news(MARKET_QUERY, { limit: 8 }), news(GEO_QUERY, { limit: 30 })]);
      const perSource = {};
      const geoItems = geo.filter(n => n.tags.includes('Geopolitik') && (perSource[n.source] = (perSource[n.source] || 0) + 1) <= 2);
      return send(res, 200, { market, geo: geoItems.slice(0, 8) });
    }
    if (url.pathname === '/api/log') return send(res, 200, await logView());
    if (url.pathname === '/api/macro') return send(res, 200, (await macro())(today()));
    if (url.pathname === '/api/products') {
      const meta = bySymbol.get(url.searchParams.get('symbol')) || freeMeta.get(url.searchParams.get('symbol'));
      if (meta?.isFree) meta.avanzaId ??= await avanzaIdFor(meta);
      if (!meta?.avanzaId) return send(res, 404, { error: 'Inga hävstångspapper hittades' });
      const bars = await fetchBars(meta.symbol);
      const ev = applyGuards(evaluate(bars.slice(-CHART_BARS)), await guards(meta));
      if (meta.isUS) await usProducts(ev, meta);
      // Fri tillgång i nedtrend: papper för en kort position (minifutures kort / bear).
      if (meta.isFree) {
        const f = freeView(ev, bars);
        if (f.direction.side === 'short') {
          const products = await fetchProducts(meta.avanzaId, 'short');
          return send(res, 200, { status: ev.status, side: 'short', stop: f.shortPlan.stop, size: 1, updated: products.at,
            ...recommend(products, { plan: f.shortPlan, atr: ev.atr, isIndex: false, side: 'short' }) });
        }
      }
      const products = await fetchProducts(meta.avanzaId);
      return send(res, 200, { status: ev.status, stop: ev.plan.stop, size: ev.guards.size, updated: products.at, ...recommend(products, { plan: ev.plan, atr: ev.atr, isIndex: !!meta.isIndex }) });
    }
    // Status för IG-kopplingen (realtid). Visar inga hemligheter.
    if (url.pathname === '/api/ig/status') return send(res, 200, await igStatus());
    // Koppla IG från appen: uppgifterna provas först, sparas krypterat och visas aldrig igen.
    // Är IG redan kopplat krävs nuvarande lösenord för att byta eller koppla bort.
    if ((url.pathname === '/api/ig/connect' || url.pathname === '/api/ig/disconnect') && req.method === 'POST') {
      const b = await readJson(req);
      const saved = await signalLog.kvGet(IG_KEY, null);
      if (saved?.data) { let old; try { old = unseal(saved); } catch { old = null; } if (old && b.currentPassword !== old.password) return send(res, 403, { error: 'Fel nuvarande lösenord för det kopplade IG-kontot.' }); }
      if (url.pathname === '/api/ig/disconnect') { await signalLog.kvSet(IG_KEY, null); configureIg(null); return send(res, 200, { ok: true }); }
      const c = { apiKey: String(b.apiKey || '').trim(), identifier: String(b.identifier || '').trim(), password: String(b.password || ''), env: b.env === 'live' ? 'live' : 'demo' };
      if (!c.apiKey || !c.identifier || !c.password) return send(res, 400, { error: 'Fyll i API-nyckel, användarnamn och lösenord.' });
      try { await igTryLogin(c); } catch (err) { return send(res, 400, { error: err.message }); }
      await signalLog.kvSet(IG_KEY, seal(c));
      configureIg(c); igLoadedAt = Date.now();
      return send(res, 200, { ok: true, status: await igStatus() });
    }
    if (url.pathname === '/api/search') {
      const q = (url.searchParams.get('q') || '').slice(0, 60);
      return send(res, 200, { results: q.trim().length >= 2 ? await searchAssets(q) : [] });
    }
    if (url.pathname === '/api/analysis') {
      const symbol = url.searchParams.get('symbol');
      // Fria tillgångar (från sökningen): kontrollera att kursdata finns.
      if (!bySymbol.has(symbol) && !freeMeta.has(symbol)) {
        if (!/^[\w.^=-]{1,20}$/.test(symbol || '')) return send(res, 404, { error: 'Okänd symbol' });
        freeMeta.set(symbol, { symbol, name: url.searchParams.get('name')?.slice(0, 80) || symbol, isFree: true });
      } else if (freeMeta.has(symbol) && url.searchParams.get('name')) freeMeta.get(symbol).name = url.searchParams.get('name').slice(0, 80);
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
