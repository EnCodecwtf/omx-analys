// Månadens aktier: momentum bland S&P 500-bolagen med skydd.
//
// Reglerna (testade 2006–2026 på historiska S&P 500-medlemmar):
//   1. Rangordna bolagen på kursutvecklingen över elva månader, där den senaste
//      hela månaden hoppas över (12-1-momentum). Signalen är alltså känd en månad i förväg.
//   2. Äg de två bästa med lika vikt. En aktie behålls så länge den är bland de fyra bästa.
//   3. Ligger S&P 500 (SPY) under sitt 200-dagars medelvärde: inga aktier.
//   4. Ligger en aktie mer än 25 % under sitt högsta de senaste 12 månaderna köps den inte.
//   5. Platser som inte går till aktier går till kassaläget: hälften guld lång och
//      hälften olja kort.
//   6. Byte sker på stängningen sista handelsdagen i New York varje månad (strax före 22.00 svensk tid).
// Hävstång: minifutures med cirka 1,8x på aktierna och 1,5x i kassaläget. Saknas en
// mini med just den hävstången väljs den med hävstång närmast målet. Hela beloppet läggs i pappret.

export const RULES = { slots: 2, keepTop: 4, maxFromHigh: -0.25, stockLev: 1.8, cashLev: 1.5 };
export const GOLD = { id: '18986', name: 'Guld', yahoo: 'GC=F', side: 'long' };
export const OIL = { id: '155722', name: 'Olja (Brent)', yahoo: 'BZ=F', side: 'short' };

const iso = d => d.toISOString().slice(0, 10);
const ymd = (y, m, d) => iso(new Date(Date.UTC(y, m - 1, d)));
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const addMonths = (ym, k) => { let [y, m] = ym.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };

// n:te veckodagen wd (0 = söndag) i månaden, eller sista om n = -1.
function nthWeekday(y, m, wd, n) {
  if (n > 0) { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return ymd(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7); }
  const last = new Date(Date.UTC(y, m, 0)); return iso(new Date(Date.UTC(y, m - 1, last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7))));
}
function easter(y) { // Gregoriansk påsk (anonym algoritm)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1; return ymd(y, month, day);
}
// Helgdag på lördag flyttas till fredag, på söndag till måndag.
const observed = s => { const w = new Date(s + 'T12:00:00Z').getUTCDay(); return w === 6 ? addDays(s, -1) : w === 0 ? addDays(s, 1) : s; };
const holidayCache = new Map();
export function nyseHolidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const set = new Set([
    observed(ymd(y, 1, 1)), nthWeekday(y, 1, 1, 3), nthWeekday(y, 2, 1, 3), addDays(easter(y), -2), nthWeekday(y, 5, 1, -1),
    ...(y >= 2022 ? [observed(ymd(y, 6, 19))] : []), observed(ymd(y, 7, 4)), nthWeekday(y, 9, 1, 1), nthWeekday(y, 11, 4, 4), observed(ymd(y, 12, 25)),
  ]);
  holidayCache.set(y, set);
  return set;
}
export const isNyseDay = s => { const w = new Date(s + 'T12:00:00Z').getUTCDay(); return w !== 0 && w !== 6 && !nyseHolidays(+s.slice(0, 4)).has(s); };
export function lastTradingDay(ym) {
  const [y, m] = ym.split('-').map(Number);
  let d = iso(new Date(Date.UTC(y, m, 0)));
  while (!isNyseDay(d)) d = addDays(d, -1);
  return d;
}

// Datum och klockslag i New York.
export function nyNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}

// Senaste genomförda bytesdag (sista handelsdagen i en månad vars stängning har passerat)
// och nästa kommande.
export function rebalanceDays(now = new Date()) {
  const ny = nyNow(now), ym = ny.date.slice(0, 7);
  const thisLast = lastTradingDay(ym);
  const passed = ny.date > thisLast || (ny.date === thisLast && ny.min >= 16 * 60 + 15);
  const last = passed ? thisLast : lastTradingDay(addMonths(ym, -1));
  const next = passed ? lastTradingDay(addMonths(ym, 1)) : thisLast;
  return { last, next, today: ny.date, nyMin: ny.min, isToday: ny.date === thisLast && !passed };
}

