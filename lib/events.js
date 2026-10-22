// Rapportdatum och räntebesked (FOMC).
//
// Historiska rapportdatum finns i data/earnings.json (från Yahoo Finance).
// Kommande rapport hämtas från Yahoo när det går. Saknas ett datum uppskattas
// det från samma kvartal året innan, eftersom svenska bolag rapporterar på
// nästan samma datum varje år.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const history = JSON.parse(fs.readFileSync(path.join(dir, 'earnings.json'), 'utf8'));
export const FOMC = JSON.parse(fs.readFileSync(path.join(dir, 'fomc.json'), 'utf8')).decisionDays;

const DAY = 86400000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// Fyller på datum ett år framåt (364 dagar = samma veckodag) där det saknas.
export function projectReports(list, until = new Date(Date.now() + 400 * DAY)) {
  const out = [...list];
  for (let k = 0; k < 4; k++) {
    for (const d of [...out]) {
      const n = new Date(new Date(d).getTime() + 364 * DAY);
      if (n > until) continue;
      if (!out.some(x => Math.abs(new Date(x) - n) < 40 * DAY)) out.push(n.toISOString().slice(0, 10));
    }
  }
  return out.sort();
}

export function reportDates(symbol) {
  return projectReports(history[symbol] || []);
}

let session = null;
async function yahooSession() {
  if (session && Date.now() - session.at < 6 * 3600 * 1000) return session;
  const res = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const cookie = (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const crumb = await (await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } })).text();
  if (!crumb || crumb.length > 40) throw new Error('Ingen crumb från Yahoo');
  session = { cookie, crumb, at: Date.now() };
  return session;
}

const upcomingCache = new Map();
// Nästa rapportdatum: från Yahoo om det går, annars uppskattat.
export async function nextReport(symbol, today = new Date().toISOString().slice(0, 10)) {
  const hit = upcomingCache.get(symbol);
  if (hit && Date.now() - hit.at < 12 * 3600 * 1000) return hit.value;
  let value = null;
  try {
    const s = await yahooSession();
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents&crumb=${encodeURIComponent(s.crumb)}`;
    const j = await (await fetch(url, { headers: { 'User-Agent': UA, Cookie: s.cookie } })).json();
    const e = j.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
    const d = e?.earningsDate?.map(x => x.fmt).filter(x => x >= today).sort()[0];
    if (d) value = { date: d, estimated: !!e.isEarningsDateEstimate, source: 'Yahoo Finance' };
  } catch { /* faller tillbaka på uppskattning */ }
  if (!value) {
    const d = reportDates(symbol).find(x => x >= today);
    if (d) value = { date: d, estimated: true, source: 'uppskattat från förra året' };
  }
  upcomingCache.set(symbol, { at: Date.now(), value });
  return value;
}

// Antal handelsdagar (mån–fre) från `from` till `to`, exklusive `from`.
export function tradingDaysBetween(from, to) {
  let n = 0;
  for (let d = new Date(from).getTime() + DAY; d <= new Date(to).getTime(); d += DAY) {
    const wd = new Date(d).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
