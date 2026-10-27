// AI-analytiker för blankning. Väger ihop det en analytiker tittar på:
//   1. Analytikerna: vinstprognoser nu mot för 90 dagar sedan, höjningar och
//      sänkningar senaste 30 dagarna, utfall mot förväntan, kurs mot riktkurs.
//   2. Nyckeltal: försäljnings- och vinsttillväxt, skuld och kassaflöde.
//   3. Blankningsregistret (FI): total blankning och förändring på 4 veckor.
//   4. Nyheter: negativa och positiva rubriker senaste 14 dagarna.
//   5. Teknik: nedtrend och en studs uppåt som vänder ned (inte översåld).
// En blankningskandidat kräver att alla krav i kravlistan är uppfyllda.
//
// Det här går inte att backtesta: historiska prognoser och nyckeltal finns inte
// gratis, och de tekniska blankningsreglerna ensamma förlorade i alla test
// (se README). Varje kandidat sparas därför med frysta nivåer i signalloggen
// så att träffsäkerheten mäts framåt.

import { yahooSession } from './events.js';
import { readOds } from './ods.js';
import { news, companyQuery } from './news.js';
import { ema, rsi, atr } from './indicators.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const day = t => new Date(t * 1000).toISOString().slice(0, 10);
const round = (x, d = 2) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export const SHORT_MIN_SCORE = 55;
export const SHORT_MIN_ANALYST = 20;
export const SHORT_SIZE = 0.5; // halv risk jämfört med köpsignalerna, eftersom metoden inte är testad

// Namnet hos Finansinspektionen för OMXS30-bolagen (blankningsregistret).
const FI_NAMES = {
  'ABB.ST': /^ABB/, 'ADDT-B.ST': /ADDTECH/, 'ALFA.ST': /ALFA LAVAL/, 'ASSA-B.ST': /ASSA ABLOY/, 'AZN.ST': /ASTRAZENECA/,
  'ATCO-A.ST': /ATLAS COPCO/, 'BOL.ST': /BOLIDEN/, 'EPI-A.ST': /EPIROC/, 'EQT.ST': /^EQT AB/, 'ERIC-B.ST': /ERICSSON/,
  'ESSITY-B.ST': /ESSITY/, 'EVO.ST': /^EVOLUTION AB/, 'HM-B.ST': /HENNES/, 'HEXA-B.ST': /^HEXAGON/, 'INDU-C.ST': /INDUSTRIVÄRDEN/,
  'INVE-B.ST': /^INVESTOR/, 'LIFCO-B.ST': /LIFCO/, 'NIBE-B.ST': /NIBE INDUSTRIER/, 'NDA-SE.ST': /NORDEA BANK/, 'SAAB-B.ST': /^SAAB/,
  'SAND.ST': /SANDVIK/, 'SCA-B.ST': /SVENSKA CELLULOSA/, 'SEB-A.ST': /SKANDINAVISKA ENSKILDA/, 'SHB-A.ST': /HANDELSBANKEN/,
  'SKA-B.ST': /SKANSKA/, 'SKF-B.ST': /\bSKF\b/, 'SWED-A.ST': /SWEDBANK/, 'TEL2-B.ST': /TELE2/, 'TELIA.ST': /TELIA/, 'VOLV-B.ST': /^AKTIEBOLAGET VOLVO|^AB VOLVO/,
};
const normName = s => s.replace(/ /g, ' ').trim().toUpperCase();

