// Nyhetsrubriker från Google Nyheter (svenska). Visas som information och
// påverkar inte signalerna: det finns ingen gratis historik att testa mot.

const cache = new Map();
const TTL = 30 * 60 * 1000;

const TAGS = [
  ['Geopolitik', /\b(krig\w*|konflikt\w*|attack\w*|missil\w*|invasion|sanktion\w*|tull\w*|handelskrig|terror\w*|ryssland|ukraina|iran|israel|kina|taiwan|nato)\b/i],
  ['Makro', /\b(räntebesked|ränt\w*|riksbank\w*|fed\b|inflation\w*|kpi\b|bnp\b|recession\w*|arbetslöshet\w*|pmi\b|konjunktur\w*)\b/i],
  ['Rapport', /\b(rapport\w*|kvartal\w*|delårs\w*|bokslut\w*|vinstvarn\w*|resultat\w*|rörelseresultat\w*|orderingång\w*)\b/i],
  ['Bud', /\b(bud\b|budpremie|uppköp\w*|förvärv\w*|köps ut)\b/i],
  ['Analys', /\b(riktkurs\w*|uppgrader\w*|nedgrader\w*|köprekommendation\w*|säljrekommendation\w*)\b/i],
];

const decode = s => s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export async function news(query, { limit = 12 } = {}) {
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=sv&gl=SE&ceid=SE:sv`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (omx-analys)' } });
  if (!res.ok) throw new Error(`Google Nyheter svarade ${res.status}`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const get = tag => decode((m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '');
    const source = get('source');
    let title = get('title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return {
      title, source, link: get('link'), date: new Date(get('pubDate')).toISOString(),
      tags: TAGS.filter(([, re]) => re.test(title)).map(([t]) => t),
    };
  }).filter(n => n.title && !Number.isNaN(Date.parse(n.date)));
  items.sort((a, b) => b.date.localeCompare(a.date));
  const value = items.slice(0, limit);
  cache.set(query, { at: Date.now(), value });
  return value;
}

// Sökfråga för ett bolag: namnet utan aktieslag, plus "aktie".
export function companyQuery(name) {
  return `"${name.replace(/\s+[ABC]$/, '')}" aktie`;
}

export const MARKET_QUERY = 'Stockholmsbörsen OR börsen OR OMXS30 when:2d';
export const GEO_QUERY = '(krig OR invasion OR missilattack OR sanktioner OR tullar OR terrorattack) (börsen OR marknaden OR oljepriset OR ekonomin OR aktier) when:3d';
