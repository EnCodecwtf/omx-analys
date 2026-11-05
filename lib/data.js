// Hämtar dagsdata från Yahoo Finance och cachar den i minnet. Under börsdagen
// är dagens stapel preliminär och uppdateras (Yahoo ligger cirka 15 minuter efter).

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

export async function fetchBars(symbol, { range = '5y' } = {}) {
  const key = `${symbol}:${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.bars;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=split`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (omx-analys)' } });
  if (!res.ok) throw new Error(`Yahoo svarade ${res.status} för ${symbol}`);
  const json = await res.json();
  const r = json.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error(`Ingen data för ${symbol}`);
  const q = r.indicators.quote[0];
  const bars = [];
  const m = r.meta || {}, day = t => new Date(t * 1000).toISOString().slice(0, 10);
  const lastI = r.timestamp.length - 1;
  for (let i = 0; i < r.timestamp.length; i++) {
    let o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    // Yahoo saknar ibland stängningskursen för senaste dagen i dagsdatan, fast
    // den finns i metadatan. Då fylls den i därifrån, annars försvinner hela dagen.
    if (i === lastI && m.regularMarketTime && day(m.regularMarketTime) === day(r.timestamp[i])) {
      c ??= m.regularMarketPrice; h ??= m.regularMarketDayHigh; l ??= m.regularMarketDayLow; o ??= c;
    }
    if ([o, h, l, c].some(x => x == null || !Number.isFinite(x))) continue;
    bars.push({ t: r.timestamp[i], o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: q.volume[i] || 0 });
  }
  cache.set(key, { at: Date.now(), bars });
  return bars;
}
