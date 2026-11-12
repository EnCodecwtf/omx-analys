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
  { group: 'eu', symbol: '^GDAXI', name: 'DAX' },
  { group: 'eu', symbol: '^STOXX50E', name: 'Euro Stoxx 50' },
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

// FedWatch som fördelning: t.ex. "+0,25 %-enheter 91 %, +0,50 9 %" i stället för bara "100 % höjning".
function fwText(fw, now) {
  const base = now?.lower;
  if (base == null || !fw.dist?.length) return `${Math.round(fw.hike)} % höjning, ${Math.round(fw.hold)} % oförändrat, ${Math.round(fw.cut)} % sänkning`;
  return fw.dist.map(x => { const bp = Math.round((x.lower - base) * 100) / 100; return `${bp === 0 ? 'oförändrat' : `${bp > 0 ? 'höjning' : 'sänkning'} ${String(Math.abs(bp).toFixed(2)).replace('.', ',')} %-enheter`} ${Math.round(x.p)} %`; }).join(', ');
}
// Varje avsnitt märks: fakta (kurser och kalender), analys (systemets tolkning), signal (bara när reglerna är uppfyllda), affärer.
export const SECTION_TYPE = { 'Natten och världen': 'fakta', 'Inför öppningen': 'analys', 'Marknad för marknad': 'analys', 'Dagens fokus': 'fokus', 'Risk, råvaror och kronan': 'fakta', 'Dagens kalender': 'fakta', 'Dina affärer': 'affärer', 'Signaler på väg': 'signal', 'Rubriker': 'fakta' };
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
  const eu = d.moves.filter(m => m.group === 'eu');
  if (eu.length) night.push(live(eu) ? `Europa just nu: ${eu.map(mv).join(', ')}.` : `Europa stängde senast: ${eu.map(mv).join(', ')} – DAX och OMX brukar röra sig åt samma håll, så det ger en fingervisning inför öppningen.`);
  if (fut.length) night.push(`Terminerna i USA just nu: ${fut.map(mv).join(', ')}.`);
  const omx = by('^OMX');
  if (omx) night.push(omx.date === todaySth ? `OMXS30 står på ${kr(omx.price)} i dag (${pc(omx.change)}).` : `OMXS30 stängde senast på ${kr(omx.price)} (${pc(omx.change)}).`);
  sections.push({ title: 'Natten och världen', type: 'fakta', lines: night });

  // 1b. Inför öppningen: sedan Stockholm stängde, och indikationen för OMX och DAX.
  const on = d.overnight;
  if (on?.moves?.length) {
    const pre = [];
    const ind = on.indication || {};
    const w = (k, n) => ind[k] ? `${n} cirka ${pc(ind[k].value)} (spann ${pc(ind[k].lo)} till ${pc(ind[k].hi)})` : null;
    const parts = [w('omx', 'OMXS30'), w('dax', 'DAX')].filter(Boolean);
    if (parts.length) pre.push(`Indikation för öppningen: ${parts.join(', ')}. Den bygger på att S&P 500-terminen rört sig ${pc(ind.omx?.basis ?? ind.dax?.basis)} sedan Stockholm stängde${ind.omx?.hit != null ? `. Av de senaste ${ind.omx.n} handelsdagarna rörde sig terminen mer än 0,3 % ${ind.omx.moved} gånger, och riktningen för OMX stämde ${ind.omx.hits} av dem (${ind.omx.hit} %)${ind.omx.mae != null ? `. Prognosen har i snitt missat med ${num(ind.omx.mae, 2)} procentenheter` : ''}` : ''}.`);
    const asOf = on.moves.map(m => m.asOf).filter(Boolean).sort().at(-1);
    const hhmm = asOf ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' }).format(new Date(asOf)) : null;
    pre.push(`Sedan Stockholm stängde${hhmm ? ` (senaste kurs kl ${hhmm})` : ''}: ${on.moves.filter(m => m.symbol !== 'ES=F').map(m => `${m.name} ${pc(m.change)}`).join(', ')}.`);
    const swe = on.moves.filter(m => m.symbol === 'ERIC' || m.symbol === 'AZN').filter(m => Math.abs(m.change) >= 1.5);
    const when = iso => { if (!iso) return ''; const t = new Date(iso), f = o => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', ...o }).format(t);
      return ` (senast handlad ${f({ year: 'numeric', month: '2-digit', day: '2-digit' }) === todaySth ? 'i dag' : 'i går'} kl ${f({ hour: '2-digit', minute: '2-digit' }).replace(':', '.')})`; };
    if (swe.length) pre.push(`Värt att notera: ${swe.map(m => `${m.name} ${pc(m.change)}${when(m.asOf)}`).join(', ')} – det brukar synas när Stockholm öppnar.`);
    sections.push({ title: 'Inför öppningen', type: 'analys', lines: pre });
  }

  // 2. Risk, råvaror och valuta.
  const vix = by('^VIX');
  // Marknad för marknad: läge och nivåer (analys, inte signaler).
  const P = v => v >= 1000 ? Math.round(v).toLocaleString('sv-SE') : num(v, v < 100 ? 2 : 1);
  const zr = z => `${P(z.lo)}–${P(z.hi)}`;
  const lv = (d.levels || []).map(x => {
    const u = x.unit ? ` ${x.unit}` : '';
    const where = x.fromHigh > -2 ? ', nära årshögsta' : x.fromHigh < -15 ? `, ${pc(x.fromHigh)} från årshögsta` : '';
    const sup = x.support ? ` Stöd ${zr(x.support)}${u} (${pc(x.support.pct)})${x.support2 ? `; bryts det är nästa nivå runt ${P((x.support2.lo + x.support2.hi) / 2)}` : ''}.` : ' Inget tydligt stöd i närheten.';
    const res = x.resistance ? ` Motstånd ${zr(x.resistance)}${u} (${pc(x.resistance.pct)}).` : ' Inget motstånd över – priset är nära toppen.';
    return `${x.name} ${P(x.price)}${u}: ${x.trend}, ${pc(x.week)} senaste veckan${where}.${sup}${res}`;
  });
  if (lv.length) sections.push({ title: 'Marknad för marknad', type: 'analys', lines: [...lv, 'Nivåerna är stöd- och motståndszoner från dagsgrafen – de visar var marknaden tidigare vänt, inte vart den ska.'] });

  const risk = [];
  if (vix) risk.push(`VIX står på ${num(vix.price, 1)} (${pc(vix.change)}). ${vix.price >= 25 ? 'Det är rädsla på riktigt – sådana lägen är när strategin brukar hitta sina bästa köp.' : vix.price >= 20 ? 'Oron är förhöjd, och det ger makropoäng för köpsignaler.' : vix.price < 15 ? 'Marknaden är mycket lugn – få signaler i sådana lägen.' : 'Normalt läge.'}`);
  const raw = d.moves.filter(m => m.group === 'raw');
  if (raw.length) risk.push(raw.map(m => `${m.name} ${m.symbol === 'SEK=X' ? num(m.price) + ' kr' : m.symbol === 'BTC-USD' ? Math.round(m.price).toLocaleString('sv-SE') + ' $' : num(m.price) + ' $'} (${pc(m.change)})`).join(' · ') + '.');
  sections.push({ title: 'Risk, råvaror och kronan', type: 'fakta', lines: risk });

  // 3. Dagens kalender.
  const cal = [];
  const today = (d.calendar?.events || []).filter(e => e.days === 0);
  for (const e of today.filter(e => e.kind === 'macro')) cal.push(`Kl ${e.time}: ${e.label}${e.last ? ` – förra utfallet ${e.last.text}${e.last.period ? ` (${e.last.period})` : ''}` : ''}.${e.fedwatch ? ` Marknaden prisar: ${fwText(e.fedwatch, d.fedwatch?.now)}.` : ''}`);
  for (const e of today.filter(e => e.kind === 'report')) cal.push(`Rapport från ${e.name}${e.open ? ' – du har en öppen affär här, räkna med större rörelser' : ''}.`);
  const soon = (d.calendar?.events || []).filter(e => e.days >= 1 && e.days <= 2 && (e.kind === 'macro' || e.open));
  const what = e => e.kind === 'report' ? `rapport ${e.name}` : e.kind === 'exit' ? `säljdag ${e.name}` : e.label || e.name || 'händelse';
  if (soon.length) cal.push(`Snart: ${soon.map(e => `${what(e)} ${e.days === 1 ? 'i morgon' : 'i övermorgon'}`).join(', ')}.`);
  const HEAVY = ['fomc', 'cpi', 'jobs', 'ppi', 'pce', 'riksbank', 'ecb', 'kpif'];
  const heavy = (d.calendar?.events || []).filter(e => e.kind === 'macro' && e.days >= 1 && e.days <= 4 && HEAVY.includes(e.macroKind || e.type || e.key || ''));
  const heavyAny = heavy.length ? heavy : (d.calendar?.events || []).filter(e => e.kind === 'macro' && e.days >= 1 && e.days <= 4);
  if (heavyAny.length) { const wd = x => new Date(x + 'T12:00:00Z').toLocaleDateString('sv-SE', { weekday: 'long' });
    cal.push(`Veckans tunga besked: ${heavyAny.map(e => `${e.label} ${e.days === 1 ? 'i morgon' : wd(e.date)} kl ${e.time}`).join(', ')}. Systemets regler ändras inte inför ett besked – signalerna gäller som vanligt.`); }
  const fw = d.fedwatch?.meetings?.[0];
  if (fw && !today.some(e => e.fedwatch)) cal.push(`FedWatch inför Feds möte ${fw.date}: ${fwText(fw, d.fedwatch.now)}.`);
  if (!cal.length) cal.push('Inga stora makrobesked eller rapporter i dag. En dag där tekniken och flödena får styra.');
  sections.push({ title: 'Dagens kalender', type: 'fakta', lines: cal });

  // 4. Dina affärer.
  const tr = d.trades.map(e => {
    const line = e.coach?.lines?.slice(0, 2).join(' ') || `${e.name}: ${e.state}.`;
    return `${line}`;
  });
  sections.push({ title: 'Dina affärer', type: 'affärer', lines: tr.length ? tr : ['Inga öppna affärer just nu. Tålamod är också en position.'] });

  // 5. Signaler på väg.
  const sig = [];
  const m = d.macro;
  if (m) sig.push(m.score >= m.need ? `Makroläget är gynnsamt (poäng ${m.score}). Köpsignaler kan släppas vid stängningen.` : `Makropoängen är ${m.score} och behöver vara ${m.need}. ${m.summary || ''}`.trim());
  if (d.signals?.length) sig.push(`Köpsignal just nu: ${d.signals.map(r => r.name).join(', ')}. Bekräftas vid stängningen 17.30.`);
  if (d.near?.length) sig.push(`Ett krav från signal: ${d.near.map(r => `${r.name} (saknar ${r.missingText})`).join(', ')}.`);
  if (d.panic) sig.push(d.panic.active ? `Panikveckan är aktiv: VIX stängde i går på ${num(d.panic.vix, 1)}.` : vix && vix.price >= 25 ? `VIX är över 25 just nu. Stänger den där i kväll kan panikveckan slå till i morgon.` : '');
  sections.push({ title: 'Signaler på väg', type: 'signal', lines: sig.filter(Boolean) });

  // 6. Dagens fokus: vad systemet säger i dag, i handling.
  const focus = [];
  if (d.signals?.length) focus.push(`Köpsignal på väg i ${d.signals.map(r => r.name).join(', ')} – bekräftas vid stängningen 17.30.`);
  else focus.push('Inga nya köpsignaler just nu. Då är jobbet att sköta de affärer som är öppna – och att låta bli resten.');
  const exits = d.trades.filter(e => e.exitDate).map(e => ({ e, days: Math.round((Date.parse(e.exitDate) - Date.parse(todaySth)) / 864e5) })).filter(x => x.days >= 0 && x.days <= 1);
  if (exits.length) focus.push(`Säljdag ${exits.map(x => `${x.days === 0 ? 'i dag' : 'i morgon'} för ${x.e.name}`).join(', ')} – sälj enligt planen, oavsett kurs.`);
  const fedTomorrow = (d.calendar?.events || []).some(e => e.kind === 'macro' && e.days === 1 && /Feds räntebesked/.test(e.label || ''));
  if (fedTomorrow) focus.push('Fed-natten i kväll: köp en Nasdaq-mini med cirka 3x före 22.00 och sälj när USA öppnar i morgon 15.30 (experiment, liten insats).');
  if (d.monthly?.lev) focus.push(`Månadens aktier: ${d.monthly.stocks?.length ? d.monthly.stocks.join(' och ') : 'kassaläge'} med ${num(d.monthly.lev, d.monthly.lev % 1 ? 2 : 0).replace(/,?0+$/, '')}x hävstång. Inget att göra förrän bytet eller säljregeln (≥ 10 % på en dag).`);
  const TIPS = [
    'Nyheter om personer och skandaler ändrar sällan vad ett bolag är värt. Läs, notera, och låt det inte ta fokus från planen.',
    'Du kan inte påverka marknaden – bara din risk. Kolla att ingen position är större än du tål att se halveras.',
    'Ingen signal är också ett besked. De bästa affärerna kommer sällan på de dagar man känner att man måste göra något.',
    'En förlust enligt planen är en bra affär. En vinst utanför planen är tur som lär dig fel saker.',
    'Kortsiktiga åsikter om riktningen är gratis – och nästan alltid hälften rätt. Reglerna är det som är testat.',
    'Inför tunga makrodagar är det frestande att gissa. Testerna säger att det sällan lönar sig – låt besked bli besked.',
    'Hävstång gör inte strategin bättre, bara större. Kolla riskpanelen hellre än kursen.',
    'Stora uppgångar på en dag rinner ofta delvis tillbaka – därför finns säljregeln i Månadens aktier.',
    'Det är tiden i marknaden och spridningen mellan delarna som bär resultatet, inte den enskilda dagen.',
    'Jämför dig inte med någon annans bästa dag. Jämför dig med din egen plan.',
  ];
  const doy = Math.floor((Date.parse(todaySth) - Date.parse(todaySth.slice(0, 4) + '-01-01')) / 864e5);
  focus.push(TIPS[doy % TIPS.length]);
  sections.push({ title: 'Dagens fokus', type: 'fokus', lines: focus });

  // 6. Rubriker.
  const head = [...(d.news?.market || []).slice(0, 3), ...(d.news?.geo || []).slice(0, 2)];
  if (head.length) sections.push({ title: 'Rubriker', type: 'fakta', lines: head.map(n => `${n.title} (${n.source})`), links: head.map(n => n.link) });

  // Inledning och sammanfattning.
  const mood = avg([...us, ...asia, ...fut]);
  const hour = +new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', hour12: false }).format(d.now);
  const intro = `God ${hour < 10 ? 'morgon' : hour < 18 ? 'dag' : 'kväll'}! Det är ${sth} och du sitter i Morgonsoffan med Glen. ${mood <= -1.5 ? 'Det är tungt på marknaderna – andas, följ planen och låt stoppen göra sitt jobb.' : mood <= -0.5 ? 'Lite motvind, men inget som ändrar planen.' : mood < 0.5 ? 'Ett lugnt läge på marknaderna.' : 'Medvind på marknaderna – skönt, men bli inte girig.'}`;
  const outro = 'Handla planen, inte känslan. Vi ses på soffan i morgon!';
  const summary = [us.length && `USA ${pc(avg(us))}`, asia.length && `Asien ${pc(avg(asia))}`, vix && `VIX ${num(vix.price, 1)}`, d.trades.length && `${d.trades.length} ${d.trades.length === 1 ? "öppen affär" : "öppna affärer"}`].filter(Boolean).join(' · ');
  const talk = buildTalk(d, { by, us, asia, fut, eu, vix, raw, today, hour, sth, mood, tip: sections.find(x => x.title === 'Dagens fokus')?.lines.at(-1) });
  return { date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(d.now), intro, summary, sections, outro, talk, createdAt: d.now.toISOString() };
}

