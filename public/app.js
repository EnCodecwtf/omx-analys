import { PriceChart } from './chart.js';

const $ = s => document.querySelector(s);
const STATUS = {
  strong: { text: 'STARK KÖPSIGNAL', order: 0 },
  buy: { text: 'KÖPSIGNAL', order: 1 },
  watch: { text: 'BEVAKA', order: 2 },
  neutral: { text: 'NEUTRAL', order: 3 },
  avoid: { text: 'AVVAKTA', order: 4 },
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = v => v == null ? '–' : v >= 1000
  ? v.toLocaleString('sv-SE', { maximumFractionDigits: 0 })
  : v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a, b) => ((a / b - 1) * 100).toFixed(1).replace('.', ',') + ' %';
const badge = (s, big) => `<span class="badge ${s}${big ? ' big' : ''}">${STATUS[s].text}</span>`;

let scanData = null;
let lastDetail = null;
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignoreras */ } } };
$('#acct').value = store.get('acct', '10000');
// Standardrisk 2,5 % per affär: affärerna kommer ofta samma dag i samma sektor,
// och fördelen framåt är troligen mindre än i backtestet (se README).
$('#risk').value = store.get('risk', '2.5');
$('#peak').value = store.get('peak', $('#acct').value);

// Nedgångsregel: bestämd i förväg så att beslutet inte fattas när det känns
// som värst. 20 % under kontots högsta värde halverar risken, 30 % ger en fjärdedel.
function ddFactor() {
  const acct = +$('#acct').value || 0;
  let peak = +$('#peak').value || 0;
  if (acct > peak) { peak = acct; $('#peak').value = String(acct); store.set('peak', String(acct)); }
  const dd = peak > 0 ? 1 - acct / peak : 0;
  const factor = dd >= 0.3 ? 0.25 : dd >= 0.2 ? 0.5 : 1;
  const el = $('#dd-rule');
  el.className = 'dd-rule' + (factor < 1 ? ' bad' : '');
  el.textContent = dd <= 0.001 ? 'Kontot är på sin högsta nivå: full risk.'
    : `Kontot är ${Math.round(dd * 100)} % under toppen: ${factor === 1 ? 'full risk (halveras vid 20 %)' : factor === 0.5 ? 'halv risk tills kontot är mindre än 20 % under toppen' : 'en fjärdedels risk tills kontot är mindre än 30 % under toppen'}.`;
  return factor;
}
ddFactor();
for (const id of ['acct', 'risk', 'peak']) $('#' + id).addEventListener('input', () => {
  store.set(id, $('#' + id).value);
  ddFactor();
  if (lastDetail?.isCrypto) renderCryptoCards(lastDetail);
  else if (lastDetail) loadProducts(lastDetail.symbol, lastDetail.analysis.status);
});
// Ansvarsfriskrivning: godkänns en gång per dag och enhet.
const termsDay = () => new Date().toLocaleDateString('sv-SE');
function showTerms() { $('#terms').hidden = false; $('#terms-ok').focus(); }
$('#terms-ok').addEventListener('click', () => { store.set('termsDay', termsDay()); $('#terms').hidden = true; });
$('#show-terms').addEventListener('click', e => { e.preventDefault(); showTerms(); });
if (store.get('termsDay', '') !== termsDay()) showTerms();

// Fyra vyer: Idag (finns det något att göra?), Affärer (hur går det?),
// Aktier (alla instrument) och Mer (konto, statistik, experiment).
let view = store.get('view', 'today');
let market = 'omx';
let current = null;
const chart = new PriceChart($('#chart'), $('#rsi-chart'), $('#tooltip'));

// Graflagren: enkla förval, valen sparas.
for (const cb of document.querySelectorAll('[data-layer]')) {
  const saved = store.get('layer-' + cb.dataset.layer, null);
  if (saved != null) cb.checked = saved === '1';
  chart.setLayer(cb.dataset.layer, cb.checked);
  cb.addEventListener('change', () => { chart.setLayer(cb.dataset.layer, cb.checked); store.set('layer-' + cb.dataset.layer, cb.checked ? '1' : '0'); });
}
function setView(v) {
  view = v; store.set('view', v);
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === v));
  for (const id of ['today', 'trades', 'stocks', 'more']) $('#v-' + id).hidden = id !== v;
  document.body.classList.remove('show-detail');
  if (v !== 'more') closeTool();
  else if (!tool && window.innerWidth > 900) openTool('calendar');
  if (v === 'stocks') renderScan();
  if (v === 'trades') renderTrades();
  if (v === 'today') renderToday();
  $('.scanner').scrollTop = 0; window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
for (const b of document.querySelectorAll('[data-market]')) {
  b.addEventListener('click', () => {
    market = b.dataset.market;
    document.querySelectorAll('[data-market]').forEach(x => x.classList.toggle('active', x === b));
    if (market === 'us' && !usData) loadUS(); else renderScan();
  });
}
// Verktygen under Mer öppnas på en egen sida (på datorn i den stora ytan till höger).
let tool = null;
function openTool(name) {
  if (tool === 'morning' && name !== 'morning') stopSpeech();
  tool = name;
  for (const t of document.querySelectorAll('.tool')) t.hidden = t.dataset.tool !== name;
  document.querySelectorAll('.menu-item').forEach(x => x.classList.toggle('active', x.dataset.tool === name));
  $('#tool-title').textContent = document.querySelector(`.tool[data-tool="${name}"]`).dataset.title;
  document.body.classList.remove('show-detail');
  document.body.classList.add('show-tool');
  window.scrollTo(0, 0);
  if (name === 'shorts' && !shortData) loadShorts();
  if (name === 'strategy') loadStrategyCalc();
  if (name === 'compound') runCompound();
  if (name === 'loans') renderLoans();
  if (name === 'hours') { renderHours(); loadVolProfile(); }
  if (name === 'morning') renderMorning();
}
function closeTool() {
  if (tool === 'morning') stopSpeech();
  tool = null;
  document.body.classList.remove('show-tool');
  document.querySelectorAll('.menu-item').forEach(x => x.classList.remove('active'));
}
for (const b of document.querySelectorAll('[data-tool].menu-item')) b.addEventListener('click', () => openTool(b.dataset.tool));
$('#tool-back').addEventListener('click', closeTool);

// USA-listan (S&P 500-bolag med hävstångspapper på Avanza) hämtas först när
// fliken öppnas, eftersom den är mycket större än OMX-listan.
let usData = null;
async function loadUS(refresh) {
  if (!usData) $('#scan-list').innerHTML = '<div class="loading">Hämtar och analyserar cirka 280 amerikanska bolag…</div>';
  try {
    usData = await (await fetch('/api/us/scan' + (refresh ? '?refresh=1' : ''))).json();
  } catch (e) {
    $('#scan-list').innerHTML = `<div class="loading">Kunde inte hämta USA-listan: ${esc(e.message)}</div>`;
    return;
  }
  if (market === 'us') renderScan();
}
// AI-analytiker för blankning. Hämtas först när fliken öppnas (cirka 10 sekunder).
let shortData = null;
async function loadShorts(refresh) {
  if (!shortData) $('#shorts').innerHTML = '<div class="loading">Analytikern läser prognoser, blankningsregistret, nyheter och kurser för 30 bolag…</div>';
  try {
    shortData = await (await fetch('/api/shorts' + (refresh ? '?refresh=1' : ''))).json();
  } catch (e) {
    $('#shorts').innerHTML = `<div class="loading">Kunde inte hämta blankningsanalysen: ${esc(e.message)}</div>`;
    return;
  }
  renderShorts();
}
const SHORT_BADGE = { short: '<span class="badge avoid">BLANKA</span>', watch: '<span class="badge watch">BEVAKA</span>', none: '<span class="badge neutral">INGEN</span>' };
const SHORT_KEY = { trend: 'nedtrend', rejection: 'vändning', rsi: 'RSI', analyst: 'analytiker', report: 'rapport', score: 'poäng', products: 'papper' };
function renderShorts() {
  const list = $('#shorts');
  if (!shortData) { list.innerHTML = '<div class="loading">Hämtar…</div>'; return; }
  const n = v => v == null ? '–' : String(v).replace(/(\d)\.(\d)/g, '$1,$2');
  const head = `<div class="small">
    <div class="muted" style="font-size:12px;margin-top:4px">Väger ihop det en analytiker tittar på: sänkta vinstprognoser och riktkurser, rapporter under förväntan, svaga nyckeltal,
    blankningsregistret hos FI, negativa nyheter och en teknisk nedtrend där kursen studsat upp och vänt ned. Blanka bara när alla krav är gröna och det finns minst tre säkra korta papper på Avanza.</div>
    <div class="muted" style="font-size:12px;margin-top:4px"><b>Går inte att backtesta</b> (historiska prognoser finns inte gratis). Därför halv position, och varje kandidat sparas med frysta nivåer så att träffsäkerheten mäts framåt under Släppta signaler.
    ${logData?.stats?.short?.closed ? `Hittills: ${logData.stats.short.closed} stängda, ${logData.stats.short.wins} vinnare, snitt ${n(logData.stats.short.avgR)} R.` : 'Inga stängda blankningar än.'}</div>
    ${shortData.register ? '' : '<div class="neg" style="font-size:12px">Blankningsregistret kunde inte hämtas just nu.</div>'}</div>`;
  const shown = shortData.rows.filter(r => r.error || r.inTrade || r.status !== 'none');
  const rest = shortData.rows.length - shown.length;
  const rows = shown.map(r => {
    if (r.error) return `<div class="row"><div class="name">${esc(r.name)}</div><div class="meta">${esc(r.error)}</div></div>`;
    const up = r.changePct >= 0;
    const groups = {};
    for (const p of r.parts) (groups[p.group] ||= []).push(p);
    const parts = Object.entries(groups).map(([g, ps]) => `<div class="s-group"><b>${esc(g)}</b> <span class="muted">(${ps.reduce((a, p) => a + p.pts, 0) > 0 ? '+' : ''}${ps.reduce((a, p) => a + p.pts, 0)})</span>
      <ul>${ps.map(p => `<li class="${p.pts > 0 ? 'bad' : 'ok'}">${esc(p.text)} (${p.pts > 0 ? '+' : ''}${p.pts})</li>`).join('')}</ul></div>`).join('') || '<p class="muted">Inga tecken på svaghet.</p>';
    const checks = `<ul class="checklist">${r.checklist.map(c => `<li class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.text)} <span class="muted">(${esc(n(c.now))})</span></li>`).join('')}</ul>`;
    const p = r.plan;
    const plan = `<div class="s-plan">Blanka runt <b>${fmt(p.entry)}</b> · stopp <b class="neg">${fmt(p.stop)}</b> (${n(p.riskPct)} %) · TP ${p.tps.map(t => fmt(t.price)).join(' / ')}
      <div class="muted" style="font-size:12px">En tredjedel stängs vid varje mål, stoppet flyttas till ingången efter TP2, högst 30 dagar. Halv position.</div></div>`;
    const prods = r.products ? [...r.products.minis, ...r.products.bulls] : [];
    const prodHtml = prods.length ? `<div class="s-sub">Korta papper på Avanza</div><ul>${prods.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a> <span class="muted">${esc(x.kind)} · ${n(x.leverage)}x · spread ${n(x.spreadPct)} % · förlust vid stopp ${x.lossAtStopPct} %</span></li>`).join('')}</ul>` : '';
    const nw = r.news?.neg?.length ? `<div class="s-sub">Negativa rubriker</div><ul>${r.news.neg.map(h => `<li><a href="${esc(h.link)}" target="_blank" rel="noopener">${esc(h.title)}</a> <span class="muted">${esc(h.source)}</span></li>`).join('')}</ul>` : '';
    const an = r.analysts ? `<div class="muted" style="font-size:12px">Analytiker: ${n(r.analysts.n)} st · riktkurs ${fmt(r.analysts.target)} · snittråd ${n(r.analysts.recMean?.toFixed(1))} (1 köp – 5 sälj)${r.short ? ` · blankat ${n(r.short.pct)} %` : ''}</div>` : '';
    return `<details class="row s-row"><summary>
      <div class="name">${esc(r.name)} ${r.inTrade ? `<span class="badge avoid">I AFFÄR</span>${r.inTrade.hit ? ` <span class="tp-chip hit">TP${r.inTrade.hit} ✓</span>` : ''}` : SHORT_BADGE[r.status]}${r.preliminary && r.status === 'short' ? ' <span class="tag">preliminär</span>' : ''}</div>
      <div class="right">${spark(r.spark, r.spark[r.spark.length - 1] >= r.spark[0])}
        <div class="num"><div>${fmt(r.price)}</div><div class="${up ? 'pos' : 'neg'}" style="font-size:12px">${up ? '+' : ''}${n(r.changePct)} %</div></div></div>
      <div class="meta"><span>Poäng ${r.score}</span><span>Analytiker ${r.analyst}</span><span>RSI ${Math.round(r.rsi)}</span>${r.missing.length ? `<span class="${r.missing.length === 1 ? 'near' : ''}">${r.missing.length} krav kvar: ${r.missing.map(k => SHORT_KEY[k] || k).join(', ')}</span>` : ''}</div>
      </summary><div class="s-body">
      ${r.blocked ? `<p class="neg">${esc(r.blocked)}</p>` : ''}
      ${an}<div class="s-sub">Varför</div>${parts}<div class="s-sub">Krav för blankning</div>${checks}${plan}${prodHtml}${nw}
      <p><a href="#${encodeURIComponent(r.symbol)}" data-open="${esc(r.symbol)}">Visa graf</a>${r.avanzaUrl ? ` · <a href="${esc(r.avanzaUrl)}" target="_blank" rel="noopener">Aktien på Avanza</a>` : ''}</p>
      </div></details>`;
  }).join('');
  list.innerHTML = head + rows + `<p class="muted small" style="margin-top:8px">${shown.length ? '' : 'Inga blankningskandidater just nu. '}${rest} bolag visar inga tecken på svaghet och visas inte.</p>`;
  for (const a of list.querySelectorAll('[data-open]')) a.addEventListener('click', ev => { ev.preventDefault(); openSymbol(a.dataset.open); });
}
$('#refresh').addEventListener('click', () => { loadScan(true); loadLog(); if (shortData) loadShorts(true); if (usData) loadUS(true); });
$('#back').addEventListener('click', () => { document.body.classList.remove('show-detail'); history.replaceState(null, '', '#'); });

function spark(values, up, quiet) {
  const w = 64, h = 22, lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - (v - lo) / (hi - lo || 1) * h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${quiet ? '#5b6878' : up ? '#22c55e' : '#ef4444'}" stroke-width="1.5" points="${pts}"/></svg>`;
}

async function loadScan(refresh, auto = false) {
  $('#refresh').disabled = true;
  if (!scanData) $('#scan-list').innerHTML = '<div class="loading">Hämtar och analyserar alla instrument…</div>';
  try {
    const res = await fetch('/api/scan' + (refresh ? '?refresh=1' : ''));
    scanData = await res.json();
    $('#updated').textContent = (marketOpen() ? 'Live · ' : 'Analys ') + new Date(scanData.updated).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) + (marketOpen() ? ' · kurser cirka 15 min fördröjda' : '');
    renderScan();
    renderMacro(scanData.macro, scanData.stress, scanData.cycle, scanData.calendar);
    renderPanic(scanData.panic);
    renderToday();
    // På datorn visas först en signal, annars en öppen affär, annars index.
    const fromHash = decodeURIComponent(location.hash.slice(1));
    const pick = scanData.rows.find(r => r.symbol === fromHash) || (refresh && current && scanData.rows.find(r => r.symbol === current))
      || scanData.rows.find(isSignal) || scanData.rows.find(r => r.inTrade) || scanData.rows[0];
    // Vid automatisk uppdatering stannar vyn där den är (listan eller aktien).
    if (pick) openSymbol(auto && current ? current : pick.symbol, { keepView: auto || (!fromHash && !refresh), refresh });
  } catch (e) {
    $('#today').innerHTML = $('#scan-list').innerHTML = `<div class="loading">Kunde inte hämta data: ${esc(e.message)}</div>`;
  } finally {
    $('#refresh').disabled = false;
  }
}

