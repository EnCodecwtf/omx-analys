// Hävstångsprodukter på Avanza: minifutures, turbos och bull-certifikat.
// Hämtas från samma (inofficiella) API som Avanzas egen produktlista och
// filtreras så att bara papper med säker hävstång rekommenderas.

const BASE = 'https://www.avanza.se/_api';
const CACHE_MS = 60 * 1000;
const cache = new Map();

async function post(path, body) {
  const res = await fetch(`${BASE}/${path}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (omx-analys)' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Avanza svarade ${res.status}`);
  return res.json();
}

// side: 'long' (minifutures long, bull) eller 'short' (minifutures short, bear).
export async function fetchProducts(underlyingId, side = 'long') {
  const key = `${underlyingId}:${side}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const sortBy = { field: 'totalValueTraded', order: 'desc' };
  const [minis, bulls] = await Promise.all([
    post('market-warrant-filter', {
      filter: { directions: [side], underlyingInstruments: [underlyingId], subTypes: ['mini_future', 'knock_out', 'turbo'],
        issuers: [], endDates: [], categories: [], exposures: [] },
      offset: 0, limit: 200, sortBy,
    }),
    post('market-certificate-filter', {
      filter: { directions: [side], underlyingInstruments: [underlyingId], subTypes: ['bull_bear'], leverages: [],
        issuers: [], exposures: [], marketplaceCodes: [], categories: [] },
      offset: 0, limit: 200, sortBy,
    }),
  ]);
  const value = { minis: minis.warrants || [], bulls: bulls.certificates || [], at: Date.now() };
  cache.set(key, { at: Date.now(), value });
  return value;
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Avanzas sida för en aktie eller ett index. Namnet i adressen är bara för
// läsbarhet, Avanza hittar sidan via id:t.
export function avanzaUrl(meta) {
  if (!meta?.avanzaId) return null;
  const kind = meta.isIndex ? 'index/om-indexet.html' : 'aktier/om-aktien.html';
  return `https://www.avanza.se/${kind}/${meta.avanzaId}/${slug(meta.name.replace(/[åä]/gi, 'a').replace(/ö/gi, 'o'))}`;
}

const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

