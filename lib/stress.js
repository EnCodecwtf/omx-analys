// Krigsrisk och akut oro. Används för positionsstorleken: halv position när
// något av dem slår till. I backtestet 2017–2026 sänkte det största
// nedgången från 40 % till 24 % med nästan samma avkastning.
//
//   Krigsspik:  geopolitiskt riskindex (GPR, Caldara & Iacoviello) som
//               7-dagarssnitt är minst 15 % över medianen för senaste året.
//               GPR räknar artiklar om krig, terror och hot i stora tidningar.
//   Akut oro:   VIX9D / VIX är minst 1,04, dvs. marknaden väntar sig mer
//               turbulens de närmaste dagarna än den närmaste månaden.

import { fetchBars } from './data.js';

const GPR_URL = 'https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.dta';
export const GPR_SPIKE = 1.15;
export const ACUTE_RATIO = 1.04;

// Läser en Stata-fil (format 118) och returnerar valda kolumner.
export function readDta(buf, wanted) {
  const text = i => buf.toString('latin1', i, i + 64);
  if (!text(0).startsWith('<stata_dta><header><release>118')) throw new Error('Okänt Stata-format');
  const tag = (name, from = 0) => {
    const i = buf.indexOf(`<${name}>`, from, 'latin1');
    if (i < 0) throw new Error(`Saknar <${name}>`);
    return i + name.length + 2;
  };
  const K = buf.readUInt16LE(tag('K'));
  const N = Number(buf.readBigUInt64LE(tag('N')));
  const tPos = tag('variable_types');
  const types = Array.from({ length: K }, (_, k) => buf.readUInt16LE(tPos + 2 * k));
  const nPos = tag('varnames');
  const names = Array.from({ length: K }, (_, k) => buf.toString('latin1', nPos + 129 * k, nPos + 129 * (k + 1)).replace(/\0.*$/s, ''));
  const width = t => (t <= 2045 ? t : { 32768: 8, 65526: 8, 65527: 4, 65528: 4, 65529: 2, 65530: 1 }[t]);
  const offsets = []; let rowLen = 0;
  for (const t of types) { offsets.push(rowLen); rowLen += width(t); }
  const dPos = tag('data');
  const read = (p, t) => {
    if (t <= 2045) return buf.toString('latin1', p, p + t).replace(/\0.*$/s, '');
    if (t === 65526) { const v = buf.readDoubleLE(p); return v > 8.988e307 ? null : v; }
    if (t === 65527) { const v = buf.readFloatLE(p); return v > 1.7e38 ? null : v; }
    if (t === 65528) { const v = buf.readInt32LE(p); return v > 2147483620 ? null : v; }
    if (t === 65529) { const v = buf.readInt16LE(p); return v > 32740 ? null : v; }
    if (t === 65530) { const v = buf.readInt8(p); return v > 100 ? null : v; }
    return null; // strL används inte här
  };
  const cols = wanted.map(w => names.indexOf(w));
  if (cols.some(c => c < 0)) throw new Error(`Kolumner saknas: ${wanted.filter((_, i) => cols[i] < 0)}`);
  const rows = [];
  for (let r = 0; r < N; r++) {
    const base = dPos + r * rowLen;
    rows.push(cols.map(c => read(base + offsets[c], types[c])));
  }
  return rows;
}

let gprCache = null;
// GPR per dag: { 'ÅÅÅÅ-MM-DD': { gpr, ma7 } }. Uppdateras högst två gånger per dygn.
export async function gprSeries() {
  if (gprCache && Date.now() - gprCache.at < 12 * 3600 * 1000) return gprCache.value;
  const res = await fetch(GPR_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (omx-analys)' } });
  if (!res.ok) throw new Error(`GPR svarade ${res.status}`);
  const rows = readDta(Buffer.from(await res.arrayBuffer()), ['DAY', 'GPRD', 'GPRD_MA7']);
  const value = {};
  for (const [dayRaw, gpr, ma7] of rows) {
    const s = String(typeof dayRaw === 'number' ? Math.round(dayRaw) : dayRaw);
    if (s.length !== 8 || s < '20150101') continue;
    value[`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`] = { gpr, ma7 };
  }
  gprCache = { at: Date.now(), value };
  return value;
}

// GPR-läget för ett datum: 7-dagarssnitt mot medianen för föregående år.
export function gprLevel(series, d) {
  const days = Object.keys(series).filter(k => k <= d).sort();
  if (days.length < 30) return null;
  const last = days[days.length - 1];
  const year = days.slice(-366, -1).map(k => series[k].gpr).filter(v => v != null).sort((a, b) => a - b);
  const median = year[year.length >> 1];
  const ma7 = series[last].ma7;
  if (!median || ma7 == null) return null;
  return { date: last, ma7, median, rel: ma7 / median };
}

const day = t => new Date(t * 1000).toISOString().slice(0, 10);

// Samlat stressläge för idag.
export async function stressNow() {
  const parts = [];
  let gpr = null, acute = null;
  try {
    const g = gprLevel(await gprSeries(), new Date().toISOString().slice(0, 10));
    if (g) {
      gpr = g;
      parts.push({ bad: g.rel >= GPR_SPIKE, text: `Krigs- och hotnivå (GPR) ${Math.round((g.rel - 1) * 100)} % ${g.rel >= 1 ? 'över' : 'under'} normalt (${g.date})` });
    }
  } catch (err) {
    parts.push({ bad: false, text: `GPR kunde inte hämtas (${err.message})` });
  }
  try {
    const [v9, v] = await Promise.all([fetchBars('^VIX9D'), fetchBars('^VIX')]);
    const a = v9[v9.length - 1], b = v[v.length - 1];
    if (a && b && day(a.t) === day(b.t)) {
      acute = { date: day(a.t), ratio: a.c / b.c };
      parts.push({ bad: acute.ratio >= ACUTE_RATIO, text: `Kortsiktig oro VIX9D/VIX ${acute.ratio.toFixed(2).replace('.', ',')}${acute.ratio >= ACUTE_RATIO ? ' – akut stigande' : ''}` });
    }
  } catch (err) {
    parts.push({ bad: false, text: `VIX9D kunde inte hämtas (${err.message})` });
  }
  const stressed = (gpr && gpr.rel >= GPR_SPIKE) || (acute && acute.ratio >= ACUTE_RATIO);
  return { stressed: !!stressed, size: stressed ? 0.5 : 1, gpr, acute, parts };
}