// Kortnamn för kraven i listan ("2 kvar: RSI, makro").
const KEY_LABEL = { trend: 'trend', support: 'stöd', rsi: 'RSI', macd: 'MACD', score: 'poäng', elliott: 'Elliott', report: 'rapport', macro: 'makro', products: 'papper', breakout: 'utbrott' };
// Sortering: köpsignaler först, sedan de med minst antal krav kvar, sedan poäng.
// Indexet ligger alltid överst som referens.
const isSignal = r => !r.inTrade && (r.status === 'strong' || r.status === 'buy');
const left = r => r.missing?.length ?? 99;
function byCloseness(a, b) {
  return (b.isIndex - a.isIndex) || (isSignal(b) - isSignal(a)) || (left(a) - left(b)) || ((b.score ?? 0) - (a.score ?? 0));
}

// Rad i aktielistan. Signaler och öppna affärer får färg, övriga är dämpade.
// Hur nära signal en aktie är: prickar för uppfyllda krav och en tydlig etikett.
// 1 krav kvar = Nära signal, 2 kvar = Bevaka.
const closeness = r => {
  if (!r.checks || r.missing == null) return null;
  const ok = r.checks - r.missing.length, left = r.missing.length;
  return { ok, of: r.checks, left, label: left === 1 ? 'NÄRA SIGNAL' : left === 2 ? 'BEVAKA' : null, cls: left === 1 ? 'near1' : left === 2 ? 'near2' : 'far' };
};
const dots = c => `<span class="kdots" title="${c.ok} av ${c.of} krav uppfyllda">${'<i class="on"></i>'.repeat(c.ok)}${'<i></i>'.repeat(c.of - c.ok)}</span>`;
function stockRow(r) {
  if (r.error) return `<div class="row"><div class="name">${esc(r.name)}</div><div class="meta">${esc(r.error)}</div></div>`;
  const up = r.changePct >= 0, c = !isSignal(r) && !r.inTrade && !r.isIndex ? closeness(r) : null;
  const hot = isSignal(r) || r.inTrade || (c && c.left <= 2);
  const tag = r.inTrade ? `<span class="badge strong" title="Signal ${esc(r.inTrade.date)} är en öppen affär. En affär i taget per aktie.">I AFFÄR</span>${r.inTrade.hit ? ` <span class="tp-chip hit">TP${r.inTrade.hit} ✓</span>` : ''}`
    : isSignal(r) ? badge(r.status) : c?.label ? `<span class="kchip ${c.cls}">${c.label}</span>` : '';
  const meta = r.isIndex ? `<span>${esc(r.trendLabel)}</span><span>RSI ${Math.round(r.rsi)}</span>`
    : c ? `${dots(c)}<span class="kcount ${c.cls}">${c.ok} av ${c.of} krav</span>${c.left <= 2 ? `<span class="kmiss">Saknas: ${r.missing.map(k => KEY_LABEL[k] || k).join(', ')}</span>` : ''}` : '';
  return `<div class="row${hot ? '' : ' quiet'}${r.symbol === current ? ' active' : ''}" data-symbol="${esc(r.symbol)}">
    <div class="name">${esc(r.name)} ${tag}${r.stale ? ' <span class="tag" title="Yahoo har inte skickat dagens kurser – inga signaler loggas för den här aktien förrän datan är tillbaka">⚠ gammal data</span>' : ''}${!r.inTrade && r.preliminary && isSignal(r) ? ' <span class="tag" title="Räknat på kursen just nu, bekräftas vid stängningen">preliminär</span>' : ''}</div>
    <div class="right">${spark(r.spark, r.spark[r.spark.length - 1] >= r.spark[0], !hot)}
      <div class="num"><div>${fmt(r.price)}</div><div class="${up ? 'pos' : 'neg'}" style="font-size:12px">${up ? '+' : ''}${String(r.changePct).replace('.', ',')} %</div></div>
    </div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
  </div>`;
}
const bindRows = el => {
  for (const x of el.querySelectorAll('[data-symbol]')) x.addEventListener('click', ev => { if (!ev.target.closest('.coach')) openSymbol(x.dataset.symbol); });
};

function renderScan() {
  if (!scanData) return;
  const list = $('#scan-list');
  if (market === 'us' && !usData) return;
  const src = market === 'us' ? usData.rows : scanData.rows.filter(r => market === 'crypto' ? r.isCrypto : !r.isCrypto);
  const rows = src.slice().sort(byCloseness);
  const um = market === 'us' && usData?.macro;
  const head = um ? `<div class="note">USA-läge: <b class="${um.score >= um.need ? 'pos' : ''}">${esc(um.label)}</b> <span class="muted">(poäng ${um.score}, kräver ${um.need})</span>
    <div class="muted small">Signaler bara vid full rädsla i USA och med minst tre säkra papper på Avanza.</div></div>`
    : market === 'crypto' ? '<div class="note muted small">Krypto-utbrott: ny 20-dagarstopp över EMA 200, sälj efter 7 dagar. Signalerna kommer även på helger.</div>' : '';
  // Grupper: köpsignaler, öppna affärer, nära signal, bevaka och övriga.
  const groups = [
    ['Köpsignaler', r => isSignal(r)],
    ['I affär', r => r.inTrade],
    ['Nära signal – 1 krav kvar', r => closeness(r)?.left === 1],
    ['Bevaka – 2 krav kvar', r => closeness(r)?.left === 2],
    ['Övriga', () => true],
  ];
  const used = new Set(), index = rows.filter(r => r.isIndex);
  index.forEach(r => used.add(r));
  const parts = groups.map(([title, f]) => {
    const g = rows.filter(r => !used.has(r) && f(r));
    g.forEach(r => used.add(r));
    return g.length ? `<h2 class="v-title">${title} <span class="muted">(${g.length})</span></h2>${g.map(stockRow).join('')}` : '';
  });
  list.innerHTML = head + index.map(stockRow).join('') + parts.join('') + (rows.length ? '' : '<div class="empty">Inget att visa.</div>');
  bindRows(list);
}

async function openSymbol(symbol, { keepView, refresh } = {}) {
  current = symbol;
  if (!keepView) closeTool();
  document.querySelectorAll('.row').forEach(r => r.classList.toggle('active', r.dataset.symbol === symbol));
  if (!keepView) { document.body.classList.add('show-detail'); history.replaceState(null, '', '#' + encodeURIComponent(symbol)); }
  $('#d-name').textContent = scanData?.rows.find(r => r.symbol === symbol)?.name || symbol;
  $('#d-sub').textContent = 'Laddar analys…';
  const res = await fetch('/api/analysis?symbol=' + encodeURIComponent(symbol) + (refresh ? '&r=' + Date.now() : ''));
  const d = await res.json();
  if (current !== symbol) return;
  renderDetail(d);
}

// Visar varje krav för köpsignal och om det är uppfyllt, så att det syns
// varför en signal inte är redo än.
function checklist(A) {
  const list = A.checklist || [];
  if (!list.length) return '';
  const missing = list.filter(c => !c.ok);
  const active = A.status === 'strong' || A.status === 'buy';
  const head = active ? 'Alla krav för köpsignal är uppfyllda.'
    : `<b>${list.length - missing.length} av ${list.length} krav uppfyllda.</b> ${missing.length === 1
      ? `Det som saknas för köpsignal: ${esc(missing[0].text.toLowerCase())}.` : `${missing.length} saknas för köpsignal.`}`;
  return `<div class="checklist"><p style="margin:0 0 6px">${head}</p><ul>${list.map(c => `<li class="${c.ok ? 'ok' : 'bad'}">
      <span class="mark">${c.ok ? '✓' : '✗'}</span><span>${esc(c.text)}<span class="muted"> – ${esc(c.now.replace(/(\d)\.(\d)/g, '$1,$2'))}</span></span></li>`).join('')}</ul></div>`;
}

// Krypto-utbrott: egen signal, plan och backtest (procent i stället för R).
function renderCryptoCards(d) {
  const A = d.analysis, cs = A.crypto;
  const active = A.status === 'strong';
  const explain = {
    strong: 'Ny 20-dagarstopp och kursen ligger över EMA 200. Köp och sälj efter 7 dagar.',
    watch: 'Upptrend och kursen är nära 20-dagarstoppen. Signal kommer om den stänger över toppen.',
    neutral: 'Inget utbrott just nu.',
  }[A.status];
  $('#c-signal').innerHTML = `<h3>Signal · krypto-utbrott</h3>
    <p>${explain}</p>
    ${checklist(A)}
    <p class="muted" style="font-size:12px">En annan strategi än OMX-signalerna: köp styrka i stället för rekyler. Den slog att bara äga
    samma dagar i alla perioder 2017–2026, men svänger mycket: en enskild affär har gått −25 %.</p>`;
  const acct = Math.max(0, +$('#acct').value || 0);
  $('#c-plan').innerHTML = `<h3>Handelsplan ${active ? '' : '<span class="muted">(om signal kommer)</span>'}</h3>
    <dl class="kv">
      <dt>Köp</dt><dd>${active ? `nu, runt <span class="num">${fmt(cs.price)}</span>` : `vid stängning över <span class="num">${fmt(cs.level)}</span>`}</dd>
      <dt>Sälj</dt><dd>${active ? `${esc(cs.exitDate)}, oavsett kurs` : '7 dagar efter köpet, oavsett kurs'}</dd>
      <dt>Storlek</dt><dd>${Math.round(cs.size * 100)} % av kontot = <b>${Math.round(acct * cs.size).toLocaleString('sv-SE')} kr</b>, utan hävstång</dd>
      <dt>Stopp</dt><dd>Inget. Backtestet säljer alltid efter 7 dagar. 2x hävstång gav större nedgångar och 3x sämre resultat.</dd>
    </dl>`;
  $('#c-products').innerHTML = `<h3>Var man handlar</h3>
    <p style="font-size:13px">Signalerna räknas på dygnets stängning (UTC) och kommer även på helger.</p>
    <ul style="font-size:13px;margin:6px 0 0 18px;padding:0">
      <li><b>Kryptobörs</b> (alla dagar): följer strategin som den är testad, cirka 0,2 % i avgift och spread.</li>
      <li><b>ETP på Avanza</b> (bara vardagar): helgsignaler köps på måndagen. I testet gav det 29 % om året mot 45 % på en kryptobörs, utan hävstång.</li>
    </ul>`;
}

