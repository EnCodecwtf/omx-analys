// Realtidskurser från IG (gratis demokonto, för eget bruk). Aktiveras när
// IG_API_KEY, IG_IDENTIFIER och IG_PASSWORD är satta i Vercel. Utan dem används
// Yahoo (cirka 15 minuters fördröjning) som förut.
//
// IG:s REST-API: inloggning ger två tokens (CST och X-SECURITY-TOKEN) som gäller
// i cirka 6 timmar och förlängs vid användning. Marknaderna söks upp på namn
// första gången och sparas.

const BASE = process.env.IG_DEMO === '0' ? 'https://api.ig.com/gateway/deal' : 'https://demo-api.ig.com/gateway/deal';

// Appens symboler → sökord hos IG (namnen på IG:s CFD:er).
export const IG_MARKETS = {
  '^OMX': ['Sweden 30', 'OMX 30', 'Sweden'],
  '^GDAXI': ['Germany 40', 'Germany 30'],
  '^GSPC': ['US 500'],
  '^IXIC': ['US Tech 100'],
  'ES=F': ['US 500'],
  'NQ=F': ['US Tech 100'],
  'GC=F': ['Spot Gold', 'Gold'],
  'SI=F': ['Spot Silver', 'Silver'],
  'BZ=F': ['Oil - Brent Crude', 'Brent Crude'],
  'CL=F': ['Oil - US Crude', 'US Crude'],
  'SEK=X': ['USD/SEK'],
  'EURSEK=X': ['EUR/SEK'],
};

export const igEnabled = () => !!(process.env.IG_API_KEY && process.env.IG_IDENTIFIER && process.env.IG_PASSWORD);

let session = null; // { cst, token, at }
const epics = new Map(); // symbol → { epic, name } | null

async function login() {
  const res = await fetch(`${BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json; charset=UTF-8', 'X-IG-API-KEY': process.env.IG_API_KEY, Version: '2' },
    body: JSON.stringify({ identifier: process.env.IG_IDENTIFIER, password: process.env.IG_PASSWORD }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`IG-inloggningen misslyckades (${res.status}): ${(await res.text()).slice(0, 120)}`);
  session = { cst: res.headers.get('cst'), token: res.headers.get('x-security-token'), at: Date.now() };
  return session;
}

async function ig(path, version = '1', retry = true) {
  if (!session || Date.now() - session.at > 5 * 3600 * 1000) await login();
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json; charset=UTF-8', 'X-IG-API-KEY': process.env.IG_API_KEY, CST: session.cst, 'X-SECURITY-TOKEN': session.token, Version: version },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 401 && retry) { session = null; return ig(path, version, false); }
  if (!res.ok) throw new Error(`IG svarade ${res.status} för ${path}`);
  session.at = Date.now();
  return res.json();
}

// Hittar IG-marknaden för en av appens symboler (sparas när den hittats).
export async function epicFor(symbol) {
  if (epics.has(symbol)) return epics.get(symbol);
  let hit = null;
  for (const term of IG_MARKETS[symbol] || []) {
    const r = await ig(`/markets?searchTerm=${encodeURIComponent(term)}`);
    const list = (r.markets || []).filter(m => m.instrumentType !== 'OPT_COMMODITIES' && !/option|weekly|future/i.test(m.instrumentName));
    // Hellre "Cash"/löpande kontrakt än terminer med förfall.
    hit = list.find(m => /cash|spot|daily|\bDFB\b/i.test(m.expiry || '') || m.expiry === '-') || list[0];
    if (hit) { hit = { epic: hit.epic, name: hit.instrumentName }; break; }
  }
  epics.set(symbol, hit);
  return hit;
}

// Kurs just nu: mittpris mellan köp och sälj, med tid och om IG själv anger fördröjning.
export async function igQuote(symbol) {
  if (!igEnabled() || !IG_MARKETS[symbol]) return null;
  const m = await epicFor(symbol);
  if (!m) return null;
  const r = await ig(`/markets/${encodeURIComponent(m.epic)}`, '3');
  const s = r.snapshot || {};
  if (s.bid == null || s.offer == null) return null;
  return { symbol, epic: m.epic, name: m.name, price: (s.bid + s.offer) / 2, bid: s.bid, offer: s.offer, status: s.marketStatus, delayMin: s.delayTime ?? null,
    updated: s.updateTime || null, changePct: s.percentageChange ?? null, high: s.high ?? null, low: s.low ?? null, source: 'IG' };
}

// Statuskontroll: loggar in och hämtar alla marknader en gång (utan att visa några hemligheter).
export async function igStatus() {
  if (!igEnabled()) return { enabled: false, note: 'IG_API_KEY, IG_IDENTIFIER och IG_PASSWORD är inte satta i Vercel.' };
  const out = { enabled: true, demo: BASE.includes('demo'), markets: {} };
  try { await login(); out.login = 'ok'; } catch (err) { return { ...out, login: err.message }; }
  for (const sym of Object.keys(IG_MARKETS)) {
    try { const q = await igQuote(sym); out.markets[sym] = q ? { name: q.name, epic: q.epic, price: q.price, status: q.status, delayMin: q.delayMin, updated: q.updated } : 'hittades inte'; }
    catch (err) { out.markets[sym] = err.message; }
  }
  return out;
}