// 1–2. Analytiker och nyckeltal från Yahoo Finance.
export async function fundamentals(symbol) {
  const s = await yahooSession();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,earningsTrend,earningsHistory&crumb=${encodeURIComponent(s.crumb)}`;
  const j = await (await fetch(url, { headers: { 'User-Agent': UA, Cookie: s.cookie } })).json();
  const r = j.quoteSummary?.result?.[0];
  if (!r) throw new Error('Inga nyckeltal');
  const fd = r.financialData || {}, v = k => fd[k]?.raw ?? null;
  const trend = (r.earningsTrend?.trend || []).filter(t => t.period === '0y' || t.period === '+1y');
  const eps = trend.map(t => ({ now: t.epsTrend?.current?.raw, ago: t.epsTrend?.['90daysAgo']?.raw, up: t.epsRevisions?.upLast30days?.raw ?? 0, down: t.epsRevisions?.downLast30days?.raw ?? 0 }));
  const chg = eps.filter(e => e.now && e.ago).map(e => (e.now - e.ago) / Math.abs(e.ago));
  return {
    epsChange90: chg.length ? chg.reduce((a, x) => a + x, 0) / chg.length : null,
    revUp: eps.reduce((a, e) => a + e.up, 0), revDown: eps.reduce((a, e) => a + e.down, 0),
    surprises: (r.earningsHistory?.history || []).map(h => h.surprisePercent?.raw).filter(x => x != null),
    price: v('currentPrice'), target: v('targetMeanPrice'), recMean: v('recommendationMean'), analysts: v('numberOfAnalystOpinions'),
    revenueGrowth: v('revenueGrowth'), earningsGrowth: v('earningsGrowth'), debtToEquity: v('debtToEquity'), fcf: v('freeCashflow'),
  };
}

// 3. Blankningsregistret: total blankning per bolag nu och för 4 veckor sedan.
let fiCache = null;
async function getOds(path) {
  const res = await fetch(`https://www.fi.se/BlankningsRegister/${path}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`FI svarade ${res.status}`);
  return readOds(Buffer.from(await res.arrayBuffer()));
}
export async function shortRegister() {
  if (fiCache && Date.now() - fiCache.at < 12 * 3600 * 1000) return fiCache.value;
  const [agg, hist, akt] = await Promise.all([getOds('GetBlankningsregisterAggregat'), getOds('GetHistFile'), getOds('GetAktuellFile')]);
  const now = new Map(agg.slice(4).filter(r => r.length >= 3).map(r => [normName(r[0]), parseFloat(String(r[2]).replace(',', '.'))]));
  // Positioner över 0,5 % per innehavare, för att räkna förändringen på 4 veckor.
  const cut = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
  const ev = [...hist.slice(4), ...akt.slice(4)].filter(r => r.length >= 5).map(r => ({ h: normName(r[0]), i: normName(r[1]), p: /^</.test(r[3]) ? 0 : parseFloat(String(r[3]).replace(',', '.')), d: String(r[4]).slice(0, 10) }))
    .sort((a, b) => a.d.localeCompare(b.d));
  const sumAt = (issuer, until) => { const m = new Map(); for (const e of ev) { if (e.d > until) break; if (e.i === issuer) m.set(e.h, e.p); } return [...m.values()].reduce((a, x) => a + x, 0); };
  const value = { now, sumAt, issuers: [...new Set(ev.map(e => e.i))], cut };
  fiCache = { at: Date.now(), value };
  return value;
}
export function shortFor(reg, symbol) {
  const re = FI_NAMES[symbol]; if (!re || !reg) return null;
  const name = [...reg.now.keys()].find(n => re.test(n));
  const issuer = reg.issuers.find(n => re.test(n));
  const today = new Date().toISOString().slice(0, 10);
  return { pct: name ? reg.now.get(name) : 0, change4w: issuer ? round(reg.sumAt(issuer, today) - reg.sumAt(issuer, reg.cut)) : 0 };
}

// 4. Nyheter: negativa och positiva rubriker senaste 14 dagarna.
const NEG = /\b(vinstvarn\w*|sänk\w*|nedgrader\w*|säljråd|säljrekommendation\w*|förlust\w*|tapp\w*|rasar|rasade|faller|föll|varsel|varslar|nyemission\w*|utredning\w*|misstänk\w*|svag\w*|miss\w*|under förväntan\w*|ras\b|kris\w*|nedskrivning\w*|stämning\w*)\b/i;
const POS = /\b(höj\w*|uppgrader\w*|köpråd|köprekommendation\w*|rekord\w*|starkare|stark\b|över förväntan\w*|stiger|steg|rusar|bud\b|vinstlyft)\b/i;
export async function newsFor(name, newsQuery) {
  const items = await news(newsQuery || companyQuery(name), { limit: 20 });
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  // Bara rubriker som nämner bolaget, så att träffar om andra bolag inte räknas.
  const base = name.replace(/\s+[ABC]$/, '').split(' ')[0].toLowerCase();
  const recent = items.filter(n => n.date >= since && n.title.toLowerCase().includes(base) && !new RegExp(`${base}-konkurrent`, 'i').test(n.title));
  return { neg: recent.filter(n => NEG.test(n.title) && !POS.test(n.title)), pos: recent.filter(n => POS.test(n.title) && !NEG.test(n.title)), total: recent.length };
}

