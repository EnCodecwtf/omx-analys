// Morgonsoffan med Glen: en morgonsession i text varje vardag kl 07.30. Den
// skrivs med regler, helt på data som appen redan har – natten i Asien och USA,
// terminer, VIX, guld, olja, bitcoin och kronan, dagens kalender, FedWatch,
// dina öppna affärer med coachen, aktier nära signal och nattens rubriker.
// Inga AI-tjänster och inga gissningar: varje siffra kommer från datan.

import { fetchBars } from './data.js';

const MARKETS = [
  { group: 'asia', symbol: '^N225', name: 'Nikkei (Tokyo)' },
  { group: 'asia', symbol: '^HSI', name: 'Hang Seng (Hongkong)' },
  { group: 'asia', symbol: '000001.SS', name: 'Shanghai' },
  { group: 'asia', symbol: '^KS11', name: 'Kospi (Seoul)' },
  { group: 'us', symbol: '^GSPC', name: 'S&P 500' },
  { group: 'us', symbol: '^IXIC', name: 'Nasdaq' },
  { group: 'fut', symbol: 'ES=F', name: 'S&P 500-terminen' },
  { group: 'fut', symbol: 'NQ=F', name: 'Nasdaq-terminen' },
  { group: 'risk', symbol: '^VIX', name: 'VIX' },
  { group: 'raw', symbol: 'GC=F', name: 'Guld' },
  { group: 'raw', symbol: 'BZ=F', name: 'Olja (Brent)' },
  { group: 'raw', symbol: 'BTC-USD', name: 'Bitcoin' },
  { group: 'raw', symbol: 'SEK=X', name: 'Dollarn mot kronan' },
  { group: 'se', symbol: '^OMX', name: 'OMXS30' },
];

const pc = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')} %`;
const num = (v, d = 2) => v.toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
const kr = v => (v >= 1000 ? Math.round(v).toLocaleString('sv-SE') : num(v));

export async function marketMoves() {
  const out = [];
  for (const m of MARKETS) {
    try {
      const b = await fetchBars(m.symbol, { range: '1mo' });
      const a = b[b.length - 1], p = b[b.length - 2];
      if (Date.now() / 1000 - a.t > 5 * 86400) continue; // gammal data
      out.push({ ...m, price: a.c, change: (a.c / p.c - 1) * 100, date: new Date(a.t * 1000).toISOString().slice(0, 10) });
    } catch { /* hoppas över */ }
  }
  return out;
}

