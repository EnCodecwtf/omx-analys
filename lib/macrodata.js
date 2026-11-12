// Utfall för de viktigaste makrobeskeden: senaste värdet och värdet före.
// Källor utan nyckel: FRED (USA och ECB), Riksbanken och SCB. Analytikernas
// förväntningar (konsensus) finns inte gratis, så utfallet jämförs med förra.
// Sparas i samma lagring som signalloggen i 6 timmar, eftersom FRED kan vara långsam.

import { kvGet, kvSet } from './log.js';
import { fetchBars } from './data.js';
import { FOMC } from './events.js';

// FRED svarar inte på webbläsarliknande User-Agent, så appen anger sitt eget namn.
const UA = 'omx-analys/1.0 (+https://omx-analys.vercel.app)';
const KEY = 'omx-analys:macro-outcomes';
const TTL = 6 * 3600 * 1000;
const round = (x, d = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

async function get(url, ms = 25000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

// FRED: [{ d: 'ÅÅÅÅ-MM-DD', v }] från startdatum. En fråga i taget, annars
// svarar FRED 503, och ett nytt försök om det ändå händer.
let fredQueue = Promise.resolve();
function fred(id, from = '2023-01-01') {
  const run = async () => {
    for (let tryNo = 0; ; tryNo++) {
      try {
        const csv = await (await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}`)).text();
        return csv.trim().split('\n').slice(1).map(l => l.split(',')).filter(([, v]) => v && v !== '.').map(([d, v]) => ({ d, v: +v }));
      } catch (err) {
        if (tryNo >= 2) throw err;
        await new Promise(r => setTimeout(r, 1500 * (tryNo + 1)));
      }
    }
  };
  const p = fredQueue.then(run, run);
  fredQueue = p.catch(() => {});
  return p;
}
const yoy = s => s.slice(12).map((x, i) => ({ d: x.d, v: (x.v / s[i].v - 1) * 100 }));
const mom = s => s.slice(1).map((x, i) => ({ d: x.d, v: (x.v / s[i].v - 1) * 100 }));
const diff = s => s.slice(1).map((x, i) => ({ d: x.d, v: x.v - s[i].v }));
const month = d => new Date(d.slice(0, 7) + '-15T12:00:00Z').toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
const quarter = d => `kvartal ${Math.floor((+d.slice(5, 7) - 1) / 3) + 1} ${d.slice(0, 4)}`;

// Senaste och föregående värde i en serie.
const lastTwo = (s, label = month) => s.length < 2 ? null : { period: label(s.at(-1).d), value: s.at(-1).v, prev: s.at(-2).v, prevPeriod: label(s.at(-2).d) };
// För styrräntor: nuvarande nivå och senaste ändringen.
function rateChange(s) {
  if (!s.length) return null;
  const now = s.at(-1).v;
  let i = s.length - 1;
  while (i > 0 && s[i - 1].v === now) i--;
  return { value: now, since: s[i].d, prev: i > 0 ? s[i - 1].v : null };
}

async function riksbank() {
  const from = new Date(Date.now() - 900 * 864e5).toISOString().slice(0, 10);
  const j = await (await get(`https://api.riksbank.se/swea/v1/Observations/SECBREPOEFF/${from}`)).json();
  return j.map(x => ({ d: x.date, v: x.value }));
}

async function kpif() {
  const url = 'https://api.scb.se/ov0104/v2beta/api/v2/tables/TAB6590/data?lang=sv&valueCodes%5BContentsCode%5D=000007ZM&valueCodes%5BTid%5D=top(3)&outputFormat=json-stat2';
  const j = await (await get(url)).json();
  const times = Object.keys(j.dimension.Tid.category.index);
  return times.map((t, i) => ({ d: `${t.slice(0, 4)}-${t.slice(5, 7)}-01`, v: j.value[i] }));
}

// Nästa publicering av KPI enligt SCB:s egen sida (Snabb-KPI kommer först).
export async function nextKpifDates() {
  try {
    const html = await (await get('https://www.scb.se/hitta-statistik/statistik-efter-amne/priser-och-ekonomiska-tendenser/priser/konsumentprisindex-kpi/', 15000)).text();
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&#xE4;/gi, 'ä').replace(/&auml;/g, 'ä');
    return [...new Set([...text.matchAll(/(?:Snabb-KPI|Nästa publicering:?)\s+(20\d\d-\d\d-\d\d)/g)].map(m => m[1]))];
  } catch { return []; }
}

const SOURCES = {
  fomc: () => fred('DFEDTARU', '2024-01-01').then(rateChange),
  riksbank: () => riksbank().then(rateChange),
  ecb: () => fred('ECBDFR', '2024-01-01').then(rateChange),
  cpi: async () => { const [all, core] = await Promise.all([fred('CPIAUCSL', '2023-01-01'), fred('CPILFESL', '2023-01-01')]); const a = lastTwo(yoy(all)), c = lastTwo(yoy(core)); return a && { ...a, unit: '%', core: c?.value, corePrev: c?.prev, coreLabel: 'kärninflation' }; },
  jobs: async () => { const [p, u] = await Promise.all([fred('PAYEMS', '2024-01-01'), fred('UNRATE', '2024-01-01')]); const a = lastTwo(diff(p)), b = lastTwo(u); return a && { ...a, unit: 'tusen jobb', core: b?.value, corePrev: b?.prev, coreLabel: 'arbetslöshet %' }; },
  pce: async () => { const [all, core] = await Promise.all([fred('PCEPI', '2023-01-01'), fred('PCEPILFE', '2023-01-01')]); const a = lastTwo(yoy(all)), c = lastTwo(yoy(core)); return a && { ...a, unit: '%', core: c?.value, corePrev: c?.prev, coreLabel: 'kärn-PCE' }; },
  gdp: async () => { const a = lastTwo(await fred('A191RL1Q225SBEA', '2023-01-01'), quarter); return a && { ...a, unit: '% i årstakt' }; },
  retail: async () => { const a = lastTwo(mom(await fred('RSAFS', '2024-01-01'))); return a && { ...a, unit: '% mot månaden före' }; },
  kpif: async () => { const a = lastTwo(await kpif()); return a && { ...a, unit: '%' }; },
  ppi: async () => { const a = lastTwo(yoy(await fred('PPIFIS', '2023-01-01'))); return a && { ...a, unit: '%' }; },
  claims: async () => { const s = (await fred('ICSA', '2025-01-01')).map(x => ({ ...x, v: Math.round(x.v / 1000) })); const a = s.length >= 2 && { period: `vecka t.o.m. ${s.at(-1).d}`, value: s.at(-1).v, prev: s.at(-2).v, prevPeriod: s.at(-2).d }; return a && { ...a, unit: 'tusen' }; },
};

const LABELS = {
  fomc: 'Feds styrränta (övre gräns)', riksbank: 'Riksbankens styrränta', ecb: 'ECB:s inlåningsränta', kpif: 'Sveriges inflation (KPIF)',
  cpi: 'USA:s inflation (KPI)', pce: 'USA:s PCE-inflation', jobs: 'USA:s nya jobb', gdp: 'USA:s BNP-tillväxt', retail: 'USA:s detaljhandel', ppi: 'USA:s producentpriser (PPI)', claims: 'USA:s nya arbetslöshetsanmälningar',
};
export const OUTCOME_ORDER = Object.keys(LABELS);

function finish(k, o) {
  if (!o) return null;
  if (['fomc', 'riksbank', 'ecb'].includes(k)) {
    const ch = o.prev == null ? 0 : round(o.value - o.prev, 2);
    return { kind: k, label: LABELS[k], text: `${String(o.value).replace('.', ',')} %`, detail: ch ? `senast ändrad ${o.since}: ${ch > 0 ? 'höjd' : 'sänkt'} ${String(Math.abs(ch)).replace('.', ',')} procentenheter` : `oförändrad sedan ${o.since}`, dir: 0 };
  }
  const f = v => (v == null ? '–' : String(round(v, k === 'jobs' ? 0 : 1)).replace('.', ','));
  const dir = Math.sign(round(o.value, 1) - round(o.prev, 1));
  return { kind: k, label: LABELS[k], period: o.period, text: `${f(o.value)} ${o.unit}`, detail: `förra (${o.prevPeriod}): ${f(o.prev)}${o.core != null ? ` · ${o.coreLabel} ${f(o.core)} (förra ${f(o.corePrev)})` : ''}`, dir };
}

let mem = null;
export async function macroOutcomes() {
  if (mem && Date.now() - mem.at < TTL) return mem.value;
  const saved = await kvGet(KEY, null);
  if (saved?.at && Date.now() - saved.at < TTL) { mem = saved; return saved.value; }
  const entries = await Promise.all(Object.entries(SOURCES).map(async ([k, fn]) => {
    try { return [k, finish(k, await fn())]; } catch (err) { console.error('Makroutfall saknas för', k, err.message); return [k, saved?.value?.[k] ?? null]; }
  }));
  const value = Object.fromEntries(entries);
  mem = { at: Date.now(), value };
  await kvSet(KEY, mem);
  return value;
}

// FedWatch: marknadens sannolikheter för Feds kommande räntebesked, räknade
// ungefär som CME FedWatch ur terminerna på Feds styrränta (30-day Fed Funds,
// ZQ, från Yahoo). Terminens pris är 100 minus snitträntan under månaden. Är
// nästa månad utan möte används den månadens termin som räntan efter mötet,
// annars delas månaden upp i dagarna före och efter beskedet.
const MCODE = 'FGHJKMNQUVXZ';
const zq = (y, m) => `ZQ${MCODE[m - 1]}${String(y).slice(2)}.CBT`;
async function implied(y, m) {
  const bars = await fetchBars(zq(y, m), { range: '1mo' });
  return 100 - bars[bars.length - 1].c;
}
const lastVal = s => s[s.length - 1].v;

export async function fedWatch(n = 4) {
  const today = new Date().toISOString().slice(0, 10);
  const meetings = FOMC.filter(d => d >= today);
  const [effr, lower] = await Promise.all([fred('EFFR', '2026-01-01').then(lastVal), fred('DFEDTARL', '2026-01-01').then(lastVal)]);
  const spread = effr - (lower + 0.125); // var EFFR brukar ligga inom intervallet
  const out = [];
  let start = effr;
  for (const d of meetings.slice(0, n)) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10), N = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
    const nextHasMeeting = meetings.some(x => x.startsWith(`${ny}-${String(nm).padStart(2, '0')}`));
    let end;
    try {
      end = nextHasMeeting ? (await implied(y, m) * N - start * day) / (N - day) : await implied(ny, nm);
    } catch { break; }
    const steps = (end - spread - (lower + 0.125)) / 0.25, lo = Math.floor(steps), p = steps - lo;
    const dist = [{ lower: lower + lo * 0.25, p: 1 - p }, { lower: lower + (lo + 1) * 0.25, p }]
      .filter(x => x.p >= 0.005).map(x => ({ range: `${fmtRate(x.lower)}–${fmtRate(x.lower + 0.25)} %`, lower: x.lower, p: Math.round(x.p * 1000) / 10 }));
    const sum = f => Math.round(dist.filter(f).reduce((a, x) => a + x.p, 0) * 10) / 10;
    out.push({ date: d, expected: round(end, 3), dist, cut: sum(x => x.lower < lower - 1e-9), hold: sum(x => Math.abs(x.lower - lower) < 1e-9), hike: sum(x => x.lower > lower + 1e-9) });
    start = end;
  }
  return { now: { range: `${fmtRate(lower)}–${fmtRate(lower + 0.25)} %`, lower, effr }, meetings: out };
}
const fmtRate = v => v.toFixed(2).replace('.', ',');