// 12-1-momentum för målmånaden: kursen i slutet av månaden två månader före målmånaden
// mot slutet av månaden tretton månader före. monthly: [{ m: 'ÅÅÅÅ-MM', c }] (justerad stängning).
export function momentum(monthly, target) {
  const by = new Map(monthly.map(x => [x.m, x.c]));
  const a = by.get(addMonths(target, -2)), b = by.get(addMonths(target, -13));
  return a > 0 && b > 0 ? a / b - 1 : null;
}

export function rank(series, target) {
  return series.map(s => ({ symbol: s.symbol, name: s.name, avanzaId: s.avanzaId || null, mom: momentum(s.monthly, target) }))
    .filter(x => x.mom != null && Number.isFinite(x.mom)).sort((a, b) => b.mom - a.mom);
}

const sma = (a, n) => a.length >= n ? a.slice(-n).reduce((s, x) => s + x, 0) / n : null;

// Beslutet för en bytesdag. closes(symbol) ska ge dagliga stängningar till och med bytesdagen.
//   ranked: rank() för målmånaden, held: symbolerna som ägs nu, spy: SPY:s stängningar.
export function decide({ ranked, held = [], spy, closes, rules = RULES }) {
  const spyLast = spy.at(-1), spy200 = sma(spy, 200);
  const below = spy200 != null && spyLast < spy200;
  const checks = new Map();
  const ok = sym => {
    if (checks.has(sym)) return checks.get(sym).ok;
    const c = closes(sym) || [];
    const yr = c.slice(-252), hi = yr.length ? Math.max(...yr) : null, last = c.at(-1);
    const fromHigh = hi && last ? last / hi - 1 : null;
    const r = { ok: fromHigh != null && fromHigh >= rules.maxFromHigh, fromHigh, last };
    checks.set(sym, r);
    return r.ok;
  };
  const slots = [];
  const skipped = [];
  if (!below) {
    const pos = new Map(ranked.map((x, i) => [x.symbol, i]));
    // Behåll det som fortfarande är bland de fyra bästa och inte har rasat.
    for (const sym of held) { const i = pos.get(sym); if (i != null && i < rules.keepTop && ok(sym) && slots.length < rules.slots) slots.push({ ...ranked[i], rank: i + 1, kept: true }); }
    // Fyll på uppifrån. En aktie som rasat lämnar sin plats åt kassaläget.
    for (let i = 0; i < ranked.length && slots.length < rules.slots; i++) {
      const x = ranked[i];
      if (slots.some(s => s && s.symbol === x.symbol)) continue;
      if (!ok(x.symbol)) { skipped.push({ ...x, rank: i + 1, fromHigh: checks.get(x.symbol).fromHigh }); slots.push(null); continue; }
      slots.push({ ...x, rank: i + 1, kept: false });
    }
  }
  while (slots.length < rules.slots) slots.push(null);
  const stocks = slots.filter(Boolean).map(s => ({ ...s, fromHigh: checks.get(s.symbol)?.fromHigh ?? null, price: checks.get(s.symbol)?.last ?? null }));
  const cashShare = (rules.slots - stocks.length) / rules.slots;
  return {
    mode: stocks.length === rules.slots ? 'aktier' : stocks.length ? 'delvis' : 'kassa',
    stocks, cashShare, skipped,
    spy: { close: spyLast, sma200: spy200 == null ? null : Math.round(spy200 * 100) / 100, below },
    sold: held.filter(sym => !stocks.some(s => s.symbol === sym)),
  };
}