function renderCryptoBacktest(d) {
  const s = d.backtest.stats;
  const recent = d.backtest.trades.slice(-8).reverse();
  const num = v => v == null ? '–' : String(v).replace('.', ',');
  $('#c-backtest').innerHTML = `<h3>Backtest – ${esc(d.name)}, cirka 4 år</h3>
    <div class="stats">
      <div class="stat"><b class="num">${s.n}</b><span>affärer</span></div>
      <div class="stat"><b class="num">${num(s.winRate)} %</b><span>med vinst</span></div>
      <div class="stat"><b class="num ${s.avgPct > 0 ? 'pos' : 'neg'}">${s.avgPct > 0 ? '+' : ''}${num(s.avgPct)} %</b><span>snitt per affär</span></div>
    </div>
    <table>
      <tr><th>Datum</th><th class="r">Köp</th><th class="r">Sälj</th><th class="r">Utfall</th></tr>
      ${recent.map(t => `<tr><td>${new Date(t.t * 1000).toLocaleDateString('sv-SE')}</td><td class="r num">${fmt(t.entry)}</td><td class="r num">${fmt(t.exit)}</td>
        <td class="r num ${t.open ? '' : t.pct > 0 ? 'pos' : 'neg'}">${t.open ? 'pågår' : (t.pct > 0 ? '+' : '') + num(t.pct) + ' %'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Inga signaler under perioden.</td></tr>'}
    </table>
    <p class="muted" style="font-size:12px;margin-top:8px">Köp på öppningen dagen efter signalen och sälj på stängningen 7 dagar senare, efter 0,2 % i avgift.</p>`;
}

function renderDetail(d) {
  lastDetail = d;
  const A = d.analysis;
  const lastT = new Date(d.bars[d.bars.length - 1][0] * 1000).toLocaleDateString('sv-SE');
  const prev = d.bars[d.bars.length - 2]?.[4], ch = prev ? (A.price / prev - 1) * 100 : null;
  $('#d-name').innerHTML = `${esc(d.name)} <span class="d-price num">${fmt(A.price)}</span>${ch == null ? '' : ` <span class="d-ch ${ch >= 0 ? 'pos' : 'neg'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2).replace('.', ',')} %</span>`}`;
  $('#d-sub').innerHTML = `${esc(d.symbol)} · ${lastT} · ${esc(A.trendLabel)}${d.avanzaUrl ? ` · <a href="${esc(d.avanzaUrl)}" target="_blank" rel="noopener">Öppna i Avanza ↗</a>` : ''}`;
  $('#d-badge').innerHTML = d.inTrade ? '<span class="badge strong big">I AFFÄR</span>' : A.status === 'strong' || A.status === 'buy' ? badge(A.status, true) : '<span class="badge neutral big">INGEN SIGNAL</span>';
  chart.setData(d);

  if (d.isCrypto) renderCryptoCards(d);
  else renderSignalCards(d);
  loadCompanyNews(d.symbol, d.name);

  // Elliott
  renderElliott(d);
}

function renderSignalCards(d) {
  const A = d.analysis, pl = A.plan;
  // Signal
  const col = A.score >= 50 ? 'var(--green)' : A.score >= 30 ? 'var(--amber)' : 'var(--muted)';
  const explain = {
    strong: 'Rekyl under EMA 200 som vänder upp vid en stödzon, med RSI och MACD som vänder samtidigt, och marknadsläget är gynnsamt.',
    buy: 'Rekyl under EMA 200 som vänder upp vid en stödzon, med RSI och MACD som vänder samtidigt. Marknadsläget är neutralt: halv position.',
    watch: 'Intressant läge, men alla krav för köpsignal är inte uppfyllda än. Se vad som saknas nedan.',
    neutral: 'Inget tydligt köpläge just nu.',
    avoid: 'Sent eller överköpt läge. Vänta på en rekyl.',
  }[A.status];
  const missing = (A.checklist || []).filter(c => !c.ok);
  const active0 = A.status === 'strong' || A.status === 'buy';
  const verdict = d.inTrade ? '' : active0
    ? `<div class="verdict go"><b>${A.status === 'strong' ? 'Stark köpsignal' : 'Köpsignal'}</b><span>${esc(explain)}</span></div>`
    : `<div class="verdict"><b>Ingen signal${A.checklist?.length ? ` – ${A.checklist.length - missing.length} av ${A.checklist.length} krav uppfyllda` : ''}</b>
      <span>${missing.length ? `Saknas: ${missing.map(c => esc(c.text[0].toLowerCase() + c.text.slice(1))).join(', ')}.` : esc(explain)}</span></div>`;
  const trade = d.inTrade ? (logData?.entries || []).find(e => isLive(e) && e.symbol === d.symbol && !e.kind) : null;
  $('#c-signal').innerHTML = d.inTrade
    ? `<h3>Din affär</h3>${trade ? tradeCard(trade) : `<p>Öppen affär från signalen ${esc(d.inTrade.date)}.</p>`}
      <p class="muted small">Stopp och mål är frysta från signalen. Ingen ny signal medan affären är öppen.</p>
      <details class="fold-in"><summary>Dagens analys (gäller nya köp, inte din affär)</summary>
        <p class="small">Signalstyrka ${A.score} av 100. ${esc(explain)}</p>${checklist(A)}</details>`
    : `<h3>Signal</h3>${verdict}
    ${d.preliminary && active0 ? `<p class="warn small">Preliminärt: räknat på kursen just nu (cirka 15 minuter fördröjd). Signalen gäller först när dagen stänger ${d.isUS ? '22:00 (USA-börsen)' : '17:30'}, och köpet sker på öppningen nästa dag${d.isUS ? ' (15:30 svensk tid)' : ''}.</p>` : ''}
    <div class="score"><span class="muted small">Signalstyrka</span><div class="score-bar"><span style="width:${A.score}%;background:${col}"></span></div><span class="num"><b>${A.score}</b><span class="muted"> / 100</span></span></div>
    ${A.warnings.length ? `<div class="warn small">⚠ ${esc(A.warnings[0])}</div>` : ''}
    <details class="fold-in"><summary>Varför – alla krav, poäng och varningar</summary>
      ${checklist(A)}
      <ul class="reasons">${A.reasons.map(r => `<li><span class="pts ${r.pts >= 0 ? 'pos' : 'neg'}">${r.pts > 0 ? '+' : ''}${r.pts}</span><span>${esc(r.text)}</span></li>`).join('') || '<li class="muted">Inga faktorer slog till.</li>'}</ul>
      ${A.warnings.slice(1).map(w => `<div class="warn small">⚠ ${esc(w)}</div>`).join('')}
      ${A.blocked ? `<p class="warn small">Utan spärren hade detta varit ${STATUS[A.blocked].text.toLowerCase()}.</p>` : ''}
      <dl class="kv" style="margin-top:10px">
        ${A.guards?.report ? `<dt>Nästa rapport</dt><dd>${esc(A.guards.report.date)} <span class="muted">(om ${A.guards.report.days} handelsdagar)</span></dd>` : ''}
        ${A.guards?.macro ? `<dt>Makro</dt><dd>${esc(A.guards.macro.label)} <span class="muted">(poäng ${A.guards.macro.score})</span></dd>` : ''}
        ${A.guards?.stress ? `<dt>Riskfaktorer</dt><dd>${A.guards.stress.factors ? `${A.guards.stress.factors} av 3 – positionen × ${String(A.guards.stress.size).replace('.', ',')}` : 'Inga'}</dd>` : ''}
      </dl>
    </details>`;

  // Handelsplan
  const active = A.status === 'strong' || A.status === 'buy';
  const planTable = `<table>
      <tr><th></th><th class="r">Nivå</th><th class="r">Avstånd</th><th class="r">R</th></tr>
      <tr class="plan-row"><td>Köp</td><td class="r num">${fmt(pl.entry)}</td><td class="r num">–</td><td class="r">–</td></tr>
      <tr class="plan-row sl"><td>Stopp${pl.frozen && pl.hit >= 2 ? '<div class="why">Flyttat till köpkursen efter TP2</div>' : ''}</td><td class="r num">${fmt(pl.stop)}</td><td class="r num neg">−${pl.riskPct.toString().replace('.', ',')} %</td><td class="r num">−1</td></tr>
      ${pl.tps.map((t, k) => `<tr class="plan-row tp${pl.frozen && k < pl.hit ? ' hit' : ''}"><td>TP${k + 1}${pl.frozen && k < pl.hit ? ' ✓' : ''}<div class="why">${t.why.map(esc).join(' · ')}</div></td><td class="r num">${fmt(t.price)}</td><td class="r num pos">+${pct(t.price, pl.entry)}</td><td class="r num">${String(t.r).replace('.', ',')}</td></tr>`).join('')}
    </table>
    <p class="muted small" style="margin-top:10px">Sälj en tredjedel vid varje mål och flytta stoppet till köpkursen när TP2 är nådd.</p>`;
  $('#c-plan').innerHTML = pl.frozen || active
    ? `<h3>Handelsplan ${pl.frozen ? `<span class="muted">(öppen affär från ${esc(pl.frozen)}${pl.hit ? `, TP${pl.hit} nådd` : ''})</span>` : ''}</h3>${planTable}`
    : `<h3>Handelsplan</h3><p class="muted small">Ingen signal, så ingen plan att följa. Planen och linjerna i grafen visas när en signal kommer.</p>
      <details class="fold-in"><summary>Visa möjlig plan om en signal skulle komma idag</summary>${planTable}</details>`;

  loadProducts(d.symbol, d.inTrade ? 'trade' : A.status);
}

function renderElliott(d) {
  const A = d.analysis;
  const ew = A.elliott.primary, maj = A.elliottMajor.primary;
  const ewBlock = e => `<p><b>${esc(e.label)}</b> <span class="muted">· säkerhet ${e.confidence} %</span></p>
    <p>${esc(e.text)}</p>
    <dl class="kv">
      ${e.zone ? `<dt>${e.bias > 0 && e.setup ? 'Köpzon' : 'Zon'}</dt><dd class="num">${fmt(e.zone[0])} – ${fmt(e.zone[1])}</dd>` : ''}
      ${e.invalidation != null ? `<dt>Ogiltig under/över</dt><dd class="num">${fmt(e.invalidation)}</dd>` : ''}
      ${e.targets.map(t => `<dt>${esc(t.label)}</dt><dd class="num">${fmt(t.price)}</dd>`).join('')}
    </dl>
    <p class="muted" style="font-size:12px">${e.notes.map(esc).join(' · ')}</p>`;
  $('#c-elliott').innerHTML = `<h3>Elliottvågor</h3>
    ${ew ? ewBlock(ew) : '<p class="muted">Ingen giltig vågräkning hittades i den senaste strukturen.</p>'}
    ${A.elliott.alternatives.length ? `<p class="muted" style="font-size:12px">Alternativ: ${A.elliott.alternatives.map(a => `${esc(a.label)} (${a.confidence} %)`).join(', ')}</p>` : ''}
    ${maj ? `<p style="font-size:13px;margin-top:10px"><span class="muted">Högre grad:</span> ${esc(maj.label)} <span class="muted">(${maj.confidence} %)</span></p>` : ''}
    <h4 style="margin:14px 0 6px">Formationer</h4>
    ${(d.patterns || []).length ? `<ul class="reasons">${d.patterns.map(p => `<li><span class="${p.dir === 'bull' ? 'pos' : 'neg'}">${p.dir === 'bull' ? '▲' : '▼'}</span><span><b>${esc(p.label)}</b>
      <span class="muted">– ${p.breakout ? (p.dir === 'bull' ? 'bröt upp i dag vid' : 'bröt ned i dag vid') : p.brokeAgo != null ? `${p.dir === 'bull' ? 'bröt upp' : 'bröt ned'} för ${p.brokeAgo} dagar sedan,${p.above ? '' : ' men är tillbaka,'} nivå` : 'bildas, utbrott vid'} ${fmt(p.level)}, mål ${fmt(p.target)}</span></span></li>`).join('')}</ul>`
      : '<p class="muted" style="font-size:13px">Ingen head & shoulders, dubbelbotten/-topp, cup & handle eller triangel nära utbrott just nu.</p>'}
    <p class="muted" style="font-size:12px">Visas som information. Formationerna gav ingen fördel efter avgifter i backtestet 2017–2026 och påverkar inte signalen.</p>`;

  // Nivåer
  const zoneName = { support: 'Stöd', resistance: 'Motstånd', inside: 'Pris i zonen' };
  $('#c-levels').innerHTML = `<h3>Stöd, motstånd och FVG</h3>
    <table>
      <tr><th>Typ</th><th class="r">Zon</th><th class="r">Styrka</th><th class="r">Avstånd</th></tr>
      ${A.zones.map(z => `<tr><td class="${z.kind === 'resistance' ? 'neg' : z.kind === 'support' ? 'pos' : ''}">${zoneName[z.kind]}${z.flipped ? ' <span class="muted">↺</span>' : ''}</td>
        <td class="r num">${fmt(z.lo)} – ${fmt(z.hi)}</td><td class="r num">${z.score} · ${z.touches}×</td><td class="r num">${pct((z.lo + z.hi) / 2, A.price)}</td></tr>`).join('')}
      ${A.fvgs.slice(-6).reverse().map(g => `<tr><td style="color:${g.type === 'bull' ? '#2dd4bf' : '#f472b6'}">FVG ${g.type === 'bull' ? '↑' : '↓'}</td>
        <td class="r num">${fmt(g.lo)} – ${fmt(g.hi)}</td><td class="r num">${g.fillPct} % fylld</td><td class="r num">${pct((g.lo + g.hi) / 2, A.price)}</td></tr>`).join('')}
    </table>
    <p class="muted" style="font-size:12px;margin-top:8px">↺ betyder att zonen har bytt roll, till exempel från motstånd till stöd. Styrkan väger ihop antal träffar och hur nya de är.</p>`;

  // Backtest
  if (d.isCrypto) { renderCryptoBacktest(d); return; }
  const s = d.backtest.stats;
  const recent = d.backtest.trades.slice(-6).reverse();
  $('#c-backtest').innerHTML = `<h3>Backtest – ${esc(d.name)}, cirka 4 år</h3>
    <div class="stats">
      <div class="stat"><b class="num">${s.n}</b><span>signaler</span></div>
      <div class="stat"><b class="num">${s.tp1Rate ?? '–'} %</b><span>nådde TP1</span></div>
      <div class="stat"><b class="num">${s.tp2Rate ?? '–'} %</b><span>nådde TP2</span></div>
      <div class="stat"><b class="num">${s.tp3Rate ?? '–'} %</b><span>nådde TP3</span></div>
      <div class="stat"><b class="num ${s.avgR > 0 ? 'pos' : 'neg'}">${s.avgR == null ? '–' : String(s.avgR).replace('.', ',')}</b><span>snitt R</span></div>
    </div>
    <table>
      <tr><th>Datum</th><th>Signal</th><th class="r">Köp</th><th class="r">Mål</th><th class="r">Utfall</th></tr>
      ${recent.map(t => `<tr><td>${new Date(t.t * 1000).toLocaleDateString('sv-SE')}</td><td>${t.status === 'strong' ? 'Stark' : 'Köp'}</td>
        <td class="r num">${fmt(t.entry)}</td><td class="r">${t.hit ? 'TP' + t.hit : '–'}</td>
        <td class="r num ${t.open ? '' : t.r > 0 ? 'pos' : 'neg'}">${t.open ? 'pågår' : (t.r > 0 ? '+' : '') + String(t.r).replace('.', ',') + ' R'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Inga signaler under perioden.</td></tr>'}
    </table>
    <p class="muted" style="font-size:12px;margin-top:8px">Få signaler per aktie ger stor slumpvariation. Se det samlade backtestet överst i listan.
    Simulering: köp på öppningen dagen efter signalen, stoppet flyttas till köpkursen efter TP2. Rapportspärr och makrofilter ingår. Öppnar kursen under stoppet räknas försäljningen på öppningskursen. Om stopp och mål nås samma dag räknas stoppet. Courtage och glidning ingår inte.</p>`;
}

async function loadProducts(symbol, status) {
  const el = $('#c-products');
  el.innerHTML = '<h3>Hävstång på Avanza</h3><p class="muted">Hämtar minifutures och certifikat…</p>';
  let r;
  try {
    const res = await fetch('/api/products?symbol=' + encodeURIComponent(symbol));
    if (!res.ok) throw new Error((await res.json()).error);
    r = await res.json();
  } catch (e) {
    el.innerHTML = `<h3>Hävstång på Avanza</h3><p class="muted">Kunde inte hämta produkter från Avanza: ${esc(e.message)}</p>`;
    return;
  }
  if (current !== symbol) return;
  const active = status === 'strong' || status === 'buy';
  const acct = Math.max(0, +$('#acct').value || 0), riskPct = Math.max(0, +$('#risk').value || 0);
  const size = r.size ?? 1;
  const dd = ddFactor();
  const riskKr = acct * riskPct / 100 * size * dd;
  const invest = p => p.lossAtStopPct > 0 ? riskKr / (p.lossAtStopPct / 100) : 0;
  const num = (v, d = 2) => v == null ? '–' : v.toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const item = (p, k, isMini) => `<div class="prod-item${k === 0 ? ' best' : ''}">
      <div><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>${p.ava ? '<span class="tag">AVA</span>' : ''}</div>
      <div class="muted" style="font-size:12px">${esc(p.kind)} · ${esc(p.issuer)}${k === 0 ? ' · förstahandsval' : ''}</div>
      <dl class="kv">
        <dt>Hävstång</dt><dd class="num">${num(p.leverage, 1)}x</dd>
        <dt>Köp / sälj</dt><dd class="num">${num(p.bid)} / ${num(p.ask)} <span class="muted">(spread ${num(p.spreadPct)} %)</span></dd>
        ${isMini ? `<dt>Knock-out</dt><dd class="num">${num(p.knockout)} <span class="muted">(${num(p.koDistPct, 1)} % bort, ${num(p.bufferAtr, 1)} ATR under stoppet)</span></dd>` : ''}
        <dt>Om stoppet nås</dt><dd class="num neg">≈ −${p.lossAtStopPct} %</dd>
        <dt>Vid TP1 / TP2</dt><dd class="num pos">≈ +${p.gainTp1Pct} % / +${p.gainTp2Pct} %</dd>
        <dt>Köp för</dt><dd class="num"><b>${Math.round(invest(p)).toLocaleString('sv-SE')} kr</b> <span class="muted">≈ ${Math.floor(invest(p) / p.ask).toLocaleString('sv-SE')} st, risk ${Math.round(riskKr).toLocaleString('sv-SE')} kr</span></dd>
      </dl>
    </div>`;
  const inner = `<p style="font-size:13px">Positionsstorlek: risk ${String(riskPct).replace('.', ',')} % av ${acct.toLocaleString('sv-SE')} kr × makrofaktor ${String(size).replace('.', ',')}
    ${dd < 1 ? ` × nedgångsregeln ${String(dd).replace('.', ',')}` : ''} = <b>${Math.round(riskKr).toLocaleString('sv-SE')} kr</b> i förlust om stoppet nås.${size === 0 ? ' Makroläget är ogynnsamt, så positionsstorleken är 0.' : ''}</p>
    ${r.minis.length ? `<p style="font-size:13px">Minifutures och turbos med säker hävstång. Knock-out ligger långt under signalens stopp, så stoppet nås långt innan pappret kan slås ut.</p>
    <div class="prod">${r.minis.map((p, k) => item(p, k, true)).join('')}</div>`
    : '<p class="muted">Inget minifuture-papper klarar säkerhetskraven just nu.</p>'}
    ${r.bulls.length ? `<p style="font-size:13px;margin-top:14px">Alternativ: bull-certifikat med daglig hävstång. De har ingen knock-out, men värdet kan minska när kursen svänger mycket under längre innehav.</p>
    <div class="prod">${r.bulls.map((p, k) => item(p, k + 1, false)).join('')}</div>` : ''}
    <p class="muted" style="font-size:12px;margin-top:10px">Avanza hade ${r.checked} papper. Bortsorterade: ${r.rejected.soldOut} slutsålda eller utan säljkurs,
    ${r.rejected.spread} med spread över ${r.rules.maxSpreadPct} %, ${r.rejected.knockout} med knock-out för nära stoppet, ${r.rejected.leverage} med för hög hävstång
    (max ${r.rules.maxLev}x för minifutures, ${r.rules.maxBull}x för bull-certifikat, högst ${r.rules.maxLossPct} % förlust vid stopp).
    Kurserna kan vara fördröjda. Kontrollera köp- och säljkurs hos Avanza innan du handlar. Sätt stoppet på underliggande (${num(r.stop ?? null)}), inte på certifikatet.</p>`;
  el.innerHTML = active ? `<h3>Köp på Avanza</h3>${inner}`
    : `<details class="fold-in"><summary><h3 style="display:inline">Hävstångspapper på Avanza</h3> <span class="muted small">${status === 'trade' ? '(för din öppna affär)' : '(ingen signal – bara bevakning)'}</span></summary>${inner}</details>`;
}

// Panikvecka: tre mest fallna OMXS30-aktier när VIX är minst 25, säljs efter 5 handelsdagar.
function renderPanic(p) {
  const el = $('#panic');
  el.hidden = !p?.active;
  if (!p) { el.innerHTML = ''; return; }
  const list = p.picks.map(x => `<a href="#${encodeURIComponent(x.symbol)}" data-open="${esc(x.symbol)}">${esc(x.name)}</a> <span class="neg">${String(x.ret5).replace('.', ',')} %</span>`).join(', ');
  const v = p.vix == null ? '–' : String(p.vix).replace('.', ',');
  el.className = 'panic' + (p.active ? ' on' : '');
  el.innerHTML = p.active
    ? `<b>Panikvecka: ${p.holding ? 'pågår' : 'köp'}</b> <span class="muted">(VIX ${v}, minst ${p.need})</span>
      <div>${p.holding ? 'En panikvecka är redan öppen, se signalloggen.' : `Köp på öppningen: ${list}. Sälj efter ${p.days} handelsdagar (cirka ${esc(p.exitDate)}).`}</div>
      <div class="muted" style="font-size:12px">${Math.round(p.size * 100)} % av kontot per aktie, utan hävstång och utan stopp. Sämsta veckan i testet var −20 %.</div>`
    : `<b>Panikvecka:</b> inaktiv <span class="muted">(VIX ${v}, krävs ${p.need})</span>
      <div class="muted" style="font-size:12px">När VIX är minst ${p.need} köps de tre OMXS30-aktier som fallit mest på 5 dagar, i en vecka. Mest fallna just nu: ${list}.</div>`;
  for (const a of el.querySelectorAll('[data-open]')) a.addEventListener('click', ev => { ev.preventDefault(); openSymbol(a.dataset.open); });
}

function renderMacro(m, st, cy, cal) {
  if (!m) return;
  const when = e => e.days === 0 ? 'idag' : e.days === 1 ? 'imorgon' : `om ${e.days} dagar`;
  const calLine = cal?.length ? `<div style="margin-top:6px">Kommande makrobesked (svensk tid):<ul>${cal.map(e => `<li class="${e.scored && e.days <= 7 ? 'bad' : ''}">${esc(e.date)} ${esc(e.time)} · ${esc(e.label)} <span class="muted">(${when(e)}${e.scored ? ', påverkar poängen veckan före' : ''})</span></li>`).join('')}</ul>
    <div class="need">Bara Feds räntebesked ingår i poängen. De andra kan ge stora rörelser samma dag och därmed ändra VIX och kurserna.</div></div>` : '';
  const cycleLine = cy ? `<div style="margin-top:6px">Portfölj: <b>30–50 % guld</b> som ledig kassa.
    Bitcoin-cykel: <b class="${cy.inWindow ? 'pos' : ''}">${esc(cy.label)}</b><div class="muted">${esc(cy.text)}</div></div>` : '';
  const sizeText = s => s === 1 ? 'hel position' : s === 0.5 ? 'halv position' : s === 0.25 ? 'en fjärdedels position' : 'en åttondels position';
  const stressLine = st ? `<div style="margin-top:6px">Positionsstorlek: <b class="${st.size < 1 ? 'neg' : 'pos'}">${sizeText(st.size)}</b> <span class="muted">(${st.factors ?? 0} av 3 riskfaktorer)</span></div>
    <ul>${st.parts.map(p => `<li class="${p.bad ? 'bad' : ''}">${esc(p.text)}</li>`).join('')}</ul>` : '';
  const cls = m.score < 0 ? 'neg' : m.score === 0 ? '' : 'pos';
  // Sammanfattningen syns alltid. Detaljerna fälls ihop så att listan med aktier
  // inte trycks ned (valet sparas i webbläsaren).
  const open = store.get('macroOpen', '0') === '1';
  $('#macro').innerHTML = `<details id="macro-details"${open ? ' open' : ''}><summary><span>Marknadsläge: <b class="${cls}">${esc(m.label)}</b> <span class="muted">· poäng ${m.score > 0 ? '+' : ''}${m.score} av ${m.need} som krävs</span></span></summary>
    ${m.summary ? `<div class="macro-sum">${esc(m.summary)}</div>` : ''}
    ${m.comment ? `<div class="macro-comment">${esc(m.comment)}</div>` : ''}
    <ul>${m.parts.map(p => `<li class="${p.ok ? 'ok' : p.bad ? 'bad' : ''}">${esc(p.text.replace('.', ','))}${p.pts ? ` (${p.pts > 0 ? '+' : ''}${p.pts})` : ''}${p.need ? `<div class="need">${esc(p.need)}</div>` : ''}</li>`).join('')}</ul>
    ${calLine}${stressLine}${cycleLine}</details>`;
  $('#macro-details').addEventListener('toggle', e => store.set('macroOpen', e.target.open ? '1' : '0'));
}

const newsList = items => items.length
  ? `<ul class="news">${items.map(n => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <span class="muted">${esc(n.source)} · ${new Date(n.date).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      ${n.tags.map(t => `<span class="tag ${t === 'Geopolitik' ? 'geo' : ''}">${esc(t)}</span>`).join('')}</li>`).join('')}</ul>`
  : '<p class="muted">Inga rubriker hittades.</p>';

async function loadMarketNews() {
  try {
    const d = await (await fetch('/api/news')).json();
    $('#news-body').innerHTML = `<h4>Börsen</h4>${newsList(d.market)}<h4>Krig och geopolitik</h4>${newsList(d.geo)}
      <p class="muted">Rubrikerna visas som information och påverkar inte signalerna. Krigsrisken vägs in via GPR-indexet ovan.</p>`;
  } catch {
    $('#news-body').textContent = 'Kunde inte hämta nyheter.';
  }
}

async function loadCompanyNews(symbol, name) {
  const el = $('#c-news');
  if (symbol.startsWith('^')) { el.innerHTML = '<h3>Nyheter</h3><p class="muted">Se börsnyheterna under listan.</p>'; return; }
  el.innerHTML = `<h3>Nyheter om ${esc(name)}</h3><p class="muted">Hämtar…</p>`;
  try {
    const d = await (await fetch('/api/news?symbol=' + encodeURIComponent(symbol))).json();
    if (current !== symbol) return;
    el.innerHTML = `<h3>Nyheter om ${esc(name)}</h3>${newsList(d.items.slice(0, 8))}
      <p class="muted" style="font-size:12px">Från Google Nyheter. Påverkar inte signalen, men läs rubrikerna innan du köper – en vinstvarning eller ett bud ändrar läget.</p>`;
  } catch {
    el.innerHTML = '<h3>Nyheter</h3><p class="muted">Kunde inte hämta nyheter.</p>';
  }
}

// Vad är normalt? Historiska förlustsviter och nedgångar jämfört med läget nu,
// så att en tung period kan bedömas mot vad strategin har klarat förut.
const NORMAL_10Y = { trades: 356, lossShare: 44, longestLosing: 10, maxDD: -23.6, longestNoHigh: 112 };
let normalBacktest = null, normalLive = null;
function renderNormal() {
  const n = normalBacktest, c = normalLive;
  const r = v => v == null ? '–' : String(v).replace('.', ',');
  const row = (lab, a, b, now) => `<tr><td>${lab}</td><td class="r num">${a}</td><td class="r num">${b}</td><td class="r num">${now}</td></tr>`;
  $('#normal-body').innerHTML = `<p>Strategin har fungerat historiskt, men tunga perioder är en del av den. Jämför läget nu med vad som har hänt förut innan du ändrar något.</p>
    <table class="normal-table">
      <tr><th></th><th class="r">10 år, alla indexbolag</th><th class="r">Backtest i appen</th><th class="r">Signalloggen nu</th></tr>
      ${row('Affärer', NORMAL_10Y.trades, r(n?.trades), r(c?.trades))}
      ${row('Andel förluster', NORMAL_10Y.lossShare + ' %', n ? n.lossShare + ' %' : '–', c?.trades ? c.lossShare + ' %' : '–')}
      ${row('Förluster i rad', `${NORMAL_10Y.longestLosing} som mest`, n ? `${n.longestLosing} som mest` : '–', c?.trades ? `${c.currentLosing} nu` : '–')}
      ${row('Nedgång från toppen', `${r(NORMAL_10Y.maxDD)} R som mest`, n ? `${r(n.maxDD)} R som mest` : '–', c?.trades ? `${r(c.currentDD)} R nu` : '–')}
      ${row('Affärer utan ny topp', `${NORMAL_10Y.longestNoHigh} som mest`, n ? `${n.longestNoHigh} som mest` : '–', c?.trades ? `${c.sinceHigh} nu` : '–')}
    </table>
    <p style="margin-top:8px">${c?.trades && (c.currentLosing > NORMAL_10Y.longestLosing || c.currentDD < NORMAL_10Y.maxDD)
      ? '<b class="neg">Läget är sämre än något som hänt i testerna. Det kan betyda att strategin har slutat fungera: minska risken och se över den.</b>'
      : 'Så länge läget nu ligger inom det som har hänt förut är det inget tecken på att strategin har slutat fungera. Följ reglerna.'}</p>
    <p>Nedgångsregeln under Mitt konto halverar risken när kontot är 20 % under sin topp och ger en fjärdedel vid 30 %. Fyll i kontots högsta värde där.</p>`;
}

// Signalloggen: affärskort för öppna affärer och en lista över avslutade.
let logData = null;
// Målen med bock och grön färg när de är nådda.
const tpChips = (tps, hit = 0) => tps.map((p, k) => `<span class="tp-chip${k < hit ? ' hit' : ''}" title="${k < hit ? 'Nådd' : 'Inte nådd än'}">TP${k + 1} ${fmt(p)}${k < hit ? ' ✓' : ''}</span>`).join(' ');
const KIND = e => e.kind === 'short' ? 'Blankning (AI)' : e.kind === 'panic' ? 'Panikvecka' : e.kind === 'crypto' ? 'Krypto' : e.market === 'USA' ? 'USA' : 'OMX';
const isLive = e => e.state === 'öppen' || e.state === 'väntar på köp';
const sv = v => String(v).replace('.', ',');
const resText = e => e.pct != null ? `${e.pct > 0 ? '+' : ''}${sv(e.pct)} %` : e.r != null ? `${e.r > 0 ? '+' : ''}${sv(e.r)} R` : '–';
const resCls = e => (e.pct ?? e.r) == null ? '' : (e.pct ?? e.r) > 0 ? 'pos' : (e.pct ?? e.r) < 0 ? 'neg' : '';

// Mätare från stoppet till TP3 med köp, mål och kursen just nu.
function tradeBar(e) {
  const entry = e.entry ?? e.close, lo = e.stop, hi = e.tps[2];
  const at = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  const mark = (v, label, cls) => `<i class="${cls}" style="left:${at(v)}%"><b>${label}</b></i>`;
  const fill = e.last != null ? at(e.last) : at(entry);
  return `<div class="trade-bar"><span class="fill ${e.last != null && e.last < entry === (e.kind !== 'short') && e.last !== entry ? 'down' : ''}" style="left:${Math.min(at(entry), fill)}%;width:${Math.abs(fill - at(entry))}%"></span>
    ${mark(lo, 'SL', 'sl')}${mark(entry, 'IN', 'in')}${e.tps.map((p, k) => mark(p, 'TP' + (k + 1), k < (e.hit || 0) ? 'tp hit' : 'tp')).join('')}
    ${e.last != null ? `<i class="now" style="left:${at(e.last)}%"></i>` : ''}</div>`;
}
// Nästa steg i klartext.
function nextStep(e) {
  const entry = e.entry ?? e.close, hit = e.hit || 0, act = e.kind === 'short' ? 'stäng' : 'sälj';
  if (e.kind === 'panic' || e.kind === 'crypto') return e.state === 'väntar på köp' ? `Köp på öppningen. Sälj ${esc(e.exitDate)}.` : `Sälj ${esc(e.exitDate)}, oavsett kurs.`;
  if (e.state === 'väntar på köp') return `${e.kind === 'short' ? 'Blanka' : 'Köp'} på öppningen. Stopp ${fmt(e.stop)}, första mål ${fmt(e.tps[0])}.`;
  if (hit === 0) return `Nästa: ${act} 1/3 vid TP1 <b>${fmt(e.tps[0])}</b>. Stopp ${fmt(e.stop)}.`;
  if (hit === 1) return `TP1 nådd – ${act} 1/3 om du inte gjort det. Nästa: ${act} 1/3 vid TP2 <b>${fmt(e.tps[1])}</b> och flytta stoppet till ${fmt(entry)}.`;
  return `Stoppet ligger på köpkursen ${fmt(entry)}. Nästa: ${act} resten vid TP3 <b>${fmt(e.tps[2])}</b>.`;
}
function tradeCard(e) {
  const days = e.kind === 'panic' || e.kind === 'crypto';
  return `<div class="trade-card" data-symbol="${esc(e.symbol)}">
    <div class="tc-head"><div><b>${esc(e.name)}</b> <span class="tag">${KIND(e)}</span></div>
      <div class="tc-res ${e.state === 'väntar på köp' ? '' : resCls(e)}">${e.state === 'väntar på köp' ? '<span class="muted small">väntar på köp</span>' : resText(e)}</div></div>
    <div class="muted small">Signal ${esc(e.date)}${e.entry ? ` · köp ${fmt(e.entry)}` : ''}${e.last != null ? ` · nu ${fmt(e.last)}` : ''}</div>
    ${!days && e.tps ? tradeBar(e) : ''}
    <div class="tc-next">${nextStep(e)}</div>
    ${e.coach?.lines?.length ? `<details class="coach ${e.coach.tone}"><summary><span class="coach-ico" aria-hidden="true">🧭</span><b>Coachen</b><span class="coach-peek">${esc(e.coach.lines[0])}</span></summary>
      <div class="coach-body">${e.coach.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div></details>` : ''}
  </div>`;
}

// Sektor per OMXS30-bolag, för att se när öppna affärer i praktiken är samma satsning.
const SECTOR = {
  'ABB.ST': 'Industri', 'ADDT-B.ST': 'Industri', 'ALFA.ST': 'Industri', 'ASSA-B.ST': 'Industri', 'ATCO-A.ST': 'Industri', 'EPI-A.ST': 'Industri',
  'LIFCO-B.ST': 'Industri', 'NIBE-B.ST': 'Industri', 'SAAB-B.ST': 'Industri', 'SAND.ST': 'Industri', 'SKA-B.ST': 'Industri', 'SKF-B.ST': 'Industri', 'VOLV-B.ST': 'Industri',
  'AZN.ST': 'Hälsovård', 'BOL.ST': 'Råvaror', 'SCA-B.ST': 'Råvaror', 'ERIC-B.ST': 'Teknik', 'HEXA-B.ST': 'Teknik', 'ESSITY-B.ST': 'Dagligvaror',
  'EVO.ST': 'Sällanköp', 'HM-B.ST': 'Sällanköp', 'EQT.ST': 'Finans', 'INDU-C.ST': 'Finans', 'INVE-B.ST': 'Finans',
  'NDA-SE.ST': 'Bank', 'SEB-A.ST': 'Bank', 'SHB-A.ST': 'Bank', 'SWED-A.ST': 'Bank', 'TEL2-B.ST': 'Telekom', 'TELIA.ST': 'Telekom',
};
// Total risk i öppna affärer, räknad med appens positionsstorlek: risk × konto ×
// riskfaktorer × nedgångsregeln, och bara den del som ligger kvar (2/3 efter TP1,
// inget efter TP2 när stoppet ligger på köpkursen).
function riskPanel(open) {
  if (!open.length) return '';
  const acct = Math.max(0, +$('#acct').value || 0), risk = Math.max(0, +$('#risk').value || 0) / 100, dd = ddFactor();
  const left = e => (e.hit || 0) >= 2 ? 0 : (e.hit || 0) === 1 ? 2 / 3 : 1;
  const stopped = open.filter(e => e.stop != null && e.kind !== 'panic' && e.kind !== 'crypto');
  const noStop = open.filter(e => e.kind === 'panic' || e.kind === 'crypto');
  const riskKr = stopped.reduce((a, e) => a + acct * risk * (e.size ?? 1) * dd * left(e), 0);
  const pctAcct = acct ? riskKr / acct * 100 : 0;
  const bySector = {};
  for (const e of open.filter(e => SECTOR[e.symbol])) (bySector[SECTOR[e.symbol]] ||= []).push(e.name);
  const cluster = Object.entries(bySector).filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length)[0];
  const sameDay = open.length >= 2 && new Set(open.map(e => e.date)).size === 1;
  const warn = pctAcct > 8 ? 'warn' : '';
  return `<div class="risk-panel ${warn}">
    <div class="rp-row"><span>Risk om alla stopp nås</span><b class="num">${kr(riskKr)} <span class="muted">(${pctAcct.toFixed(1).replace('.', ',')} % av kontot)</span></b></div>
    ${noStop.length ? `<div class="rp-row"><span>Utan stopp (panikvecka, krypto)</span><b class="num">${noStop.length} st</b></div>` : ''}
    ${pctAcct > 8 ? '<p class="small warn">Över 8 % av kontot på en gång. Överväg att avstå nästa signal tills något mål nåtts.</p>' : ''}
    ${cluster ? `<p class="small">⚠ ${cluster[1].length} av ${open.length} affärer är <b>${esc(cluster[0].toLowerCase())}</b>${sameDay ? ' och kom samma dag' : ''}. De rör sig ofta tillsammans, så räkna dem som en större satsning.</p>` : ''}
    <p class="muted small">Räknat med ${String(risk * 100).replace('.', ',')} % risk på ${kr(acct)} (Mer → Mitt konto) och appens positionsstorlek. Mål som redan nåtts minskar risken.</p>
  </div>`;
}

function renderTrades() {
  const el = $('#trades');
  if (!logData) { el.innerHTML = '<div class="loading">Hämtar signalloggen…</div>'; return; }
  const open = logData.entries.filter(isLive), closed = logData.entries.filter(e => !isLive(e));
  const s = logData.stats;
  el.innerHTML = `<h2 class="v-title">Öppna affärer <span class="muted">(${open.length})</span></h2>
    ${riskPanel(open)}
    ${open.length ? open.map(tradeCard).join('') : '<div class="empty small">Inga öppna affärer. Nya signaler visas under Idag.</div>'}
    <h2 class="v-title">Avslutade <span class="muted">(${closed.length})</span></h2>
    ${s.closed ? `<div class="note small">OMX: ${s.closed} stängda · TP1 ${s.tp1Rate ?? '–'} % · snitt ${s.avgR == null ? '–' : sv(s.avgR) + ' R'}${s.panic?.closed ? ` · panikveckor snitt ${sv(s.panic.avgPct)} %` : ''}${s.crypto?.closed ? ` · krypto snitt ${sv(s.crypto.avgPct)} %` : ''}</div>` : ''}
    ${closed.length ? closed.map(e => `<div class="row" data-symbol="${esc(e.symbol)}">
      <div class="name">${esc(e.name)} <span class="tag">${KIND(e)}</span></div>
      <div class="right num ${resCls(e)}">${resText(e)}</div>
      <div class="meta"><span>${esc(e.date)}</span><span>${esc(e.state)}${e.hit ? ' · TP' + e.hit + ' ✓' : ''}</span></div></div>`).join('')
      : '<div class="empty small">Inga avslutade affärer än. Alla signaler sparas med frysta nivåer, vinnare som förlorare.</div>'}`;
  bindRows(el);
}

// Idag: svaret på "finns det något att göra?".
function renderToday() {
  const el = $('#today');
  if (!scanData) return;
  const signals = scanData.rows.filter(isSignal);
  const open = (logData?.entries || []).filter(isLive);
  const near = scanData.rows.filter(r => !r.isCrypto && !isSignal(r) && !r.inTrade && r.missing?.length === 1).sort(byCloseness).slice(0, 4);
  const p = scanData.panic, panicOn = p?.active && !p.holding;
  const m = scanData.macro;
  const n = signals.length + (panicOn ? p.picks.length : 0);
  const status = n
    ? `<div class="status go"><b>${n} ${n === 1 ? 'ny signal' : 'nya signaler'}</b><span>${signals.some(r => r.preliminary) ? 'Preliminärt – bekräftas vid stängningen 17:30, köp på öppningen.' : 'Köp på öppningen. Se planen för stopp och mål.'}</span></div>`
    : `<div class="status"><b>Inget nytt att köpa</b><span>${open.length ? `Du har ${open.length} öppna ${open.length === 1 ? 'affär' : 'affärer'}. ` : ''}${m && m.score < m.need ? `Marknadsläget räcker inte (poäng ${m.score}, kräver ${m.need}). ` : ''}Nästa bedömning vid stängningen 17:30.</span></div>`;
  el.innerHTML = status
    + (signals.length ? `<h2 class="v-title">Nya signaler</h2>${signals.map(stockRow).join('')}` : '')
    + (open.length ? `<h2 class="v-title">Öppna affärer</h2>${open.map(tradeCard).join('')}` : '')
    + (near.length ? `<h2 class="v-title">Nära signal <span class="muted">(1 krav kvar)</span></h2>${near.map(stockRow).join('')}` : '');
  bindRows(el);
}

async function loadLog() {
  try {
    logData = await (await fetch('/api/log')).json();
    normalLive = logData.stats.current; renderNormal();
    const open = logData.entries.filter(isLive).length;
    $('#trades-count').hidden = !open; $('#trades-count').textContent = open;
    renderToday();
    if (view === 'trades') renderTrades();
  } catch {
    $('#trades').innerHTML = '<div class="loading">Kunde inte läsa signalloggen.</div>';
  }
}

// Kalender: rapporter, makrobesked och säljdagar de kommande 60 dagarna.
let calData = null, calAll = false;
const dayName = d => new Date(d + 'T12:00:00Z').toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
const inDays = n => n === 0 ? 'idag' : n === 1 ? 'imorgon' : `om ${n} handelsdagar`;
function calRow(e) {
  const what = e.kind === 'report' ? `Rapport: <b>${esc(e.name)}</b>` : e.kind === 'exit' ? `Säljdag: <b>${esc(e.name)}</b>` : `${esc(e.label)}${e.time ? ` <span class="muted">${esc(e.time)}</span>` : ''}`;
  const tags = [e.open ? '<span class="tp-chip hit">Din affär</span>' : '', e.near ? '<span class="tp-chip">Nära signal</span>' : '',
    e.estimated ? '<span class="muted small">uppskattat</span>' : '', e.scored ? '<span class="muted small">påverkar makropoängen veckan före</span>' : ''].filter(Boolean).join(' ');
  return `<li class="cal-row${e.open ? ' mine' : ''}"${e.symbol ? ` data-symbol="${esc(e.symbol)}"` : ''}><span class="cal-date num">${dayName(e.date)}</span>
    <span class="cal-what">${what} ${tags}${e.fedwatch ? `<span class="small cal-in">Marknaden: ${fwText(e.fedwatch)}</span>` : ''}<span class="muted small cal-in">${inDays(e.days)}${e.last ? ` · förra: ${esc(e.last.text)}${e.last.period ? ` (${esc(e.last.period)})` : ''}` : ''}</span></span></li>`;
}
// Sannolikheterna i ord, störst först.
const fwText = m => [['höjning', m.hike], ['oförändrat', m.hold], ['sänkning', m.cut]].filter(x => x[1] >= 0.5).sort((a, b) => b[1] - a[1])
  .map(([t, p]) => `${String(Math.round(p)).replace('.', ',')} % ${t}`).join(', ');
function renderFedWatch(fw) {
  const el = $('#fedwatch');
  if (!fw?.meetings?.length) { el.innerHTML = '<p class="muted small">Kunde inte räknas just nu.</p>'; return; }
  const seg = (p, cls, label) => p >= 0.5 ? `<span class="fw-seg ${cls}" style="width:${p}%" title="${label} ${Math.round(p)} %">${p >= 12 ? `${Math.round(p)} %` : ''}</span>` : '';
  el.innerHTML = `<p class="small" style="margin-top:0">Styrräntan nu: <b>${esc(fw.now.range)}</b> <span class="muted">(effektiv ${String(fw.now.effr).replace('.', ',')} %)</span></p>
    ${fw.meetings.map(m => `<div class="fw-row"><div class="fw-head"><span>${dayName(m.date)}</span><span class="muted small">väntad ränta ${m.expected.toFixed(2).replace('.', ',')} %</span></div>
      <div class="fw-bar">${seg(m.cut, 'cut', 'Sänkning')}${seg(m.hold, 'hold', 'Oförändrat')}${seg(m.hike, 'hike', 'Höjning')}</div>
      <div class="small">${fwText(m)}</div>
      <div class="muted small">${m.dist.map(d => `${esc(d.range)}: ${String(d.p).replace('.', ',')} %`).join(' · ')}</div></div>`).join('')}
    <div class="calc-legend" style="margin-top:8px"><span><i class="fw-key cut"></i>Sänkning</span><span><i class="fw-key hold"></i>Oförändrat</span><span><i class="fw-key hike"></i>Höjning</span></div>
    <p class="muted small" style="margin-top:6px">Jämfört med räntan idag. Räknat ungefär som CME FedWatch ur terminerna på Feds styrränta (Yahoo Finance). Det är marknadens bedömning, inte en prognos från Fed, och den kan ändras snabbt efter till exempel inflations- eller jobbsiffror.</p>`;
}
function renderCalendar() {
  const el = $('#calendar');
  if (!calData) return;
  const important = e => e.kind !== 'report' || e.open || e.near;
  const list = calData.events.filter(e => calAll || important(e));
  const hidden = calData.events.length - calData.events.filter(important).length;
  const outs = calData.outcomes || [];
  renderFedWatch(calData.fedwatch);
  el.innerHTML = (list.length ? `<ul class="cal">${list.map(calRow).join('')}</ul>` : '<p class="muted small">Inget inplanerat.</p>')
    + (hidden ? `<button class="btn small-btn" id="cal-all">${calAll ? 'Visa bara viktiga' : `Visa alla rapporter (${hidden} till)`}</button>` : '')
    + '<p class="muted small" style="margin-top:8px">Nya köpsignaler spärras om bolaget rapporterar inom 10 handelsdagar. För en öppen affär kan en rapport ge ett stort hopp åt båda hållen.</p>';
  $('#outcomes').innerHTML = (outs.length ? `<table class="outcomes">${outs.map(o => `<tr><td>${esc(o.label)}${o.period ? `<div class="muted small">${esc(o.period)}</div>` : ''}</td>
        <td class="r num"><b>${esc(o.text)}</b> ${o.dir > 0 ? '<span class="arrow">▲</span>' : o.dir < 0 ? '<span class="arrow">▼</span>' : ''}<div class="muted small">${esc(o.detail)}</div></td></tr>`).join('')}</table>
      <p class="muted small" style="margin-top:6px">▲ ▼ visar jämfört med förra utfallet. Analytikernas förväntningar finns inte gratis, så utfallen jämförs med förra. Källor: FRED, Riksbanken och SCB.</p>` : '<p class="muted small">Utfallen kunde inte hämtas just nu.</p>');
  $('#cal-all')?.addEventListener('click', () => { calAll = !calAll; renderCalendar(); });
  bindRows(el);
  // På Idag: rapporter för öppna affärer inom 10 handelsdagar och makrobesked inom 3 dagar.
  const soon = calData.events.filter(e => (e.open && e.kind === 'report' && e.days <= 10) || (e.kind === 'macro' && e.days <= 3));
  $('#today-cal').innerHTML = soon.length ? `<h2 class="v-title">Snart</h2><ul class="cal">${soon.map(calRow).join('')}</ul>` : '';
  bindRows($('#today-cal'));
}
async function loadCalendar() {
  try { calData = await (await fetch('/api/calendar')).json(); renderCalendar(); }
  catch { $('#calendar').innerHTML = '<p class="muted small">Kunde inte hämta kalendern.</p>'; }
}

// Vanlig ränta på ränta: fast avkastning per år, sparande varje månad och avgift.
for (const id of ['cc-start', 'cc-month', 'cc-rate', 'cc-years', 'cc-fee']) {
  const el = $('#' + id); el.value = store.get(id, el.value);
  el.addEventListener('input', () => { store.set(id, el.value); runCompound(); });
}
function runCompound() {
  const start = Math.max(0, +$('#cc-start').value || 0), monthly = Math.max(0, +$('#cc-month').value || 0);
  const rate = (+$('#cc-rate').value || 0) / 100, fee = Math.max(0, +$('#cc-fee').value || 0) / 100;
  const years = Math.min(60, Math.max(1, Math.round(+$('#cc-years').value || 1)));
  const r = (1 + rate) ** (1 / 12) * (1 - fee) ** (1 / 12) - 1;
  const rows = [{ y: 0, value: start, paid: start, fees: 0 }];
  let v = start, paid = start, fees = 0;
  for (let m = 1; m <= years * 12; m++) {
    v += monthly; paid += monthly;
    const gross = v * ((1 + rate) ** (1 / 12) - 1), net = v * r;
    fees += gross - net; v += net;
    if (m % 12 === 0) rows.push({ y: m / 12, value: v, paid, fees });
  }
  const last = rows.at(-1), gain = last.value - last.paid;
  const doubleIn = rate > 0 ? Math.log(2) / Math.log(1 + rate) : null;
  $('#cc-out').innerHTML = `
    <div class="calc-tiles">
      <div class="stat"><b class="num">${kr(last.value)}</b><span>slutvärde efter ${years} år</span></div>
      <div class="stat"><b class="num">${kr(last.paid)}</b><span>insatt totalt</span></div>
      <div class="stat"><b class="num ${gain >= 0 ? 'pos' : 'neg'}">${gain >= 0 ? '+' : ''}${kr(gain)}</b><span>avkastning (ränta på ränta)</span></div>
      <div class="stat"><b class="num">${fee > 0 ? kr(last.fees) : doubleIn ? `${doubleIn.toFixed(1).replace('.', ',')} år` : '–'}</b><span>${fee > 0 ? 'betalt i avgifter' : 'tills startbeloppet fördubblats'}</span></div>
    </div>
    <div class="calc-chart" id="cc-chart"></div>
    <div class="calc-legend"><span><i class="lg-paid-box"></i>Insatt</span><span><i class="lg-band"></i>Avkastning</span></div>
    <details class="fold-in"><summary>Visa år för år</summary>
      <table class="cc-table"><tr><th>År</th><th class="r">Insatt</th><th class="r">Avkastning</th><th class="r">Värde</th></tr>
      ${rows.slice(1).map(x => `<tr><td>${x.y}</td><td class="r num">${kr(x.paid)}</td><td class="r num">${kr(x.value - x.paid)}</td><td class="r num"><b>${kr(x.value)}</b></td></tr>`).join('')}</table>
    </details>
    <p class="muted small">Räknat med samma avkastning varje år och sparande i början av varje månad. Verkligheten svänger: börsen har gått upp ungefär 7–9 % om året i snitt över lång tid, men med år på −30 % emellan. Skatt (till exempel ISK) ingår inte.</p>`;
  drawCompound(rows);
}
function drawCompound(rows) {
  const el = $('#cc-chart'), W = Math.max(300, Math.round(el.clientWidth || 640)), H = W < 500 ? 220 : 280, L = 60, Rm = 12, T = 12, B = 26;
  const n = rows.length - 1, top = Math.max(...rows.map(r => r.value), 1) * 1.05;
  const x = i => L + (W - L - Rm) * i / n, y = v => T + (H - T - B) * (1 - Math.max(0, v) / top);
  const path = fn => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(fn(r)).toFixed(1)}`).join('');
  const area = (hi, lo) => path(hi) + rows.slice().reverse().map((r, k) => `L${x(n - k).toFixed(1)},${y(lo(r)).toFixed(1)}`).join('') + 'Z';
  const ticks = [0, .25, .5, .75, 1].map(f => top / 1.05 * f), step = n > 30 ? 10 : n > 12 ? 5 : n > 6 ? 2 : 1;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Värdet år för år">
    ${ticks.map(v => `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${krShort(v)}</text>`).join('')}
    ${rows.filter(r => r.y % step === 0).map(r => `<text x="${x(r.y)}" y="${H - 8}" class="ax" text-anchor="middle">${r.y ? r.y + ' år' : 'nu'}</text>`).join('')}
    <path d="${area(r => r.paid, () => 0)}" class="paid-area"/>
    <path d="${area(r => r.value, r => Math.min(r.paid, r.value))}" class="band2"/>
    <path d="${path(r => r.value)}" class="med"/>
    <line id="cc-hair" y1="${T}" y2="${H - B}" class="hair" visibility="hidden"/>
  </svg><div class="calc-tip" id="cc-tip" hidden></div>`;
  const svg = el.querySelector('svg'), tip = $('#cc-tip'), hair = $('#cc-hair');
  svg.addEventListener('pointermove', ev => {
    const rc = svg.getBoundingClientRect(), px = (ev.clientX - rc.left) / rc.width * W;
    const i = Math.max(0, Math.min(n, Math.round((px - L) / (W - L - Rm) * n))), r = rows[i];
    hair.setAttribute('x1', x(i)); hair.setAttribute('x2', x(i)); hair.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="muted">${i ? i + ' år' : 'nu'}</div><div><i class="lg-line"></i><b>${kr(r.value)}</b> värde</div>
      <div><i class="lg-band"></i><b>${kr(r.value - r.paid)}</b> avkastning</div><div><i class="lg-paid-box"></i><b>${kr(r.paid)}</b> insatt</div>`;
    tip.hidden = false; tip.style.left = Math.min(x(i) / W * rc.width + 12, rc.width - tip.offsetWidth - 4) + 'px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); });
}

