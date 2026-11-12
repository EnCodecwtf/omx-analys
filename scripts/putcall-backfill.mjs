// Hämtar CBOE:s dagliga put/call-kvoter (öppen data) och sparar dem i data/putcall.json.
// Körs vid behov: node scripts/putcall-backfill.mjs [från-datum]
import fs from 'node:fs';
const file = new URL('../data/putcall.json', import.meta.url);
const have = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const from = process.argv[2] || '2024-06-01', to = new Date().toISOString().slice(0, 10);
const days = []; for (let d = new Date(from + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) { const w = d.getUTCDay(); if (w && w < 6) days.push(d.toISOString().slice(0, 10)); }
const todo = days.filter(d => !(d in have));
let n = 0;
async function one(d) {
  try {
    const r = await fetch(`https://cdn.cboe.com/data/us/options/market_statistics/daily/${d}_daily_options`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) { have[d] = null; return; } // helgdag: ingen fil
    const j = await r.json(); const v = n => +(j.ratios || []).find(x => x.name === n)?.value;
    const total = v('TOTAL PUT/CALL RATIO'), equity = v('EQUITY PUT/CALL RATIO');
    have[d] = isFinite(total) ? { total, equity: isFinite(equity) ? equity : null } : null;
  } catch { /* försök igen nästa gång */ }
}
const q = [...todo];
await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) { await one(q.shift()); if (++n % 50 === 0) console.log(n, 'av', todo.length); await new Promise(r => setTimeout(r, 150)); } }));
const out = Object.fromEntries(Object.entries(have).sort());
fs.writeFileSync(file, JSON.stringify(out));
const vals = Object.values(out).filter(Boolean);
console.log('dagar med data', vals.length, 'första', Object.keys(out).find(k => out[k]), 'sista', Object.keys(out).filter(k => out[k]).at(-1));