// Minsta order: under 1 000 kr tar Avanza courtage även på AVA-papper.
export const MIN_ORDER = 1000;
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Rangordnar minifutures efter hur väl de passar: hävstång nära målet, låg spread
// och AVA-papper (inget courtage) först.
export function rankMinis(warrants, { target, side = 'long' }) {
  const out = [];
  for (const w of warrants || []) {
    if (w.subType && w.subType !== 'MINI_FUTURE') continue;
    if (!w.sellPrice || !w.buyPrice || !w.leverage || w.leverage < 1) continue;
    const spread = (w.sellPrice - w.buyPrice) / w.sellPrice;
    if (spread > 0.01) continue;
    const ava = /\bAVA\b/.test(w.name);
    const gap = w.leverage >= target ? (w.leverage - target) / target : (target - w.leverage) / target * 2;
    const score = gap * 3 + spread * 100 + (ava ? 0 : 4) - Math.log10(1 + (w.totalValueTraded || 0)) * 0.05;
    out.push({ id: w.orderbookId, name: w.name, issuer: w.issuer, ava, side, leverage: Math.round(w.leverage * 100) / 100, spreadPct: Math.round(spread * 10000) / 100,
      bid: w.buyPrice, ask: w.sellPrice, financing: w.financingLevel ?? null, stopLoss: w.stopLoss ?? null, score,
      url: `https://www.avanza.se/borshandlade-produkter/warranter-torg/om-warranten.html/${w.orderbookId}/${slug(w.name)}` });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 10).map(({ score, ...x }) => x);
}

// Väljer papper för en plats. Hävstången sitter i pappret, så hela beloppet läggs i
// det papper som har hävstång närmast målet (högst cirka 35 % över). AVA-papper först
// (inget courtage från 1 000 kr). Ingen order under 1 000 kr.
export function chooseMini(list, { target, money, minOrder = MIN_ORDER, maxLev = target * 1.35 }) {
  if (!list?.length || !(money >= minOrder)) return null;
  const make = (p, note = null) => ({ ...p, order: Math.round(money), note });
  const closest = (a, b) => Math.abs(a.leverage - target) + a.spreadPct * 0.5 - (Math.abs(b.leverage - target) + b.spreadPct * 0.5);
  const ok = list.filter(p => p.leverage <= maxLev);
  const ava = ok.filter(p => p.ava).sort(closest)[0];
  if (ava) return make(ava);
  const any = ok.sort(closest)[0];
  if (any) return make(any, 'Det finns inget AVA-papper med så låg hävstång – courtage kan tillkomma.');
  const low = list.slice().sort((a, b) => a.leverage - b.leverage)[0];
  return make(low, `Lägsta hävstången som finns är ${String(low.leverage).replace('.', ',')}x.`);
}

export function pickMini(warrants, { target, side = 'long', money = 10 * MIN_ORDER }) {
  return chooseMini(rankMinis(warrants, { target, side }), { target, money });
}

// Värdet i en minifuture med hävstång L som köptes när kursen var S0 (ränta på finansieringen ingår inte).
export function miniGrowth(S0, S1, L, side = 'long') {
  if (!(S0 > 0 && S1 > 0)) return 1;
  if (side === 'short') { const F = S0 * (1 + 1 / L); return Math.max(0, (F - S1) / (F - S0)); }
  const F = S0 * (1 - 1 / L); return Math.max(0, (S1 - F) / (S0 - F));
}

export const nextNyseDay = s => { let d = addDays(s, 1); while (!isNyseDay(d)) d = addDays(d, 1); return d; };

// Beräknat resultat för en period (från bytesdagen till nästa, eller till nu):
// lika vikt per plats, aktier i mini 1,8x räknat från köpkursen (minin behålls),
// kassaläget hälften guld lång och hälften olja kort med 1,5x.
export function periodReturn(h, end, rules = RULES) {
  if (!end) return null;
  let lev = 0, raw = 0;
  const w = 1 / rules.slots;
  for (const s of h.stocks) {
    const p1 = end.prices?.[s.symbol];
    if (!(p1 > 0) || !(s.price > 0)) return null;
    lev += w * (miniGrowth(s.entry, p1, rules.stockLev) / miniGrowth(s.entry, s.price, rules.stockLev) - 1);
    raw += w * (p1 / s.price - 1);
  }
  if (h.cashShare > 0) {
    if (!(h.gold > 0 && h.oil > 0 && end.gold > 0 && end.oil > 0)) return null;
    const g = end.gold / h.gold - 1, o = end.oil / h.oil - 1;
    lev += h.cashShare * (0.5 * (miniGrowth(h.gold, end.gold, rules.cashLev) - 1) + 0.5 * (miniGrowth(h.oil, end.oil, rules.cashLev, 'short') - 1));
    raw += h.cashShare * (0.5 * g - 0.5 * o);
  }
  return { lev, raw };
}

