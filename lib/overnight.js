// Natten: vad som hänt sedan Stockholm stängde 17.30, och en indikation för hur
// OMXS30 och DAX öppnar. Bygger på marknader som handlas när Stockholm, Frankfurt
// och New York är stängda: USA-terminerna (nästan dygnet runt), guld, olja,
// bitcoin, kronan och svenska bolag i USA (Ericsson, AstraZeneca) med efterhandel.
//
// Indikationen är en enkel regression på de senaste cirka 60 dagarna: öppningen
// mot förra stängningen förklarad av hur S&P 500-terminen rört sig mellan 17.30
// och 08.45. Den räknas om varje dag och visar hur bra den har träffat.

const UA = 'Mozilla/5.0 (omx-analys)';
const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const loc = t => { const p = Object.fromEntries(fmt.formatToParts(new Date(t * 1000)).map(x => [x.type, x.value])); return { d: `${p.year}-${p.month}-${p.day}`, m: +p.hour * 60 + +p.minute }; };
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

async function chart(symbol, q) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Yahoo ${res.status} för ${symbol}`);
  return (await res.json()).chart.result[0];
}
async function intraday(symbol, range = '5d') {
  const r = await chart(symbol, `range=${range}&interval=15m&includePrePost=true`);
  const q = r.indicators.quote[0];
  return r.timestamp.map((t, i) => ({ t, ...loc(t), o: q.open[i], c: q.close[i] })).filter(x => x.c != null);
}
// Senaste värdet vid eller före en viss tid (Stockholmstid) en viss dag.
const at = (S, d, m) => { let v = null; for (const x of S) { if (x.d < d || (x.d === d && x.m <= m)) v = x.c; else break; } return v; };

const NIGHT = [
  { symbol: 'ES=F', name: 'S&P 500-terminen' },
  { symbol: 'NQ=F', name: 'Nasdaq-terminen' },
  { symbol: 'YM=F', name: 'Dow Jones-terminen' },
  { symbol: 'ERIC', name: 'Ericsson i USA' },
  { symbol: 'AZN', name: 'AstraZeneca i USA' },
  { symbol: 'GC=F', name: 'Guld' },
  { symbol: 'BZ=F', name: 'Olja (Brent)' },
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'EURSEK=X', name: 'Euron mot kronan' },
  { symbol: 'SEK=X', name: 'Dollarn mot kronan' },
];

// Senaste handelsdag i Stockholm som har stängt (17.30), som 'ÅÅÅÅ-MM-DD'.
function lastClose(now = Date.now()) {
  const n = loc(now / 1000);
  let d = new Date(n.d + 'T12:00:00Z');
  if (n.m < 17 * 60 + 30) d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() % 6 === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

let model = null;
async function fitModel() {
  if (model && Date.now() - model.at < 12 * 3600 * 1000) return model.value;
  const es = await intraday('ES=F', '60d');
  const value = {};
  for (const [key, idx] of [['omx', '^OMX'], ['dax', '^GDAXI']]) {
    const daily = await chart(idx, 'range=3mo&interval=1d');
    const dq = daily.indicators.quote[0];
    const days = daily.timestamp.map((t, i) => ({ d: loc(t).d, o: dq.open[i], c: dq.close[i] })).filter(x => x.o && x.c);
    const pts = [];
    for (let i = 1; i < days.length; i++) {
      if (days[i].d < es[0].d) continue;
      const e0 = at(es, days[i - 1].d, 17 * 60 + 30), e1 = at(es, days[i].d, 8 * 60 + 45);
      if (e0 && e1) pts.push({ x: (e1 / e0 - 1) * 100, y: (days[i].o / days[i - 1].c - 1) * 100 });
    }
    if (pts.length < 20) continue;
    const n = pts.length, mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
    const b = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / pts.reduce((a, p) => a + (p.x - mx) ** 2, 0), a = my - b * mx;
    const res = pts.map(p => p.y - (a + b * p.x));
    const sd = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / (n - 2));
    const r2 = 1 - res.reduce((s, r) => s + r * r, 0) / pts.reduce((s, p) => s + (p.y - my) ** 2, 0);
    const moved = pts.filter(p => Math.abs(p.x) > 0.3);
    // Kvalitet: antal dagar med tydlig terminsrörelse, träffar i riktning och snittfelet i procentenheter.
    const hits = moved.filter(p => Math.sign(p.y) === Math.sign(p.x)).length;
    const mae = res.reduce((t, r) => t + Math.abs(r), 0) / n;
    value[key] = { a, b, sd, r2, n, moved: moved.length, hits, mae, hit: moved.length ? hits / moved.length : null };
  }
  model = { at: Date.now(), value };
  return value;
}

let cache = null;
export async function overnight() {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.value;
  const since = lastClose();
  const moves = [];
  for (const m of NIGHT) {
    try {
      const S = await intraday(m.symbol);
      const base = at(S, since, 17 * 60 + 30), last = S[S.length - 1];
      if (!base || !last) continue;
      moves.push({ ...m, price: last.c, change: round((last.c / base - 1) * 100), asOf: new Date(last.t * 1000).toISOString() });
    } catch { /* hoppas över */ }
  }
  const es = moves.find(m => m.symbol === 'ES=F');
  const fit = await fitModel().catch(() => ({}));
  const indication = {};
  if (es) for (const [k, f] of Object.entries(fit)) {
    const v = f.a + f.b * es.change;
    indication[k] = { value: round(v), lo: round(v - f.sd), hi: round(v + f.sd), r2: round(f.r2), n: f.n, moved: f.moved, hits: f.hits, mae: f.mae == null ? null : round(f.mae), hit: f.hit == null ? null : Math.round(f.hit * 100), basis: es.change };
  }
  const value = { since, moves, indication, updated: new Date().toISOString() };
  cache = { at: Date.now(), value };
  return value;
}