// Natten: när Stockholm är stängt visas vad som hänt sedan 17.30 och en
// indikation för hur OMXS30 och DAX öppnar. Uppdateras var femte minut.
async function loadNight() {
  const el = $('#night');
  if (marketOpen()) { el.innerHTML = ''; return; }
  let n;
  try { n = await (await fetch('/api/overnight')).json(); } catch { return; }
  if (!n?.moves?.length) { el.innerHTML = ''; return; }
  const pc = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2).replace('.', ',')} %`;
  const cls = v => v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : '';
  const ind = n.indication || {};
  const tile = (k, name) => ind[k] ? `<div class="stat"><b class="num ${cls(ind[k].value)}">${pc(ind[k].value)}</b><span>${name} väntas öppna<br><span class="muted">spann ${pc(ind[k].lo)} till ${pc(ind[k].hi)}</span></span></div>` : '';
  el.innerHTML = `<div class="night-card">
    <div class="nc-head"><b>🌙 Natten – inför öppningen</b><span class="muted small">sedan Stockholm stängde ${esc(n.since)} 17.30 · ${new Date(n.updated).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</span></div>
    <div class="calc-tiles">${tile('omx', 'OMXS30')}${tile('dax', 'DAX')}</div>
    <ul class="night-list">${n.moves.map(m => `<li><span>${esc(m.name)}</span><b class="num ${cls(m.change)}">${pc(m.change)}</b></li>`).join('')}</ul>
    ${ind.omx ? `<p class="muted small">Indikationen bygger på S&P 500-terminen (${pc(ind.omx.basis)} sedan 17.30). De senaste ${ind.omx.n} dagarna förklarade den ${Math.round(ind.omx.r2 * 100)} % av OMX-öppningen, och riktningen stämde ${ind.omx.hit} % av gångerna när terminen rört sig mer än 0,3 %. Nyheter under natten kan ändra bilden.</p>` : ''}
  </div>`;
}
setInterval(() => { if (!document.hidden) loadNight(); }, 5 * 60 * 1000);
loadNight();

// Morgonsoffan med Glen: dagens morgonsession i text.
let morningData = null;
async function loadMorning() {
  try { morningData = (await (await fetch('/api/morning')).json()).morning; } catch { morningData = null; }
  const el = $('#morning-teaser');
  if (!morningData) { el.innerHTML = ''; return; }
  const isToday = morningData.date === new Date().toLocaleDateString('sv-SE');
  el.innerHTML = `<button class="morning-teaser" id="morning-open"><span class="mt-ico">☕</span><span><b>Morgonsoffan med Glen</b>
    <small>${isToday ? 'I dag' : esc(morningData.date)} · ${esc(morningData.summary || 'Läs dagens session')}</small></span><span class="mt-go">›</span></button>`;
  $('#morning-open').addEventListener('click', () => { setView('more'); openTool('morning'); });
  if (tool === 'morning') renderMorning();
}
function renderMorning() {
  const el = $('#morning');
  const m = morningData;
  stopSpeech();
  if (!m) { el.innerHTML = '<p class="muted">Ingen session än. Glen sätter sig i soffan kl 07.30 varje vardag.</p>'; return; }
  // Varje stycke får ett nummer, så att uppläsningen kan markera var den är.
  let i = 0;
  const p = (t, cls = '') => `<p class="say${cls ? ' ' + cls : ''}" data-say="${i++}">${esc(t)}</p>`;
  const sections = m.sections.filter(x => x.lines.length);
  el.innerHTML = `<div class="m-head"><span class="m-cup">☕</span><div><b>Morgonsoffan med Glen</b><div class="muted small">${esc(m.date)} · skriven ${new Date(m.createdAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</div></div></div>
    <div class="listen" id="listen">
      <button class="btn listen-play" id="say-play">▶ Lyssna</button>
      <button class="btn" id="say-next" title="Nästa avsnitt" hidden>⏭</button>
      <button class="btn" id="say-stop" title="Stoppa" hidden>⏹</button>
      <label class="small muted">Tempo <select id="say-rate"><option value="0.9">0,9×</option><option value="1" selected>1×</option><option value="1.15">1,15×</option><option value="1.3">1,3×</option></select></label>
      <span class="small muted" id="say-voice"></span>
    </div>
    ${p(m.intro, 'm-intro')}
    ${sections.map(x => `<h4 class="loan-h say" data-say="${i++}" data-head="1" data-title="${esc(x.title)}">${esc(x.title)}</h4>${x.links
      ? `<ul class="m-list">${x.lines.map((l, k) => `<li class="say" data-say="${i++}"><a href="${esc(x.links[k])}" target="_blank" rel="noopener">${esc(l)}</a></li>`).join('')}</ul>`
      : x.lines.map(l => p(l)).join('')}`).join('')}
    ${p(m.outro, 'm-outro')}
    <p class="muted small">Skriven automatiskt av appen från marknadsdata (Yahoo Finance, FRED, SCB, Riksbanken, Google Nyheter) och dina loggade affärer. Inte investeringsrådgivning.</p>`;
  $('#say-rate').value = store.get('sayRate', '1');
  $('#say-rate').addEventListener('change', e => { store.set('sayRate', e.target.value); const a = $('#say-audio'); if (a) a.playbackRate = +e.target.value; });
  // Färdig ljudfil med neural röst om den finns för dagens session, annars enhetens röst.
  const audioOk = m.audio?.url && m.talk?.length && m.audio.offsets?.length === m.talk.length;
  if (audioOk) {
    const a = document.createElement('audio');
    a.id = 'say-audio'; a.preload = 'none'; a.src = m.audio.url;
    a.addEventListener('timeupdate', () => audioHighlight(a));
    a.addEventListener('play', setSayButtons);
    a.addEventListener('pause', setSayButtons);
    a.addEventListener('ended', stopSpeech);
    a.addEventListener('error', () => { a.remove(); toast('Ljudfilen kunde inte spelas. Enhetens egen röst används i stället.'); setVoiceLabel(); setSayButtons(); });
    $('#listen').appendChild(a);
  }
  $('#say-play').addEventListener('click', toggleSpeech);
  $('#say-stop').addEventListener('click', stopSpeech);
  $('#say-next').addEventListener('click', nextSection);
  setVoiceLabel();
  // Dagens ljudfil skapas några minuter efter att sessionen skrivits: hämta igen tills den finns.
  clearTimeout(renderMorning.wait);
  if (!audioOk && m.date === new Date().toLocaleDateString('sv-SE') && Date.now() - Date.parse(m.createdAt) < 30 * 60000) {
    $('#say-voice').textContent = 'Mattias röst läses in – klar inom några minuter. Tills dess används enhetens röst.';
    renderMorning.wait = setTimeout(async () => { if (tool !== 'morning' || speech) return; await loadMorning(); renderMorning(); }, 60000);
  }
}
function setVoiceLabel() {
  const el = $('#say-voice'); if (!el) return;
  if ($('#say-audio')) { el.textContent = `Röst: ${(morningData.audio.voice || '').includes('Sofie') ? 'Sofie' : 'Mattias'} (neural)`; return; }
  const v = pickVoice();
  el.textContent = !('speechSynthesis' in window) ? 'Webbläsaren saknar uppläsning.' : v ? `Röst: ${v.name}` : 'Ingen svensk röst hittades på enheten.';
}
// Ljudfil: markera stycket som spelas utifrån var varje stycke börjar.
function audioHighlight(a) {
  const off = morningData?.audio?.offsets || [];
  let k = 0; while (k + 1 < off.length && off[k + 1] <= a.currentTime + 0.05) k++;
  if (speech?.idx === k) return;
  speech = { idx: k, playing: !a.paused };
  const it = sayItems()[k];
  document.querySelectorAll('#morning .speaking').forEach(x => x.classList.remove('speaking'));
  if (it?.el) { it.el.classList.add('speaking'); it.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

// Uppläsning med enhetens inbyggda talsyntes (Web Speech). Gratis, ingen server.
// Texten skrivs om för tal: minus/plus, procent, mål, datum och klockslag.
const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
function forSpeech(t) {
  return t
    .replace(/(\d)[ \u00a0](\d{3})\b/g, '$1$2')
    .replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y, mo, d) => `${+d} ${MONTHS[+mo - 1]}`)
    .replace(/\b[Kk]l\.? (\d{1,2})\.(\d{2})/g, (_, h, mi) => `klockan ${+h}${mi === '00' ? '' : ' och ' + +mi}`)
    .replace(/\b(\d{1,2})\.(\d{2})\b(?=\D|$)/g, (_, h, mi) => (+h < 24 && +mi < 60 ? `${+h}${mi === '00' ? '' : ' och ' + +mi}` : `${h}.${mi}`))
    .replace(/[−-](?=\d)/g, 'minus ').replace(/\+(?=\d)/g, 'plus ')
    .replace(/\bTP(\d)\b/g, (_, n) => `mål ${['', 'ett', 'två', 'tre'][+n] || n}`)
    .replace(/OMXS30/g, 'O M X trettio').replace(/S&P/g, 'S och P').replace(/\bVIX\b/g, 'vix')
    .replace(/\bEMA (\d+)/g, 'E M A $1').replace(/\bRSI\b/g, 'R S I').replace(/\bKPIF\b/g, 'K P I F').replace(/\bKPI\b/g, 'K P I').replace(/\bPCE\b/g, 'P C E').replace(/\bBNP\b/g, 'B N P')
    .replace(/(\d) %/g, '$1 procent').replace(/%/g, ' procent').replace(/(\d) \$/g, '$1 dollar').replace(/\$/g, ' dollar')
    .replace(/(\d) kr\b/g, '$1 kronor').replace(/ – /g, ', ').replace(/·/g, ',').replace(/[()]/g, ', ')
    .replace(/(\d)[ \u00a0](\d{3})\b/g, '$1$2').replace(/\s*,(\s*,)+/g, ',').replace(/\s+,/g, ',').replace(/,\s*\./g, '.').replace(/\s{2,}/g, ' ');
}
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const sv = speechSynthesis.getVoices().filter(v => /^sv/i.test(v.lang));
  const score = v => (/enhanced|förbättrad|premium|natural|neural/i.test(v.name) ? 4 : 0) + (/alva|klara|sofie|hillevi|mattias/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
  return sv.sort((a, b) => score(b) - score(a))[0] || null;
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { if (tool === 'morning' && $('#say-voice')) { const v = pickVoice(); $('#say-voice').textContent = v ? `Röst: ${v.name}` : 'Ingen svensk röst hittades på enheten.'; } };
let speech = null; // { idx, playing }
// Det som läses upp: talmanuset (skrivet för tal) om det finns, annars texten på sidan.
// Varje post pekar på stycket eller avsnittsrubriken som markeras medan den läses.
function sayItems() {
  const dom = [...document.querySelectorAll('#morning [data-say]')];
  const talk = morningData?.talk;
  if (!talk?.length) return dom.map(el => ({ el, text: forSpeech(el.textContent) + (el.dataset.head ? '.' : ''), head: !!el.dataset.head, section: el.dataset.title || null }));
  const head = t => document.querySelector(`#morning h4[data-title="${CSS.escape(t)}"]`);
  return talk.map((t, k) => ({ el: t.section ? head(t.section) : k === 0 ? dom[0] : dom[dom.length - 1], text: forSpeech(t.text), section: t.section, head: k > 0 && t.section !== talk[k - 1].section }));
}
function sayFrom(idx) {
  const items = sayItems();
  document.querySelectorAll('#morning .speaking').forEach(x => x.classList.remove('speaking'));
  if (idx >= items.length) { stopSpeech(); return; }
  const it = items[idx];
  if (it.el) { it.el.classList.add('speaking'); it.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  const u = new SpeechSynthesisUtterance(it.text);
  const v = pickVoice(); if (v) u.voice = v;
  u.lang = 'sv-SE'; u.rate = +($('#say-rate')?.value || 1);
  u.onend = () => {
    if (!(speech?.playing && speech.idx === idx)) return;
    speech.idx = idx + 1;
    // En kort paus mellan avsnitten, som en människa gör.
    setTimeout(() => { if (speech?.playing && speech.idx === idx + 1) sayFrom(idx + 1); }, items[idx + 1]?.head ? 450 : 120);
  };
  speech = { idx, playing: true };
  speechSynthesis.speak(u);
  setSayButtons();
}
function setSayButtons() {
  if (!$('#say-play')) return;
  const a = $('#say-audio');
  if (a) {
    const started = a.currentTime > 0 && !a.ended;
    $('#say-play').textContent = !a.paused ? '⏸ Pausa' : started ? '▶ Fortsätt' : '▶ Lyssna';
    $('#say-next').hidden = $('#say-stop').hidden = !started && a.paused;
    return;
  }
  const on = !!speech;
  $('#say-play').textContent = !on ? '▶ Lyssna' : speech.playing ? '⏸ Pausa' : '▶ Fortsätt';
  $('#say-next').hidden = $('#say-stop').hidden = !on;
}
function toggleSpeech() {
  const a = $('#say-audio');
  if (a) { a.playbackRate = +($('#say-rate')?.value || 1); if (a.paused) a.play().catch(() => a.dispatchEvent(new Event('error'))); else a.pause(); return; }
  if (!('speechSynthesis' in window)) return;
  if (!speech) { speechSynthesis.cancel(); sayFrom(0); return; }
  if (speech.playing) { speech.playing = false; speechSynthesis.pause(); }
  else { speech.playing = true; speechSynthesis.resume(); if (!speechSynthesis.speaking) sayFrom(speech.idx); }
  setSayButtons();
}
function nextSection() {
  const a = $('#say-audio');
  if (a) {
    const items = sayItems(), off = morningData.audio.offsets;
    let k = (speech?.idx ?? 0) + 1; while (k < items.length && !items[k].head) k++;
    if (k < off.length) a.currentTime = off[k] + 0.01; else stopSpeech();
    return;
  }
  if (!speech) return;
  const items = sayItems();
  let k = speech.idx + 1;
  while (k < items.length && !items[k].head) k++;
  speech.playing = false; speechSynthesis.cancel();
  sayFrom(k);
}
function stopSpeech() {
  const a = $('#say-audio');
  if (a) { a.pause(); try { a.currentTime = 0; } catch { /* inte laddad */ } }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  speech = null;
  document.querySelectorAll('#morning .speaking').forEach(x => x.classList.remove('speaking'));
  setSayButtons();
}

// Börstider i användarens egen tid (webbläsarens tidszon). Helgdagar räknas inte.
const EXCHANGES = [
  { name: 'Tokyo', tz: 'Asia/Tokyo', s: [['09:00', '11:30'], ['12:30', '15:30']] },
  { name: 'Shanghai', tz: 'Asia/Shanghai', s: [['09:30', '11:30'], ['13:00', '15:00']] },
  { name: 'Hongkong', tz: 'Asia/Hong_Kong', s: [['09:30', '12:00'], ['13:00', '16:00']] },
  { name: 'Sydney', tz: 'Australia/Sydney', s: [['10:00', '16:00']] },
  { name: 'Stockholm', tz: 'Europe/Stockholm', s: [['09:00', '17:30']], note: 'Stängningsauktion 17.25–17.30', mine: true },
  { name: 'Frankfurt (Xetra)', tz: 'Europe/Berlin', s: [['09:00', '17:30']] },
  { name: 'London', tz: 'Europe/London', s: [['08:00', '16:30']] },
  { name: 'New York', tz: 'America/New_York', s: [['09:30', '16:00']], note: 'Förhandel från 04.00, efterhandel till 20.00 (New York-tid)' },
];
const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
// Tidpunkt (Date) för en klockslag i en viss tidszon, en viss dag (räknat i den zonen).
function tzOffsetMin(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - date.getTime()) / 60000;
}
function zoned(ymd, hhmm, tz) {
  const [y, m, d] = ymd.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  return new Date(guess - tzOffsetMin(new Date(guess), tz) * 60000);
}
const ymdIn = (date, tz) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const hm = date => date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }).replace(':', '.');
const isWeekday = (date, tz) => !/Sat|Sun/.test(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date));
// Handelspass idag (i börsens tid) och nästa öppning, som Date.
function sessions(ex, now = new Date()) {
  const today = ymdIn(now, ex.tz);
  const list = isWeekday(zoned(today, '12:00', ex.tz), ex.tz) ? ex.s.map(([a, b]) => [zoned(today, a, ex.tz), zoned(today, b, ex.tz)]) : [];
  const open = list.find(([a, b]) => now >= a && now < b);
  let next = list.find(([a]) => a > now)?.[0];
  for (let k = 1; !next && k < 8; k++) {
    const d = new Date(zoned(today, '12:00', ex.tz).getTime() + k * 864e5), ymd = ymdIn(d, ex.tz);
    if (isWeekday(zoned(ymd, '12:00', ex.tz), ex.tz)) next = zoned(ymd, ex.s[0][0], ex.tz);
  }
  return { list, open, next };
}
const until = ms => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
let hoursTimer = null;
function renderHours() {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const pos = d => Math.max(0, Math.min(100, (d - dayStart) / 864e5 * 100));
  const rows = EXCHANGES.map(ex => {
    const { list, open, next } = sessions(ex, now);
    const all = ex.s.map(([a, b]) => { const t = ymdIn(now, ex.tz); return [zoned(t, a, ex.tz), zoned(t, b, ex.tz)]; });
    const span = `${hm(all[0][0])}–${hm(all.at(-1)[1])}${all.length > 1 ? ` <span class="muted small">(lunch ${hm(all[0][1])}–${hm(all[1][0])})</span>` : ''}`;
    const status = open ? `<span class="tp-chip hit">Öppen</span> <span class="muted small">stänger om ${until(open[1] - now)}</span>`
      : `<span class="tp-chip">Stängd</span> <span class="muted small">${next ? `öppnar ${next.toDateString() === now.toDateString() ? `om ${until(next - now)}` : next.toLocaleDateString('sv-SE', { weekday: 'long' }) + ' ' + hm(next)}` : ''}</span>`;
    // Tidslinje 00–24 i din tid. Pass som går över midnatt delas.
    const segs = [];
    for (const [a, b] of all) {
      for (const shift of [-864e5, 0, 864e5]) {
        const A = new Date(+a + shift), B = new Date(+b + shift);
        const l = pos(A), r = pos(B);
        if (r > l) segs.push(`<span class="hr-seg${ex.mine ? ' mine' : ''}" style="left:${l}%;width:${r - l}%"></span>`);
      }
    }
    return `<div class="hr-row"><div class="hr-top"><b>${esc(ex.name)}</b><span>${span}</span></div>
      <div class="hr-line">${segs.join('')}<span class="hr-now" style="left:${pos(now)}%"></span></div>
      <div class="hr-bot">${status}${ex.note ? `<span class="muted small">${esc(ex.note)}</span>` : ''}</div></div>`;
  });
  $('#hours').innerHTML = `<p class="small" style="margin-top:0">Din tid: <b>${hm(now)}</b> <span class="muted">(${esc(myTz)})</span>. Tiderna räknas om automatiskt vid sommar- och vintertid.</p>
    <div class="hr-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    ${rows.join('')}
    <div class="hr-row"><div class="hr-top"><b>Hävstångscertifikat på Avanza</b><span>till cirka 22.00</span></div>
      <div class="hr-bot"><span class="muted small">Emittenterna ställer kurser även när Stockholm är stängt, så länge USA handlas. Tiderna varierar mellan emittenter.</span></div></div>
    <div class="hr-row"><div class="hr-top"><b>Krypto</b><span>dygnet runt</span></div></div>
    <p class="muted small">Helgdagar ingår inte – kontrollera börsens kalender kring storhelger.</p>`;
  clearInterval(hoursTimer);
  hoursTimer = setInterval(() => { if (tool === 'hours') renderHours(); else clearInterval(hoursTimer); }, 60000);
}
// Volym per kvart, omräknad till din tid.
let volData = null;
async function loadVolProfile() {
  if (!volData) { try { volData = await (await fetch('/api/volume-profile')).json(); } catch { $('#volprof').innerHTML = '<p class="muted small">Kunde inte hämta volymdata.</p>'; return; } }
  const chart = (m, title, note) => {
    if (!m?.slots?.length) return '';
    const today = ymdIn(new Date(), m.tz);
    const slots = m.slots.map(x => ({ ...x, at: zoned(today, x.t, m.tz) }));
    const cap = Math.max(...slots.slice(0, -1).map(x => x.share)) * 1.15;
    const top = slots.slice().sort((a, b) => b.share - a.share);
    const bars = slots.map(x => { const big = x.share > cap; const h = Math.min(100, x.share / cap * 100);
      return `<div class="vb${big ? ' cut' : ''}" title="${hm(x.at)}: ${String(x.share).replace('.', ',')} % av dagens volym"><span style="height:${h}%"></span>${big ? `<em>${Math.round(x.share)} %</em>` : ''}</div>`; }).join('');
    const ticks = slots.filter((x, i) => i % 4 === 0).map(x => `<span>${hm(x.at)}</span>`).join('');
    return `<h4 class="loan-h">${title}</h4><div class="vchart">${bars}</div><div class="vticks">${ticks}</div>
      <p class="small">${note(top, slots)}</p>`;
  };
  const pctOf = (slots, from, to) => String(Math.round(slots.filter(x => hm(x.at) >= from && hm(x.at) < to).reduce((a, x) => a + x.share, 0) * 10) / 10).replace('.', ',');
  const om = volData.omx, us = volData.us;
  $('#volprof').innerHTML = `<p class="small" style="margin-top:0">Andel av dagens handel per kvart, i snitt de senaste 60 handelsdagarna. Mycket volym betyder mycket köpare och säljare: bättre priser, men också större rörelser.</p>`
    + chart(om, 'Stockholm (10 stora OMX-aktier)', (top, sl) => {
      const auction = sl.at(-1), usOpen = sl.find(x => x.t === '15:30');
      return `Störst är <b>stängningsauktionen</b> i sista kvarten (${hm(auction.at)}–${hm(new Date(+auction.at + 15 * 6e4))}): <b>${String(auction.share).replace('.', ',')} %</b> av dagens volym.
        Därefter <b>öppningen</b> (${hm(sl[0].at)}–${hm(sl[2].at)}: ${pctOf(sl, hm(sl[0].at), hm(sl[2].at))} %) och <b>när USA öppnar</b> (${usOpen ? hm(usOpen.at) : '15.30'}). Lugnast är lunchen.`;
    })
    + chart(us, 'New York (SPY och QQQ)', (top, sl) => `Första kvarten (${hm(sl[0].at)}) står för <b>${String(sl[0].share).replace('.', ',')} %</b> och sista kvarten (${hm(sl.at(-1).at)}) för <b>${String(sl.at(-1).share).replace('.', ',')} %</b> av dagens volym. Mitt på dagen är det lugnast.`)
    + `<p class="muted small">Källa: Yahoo Finance, 15-minutersdata. Amerikanska makrosiffror (${hm(zoned(ymdIn(new Date(), 'America/New_York'), '08:30', 'America/New_York'))} i din tid) brukar ge en extra topp i både Stockholm och USA.</p>`;
}