// Notistext för ett byte.
export function changeText(cur, next) {
  const held = new Set((cur?.stocks || []).map(s => s.symbol));
  const buy = next.stocks.filter(s => !held.has(s.symbol)), keep = next.stocks.filter(s => held.has(s.symbol));
  const sell = (cur?.stocks || []).filter(s => !next.stocks.some(x => x.symbol === s.symbol));
  const parts = [];
  if (sell.length) parts.push(`Sälj ${sell.map(s => s.name).join(' och ')}.`);
  if (buy.length) parts.push(`Köp ${buy.map(s => s.name).join(' och ')} med mini cirka ${String(RULES.stockLev).replace('.', ',')}x.`);
  if (keep.length) parts.push(`Behåll ${keep.map(s => s.name).join(' och ')}.`);
  const wasCash = cur?.cashShare || 0;
  if (next.cashShare > 0) parts.push(`${next.mode === 'kassa' ? 'Kassaläge' : `Kassaläge för ${Math.round(next.cashShare * 100)} %`}: hälften guld lång, hälften olja kort, ${String(RULES.cashLev).replace('.', ',')}x (allt i guld om beloppet räcker till färre än två order om minst 1 000 kr).`);
  else if (wasCash > 0) parts.push('Sälj guldet och oljan.');
  if (!sell.length && !buy.length && next.cashShare === wasCash) parts.unshift('Inget byte den här månaden.');
  return parts.join(' ');
}

// Fördelning av ett belopp: strategins vikter (lika per aktieplats, kassaplatsen delad
// lika på guld och olja kort). Blir någon order under minsta beloppet delas pengarna lika
// på alla papper; räcker inte heller det tas olja kort bort först. lists: minifutures per del.
export function allocate({ stocks, cashShare }, money, { stockLists = {}, gold = [], oil = [] } = {}, rules = RULES, minOrder = MIN_ORDER) {
  const legs = stocks.map(s => ({ kind: 'stock', symbol: s.symbol, name: s.name, list: stockLists[s.symbol] || s.minis || [], target: rules.stockLev, side: 'long', w: 1 / rules.slots }));
  if (cashShare > 0) {
    legs.push({ kind: 'gold', symbol: GOLD.yahoo, name: 'Guld', list: gold, target: rules.cashLev, side: 'long', w: cashShare / 2 });
    legs.push({ kind: 'oil', symbol: OIL.yahoo, name: 'Olja (Brent)', list: oil, target: rules.cashLev, side: 'short', w: cashShare / 2 });
  }
  let use = legs;
  if (use.some(l => money * l.w < minOrder)) {
    while (use.length > 1 && money / use.length < minOrder) use = use.filter(l => l !== (use.find(x => x.kind === 'oil') || use.at(-1)));
    use = use.map(l => ({ ...l, w: 1 / use.length }));
  }
  return use.map(l => ({ ...l, money: money * l.w, pick: chooseMini(l.list, { target: l.target, money: money * l.w, minOrder }) }));
}

// Utfallet i testet 2006–2026 för beslut mitt i månaden (strategin med årshögsta-regel och guld).
// AI-tradern använder siffrorna när den bedömer om den ska agera inom månaden.
export const INTRAMONTH_TEST = {
  none: { cagr: 26.5, dd: -46 },
  spyBelow: { cagr: 23.3, dd: -53 },
  fromHigh25: { cagr: 17.9, dd: -61 },
  below50: { cagr: 11.9, dd: -53 },
  stop15: { cagr: 18.0, dd: -75 },
};