// Väljer de bästa papperna för en köpsignal.
//   plan:   { entry, stop, tps } från analysen
//   atr:    ATR för underliggande
// Reglerna för säker hävstång:
//   - knock-out ligger minst 1 ATR under signalens stopp (stoppet nås först)
//   - förlusten i pappret om stoppet nås är högst 35 %
//   - hävstången är högst 12x (index) eller 6x (aktie); bull-certifikat högst 5x / 3x
//   - det finns en säljkurs (pappret är inte slutsålt) och spreaden är högst 1,5 %
// side 'short': samma regler spegelvänt, knock-out minst 1 ATR över stoppet.
export function recommend({ minis, bulls }, { plan, atr, isIndex, side = 'long' }) {
  const dir = side === 'short' ? -1 : 1;
  const price = plan.entry;
  const riskPct = dir * (plan.entry - plan.stop) / plan.entry;
  const tp1Pct = dir * (plan.tps[0].price - plan.entry) / plan.entry;
  const tp2Pct = dir * (plan.tps[1].price - plan.entry) / plan.entry;
  const maxLev = isIndex ? 12 : 6;
  const target = isIndex ? 7 : 4;
  const maxLoss = 0.35;
  const rejected = { soldOut: 0, spread: 0, knockout: 0, leverage: 0 };

  const miniOut = [];
  for (const m of minis) {
    const ko = m.stopLoss ?? m.financingLevel;
    if (!m.sellPrice || !m.buyPrice || ko == null || !m.financingLevel) { rejected.soldOut++; continue; }
    const spread = (m.sellPrice - m.buyPrice) / m.sellPrice;
    const lev = m.leverage || price / (dir * (price - m.financingLevel));
    if (spread > 0.015) { rejected.spread++; continue; }
    const buffer = dir * (plan.stop - ko) / atr;
    if (buffer < 1) { rejected.knockout++; continue; }
    if (!(lev > 1) || lev > maxLev || lev * riskPct > maxLoss) { rejected.leverage++; continue; }
    const ava = /\bAVA\b/.test(m.name);
    const score = -spread * 400 - Math.abs(lev - target) * 1.0 + Math.log10(1 + (m.totalValueTraded || 0)) * 0.6
      + (m.subType === 'MINI_FUTURE' ? 1 : 0) + (ava ? 0.5 : 0) + Math.min(buffer, 3) * 0.3;
    miniOut.push({
      id: m.orderbookId, name: m.name, issuer: m.issuer, kind: (m.subType === 'MINI_FUTURE' ? 'Mini future' : 'Turbo') + (dir < 0 ? ' (kort)' : ''),
      leverage: round(lev, 1), spreadPct: round(spread * 100), bid: m.buyPrice, ask: m.sellPrice,
      knockout: round(ko), financing: round(m.financingLevel), koDistPct: round(dir * (price - ko) / price * 100, 1),
      bufferAtr: round(buffer, 1), lossAtStopPct: round(lev * riskPct * 100, 0),
      gainTp1Pct: round(lev * tp1Pct * 100, 0), gainTp2Pct: round(lev * tp2Pct * 100, 0),
      turnover: m.totalValueTraded || 0, ava, score,
      url: `https://www.avanza.se/borshandlade-produkter/warranter-torg/om-warranten.html/${m.orderbookId}/${slug(m.name)}`,
    });
  }

  const maxBull = isIndex ? 5 : 3;
  const bullOut = [];
  for (const b of bulls) {
    if (!b.sellPrice || !b.buyPrice || !b.leverage) { rejected.soldOut++; continue; }
    const spread = (b.sellPrice - b.buyPrice) / b.sellPrice;
    if (spread > 0.015) { rejected.spread++; continue; }
    if (b.leverage > maxBull || b.leverage * riskPct > maxLoss) { rejected.leverage++; continue; }
    const ava = /\bAVA\b/.test(b.name);
    const score = -spread * 400 + Math.log10(1 + (b.totalValueTraded || 0)) * 0.8 + (ava ? 0.5 : 0) + b.leverage * 0.3;
    bullOut.push({
      id: b.orderbookId, name: b.name, issuer: b.issuer, kind: dir < 0 ? 'Bear (daglig hävstång)' : 'Bull (daglig hävstång)',
      leverage: b.leverage, spreadPct: round(spread * 100), bid: b.buyPrice, ask: b.sellPrice,
      lossAtStopPct: round(b.leverage * riskPct * 100, 0),
      gainTp1Pct: round(b.leverage * tp1Pct * 100, 0), gainTp2Pct: round(b.leverage * tp2Pct * 100, 0),
      turnover: b.totalValueTraded || 0, ava, score,
      url: `https://www.avanza.se/borshandlade-produkter/certifikat-torg/om-certifikatet.html/${b.orderbookId}/${slug(b.name)}`,
    });
  }

  // Sprid rekommendationerna över olika hävstång så att det finns ett
  // alternativ kvar om ett papper är slutsålt eller får hög spread.
  miniOut.sort((a, b) => b.score - a.score);
  const picks = [];
  for (const m of miniOut) {
    if (picks.length === 3) break;
    if (picks.some(p => Math.abs(p.leverage - m.leverage) < 0.6 || p.knockout === m.knockout)) continue;
    picks.push(m);
  }
  for (const m of miniOut) { if (picks.length === 3) break; if (!picks.includes(m)) picks.push(m); }
  bullOut.sort((a, b) => b.score - a.score);

  return {
    minis: picks.map(({ score, ...x }) => x),
    bulls: bullOut.slice(0, 2).map(({ score, ...x }) => x),
    rules: { maxLev, maxBull, maxLossPct: maxLoss * 100, koBufferAtr: 1, maxSpreadPct: 1.5 },
    checked: minis.length + bulls.length,
    rejected,
  };
}