// Betala av lån med snöbollsmetoden (Dave Ramsey): minimibetalning på alla lån,
// och allt som blir över går till det minsta lånet. När det är betalt flyttas
// dess betalning till nästa minsta, så att summan per månad är densamma men
// lånen försvinner allt fortare. Lån markerade "Enligt plan" (till exempel CSN
// och bolån) betalas som vanligt och ingår inte. Sparas bara i webbläsaren.
const LOAN_EXAMPLE = [
  { name: 'Kreditkort', debt: 8000, rate: 18, pay: 300, plan: false },
  { name: 'Privatlån', debt: 25000, rate: 9, pay: 600, plan: false },
  { name: 'Billån', debt: 60000, rate: 6, pay: 1500, plan: false },
  { name: 'CSN', debt: 180000, rate: 1.8, pay: 1100, plan: true },
];
let loans = (() => { try { return JSON.parse(store.get('loans', '')) || LOAN_EXAMPLE; } catch { return LOAN_EXAMPLE; } })();
const loansExample = () => store.get('loans', '') === '';
$('#loan-extra').value = store.get('loanExtra', '0');
$('#loan-extra').addEventListener('input', () => { store.set('loanExtra', $('#loan-extra').value); runLoans(); });
$('#loan-add').addEventListener('click', () => { loans.push({ name: `Lån ${loans.length + 1}`, debt: 10000, rate: 5, pay: 500, plan: false }); saveLoans(); renderLoans(); });
function saveLoans() { store.set('loans', JSON.stringify(loans)); }
// Låsta lån går inte att ändra av misstag. Valet sparas.
let loansLocked = store.get('loansLocked', '0') === '1';
$('#loan-lock').addEventListener('click', () => { loansLocked = !loansLocked; store.set('loansLocked', loansLocked ? '1' : '0'); renderLoans(); });
function renderLoans() {
  $('#loan-lock').textContent = loansLocked ? '🔒 Låst – lås upp för att ändra' : '🔓 Lås siffrorna';
  $('#loan-lock').setAttribute('aria-pressed', String(loansLocked));
  $('#loan-lock').classList.toggle('locked', loansLocked);
  $('#loan-add').hidden = loansLocked;
  $('#loan-extra').disabled = loansLocked;
  if (loansLocked) {
    $('#loan-list').innerHTML = `<table class="cc-table loan-locked"><tr><th>Lån</th><th class="r">Skuld</th><th class="r">Ränta</th><th class="r">Per månad</th></tr>
      ${loans.map(l => `<tr><td>${esc(l.name)}${l.plan ? ' <span class="tp-chip">Enligt plan</span>' : ''}</td><td class="r num">${kr(l.debt)}</td><td class="r num">${String(l.rate).replace('.', ',')} %</td><td class="r num">${kr(l.pay)}</td></tr>`).join('')}</table>`;
    runLoans();
    return;
  }
  $('#loan-list').innerHTML = (loansExample() ? '<p class="note small">Exempel. Skriv in dina egna lån, så sparas de.</p>' : '')
    + `<div class="loan-row loan-headrow"><span>Namn</span><span>Skuld, kr</span><span>Ränta, %</span><span>Per månad, kr</span><span>Enligt plan</span><span></span></div>`
    + loans.map((l, i) => `<div class="loan-row" data-i="${i}">
      <label class="lf lf-name"><span>Namn</span><input data-k="name" value="${esc(l.name)}"></label>
      <label class="lf"><span>Skuld, kr</span><input data-k="debt" type="number" min="0" step="1000" inputmode="numeric" value="${l.debt}"></label>
      <label class="lf"><span>Ränta, %</span><input data-k="rate" type="number" min="0" max="50" step="0.1" inputmode="decimal" value="${l.rate}"></label>
      <label class="lf"><span>Per månad, kr</span><input data-k="pay" type="number" min="0" step="100" inputmode="numeric" value="${l.pay}"></label>
      <label class="loan-plan"><input data-k="plan" type="checkbox"${l.plan ? ' checked' : ''}><span>Enligt plan</span></label>
      <button class="btn loan-del" title="Ta bort lånet" aria-label="Ta bort lånet">×</button></div>`).join('');
  for (const row of document.querySelectorAll('.loan-row[data-i]')) {
    const i = +row.dataset.i;
    for (const inp of row.querySelectorAll('input')) inp.addEventListener('input', () => {
      const k = inp.dataset.k;
      loans[i][k] = k === 'plan' ? inp.checked : k === 'name' ? inp.value : Math.max(0, +inp.value || 0);
      saveLoans(); runLoans();
    });
    row.querySelector('.loan-del').addEventListener('click', () => { loans.splice(i, 1); saveLoans(); renderLoans(); });
  }
  runLoans();
}
// Simulerar månad för månad. order: 'snowball' (minst skuld först), 'avalanche'
// (högst ränta först) eller 'min' (bara minimibetalningar). Returnerar när varje lån är betalt.
function simulateLoans(list, extra, order) {
  const L = list.map((l, i) => ({ ...l, i, bal: l.debt, paidAt: l.debt > 0 ? null : 0, interest: 0 }));
  const snow = L.filter(l => !l.plan), plan = L.filter(l => l.plan);
  const pool = snow.reduce((a, l) => a + l.pay, 0) + (order === 'min' ? 0 : extra);
  const sorted = snow.slice().sort((a, b) => order === 'avalanche' ? b.rate - a.rate || a.debt - b.debt : a.debt - b.debt || b.rate - a.rate);
  const curve = [snow.reduce((a, l) => a + l.bal, 0)];
  let m = 0;
  while (m < 600 && L.some(l => l.bal > 0.5)) {
    m++;
    for (const l of L) if (l.bal > 0) { const r = l.bal * l.rate / 100 / 12; l.bal += r; l.interest += r; }
    for (const l of plan) if (l.bal > 0) { l.bal -= Math.min(l.bal, l.pay); if (l.bal <= 0.5 && l.paidAt == null) { l.bal = 0; l.paidAt = m; } }
    let left = pool;
    if (order === 'min') { for (const l of snow) if (l.bal > 0) { const p = Math.min(l.bal, l.pay); l.bal -= p; } }
    else {
      for (const l of snow) if (l.bal > 0) { const p = Math.min(l.bal, l.pay); l.bal -= p; left -= p; }
      for (const l of sorted) { if (left <= 0) break; if (l.bal > 0) { const p = Math.min(l.bal, left); l.bal -= p; left -= p; } }
    }
    for (const l of snow) if (l.bal <= 0.5 && l.paidAt == null) { l.bal = 0; l.paidAt = m; }
    curve.push(snow.reduce((a, l) => a + Math.max(0, l.bal), 0));
    if (snow.every(l => l.bal <= 0.5) && plan.every(l => l.bal <= 0.5)) break;
  }
  const done = snow.length ? Math.max(...snow.map(l => l.paidAt ?? Infinity)) : 0;
  return { loans: L, sorted, pool, done, interest: snow.reduce((a, l) => a + l.interest, 0), curve };
}
const monthName = m => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + m); return d.toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' }); };
const dur = m => !isFinite(m) ? 'aldrig' : m < 12 ? `${m} mån` : `${Math.floor(m / 12)} år${m % 12 ? ` ${m % 12} mån` : ''}`;
function runLoans() {
  const out = $('#loan-out');
  const extra = Math.max(0, +$('#loan-extra').value || 0);
  const list = loans.filter(l => l.debt > 0);
  const snowList = list.filter(l => !l.plan);
  if (!snowList.length) { out.innerHTML = '<p class="muted">Lägg till minst ett lån som inte är markerat Enligt plan.</p>'; return; }
  const never = list.filter(l => l.pay <= l.debt * l.rate / 100 / 12);
  const sb = simulateLoans(list, extra, 'snowball'), av = simulateLoans(list, extra, 'avalanche'), mn = simulateLoans(list, extra, 'min');
  // Betalningen som rullar vidare när varje lån är betalt.
  let roll = 0;
  const steps = sb.sorted.map((l, k) => {
    const res = sb.loans[l.i];
    const payNow = l.pay + (k === 0 ? extra : 0) + roll;
    roll += l.pay + (k === 0 ? extra : 0);
    return { name: l.name, debt: l.debt, rate: l.rate, payNow, at: res.paidAt };
  });
  const plans = sb.loans.filter(l => l.plan);
  out.innerHTML = `
    ${never.length ? `<p class="warn small">⚠ ${never.map(l => esc(l.name)).join(', ')}: betalningen täcker inte räntan, så lånet växer. Höj betalningen.</p>` : ''}
    <div class="calc-tiles">
      <div class="stat"><b class="num">${dur(sb.done)}</b><span>till skuldfri med snöbollen${isFinite(sb.done) ? ` (${monthName(sb.done)})` : ''}</span></div>
      <div class="stat"><b class="num">${kr(sb.pool)}</b><span>betalar du varje månad, hela vägen</span></div>
      <div class="stat"><b class="num">${kr(sb.interest)}</b><span>i ränta totalt</span></div>
      <div class="stat"><b class="num ${mn.done - sb.done > 0 ? 'pos' : ''}">${isFinite(mn.done) ? dur(mn.done - sb.done) : '–'}</b><span>snabbare än bara minimibetalningar</span></div>
    </div>
    <h4 class="loan-h">Ordning</h4>
    <ol class="snow">${steps.map((s, k) => `<li><div><b>${esc(s.name)}</b> <span class="muted small">${kr(s.debt)} · ${String(s.rate).replace('.', ',')} %</span></div>
      <div class="small">${k === 0 ? 'Betala nu' : 'Därefter'} <b>${kr(s.payNow)}</b> i månaden${k ? ` <span class="muted">(${kr(steps[k - 1].payNow)} flyttas hit)</span>` : ''} · betalt <b>${isFinite(s.at) && s.at != null ? monthName(s.at) : 'aldrig'}</b></div></li>`).join('')}</ol>
    ${plans.length ? `<p class="small muted">Enligt plan: ${plans.map(l => `${esc(l.name)} ${kr(l.pay)}/mån, klart ${l.paidAt != null ? monthName(l.paidAt) : 'om mer än 50 år'}`).join(' · ')}</p>` : ''}
    <div class="calc-chart" id="loan-chart"></div>
    <div class="calc-legend"><span><i class="lg-line"></i>Snöbollen</span><span><i class="lg-paid"></i>Bara minimibetalningar</span></div>
    <h4 class="loan-h">Jämförelse</h4>
    <table class="cc-table"><tr><th></th><th class="r">Skuldfri</th><th class="r">Ränta totalt</th></tr>
      <tr><td>Snöbollen (minsta lånet först)</td><td class="r num">${dur(sb.done)}</td><td class="r num">${kr(sb.interest)}</td></tr>
      <tr><td>Lavinen (dyraste räntan först)</td><td class="r num">${dur(av.done)}</td><td class="r num">${kr(av.interest)}</td></tr>
      <tr><td>Bara minimibetalningar</td><td class="r num">${dur(mn.done)}</td><td class="r num">${isFinite(mn.done) ? kr(mn.interest) : '–'}</td></tr></table>
    <p class="muted small">${av.interest < sb.interest - 1 ? `Lavinen sparar ${kr(sb.interest - av.interest)} i ränta, men snöbollen ger snabba segrar när små lån försvinner, och det är därför Ramsey förordar den.` : 'Här kostar snöbollen inte mer i ränta än lavinen.'}
      Räknat med samma ränta hela tiden och betalning en gång i månaden. Ramsey rekommenderar en buffert på cirka 10 000 kr innan man börjar.</p>`;
  drawLoans(sb.curve, mn.curve);
}
function drawLoans(a, b) {
  const el = $('#loan-chart'), W = Math.max(300, Math.round(el.clientWidth || 600)), H = W < 500 ? 200 : 240, L = 60, Rm = 12, T = 12, B = 26;
  // Visa bara tiden tills snöbollslånen är betalda (lån enligt plan kan pågå i många år till).
  const lastDebt = c => { let i = c.length - 1; while (i > 0 && c[i] <= 0.5) i--; return i + 1; };
  const n = Math.max(12, Math.min(Math.max(lastDebt(a), lastDebt(b)) + 3, 600)), top = Math.max(a[0], 1) * 1.05;
  const x = i => L + (W - L - Rm) * i / n, y = v => T + (H - T - B) * (1 - v / top);
  const path = c => c.slice(0, n + 1).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const yrs = n / 12, step = yrs > 20 ? 5 : yrs > 8 ? 2 : yrs > 3 ? 1 : 0.5;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Skulden över tid">
    ${[0, .5, 1].map(f => top / 1.05 * f).map(v => `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${krShort(v)}</text>`).join('')}
    ${Array.from({ length: Math.floor(yrs / step) + 1 }, (_, k) => k * step).map(t => `<text x="${x(t * 12)}" y="${H - 8}" class="ax" text-anchor="middle">${t ? String(t).replace('.', ',') + ' år' : 'nu'}</text>`).join('')}
    <path d="${path(b)}" class="paid"/><path d="${path(a)}" class="med"/></svg>`;
}

// Ränta på ränta med strategin: tusentals möjliga framtider dragna ur de
// verkliga affärerna i tioårstestet, i stället för en jämn kurva.
let trades10y = null;
const CALC_COST_R = 0.05; // courtage och spread per affär, uppskattat
$('#cx-start').value = store.get('acct', '10000');
$('#cx-risk').value = store.get('risk', '2.5');
for (const id of ['cx-start', 'cx-month', 'cx-risk', 'cx-years', 'cx-rate']) $('#' + id).addEventListener('input', () => runCalc());
async function loadStrategyCalc() {
  if (trades10y) { runCalc(); return; }
  $('#calc-out').innerHTML = '<div class="loading">Hämtar affärerna…</div>';
  try { trades10y = await (await fetch('/api/trades10y')).json(); runCalc(); } catch { $('#calc-out').innerHTML = '<p class="muted">Kunde inte hämta affärerna.</p>'; }
}
const kr = v => Math.round(v).toLocaleString('sv-SE') + ' kr';
const krShort = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' mn' : v >= 1e4 ? Math.round(v / 1000) + ' tkr' : Math.round(v).toLocaleString('sv-SE');
function runCalc() {
  if (!trades10y) return;
  const start = Math.max(0, +$('#cx-start').value || 0), monthly = Math.max(0, +$('#cx-month').value || 0);
  const risk = Math.min(10, Math.max(0, +$('#cx-risk').value || 0)) / 100, years = Math.min(20, Math.max(1, Math.round(+$('#cx-years').value || 1)));
  const rate = Math.max(0, +$('#cx-rate').value || 0) / 100;
  const R = trades10y.r.map(x => x - CALC_COST_R);
  const span = (Date.now() - Date.parse(trades10y.from)) / (365.25 * 864e5), perYear = R.length / span, lambda = perYear / 12;
  const M = years * 12, N = 2000;
  // Fast slumpfrö så att siffrorna inte hoppar när man skriver.
  let seed = 12345; const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const poisson = () => { const L = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
  const cols = Array.from({ length: M + 1 }, () => new Float64Array(N)), dds = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let eq = start, peak = start, dd = 0; cols[0][i] = eq;
    for (let m = 1; m <= M; m++) {
      eq += monthly; peak += monthly;
      for (let k = poisson(); k > 0; k--) { eq = Math.max(0, eq * (1 + risk * R[Math.floor(rnd() * R.length)])); peak = Math.max(peak, eq); dd = Math.min(dd, peak > 0 ? eq / peak - 1 : 0); }
      cols[m][i] = eq;
    }
    dds[i] = dd;
  }
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const bands = cols.map(c => { const a = Float64Array.from(c).sort(); return { p10: q(a, .1), p25: q(a, .25), p50: q(a, .5), p75: q(a, .75), p90: q(a, .9) }; });
  const paid = m => start + monthly * m;
  const fixed = []; let f = start; fixed.push(f); for (let m = 1; m <= M; m++) { f = f * (1 + rate) ** (1 / 12) + monthly; fixed.push(f); }
  const last = bands[M], sortedDD = Float64Array.from(dds).sort();
  const below = cols[M].filter(v => v < paid(M)).length / N;
  $('#calc-out').innerHTML = `
    <div class="calc-tiles">
      <div class="stat"><b class="num">${kr(last.p50)}</b><span>normalt utfall (median)</span></div>
      <div class="stat"><b class="num">${kr(last.p10)}</b><span>dåligt (1 av 10 sämre)</span></div>
      <div class="stat"><b class="num">${kr(last.p90)}</b><span>bra (1 av 10 bättre)</span></div>
      <div class="stat"><b class="num">${kr(paid(M))}</b><span>insatt totalt</span></div>
    </div>
    <div class="calc-chart" id="calc-chart"></div>
    <div class="calc-legend">
      <span><i class="lg-band"></i>Strategin, 8 av 10 utfall</span><span><i class="lg-line"></i>Strategin, median</span>
      <span><i class="lg-fixed"></i>Fast ränta ${(rate * 100).toFixed(1).replace(/\.0$/, '').replace('.', ',')} %</span><span><i class="lg-paid"></i>Insatt</span>
    </div>
    <p class="small">På vägen: i hälften av utfallen var kontot som mest <b>${Math.round(-q(sortedDD, .5) * 100)} %</b> under sin topp, och i 1 av 10 utfall <b>${Math.round(-q(sortedDD, .1) * 100)} %</b>.
      ${below >= 0.005 ? `I ${Math.round(below * 100)} % av utfallen slutade kontot under det insatta beloppet.` : 'Nästan inga utfall slutade under det insatta beloppet.'}</p>
    <p class="muted small">Räknat på ${R.length} affärer från tioårstestet (${esc(trades10y.from.slice(0, 4))}–${esc(trades10y.to.slice(0, 4))}, de bolag som faktiskt var med i OMXS30), cirka ${Math.round(perYear)} affärer om året,
      ${String(CALC_COST_R).replace('.', ',')} R i avgifter per affär. Varje affär riskerar ${(risk * 100).toFixed(1).replace(/\.0$/, '').replace('.', ',')} % av kontot vid stopp. ${N.toLocaleString('sv-SE')} slumpade framtider.
      Ingen skatt, och ingen hänsyn till makrofaktorn eller att flera affärer kan vara öppna samtidigt. Historiska resultat är ingen garanti för framtiden.</p>`;
  drawCalc(bands, fixed, paid, M);
}
function drawCalc(bands, fixed, paid, M) {
  const el = $('#calc-chart'), W = Math.max(300, Math.round(el.clientWidth || 640)), H = W < 500 ? 220 : 260, L = 56, Rm = 12, T = 12, B = 26;
  const top = Math.max(bands[M].p90, fixed[M], paid(M)) * 1.05;
  const x = m => L + (W - L - Rm) * m / M, y = v => T + (H - T - B) * (1 - v / top);
  const line = (fn) => bands.map((_, m) => `${m ? 'L' : 'M'}${x(m).toFixed(1)},${y(fn(m)).toFixed(1)}`).join('');
  const area = (lo, hi) => line(m => bands[m][hi]) + bands.map((_, m) => `L${x(M - m).toFixed(1)},${y(bands[M - m][lo]).toFixed(1)}`).join('') + 'Z';
  const ticks = [0, .25, .5, .75, 1].map(f => top / 1.05 * f);
  const yrs = M / 12, step = yrs > 10 ? 2 : 1;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kontots utveckling">
    ${ticks.map(v => `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${krShort(v)}</text>`).join('')}
    ${Array.from({ length: Math.floor(yrs / step) + 1 }, (_, k) => k * step).map(a => `<text x="${x(a * 12)}" y="${H - 8}" class="ax" text-anchor="middle">${a ? a + ' år' : 'nu'}</text>`).join('')}
    <path d="${area('p10', 'p90')}" class="band"/><path d="${area('p25', 'p75')}" class="band2"/>
    <path d="${line(m => paid(m))}" class="paid"/><path d="${line(m => fixed[m])}" class="fixed"/><path d="${line(m => bands[m].p50)}" class="med"/>
    <line id="cx-hair" y1="${T}" y2="${H - B}" class="hair" visibility="hidden"/>
    <rect x="${L}" y="${T}" width="${W - L - Rm}" height="${H - T - B}" fill="transparent" id="cx-hit"/>
  </svg><div class="calc-tip" id="cx-tip" hidden></div>`;
  const svg = el.querySelector('svg'), tip = $('#cx-tip'), hair = $('#cx-hair');
  const move = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
    const m = Math.max(0, Math.min(M, Math.round((px - L) / (W - L - Rm) * M)));
    hair.setAttribute('x1', x(m)); hair.setAttribute('x2', x(m)); hair.setAttribute('visibility', 'visible');
    const b = bands[m];
    tip.innerHTML = `<div class="muted">${m < 12 ? m + ' mån' : (m / 12).toFixed(1).replace('.', ',') + ' år'}</div>
      <div><i class="lg-line"></i><b>${kr(b.p50)}</b> median</div><div><i class="lg-band"></i><b>${kr(b.p10)} – ${kr(b.p90)}</b> 8 av 10</div>
      <div><i class="lg-fixed"></i><b>${kr(fixed[m])}</b> fast ränta</div><div><i class="lg-paid"></i><b>${kr(paid(m))}</b> insatt</div>`;
    tip.hidden = false;
    const left = x(m) / W * r.width; tip.style.left = Math.min(left + 12, r.width - tip.offsetWidth - 4) + 'px';
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); });
}

