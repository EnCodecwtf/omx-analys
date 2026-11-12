// Experiment som mäts framåt. Båda höll i känslighetstester 2015–2026 (träning 2015–2020,
// test 2021–2026), men bygger på få affärer och kan sluta fungera. Liten insats.
//
// 1. NFP-guld: om guldet stiger mer än 0,5 % på NFP-fredagen (första fredagen i månaden,
//    räknat till stängningskursen 13.30 i New York) köps guld. Stopp 1 ATR, mål 2 ATR,
//    annars stängs affären onsdagen efter. Bara köp. Plus i 11 av 12 år.
// 2. Fed-vändning: på dagen för Feds räntebesked tas en position MOT dagens rörelse i silver
//    och Brentolja, som hålls i tre dagar. Stopp 2 ATR (skyddar inte mot gap). Halv insats,
//    eftersom en enskild affär i testet gav −21 % (oljekraschen 2020).

const day = t => new Date(t * 1000).toISOString().slice(0, 10);
const round = x => Math.round(x * 100) / 100;
export const EXP_COST = 0.0006;

export const EXPERIMENTS = {
  'nfp-gold': { id: 'nfp-gold', title: 'NFP-guld', symbol: 'GC=F', asset: 'Guld', event: 'nfp', fade: false, longOnly: true, thr: 0.005, stop: 1, tp: 2, hold: 5, size: 1, settle: 13 * 60 + 30 },
  'fed-silver': { id: 'fed-silver', title: 'Fed-vändning silver', symbol: 'SI=F', asset: 'Silver', event: 'fed', fade: true, longOnly: false, thr: 0, stop: 2, tp: null, hold: 3, size: 0.5, settle: 13 * 60 + 30 },
  'fed-brent': { id: 'fed-brent', title: 'Fed-vändning Brent', symbol: 'BZ=F', asset: 'Olja (Brent)', event: 'fed', fade: true, longOnly: false, thr: 0, stop: 2, tp: null, hold: 3, size: 0.5, settle: 14 * 60 + 30 },
};

const wd = d => new Date(d + 'T12:00:00Z').getUTCDay();
export const isNfpDay = d => wd(d) === 5 && +d.slice(8) <= 7;
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// Säljdag: första vardagen på eller efter signaldagen + hold kalenderdagar.
export function exitDateFor(d, hold) { let x = addDays(d, hold); while (wd(x) === 0 || wd(x) === 6) x = addDays(x, 1); return x; }

function atr14(bars) {
  let a = null;
  for (let i = 1; i < bars.length; i++) { const b = bars[i], p = bars[i - 1]; const tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)); a = a == null ? tr : (a * 13 + tr) / 14; }
  return a;
}

// Signal för ett experiment på dagens datum (New York), räknat när stängningskursen är satt.
// bars: dagsstaplar till och med idag. Returnerar en post för signalloggen eller null.
export function experimentSignal(x, bars, { date, nyMin, fomc }) {
  const isEvent = x.event === 'nfp' ? isNfpDay(date) : fomc.has(date);
  if (!isEvent || nyMin < x.settle + 10) return null;
  const i = bars.findIndex(b => day(b.t) === date);
  if (i < 15) return null;
  const c = bars[i].c, prev = bars[i - 1].c, move = c / prev - 1;
  if (!move || Math.abs(move) < x.thr) return null;
  const dir = x.fade ? -Math.sign(move) : Math.sign(move);
  if (x.longOnly && dir < 0) return null;
  const a = atr14(bars.slice(0, i + 1));
  return {
    kind: 'exp', exp: x.id, date, symbol: x.symbol, name: x.asset, side: dir > 0 ? 'lång' : 'kort', dir,
    close: round(c), move: round(move * 100), stop: round(c - dir * x.stop * a), tp: x.tp ? round(c + dir * x.tp * a) : null,
    exitDate: exitDateFor(date, x.hold), size: x.size, title: x.title, loggedAt: new Date().toISOString(),
  };
}

// Utfall: inträde på signaldagens stängningskurs, ut vid stopp, mål eller stängningen säljdagen.
export function expOutcome(e, bars) {
  const i = bars.findIndex(b => day(b.t) === e.date);
  if (i < 0) return { state: 'okänd' };
  const dir = e.dir || (e.side === 'kort' ? -1 : 1), entry = e.close;
  let exit = null, why = null, k = i + 1;
  for (; k < bars.length; k++) {
    const b = bars[k];
    if (dir > 0 ? b.l <= e.stop : b.h >= e.stop) { exit = dir > 0 ? Math.min(e.stop, b.o) : Math.max(e.stop, b.o); why = 'stopp'; break; }
    if (e.tp != null && (dir > 0 ? b.h >= e.tp : b.l <= e.tp)) { exit = e.tp; why = 'mål'; break; }
    if (day(b.t) >= e.exitDate) { exit = b.c; why = 'säljdag'; break; }
  }
  const last = bars.at(-1).c;
  if (exit == null) return { state: 'öppen', entry, last, pct: round((dir * (last / entry - 1) - EXP_COST) * 100) };
  return { state: 'stängd', entry, last, why, exitDate: day(bars[k].t), pct: round((dir * (exit / entry - 1) - EXP_COST) * 100) };
}