// 5. Teknik: nedtrend, studs upp mot EMA 20 eller EMA 50 som vänder ned, inte översåld.
export function technical(bars) {
  const c = bars.map(b => b.c), n = c.length - 1;
  const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200), r = rsi(c, 14), a = atr(bars, 14);
  const price = c[n], A = a[n] ?? (bars[n].h - bars[n].l);
  const down = e200[n] != null && price < e200[n] && e50[n] < e200[n];
  const last3 = bars.slice(-3);
  const touched = last3.some((b, k) => { const i = n - 2 + k; return b.h >= Math.min(e20[i], e50[i]) - 0.1 * a[i]; });
  const rejection = touched && price < e20[n] && price < bars[n - 1].c;
  const notOversold = r[n] > 40;
  const fading = r[n] < r[n - 1] && r[n] >= 40 && r[n] <= 65;
  let stop = Math.max(...bars.slice(-5).map(b => b.h), e20[n]) + 0.25 * A;
  if (stop - price < A) stop = price + A;
  if (stop - price > 4 * A) stop = price + 4 * A;
  const R = stop - price;
  return {
    price: round(price), atr: round(A), rsi: round(r[n], 1), ema20: round(e20[n]), ema50: round(e50[n]), ema200: round(e200[n]),
    down, rejection, notOversold, fading, date: day(bars[n].t),
    plan: { entry: round(price), stop: round(stop), riskPct: round(R / price * 100), tps: [1, 2, 3].map(k => ({ price: round(price - k * R), r: k })) },
  };
}

// Poäng och kravlista. f: fundamentals, si: blankningsregistret, nw: nyheter, tech: teknik.
export function scoreShort({ f, si, nw, tech, report }) {
  const parts = [];
  const add = (group, pts, text) => { if (pts) parts.push({ group, pts, text }); return pts; };
  const pc = x => `${x > 0 ? '+' : ''}${String(round(x * 100, 1)).replace('.', ',')} %`;
  let analyst = 0;
  if (f) {
    const e = f.epsChange90;
    if (e != null) analyst += add('Analytiker', e <= -0.08 ? 20 : e <= -0.03 ? 12 : e <= -0.01 ? 5 : e >= 0.03 ? -10 : 0, `Vinstprognoserna ${pc(e)} på 90 dagar`);
    const net = f.revDown - f.revUp;
    analyst += add('Analytiker', net >= 3 ? 8 : net >= 1 ? 4 : net <= -3 ? -5 : 0, `${f.revDown} sänkningar och ${f.revUp} höjningar av prognoserna senaste 30 dagarna`);
    const misses = f.surprises.filter(x => x < -0.02).length;
    analyst += add('Analytiker', misses >= 2 ? 6 : 0, `${misses} av ${f.surprises.length} senaste rapporterna under förväntan`);
    if (f.surprises.length && f.surprises[f.surprises.length - 1] < -0.02) analyst += add('Analytiker', 4, `Senaste rapporten ${pc(f.surprises[f.surprises.length - 1])} mot förväntan`);
    if (f.target && f.price) { const up = f.target / f.price - 1; analyst += add('Analytiker', up <= 0 ? 6 : up >= 0.2 ? -5 : 0, `Riktkurs ${round(f.target)} (${pc(up)} mot kursen)`); }
    if (f.recMean != null) analyst += add('Analytiker', f.recMean >= 2.8 ? 4 : 0, `Snittrekommendation ${String(round(f.recMean, 1)).replace('.', ',')} (1 köp – 5 sälj)`);
    add('Nyckeltal', f.revenueGrowth != null && f.revenueGrowth < 0 ? 5 : 0, `Försäljningen ${pc(f.revenueGrowth)} mot året innan`);
    add('Nyckeltal', f.earningsGrowth != null && f.earningsGrowth < -0.1 ? 5 : 0, `Vinsten ${pc(f.earningsGrowth)} mot året innan`);
    add('Nyckeltal', f.debtToEquity > 150 && f.fcf < 0 ? 5 : 0, 'Hög skuld och negativt kassaflöde');
  }
  if (si) {
    add('Blankning', si.pct >= 5 ? 10 : si.pct >= 3 ? 6 : si.pct >= 1.5 ? 3 : 0, `${String(si.pct).replace('.', ',')} % av aktierna är blankade`);
    add('Blankning', si.change4w >= 0.5 ? 5 : 0, `Blankningen ${si.change4w > 0 ? '+' : ''}${String(si.change4w).replace('.', ',')} procentenheter på 4 veckor`);
  }
  if (nw) {
    add('Nyheter', Math.min(10, nw.neg.length * 4), `${nw.neg.length} negativa rubriker senaste 14 dagarna`);
    add('Nyheter', -Math.min(10, nw.pos.length * 4), `${nw.pos.length} positiva rubriker senaste 14 dagarna`);
  }
  add('Teknik', tech.down ? 8 : 0, 'Nedtrend: under EMA 200 och EMA 50 under EMA 200');
  add('Teknik', tech.rejection ? 8 : 0, 'Studsade upp mot EMA 20/50 och vände ned');
  add('Teknik', tech.fading ? 4 : 0, `RSI ${String(tech.rsi).replace('.', ',')} och faller`);
  const score = Math.max(0, Math.min(100, parts.reduce((a, p) => a + p.pts, 0)));
  const reportSoon = report && report.days != null && report.days <= 10;
  const checklist = [
    { key: 'trend', ok: tech.down, text: 'Nedtrend (under EMA 200, EMA 50 under EMA 200)', now: `${tech.price} mot EMA 200 ${tech.ema200}` },
    { key: 'rejection', ok: tech.rejection, text: 'Studs upp mot EMA 20/50 som vänt ned', now: tech.rejection ? 'ja' : `kurs ${tech.price}, EMA 20 ${tech.ema20}` },
    { key: 'rsi', ok: tech.notOversold, text: 'Inte översåld (RSI över 40)', now: `RSI ${tech.rsi}` },
    { key: 'analyst', ok: analyst >= SHORT_MIN_ANALYST, text: `Analytikerna negativa (minst ${SHORT_MIN_ANALYST} poäng)`, now: `${analyst} poäng` },
    { key: 'report', ok: !reportSoon, text: 'Ingen rapport inom 10 handelsdagar', now: report ? `rapport ${report.date}, om ${report.days} handelsdagar` : 'ingen känd' },
    { key: 'score', ok: score >= SHORT_MIN_SCORE, text: `Total poäng minst ${SHORT_MIN_SCORE}`, now: `poäng ${score}` },
  ];
  const status = checklist.every(c => c.ok) ? 'short' : tech.down && analyst >= 10 ? 'watch' : 'none';
  return { score, analyst, parts, checklist, status };
}