async function loadSummary() {
  try {
    const s = await (await fetch('/api/summary')).json();
    normalBacktest = s.normal; renderNormal();
    const a = s.all;
    const pc = v => v == null ? '–' : String(v).replace('.', ',') + ' %';
    $('#summary').innerHTML = `<span>Backtest för OMX-signalerna (${a.n} st, cirka 4 år):</span>
      <span class="pill">TP1 <b class="${a.tp1Rate >= 60 ? 'pos' : 'neg'}">${pc(a.tp1Rate)}</b></span>
      <span class="pill">TP2 <b class="${a.tp2Rate >= 54 ? 'pos' : 'neg'}">${pc(a.tp2Rate)}</b></span>
      <span class="pill">TP3 <b>${pc(a.tp3Rate)}</b></span>
      <span class="pill">Snitt <b>${String(a.avgR).replace('.', ',')} R</b></span>`;
  } catch {
    $('#summary').textContent = '';
  }
}

setView(view);
loadScan(false);
loadSummary();
loadLog().then(loadCalendar);

// Börsen i Stockholm är öppen vardagar 09.00–17.30. Då uppdateras appen var
// femte minut, så att signaler, kravlistor och öppna affärer följer kursen live.
function marketOpen(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(now).map(x => [x.type, x.value]));
  const min = +p.hour * 60 + +p.minute;
  return !/lör|sön/.test(p.weekday) && min >= 9 * 60 && min <= 17 * 60 + 35;
}
setInterval(() => { if (marketOpen() && !document.hidden) { loadScan(true, true); loadLog(); } }, 5 * 60 * 1000);
// Notiser och länkar kan öppna Affärer (#affarer) eller Morgonsoffan (#morgon) direkt.
if (location.hash === '#affarer') setView('trades');
loadMorning().then(() => { if (location.hash === '#morgon') { setView('more'); openTool('morning'); } });
loadMarketNews();