// 3. Asien-guld (daglig): guldets rörelse under asiatiska sessionen (19.00 → 02.00 New York)
//    följs fram till 09.30 New York (08.00 → 15.30 svensk tid). Båda riktningarna, stopp 1 %.
//    Testat bara 2024–2026 (timdata): +20 500 USD för 0,1 lot, t ≥ 2 i båda halvorna. Enligt
//    andras test förlorade regeln 2015–2023 – därför pausas den om de senaste 40 affärerna gått minus.
export const ASIA = { id: 'asia-gold', title: 'Asien-guld', symbol: 'GC=F', asset: 'Guld', entry: 2 * 60, look: 7, exit: 9 * 60 + 30, stopPct: 0.01, size: 0.5, pauseAfter: 40 };

// hours: timstaplar { t, d (New York-datum), hm (minut i New York), o, h, l, c } i tidsordning.
export function asiaSignal(hours, { date, nyMin }) {
  const wdNum = new Date(date + 'T12:00:00Z').getUTCDay();
  if (wdNum === 0 || wdNum === 6 || nyMin < ASIA.entry + 5 || nyMin > ASIA.entry + 120) return null;
  const b = hours.find(x => x.d === date && x.hm === ASIA.entry);
  if (!b) return null;
  let a0 = null; for (const x of hours) { if (x.t <= b.t - ASIA.look * 3600) a0 = x; else break; }
  if (!a0) return null;
  const move = b.o / a0.o - 1;
  if (!move) return null;
  const dir = Math.sign(move);
  return { kind: 'exp', exp: ASIA.id, date, symbol: ASIA.symbol, name: ASIA.asset, side: dir > 0 ? 'lång' : 'kort', dir,
    close: round(b.o), move: round(move * 100), stop: round(b.o * (1 - dir * ASIA.stopPct)), tp: null, exitDate: date, exitAt: '15.30',
    size: ASIA.size, title: ASIA.title, loggedAt: new Date().toISOString() };
}

export function asiaOutcome(e, hours) {
  const start = hours.findIndex(x => x.d === e.date && x.hm === ASIA.entry);
  if (start < 0) return { state: 'okänd' };
  const dir = e.dir || (e.side === 'kort' ? -1 : 1), entry = e.close;
  const exitBar = hours.find(x => x.d === e.date && x.hm === Math.floor(ASIA.exit / 60) * 60);
  for (let k = start; k < hours.length; k++) {
    const x = hours[k];
    if (x.d !== e.date || x.hm > ASIA.exit) break;
    if (dir > 0 ? x.l <= e.stop : x.h >= e.stop) return { state: 'stängd', entry, last: x.c, why: 'stopp', exitDate: e.date, pct: round((dir * (e.stop / entry - 1) - EXP_COST) * 100) };
  }
  const last = hours.at(-1);
  if (!exitBar || (last.d === e.date && last.hm < ASIA.exit)) return { state: 'öppen', entry, last: last.c, pct: round((dir * (last.c / entry - 1) - EXP_COST) * 100) };
  const px = (exitBar.o + exitBar.c) / 2; // ≈ 09.30
  return { state: 'stängd', entry, last: px, why: 'säljdag', exitDate: e.date, pct: round((dir * (px / entry - 1) - EXP_COST) * 100) };
}

// 4. Fed-natten: Nasdaq har stigit natten före Feds räntebesked (stängning dagen före → öppning
//    beslutsdagen): +0,27 % mot +0,05 % en vanlig natt, t 4,2, upp 71 % av gångerna. Lika i
//    2015–2020 och 2021–2026 (Lucca & Moench 2015 visade effekten fram till 2011). Själva
//    beslutsdagen ger inget extra, så affären stängs när USA öppnar. Med en Nasdaq-mini på
//    cirka 3x gav det +0,52 % per affär efter spread (sämsta affär −3,4 %).
export const FED_NIGHT = { id: 'fed-night', title: 'Fed-natten', symbol: 'QQQ', asset: 'Nasdaq 100', lev: 3, size: 0.5, from: 15 * 60 + 20, to: 15 * 60 + 58, exitMin: 9 * 60 + 30 };

// date: New York-datum idag, fedDay: nästa handelsdag om den är ett Fed-beslut (annars null).
export function fedNightSignal(bars, { date, nyMin, fedDay }) {
  if (!fedDay || nyMin < FED_NIGHT.from || nyMin > FED_NIGHT.to) return null;
  const b = bars.find(x => day(x.t) === date);
  if (!b) return null;
  return { kind: 'exp', exp: FED_NIGHT.id, date, symbol: FED_NIGHT.symbol, name: FED_NIGHT.asset, side: 'lång', dir: 1, close: round(b.c), move: 0, stop: null, tp: null,
    exitDate: fedDay, exitAt: '15.30', lev: FED_NIGHT.lev, size: FED_NIGHT.size, title: FED_NIGHT.title, loggedAt: new Date().toISOString() };
}

// Utfall: köp på stängningen signaldagen, sälj på öppningen beslutsdagen (procent i Nasdaq, utan hävstång).
export function fedNightOutcome(e, bars) {
  const i = bars.findIndex(b => day(b.t) === e.date);
  if (i < 0) return { state: 'okänd' };
  const entry = bars[i].c, j = bars.findIndex(b => day(b.t) === e.exitDate);
  if (j < 0) { const last = bars.at(-1).c; return { state: 'öppen', entry, last, pct: round((last / entry - 1 - EXP_COST) * 100) }; }
  return { state: 'stängd', entry, last: bars[j].o, why: 'säljdag', exitDate: e.exitDate, pct: round((bars[j].o / entry - 1 - EXP_COST) * 100) };
}