// Talmanus: samma fakta, men skrivet som man pratar – avrundade siffror, få tal
// per mening och naturliga övergångar. Används när sessionen läses upp.
const WORDS = ['noll', 'en', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv'];
function about(v) {
  const a = Math.abs(v);
  if (a < 0.15) return 'i stort sett ingenting';
  if (a < 0.4) return 'några tiondelar';
  if (a < 0.65) return 'en halv procent';
  if (a < 0.95) return 'knappt en procent';
  const n = Math.round(a), diff = a - n, w = n <= 12 ? WORDS[n] : String(n);
  return `${diff < -0.15 ? 'nästan ' : diff > 0.15 ? 'drygt ' : ''}${w} procent`;
}
const moved = (v, up = 'stigit', down = 'fallit') => Math.abs(v) < 0.15 ? 'legat i stort sett still' : `${v > 0 ? up : down} ${about(v)}`;
function sayTime(t) {
  if (!t) return '';
  const [h, m] = t.split('.').map(Number), h12 = h % 12 || 12, next = (h + 1) % 12 || 12;
  const W = n => WORDS[n] || String(n);
  if (m === 0) return `klockan ${W(h12)}`;
  if (m === 30) return `klockan halv ${W(next)}`;
  if (m === 15) return `klockan kvart över ${W(h12)}`;
  if (m === 45) return `klockan kvart i ${W(next)}`;
  return `klockan ${h} och ${m}`;
}
const spoken = n => n.replace(/OMXS30/g, 'O M X').replace(/S&P 500/g, 'S och P femhundra').replace(/\s*\([^)]*\)/g, '').replace(/\bKPIF\b/g, 'K P I F').replace(/\bKPI\b/g, 'K P I').replace(/\bPCE\b/g, 'P C E').replace(/\bBNP\b/g, 'B N P');
function buildTalk(d, c) {
  const out = [], say = (section, text) => text && out.push({ section, text });
  const greet = c.hour < 10 ? 'God morgon' : c.hour < 18 ? 'Hej' : 'God kväll';
  say(null, `${greet} och välkommen till Morgonsoffan. Det är ${c.sth.replace(/^(\S+) (\d+)/, '$1 den $2')}. ${c.mood <= -1.5 ? 'Det är en tung dag på marknaderna, så vi tar det lugnt och följer planen.' : c.mood <= -0.5 ? 'Lite motvind i dag, men inget som ändrar planen.' : c.mood < 0.5 ? 'Det är lugnt på marknaderna.' : 'Det är medvind på marknaderna i dag.'}`);

  const on = d.overnight, ind = on?.indication || {};
  if (on?.moves?.length && ind.omx) {
    const es = on.moves.find(m => m.symbol === 'ES=F');
    const tone = ind.omx.value <= -0.3 ? 'en svag öppning' : ind.omx.value >= 0.3 ? 'en stark öppning' : 'en lugn öppning';
    say('Inför öppningen', `Vi börjar med det viktigaste: hur Stockholm väntas öppna. Terminerna i USA har ${moved(es?.change ?? ind.omx.basis)} sedan vi stängde i går, och det pekar på ${tone} – runt ${about(ind.omx.value)} ${ind.omx.value < 0 ? 'ned' : 'upp'} för O M X${ind.dax ? ', och ungefär lika mycket för DAX' : ''}.`);
    const swe = on.moves.filter(m => (m.symbol === 'ERIC' || m.symbol === 'AZN') && Math.abs(m.change) >= 1.5);
    for (const m of swe) say('Inför öppningen', `${m.name.replace(' i USA', '')} har ${moved(m.change)} i New York under kvällen. Det brukar synas här i morse.`);
  }

  const us = c.us, asia = c.asia;
  if (us.length) {
    const sp = us.find(m => m.symbol === '^GSPC'), nq = us.find(m => m.symbol === '^IXIC');
    const big = Math.abs(sp?.change ?? 0) >= 2 ? (sp.change < 0 ? 'Det var en riktigt tung kväll på Wall Street' : 'Det var en stark kväll på Wall Street') : 'På Wall Street';
    say('Natten och världen', `${big}: S och P femhundra har ${moved(sp?.change ?? 0)}${nq ? ` och Nasdaq ${moved(nq.change)}` : ''}.`);
  }
  if (asia.length) {
    const sorted = asia.slice().sort((a, b) => a.change - b.change), lo = sorted[0], hi = sorted[sorted.length - 1];
    const city = m => m.name.match(/\((.+)\)/)?.[1] || m.name;
    if (Math.sign(lo.change) === Math.sign(hi.change) || Math.abs(hi.change - lo.change) < 1) say('Natten och världen', `I Asien har det varit ${lo.change < 0 ? 'svagt' : 'starkt'} i natt, med ${city(lo.change < 0 ? lo : hi)} som ${lo.change < 0 ? 'föll' : 'steg'} mest, ${about(lo.change < 0 ? lo.change : hi.change)}.`);
    else say('Natten och världen', `I Asien gick det isär i natt: ${city(hi)} steg ${about(hi.change)}, medan ${city(lo)} föll ${about(lo.change)}.`);
  }

  if (c.vix) say('Risk, råvaror och kronan', `Rädsloindex VIX står på ${Math.round(c.vix.price)}. ${c.vix.price >= 25 ? 'Det är högt, och det är i sådana lägen strategin brukar hitta sina bästa köp.' : c.vix.price >= 20 ? 'Oron är förhöjd, och det hjälper köpsignalerna.' : c.vix.price < 15 ? 'Det är väldigt lugnt, och då kommer få signaler.' : 'Det är ett normalt läge.'}`);
  const notable = c.raw.filter(m => Math.abs(m.change) >= 1.5 && m.symbol !== 'SEK=X');
  const rawName = m => ({ 'GC=F': 'Guldet', 'BZ=F': 'Oljan', 'BTC-USD': 'Bitcoin' }[m.symbol] || m.name);
  if (notable.length) say('Risk, råvaror och kronan', notable.map(m => `${rawName(m)} har ${moved(m.change)}`).join(', och ') + '.');
  else if (c.raw.length) say('Risk, råvaror och kronan', 'Guld, olja och kronan rör sig lugnt.');

  for (const e of c.today.filter(e => e.kind === 'macro')) say('Dagens kalender', `${sayTime(e.time).replace(/^k/, 'K')} kommer ${spoken(e.label).replace(/^USA:s/, 'amerikanska').replace(/^Sveriges/, 'svensk').replace(/^Feds/, 'Feds')}.${e.last ? ` Förra gången blev det ${spoken(e.last.text).replace('tusen jobb', 'tusen nya jobb')}.` : ''}`);
  const reps = c.today.filter(e => e.kind === 'report');
  if (reps.length) say('Dagens kalender', `${reps.map(e => e.name.replace(/ [ABC]$/, '')).join(' och ')} rapporterar i dag${reps.some(e => e.open) ? ', och där har du en öppen affär – räkna med större rörelser' : ''}.`);
  if (!c.today.length) say('Dagens kalender', 'Inga stora makrobesked eller rapporter i dag.');

  const short = n => n.replace(/ [ABC]$/, '');
  if (!d.trades.length) say('Dina affärer', 'Du har inga öppna affärer just nu. Tålamod är också en position.');
  for (const e of d.trades) {
    if (e.kind === 'panic' || e.kind === 'crypto') { say('Dina affärer', `${short(e.name)} ligger ${e.pct >= 0 ? 'plus' : 'minus'} ${about(e.pct ?? 0)}, och säljdagen är ${e.exitDate}.`); continue; }
    const entry = e.entry ?? e.close, last = e.last ?? entry, hit = e.hit || 0, from = (last / entry - 1) * 100;
    const holds = (e.coach?.lines || []).some(l => /håller/.test(l));
    if (e.state === 'väntar på köp') say('Dina affärer', `${short(e.name)} köps på öppningen i dag.`);
    else if (hit >= 1) say('Dina affärer', `${short(e.name)}: mål ${WORDS[hit] === 'en' ? 'ett' : WORDS[hit]} är taget${holds ? ', och studsen från stödet håller' : ''}. ${hit < 3 ? `Nästa mål ligger ${about((e.tps[hit] / last - 1) * 100)} bort.` : ''}`);
    else say('Dina affärer', `${short(e.name)} ligger ${from >= 0 ? 'upp' : 'ned'} ${about(from)} sedan köpet${from >= 0 ? `, och det är ${about((e.tps[0] / last - 1) * 100)} kvar till första målet` : ', men stoppet håller och planen gäller'}${holds && from >= 0 ? '. Strukturen håller' : ''}.`);
  }

  const m = d.macro;
  if (m) say('Signaler på väg', m.score >= m.need ? 'Makroläget är gynnsamt, så nya köpsignaler kan komma vid stängningen.' : 'Makroläget räcker inte riktigt än, så inga nya köp väntas i dag.');
  if (d.signals?.length) say('Signaler på väg', `Just nu ser det ut som köpsignal i ${d.signals.map(r => short(r.name)).join(' och ')}. Det avgörs vid stängningen.`);
  if (d.near?.length) say('Signaler på väg', `Närmast en signal är ${d.near.slice(0, 2).map(r => `${short(r.name)}, som bara saknar ${spoken(r.missingText).replace('RSI', 'R S I').replace('MACD', 'MAC D')}`).join(', och ')}.`);
  if (d.panic && !d.panic.active && c.vix && c.vix.price >= 25) say('Signaler på väg', 'Och håll koll på VIX: stänger den över tjugofem i kväll kan panikveckan slå till i morgon.');
  if (d.panic?.active) say('Signaler på väg', 'Panikveckan är aktiv.');

  // Marknad för marknad: läge och närmaste nivå för de viktigaste.
  const R = v => v >= 1000 ? Math.round(v).toLocaleString('sv-SE') : String(Math.round(v * 10) / 10).replace('.', ',');
  for (const x of (d.levels || []).filter(x => ['OMXS30', 'Nasdaq 100', 'Guld', 'Bitcoin'].includes(x.name))) {
    const u = x.unit === '$' ? ' dollar' : '';
    say('Marknad för marknad', `${spoken(x.name)} är i ${x.trend.startsWith('upp') ? 'upptrend' : x.trend.startsWith('ned') ? 'nedåttrend' : 'ett läge utan tydlig trend'} och har ${moved(x.week)} på en vecka.${x.support ? ` Närmaste stöd ligger runt ${R((x.support.lo + x.support.hi) / 2)}${u}${x.support2 ? `, och bryts det är nästa nivå runt ${R((x.support2.lo + x.support2.hi) / 2)}` : ''}.` : ''}${x.resistance ? ` Motståndet över ligger runt ${R((x.resistance.lo + x.resistance.hi) / 2)}.` : ' Det finns inget motstånd över – priset är nära toppen.'}`);
  }
  // Dagens fokus.
  if (d.signals?.length) say('Dagens fokus', `Fokus i dag: köpsignalen i ${d.signals.map(r => short(r.name)).join(' och ')}, som bekräftas vid stängningen.`);
  else say('Dagens fokus', 'Fokus i dag: inga nya köpsignaler, så jobbet är att sköta det som är öppet och låta bli resten.');
  if (c.tip) say('Dagens fokus', c.tip);
  say(null, 'Det var allt från soffan för i dag. Handla planen, inte känslan – vi hörs i morgon.');
  return out;
}