// Webbnotiser: ingen extra app behövs. På iPhone måste appen först läggas till
// på hemskärmen (Dela → Lägg till på hemskärmen), sedan fungerar det där.
function toast(text, ms = 6000) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
const b64ToBytes = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
let swReg = null;
async function pushInit() {
  if (!pushSupported()) return;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
    const sub = await swReg.pushManager.getSubscription();
    $('#push').classList.toggle('on', !!sub);
    $('#push').textContent = sub ? 'Notiser på' : 'Notiser';
  } catch { /* service worker kunde inte registreras */ }
}
$('#push').addEventListener('click', async () => {
  if (!pushSupported()) {
    toast(isIOS ? 'På iPhone: tryck på Dela och välj "Lägg till på hemskärmen". Öppna appen från hemskärmen och tryck på Notiser igen.' : 'Webbläsaren stöder inte notiser. Prova Chrome, Edge eller Firefox.', 10000);
    return;
  }
  try {
    swReg ??= await navigator.serviceWorker.register('/sw.js');
    let sub = await swReg.pushManager.getSubscription();
    if (!sub) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Notiser är blockerade. Tillåt notiser för sidan i webbläsarens inställningar.'); return; }
      const { key } = await (await fetch('/api/push/key')).json();
      sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    }
    const r = await (await fetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })).json();
    $('#push').classList.add('on'); $('#push').textContent = 'Notiser på';
    toast(r.ok ? 'Notiser är på. En testnotis är skickad.' : 'Notiser är på, men testnotisen kom inte fram. Kontrollera att Upstash Redis är inlagt i Vercel.');
  } catch (e) {
    toast('Kunde inte slå på notiser: ' + e.message);
  }
});
pushInit();