// Utfall för en loggad blankning: in på nästa öppning, en tredjedel vid varje mål,
// stoppet till ingången efter TP2, högst 30 dagar. R efter 0,3 % avgift.
export function shortOutcome(e, bars) {
  const t = bars.findIndex(b => day(b.t) === e.date);
  if (t < 0) return { state: 'okänd' };
  if (t + 1 >= bars.length) return { state: 'väntar på köp' };
  const entry = bars[t + 1].o, R = e.stop - entry;
  if (!(R > 0)) return { state: 'öppnade över stoppet – ingen affär' };
  let sl = e.stop, hit = 0, res = 0;
  for (let j = t + 1; j < bars.length && j <= t + 30; j++) {
    const x = bars[j];
    if (x.h >= sl) { res += ((entry - Math.max(sl, x.o)) / R) * (3 - hit) / 3; return { state: 'stängd', entry: round(entry), hit, r: round(res - 0.003 * entry / R), exitDate: day(x.t) }; }
    while (hit < 3 && x.l <= e.tps[hit]) { res += ((entry - e.tps[hit]) / R) / 3; hit++; if (hit >= 2) sl = Math.min(sl, entry); }
    if (hit === 3) return { state: 'stängd', entry: round(entry), hit, r: round(res - 0.003 * entry / R), exitDate: day(x.t) };
  }
  const j = Math.min(bars.length - 1, t + 30), open = t + 30 > bars.length - 1;
  return { state: open ? 'öppen' : 'stängd', entry: round(entry), hit, r: round(res + ((entry - bars[j].c) / R) * (3 - hit) / 3 - (open ? 0 : 0.003 * entry / R)), exitDate: day(bars[j].t) };
}