// d: { now: Date, moves, macro, calendar, fedwatch, trades, near, panic, news: { market, geo } }
export function buildMorning(d) {
  const sth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', weekday: 'long', day: 'numeric', month: 'long' }).format(d.now);
  const by = s => d.moves.find(m => m.symbol === s);
  const sections = [];
  const mv = m => `${m.name} ${pc(m.change)}`;

  // 1. Natten.
  const asia = d.moves.filter(m => m.group === 'asia'), us = d.moves.filter(m => m.group === 'us'), fut = d.moves.filter(m => m.group === 'fut');
  const avg = l => l.length ? l.reduce((a, m) => a + m.change, 0) / l.length : 0;
  const tone = v => v <= -2 ? 'tungt' : v <= -0.5 ? 'svagt' : v < 0.5 ? 'blandat' : v < 2 ? 'starkt' : 'mycket starkt';
  const night = [];
  // Datumet på senaste stapeln avgör om det är gårdagens stängning eller handel just nu.
  const todaySth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(d.now);
  const live = l => l.some(m => m.date === todaySth);
  if (us.length) night.push(live(us) ? `USA handlas ${tone(avg(us))} just nu: ${us.map(mv).join(', ')}.` : `USA stängde ${tone(avg(us))} senast: ${us.map(mv).join(', ')}.`);
  if (asia.length) night.push(`I Asien var det ${tone(avg(asia))} i natt: ${asia.map(mv).join(', ')}.`);
  if (fut.length) night.push(`Terminerna i USA just nu: ${fut.map(mv).join(', ')}.`);
  const omx = by('^OMX');
  if (omx) night.push(omx.date === todaySth ? `OMXS30 står på ${kr(omx.price)} i dag (${pc(omx.change)}).` : `OMXS30 stängde senast på ${kr(omx.price)} (${pc(omx.change)}).`);
  sections.push({ title: 'Natten och världen', lines: night });

  // 2. Risk, råvaror och valuta.
  const vix = by('^VIX');
  const risk = [];
  if (vix) risk.push(`VIX står på ${num(vix.price, 1)} (${pc(vix.change)}). ${vix.price >= 25 ? 'Det är rädsla på riktigt – sådana lägen är när strategin brukar hitta sina bästa köp.' : vix.price >= 20 ? 'Oron är förhöjd, och det ger makropoäng för köpsignaler.' : vix.price < 15 ? 'Marknaden är mycket lugn – få signaler i sådana lägen.' : 'Normalt läge.'}`);
  const raw = d.moves.filter(m => m.group === 'raw');
  if (raw.length) risk.push(raw.map(m => `${m.name} ${m.symbol === 'SEK=X' ? num(m.price) + ' kr' : m.symbol === 'BTC-USD' ? Math.round(m.price).toLocaleString('sv-SE') + ' $' : num(m.price) + ' $'} (${pc(m.change)})`).join(' · ') + '.');
  sections.push({ title: 'Risk, råvaror och kronan', lines: risk });

  // 3. Dagens kalender.
  const cal = [];
  const today = (d.calendar?.events || []).filter(e => e.days === 0);
  for (const e of today.filter(e => e.kind === 'macro')) cal.push(`Kl ${e.time}: ${e.label}${e.last ? ` – förra utfallet ${e.last.text}${e.last.period ? ` (${e.last.period})` : ''}` : ''}.${e.fedwatch ? ` Marknaden prisar ${Math.round(e.fedwatch.hike)} % höjning och ${Math.round(e.fedwatch.cut)} % sänkning.` : ''}`);
  for (const e of today.filter(e => e.kind === 'report')) cal.push(`Rapport från ${e.name}${e.open ? ' – du har en öppen affär här, räkna med större rörelser' : ''}.`);
  const soon = (d.calendar?.events || []).filter(e => e.days >= 1 && e.days <= 2 && (e.kind === 'macro' || e.open));
  if (soon.length) cal.push(`Snart: ${soon.map(e => `${e.kind === 'report' ? 'rapport ' + e.name : e.label} ${e.days === 1 ? 'i morgon' : 'i övermorgon'}`).join(', ')}.`);
  const fw = d.fedwatch?.meetings?.[0];
  if (fw && !today.some(e => e.fedwatch)) cal.push(`FedWatch inför Feds möte ${fw.date}: ${Math.round(fw.hike)} % höjning, ${Math.round(fw.hold)} % oförändrat, ${Math.round(fw.cut)} % sänkning.`);
  if (!cal.length) cal.push('Inga stora makrobesked eller rapporter i dag. En dag där tekniken och flödena får styra.');
  sections.push({ title: 'Dagens kalender', lines: cal });

  // 4. Dina affärer.
  const tr = d.trades.map(e => {
    const line = e.coach?.lines?.slice(0, 2).join(' ') || `${e.name}: ${e.state}.`;
    return `${line}`;
  });
  sections.push({ title: 'Dina affärer', lines: tr.length ? tr : ['Inga öppna affärer just nu. Tålamod är också en position.'] });

  // 5. Signaler på väg.
  const sig = [];
  const m = d.macro;
  if (m) sig.push(m.score >= m.need ? `Makroläget är gynnsamt (poäng ${m.score}). Köpsignaler kan släppas vid stängningen.` : `Makropoängen är ${m.score} och behöver vara ${m.need}. ${m.summary || ''}`.trim());
  if (d.signals?.length) sig.push(`Köpsignal just nu: ${d.signals.map(r => r.name).join(', ')}. Bekräftas vid stängningen 17.30.`);
  if (d.near?.length) sig.push(`Ett krav från signal: ${d.near.map(r => `${r.name} (saknar ${r.missingText})`).join(', ')}.`);
  if (d.panic) sig.push(d.panic.active ? `Panikveckan är aktiv: VIX stängde i går på ${num(d.panic.vix, 1)}.` : vix && vix.price >= 25 ? `VIX är över 25 just nu. Stänger den där i kväll kan panikveckan slå till i morgon.` : '');
  sections.push({ title: 'Signaler på väg', lines: sig.filter(Boolean) });

  // 6. Rubriker.
  const head = [...(d.news?.market || []).slice(0, 3), ...(d.news?.geo || []).slice(0, 2)];
  if (head.length) sections.push({ title: 'Rubriker', lines: head.map(n => `${n.title} (${n.source})`), links: head.map(n => n.link) });

  // Inledning och sammanfattning.
  const mood = avg([...us, ...asia, ...fut]);
  const hour = +new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', hour12: false }).format(d.now);
  const intro = `God ${hour < 10 ? 'morgon' : hour < 18 ? 'dag' : 'kväll'}! Det är ${sth} och du sitter i Morgonsoffan med Glen. ${mood <= -1.5 ? 'Det är tungt på marknaderna – andas, följ planen och låt stoppen göra sitt jobb.' : mood <= -0.5 ? 'Lite motvind, men inget som ändrar planen.' : mood < 0.5 ? 'Ett lugnt läge på marknaderna.' : 'Medvind på marknaderna – skönt, men bli inte girig.'}`;
  const outro = 'Handla planen, inte känslan. Vi ses på soffan i morgon!';
  const summary = [us.length && `USA ${pc(avg(us))}`, asia.length && `Asien ${pc(avg(asia))}`, vix && `VIX ${num(vix.price, 1)}`, d.trades.length && `${d.trades.length} ${d.trades.length === 1 ? "öppen affär" : "öppna affärer"}`].filter(Boolean).join(' · ');
  return { date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(d.now), intro, summary, sections, outro, createdAt: d.now.toISOString() };
}
