// Hämtar dagsdata från Yahoo Finance och cachar den i minnet.

const CACHE_MS = 15 * 60 * 1000;
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
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].some(x => x == null || !Number.isFinite(x))) continue;
    bars.push({ t: r.timestamp[i], o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: q.volume[i] || 0 });
  }
  cache.set(key, { at: Date.now(), bars });
  return bars;
}
