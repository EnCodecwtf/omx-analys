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
$('#risk').value = store.get('risk', '6');
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
let filter = 'all';
let current = null;
const chart = new PriceChart($('#chart'), $('#rsi-chart'), $('#tooltip'));

for (const cb of document.querySelectorAll('[data-layer]')) {
  cb.addEventListener('change', () => chart.setLayer(cb.dataset.layer, cb.checked));
}
for (const b of document.querySelectorAll('[data-filter]')) {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
    filter = b.dataset.filter;
    if (filter === 'us' && !usData) loadUS(); else if (filter === 'shorts' && !shortData) loadShorts(); else renderScan();
  });
}

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
  if (filter === 'us') renderScan();
}
// AI-analytiker för blankning. Hämtas först när fliken öppnas (cirka 10 sekunder).
let shortData = null;
async function loadShorts(refresh) {
  if (!shortData) $('#scan-list').innerHTML = '<div class="loading">Analytikern läser prognoser, blankningsregistret, nyheter och kurser för 30 bolag…</div>';
  try {
    shortData = await (await fetch('/api/shorts' + (refresh ? '?refresh=1' : ''))).json();
  } catch (e) {
    $('#scan-list').innerHTML = `<div class="loading">Kunde inte hämta blankningsanalysen: ${esc(e.message)}</div>`;
    return;
  }
  if (filter === 'shorts') renderScan();
}
const SHORT_BADGE = { short: '<span class="badge avoid">BLANKA</span>', watch: '<span class="badge watch">BEVAKA</span>', none: '<span class="badge neutral">INGEN</span>' };
const SHORT_KEY = { trend: 'nedtrend', rejection: 'vändning', rsi: 'RSI', analyst: 'analytiker', report: 'rapport', score: 'poäng', products: 'papper' };
function renderShorts() {
  const list = $('#scan-list');
  if (!shortData) { list.innerHTML = '<div class="loading">Hämtar…</div>'; return; }
  const n = v => v == null ? '–' : String(v).replace(/(\d)\.(\d)/g, '$1,$2');
  const head = `<div class="us-head"><b>AI-analytiker: blankning</b> <span class="tag">experimentell</span>
    <div class="muted" style="font-size:12px;margin-top:4px">Väger ihop det en analytiker tittar på: sänkta vinstprognoser och riktkurser, rapporter under förväntan, svaga nyckeltal,
    blankningsregistret hos FI, negativa nyheter och en teknisk nedtrend där kursen studsat upp och vänt ned. Blanka bara när alla krav är gröna och det finns minst tre säkra korta papper på Avanza.</div>
    <div class="muted" style="font-size:12px;margin-top:4px"><b>Går inte att backtesta</b> (historiska prognoser finns inte gratis). Därför halv position, och varje kandidat sparas med frysta nivåer så att träffsäkerheten mäts framåt under Släppta signaler.
    ${logData?.stats?.short?.closed ? `Hittills: ${logData.stats.short.closed} stängda, ${logData.stats.short.wins} vinnare, snitt ${n(logData.stats.short.avgR)} R.` : 'Inga stängda blankningar än.'}</div>
    ${shortData.register ? '' : '<div class="neg" style="font-size:12px">Blankningsregistret kunde inte hämtas just nu.</div>'}</div>`;
  const rows = shortData.rows.map(r => {
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
      <div class="name">${esc(r.name)} ${SHORT_BADGE[r.status]}${r.preliminary && r.status === 'short' ? ' <span class="tag">preliminär</span>' : ''}</div>
      <div class="right">${spark(r.spark, r.spark[r.spark.length - 1] >= r.spark[0])}
        <div class="num"><div>${fmt(r.price)}</div><div class="${up ? 'pos' : 'neg'}" style="font-size:12px">${up ? '+' : ''}${n(r.changePct)} %</div></div></div>
      <div class="meta"><span>Poäng ${r.score}</span><span>Analytiker ${r.analyst}</span><span>RSI ${Math.round(r.rsi)}</span>${r.missing.length ? `<span class="${r.missing.length === 1 ? 'near' : ''}">${r.missing.length} krav kvar: ${r.missing.map(k => SHORT_KEY[k] || k).join(', ')}</span>` : ''}</div>
      </summary><div class="s-body">
      ${r.blocked ? `<p class="neg">${esc(r.blocked)}</p>` : ''}
      ${an}<div class="s-sub">Varför</div>${parts}<div class="s-sub">Krav för blankning</div>${checks}${plan}${prodHtml}${nw}
      <p><a href="#${encodeURIComponent(r.symbol)}" data-open="${esc(r.symbol)}">Visa graf</a>${r.avanzaUrl ? ` · <a href="${esc(r.avanzaUrl)}" target="_blank" rel="noopener">Aktien på Avanza</a>` : ''}</p>
      </div></details>`;
  }).join('');
  list.innerHTML = head + rows;
  for (const a of list.querySelectorAll('[data-open]')) a.addEventListener('click', ev => { ev.preventDefault(); openSymbol(a.dataset.open); });
}
$('#refresh').addEventListener('click', () => { loadScan(true); if (filter === 'shorts') loadShorts(true); });
$('#back').addEventListener('click', () => { document.body.classList.remove('show-detail'); history.replaceState(null, '', '#'); });

function spark(values, up) {
  const w = 64, h = 22, lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - (v - lo) / (hi - lo || 1) * h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${up ? '#22c55e' : '#ef4444'}" stroke-width="1.5" points="${pts}"/></svg>`;
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
    const fromHash = decodeURIComponent(location.hash.slice(1));
    const pick = scanData.rows.find(r => r.symbol === fromHash) || (refresh && current && scanData.rows.find(r => r.symbol === current)) || scanData.rows[0];
    // Vid automatisk uppdatering stannar vyn där den är (listan eller aktien).
    if (pick) openSymbol(auto && current ? current : pick.symbol, { keepView: auto || (!fromHash && !refresh), refresh });
  } catch (e) {
    $('#scan-list').innerHTML = `<div class="loading">Kunde inte hämta data: ${esc(e.message)}</div>`;
  } finally {
    $('#refresh').disabled = false;
  }
}

// Kortnamn för kraven i listan ("2 kvar: RSI, makro").
const KEY_LABEL = { trend: 'trend', support: 'stöd', rsi: 'RSI', macd: 'MACD', score: 'poäng', elliott: 'Elliott', report: 'rapport', macro: 'makro', products: 'papper', breakout: 'utbrott' };
// Sortering: köpsignaler först, sedan de med minst antal krav kvar, sedan poäng.
// Indexet ligger alltid överst som referens.
const isSignal = r => r.status === 'strong' || r.status === 'buy';
const left = r => r.missing?.length ?? 99;
function byCloseness(a, b) {
  return (b.isIndex - a.isIndex) || (isSignal(b) - isSignal(a)) || (left(a) - left(b)) || ((b.score ?? 0) - (a.score ?? 0));
}

function renderScan() {
  if (filter === 'log') { renderReleased(); return; }
  if (filter === 'shorts') { renderShorts(); return; }
  const src = filter === 'us' ? (usData?.rows || []) : scanData.rows;
  const rows = src.slice().sort(byCloseness);
  // Kryptovalutorna visas bara under fliken Krypto, så att listan är ren OMX.
  const visible = filter === 'us' ? rows : rows.filter(r => filter === 'crypto' ? r.isCrypto : !r.isCrypto && (r.isIndex || filter === 'all'
    || (filter === 'signals' && (r.status === 'strong' || r.status === 'buy'))
    || (filter === 'watch' && r.status === 'watch')));
  const list = $('#scan-list');
  const um = filter === 'us' && usData?.macro;
  const usHead = um ? `<div class="us-head">USA-läge: <b class="${um.score >= um.need ? 'pos' : 'neg'}">${esc(um.label)}</b> <span class="muted">(poäng ${um.score}, köpsignaler kräver ${um.need})</span>
    <div class="macro-comment">${esc(um.comment || '')}</div>
    <div class="muted" style="font-size:12px;margin-top:4px">USA-signaler kommer bara vid full rädsla i den amerikanska marknaden, det enda läge där de gav en fördel i backtestet, och bara om minst tre säkra hävstångspapper finns på Avanza.</div></div>` : '';
  list.innerHTML = usHead + visible.map(r => {
    if (r.error) return `<div class="row"><div class="name">${esc(r.name)}</div><div class="meta">${esc(r.error)}</div></div>`;
    const up = r.changePct >= 0;
    return `<div class="row${r.isIndex ? ' index' : ''}${r.symbol === current ? ' active' : ''}" data-symbol="${esc(r.symbol)}">
      <div class="name">${esc(r.name)} ${badge(r.status)}${r.preliminary && r.status !== 'neutral' && r.status !== 'avoid' ? ' <span class="tag" title="Räknat på kursen just nu, bekräftas vid stängningen">preliminär</span>' : ''}</div>
      <div class="right">${spark(r.spark, r.spark[r.spark.length - 1] >= r.spark[0])}
        <div class="num"><div>${fmt(r.price)}</div><div class="${up ? 'pos' : 'neg'}" style="font-size:12px">${up ? '+' : ''}${String(r.changePct).replace('.', ',')} %</div></div>
      </div>
      <div class="meta">${r.isCrypto ? '<span class="tag">Krypto</span>' : r.isUS ? `<span class="tag">USA</span><span>Poäng ${r.score}</span>` : `<span>Poäng ${r.score}</span>`}<span>${esc(r.trendLabel)}</span><span>RSI ${Math.round(r.rsi)}</span>${r.missing?.length && !isSignal(r) ? `<span class="${r.missing.length === 1 ? 'near' : ''}" title="${r.checks - r.missing.length} av ${r.checks} krav uppfyllda">${r.missing.length} krav kvar: ${r.missing.map(k => KEY_LABEL[k] || k).join(', ')}</span>` : ''}${r.elliott ? `<span>${esc(r.elliott.label)}</span>` : ''}</div>
    </div>`;
  }).join('') + (visible.length <= (filter === 'crypto' || filter === 'us' ? 0 : 1) ? '<div class="empty">Inga aktier matchar filtret just nu.</div>' : '');
  for (const el of list.querySelectorAll('[data-symbol]')) el.addEventListener('click', () => openSymbol(el.dataset.symbol));
}

async function openSymbol(symbol, { keepView, refresh } = {}) {
  current = symbol;
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
  $('#d-name').textContent = d.name;
  $('#d-sub').innerHTML = `${esc(d.symbol)} · stängning ${lastT} · <span class="num">${fmt(A.price)}</span> · ATR ${fmt(A.atr)} · ${esc(A.trendLabel)}${d.avanzaUrl ? ` · <a href="${esc(d.avanzaUrl)}" target="_blank" rel="noopener">Öppna i Avanza ↗</a>` : ''}`;
  $('#d-badge').innerHTML = badge(A.status, true);
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
  $('#c-signal').innerHTML = `<h3>Signal</h3>
    <div class="score"><span class="score-val num">${A.score}</span><div class="score-bar"><span style="width:${A.score}%;background:${col}"></span></div><span class="muted">/ 100</span></div>
    <p>${explain}</p>
    ${d.preliminary ? `<p class="warn" style="font-size:12px">Preliminärt: räknat på kursen just nu (cirka 15 minuter fördröjd). Signalen gäller först när dagen stänger ${d.isUS ? '22:00 (USA-börsen)' : '17:30'}, och köpet sker på öppningen nästa dag${d.isUS ? ' (15:30 svensk tid)' : ''}.</p>` : ''}
    ${checklist(A)}
    <ul class="reasons">${A.reasons.map(r => `<li><span class="pts ${r.pts >= 0 ? 'pos' : 'neg'}">${r.pts > 0 ? '+' : ''}${r.pts}</span><span>${esc(r.text)}</span></li>`).join('') || '<li class="muted">Inga faktorer slog till.</li>'}</ul>
    ${A.warnings.map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}
    ${A.blocked ? `<p class="warn">Utan spärren hade detta varit ${STATUS[A.blocked].text.toLowerCase()}.</p>` : ''}
    <dl class="kv" style="margin-top:10px">
      ${A.guards?.report ? `<dt>Nästa rapport</dt><dd>${esc(A.guards.report.date)} <span class="muted">(om ${A.guards.report.days} handelsdagar, ${esc(A.guards.report.source)})</span></dd>` : ''}
      ${A.guards?.macro ? `<dt>Makro</dt><dd>${esc(A.guards.macro.label)} <span class="muted">(poäng ${A.guards.macro.score})</span></dd>` : ''}
      ${A.guards?.stress ? `<dt>Riskfaktorer</dt><dd>${A.guards.stress.factors ? `${A.guards.stress.factors} av 3 – positionen × ${String(A.guards.stress.size).replace('.', ',')}` : 'Inga'}</dd>` : ''}
    </dl>`;

  // Handelsplan
  const active = A.status === 'strong' || A.status === 'buy';
  $('#c-plan').innerHTML = `<h3>Handelsplan ${active ? '' : '<span class="muted">(om signal kommer)</span>'}</h3>
    <table>
      <tr><th></th><th class="r">Nivå</th><th class="r">Avstånd</th><th class="r">R</th></tr>
      <tr class="plan-row"><td>Köp</td><td class="r num">${fmt(pl.entry)}</td><td class="r num">–</td><td class="r">–</td></tr>
      <tr class="plan-row sl"><td>Stopp</td><td class="r num">${fmt(pl.stop)}</td><td class="r num neg">−${pl.riskPct.toString().replace('.', ',')} %</td><td class="r num">−1</td></tr>
      ${pl.tps.map((t, k) => `<tr class="plan-row tp"><td>TP${k + 1}<div class="why">${t.why.map(esc).join(' · ')}</div></td><td class="r num">${fmt(t.price)}</td><td class="r num pos">+${pct(t.price, pl.entry)}</td><td class="r num">${String(t.r).replace('.', ',')}</td></tr>`).join('')}
    </table>
    <p class="muted" style="font-size:12px;margin-top:10px">Sälj en tredjedel vid varje mål. Flytta stoppet till köpkursen när TP2 är nådd.
    TP1 ligger på närmaste nivå 0,5–1,2 R bort och TP2 på nästa nivå upp till 2 R, för att målen ska nås ofta.
    Stoppet ligger under stödet och de senaste dagarnas botten, minst 1 ATR från köpkursen.</p>`;

  loadProducts(d.symbol, A.status);
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
  el.innerHTML = `<h3>Hävstång på Avanza ${active ? '' : '<span class="muted">(ingen köpsignal just nu – bara för bevakning)</span>'}</h3>
    <p style="font-size:13px">Positionsstorlek: risk ${String(riskPct).replace('.', ',')} % av ${acct.toLocaleString('sv-SE')} kr × makrofaktor ${String(size).replace('.', ',')}
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
}

// Panikvecka: tre mest fallna OMXS30-aktier när VIX är minst 25, säljs efter 5 handelsdagar.
function renderPanic(p) {
  const el = $('#panic');
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
  $('#macro').innerHTML = `Marknadsläge: <b class="${cls}">${esc(m.label)}</b> <span class="muted">(poäng ${m.score > 0 ? '+' : ''}${m.score})</span>
    ${m.summary ? `<div class="macro-sum">${esc(m.summary)}</div>` : ''}
    ${m.comment ? `<div class="macro-comment">${esc(m.comment)}</div>` : ''}
    <details id="macro-details"${open ? ' open' : ''}><summary>Detaljer: vad som behövs, makrokalender och positionsstorlek</summary>
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
    <p>Nedgångsregeln under grafen halverar risken när kontot är 20 % under sin topp och ger en fjärdedel vid 30 %. Fyll i kontots högsta värde där.</p>`;
}

// Alla släppta signaler på ett ställe: OMX, USA, krypto och panikvecka.
// Öppna affärer överst, sedan avslutade, nyast först.
let logData = null;
const KIND = e => e.kind === 'short' ? 'Blankning (AI)' : e.kind === 'panic' ? 'Panikvecka' : e.kind === 'crypto' ? 'Krypto' : e.market === 'USA' ? 'USA' : 'OMX';
function renderReleased() {
  const list = $('#scan-list');
  if (!logData) { list.innerHTML = '<div class="loading">Hämtar signalloggen…</div>'; return; }
  const live = e => e.state === 'öppen' || e.state === 'väntar på köp';
  const es = logData.entries.slice().sort((a, b) => (live(b) - live(a)) || b.date.localeCompare(a.date));
  const res = e => e.pct != null ? `<span class="${e.state === 'stängd' ? (e.pct > 0 ? 'pos' : 'neg') : ''}">${e.pct > 0 ? '+' : ''}${String(e.pct).replace('.', ',')} %</span>`
    : e.r != null && e.state === 'stängd' ? `<span class="${e.r > 0 ? 'pos' : 'neg'}">${e.r > 0 ? '+' : ''}${String(e.r).replace('.', ',')} R</span>`
    : e.r != null ? `<span>${e.r > 0 ? '+' : ''}${String(e.r).replace('.', ',')} R</span>` : '–';
  const plan = e => e.kind === 'panic' || e.kind === 'crypto'
    ? `Köp ${e.entry ? fmt(e.entry) : 'på öppningen'} · säljdag ${esc(e.exitDate || '–')}`
    : `${e.kind === 'short' ? 'Blanka' : 'Köp'} ${e.entry ? fmt(e.entry) : fmt(e.close)} · stopp ${fmt(e.stop)} · TP ${e.tps.map(fmt).join(' / ')}`;
  const head = `<div class="us-head"><b>Släppta signaler</b> <span class="muted">(${logData.stats.n} st, ${logData.stats.open} öppna)</span>
    <div class="muted" style="font-size:12px;margin-top:4px">Alla köpsignaler som har gått ut, med frysta nivåer och utfall räknat med samma regler som backtestet.</div></div>`;
  list.innerHTML = head + (es.length ? es.map(e => `<div class="row" data-symbol="${esc(e.symbol)}">
      <div class="name">${esc(e.name)} <span class="tag">${KIND(e)}</span>${live(e) ? ' <span class="badge strong">ÖPPEN</span>' : ''}</div>
      <div class="right"><div class="num"><div>${res(e)}</div><div class="muted" style="font-size:12px">${esc(e.state)}${e.hit ? ' · TP' + e.hit : ''}</div></div></div>
      <div class="meta"><span>${esc(e.date)}</span><span>${plan(e)}</span></div>
    </div>`).join('') : '<div class="empty">Inga signaler har släppts än. De samlas här så fort de kommer, oavsett om de blir vinnare eller förlorare.</div>');
  for (const el of list.querySelectorAll('[data-symbol]')) el.addEventListener('click', () => openSymbol(el.dataset.symbol));
}

async function loadLog() {
  try {
    const d = await (await fetch('/api/log')).json();
    logData = d;
    if (filter === 'log') renderReleased();
    const s = d.stats;
    normalLive = s.current; renderNormal();
    const pc = v => v == null ? '–' : String(v).replace('.', ',') + ' %';
    const state = e => (e.kind === 'crypto' || e.kind === 'panic') && e.pct != null
      ? `<span class="${e.state === 'stängd' ? (e.pct > 0 ? 'pos' : 'neg') : ''}">${e.state === 'öppen' ? 'öppen ' : ''}${e.pct > 0 ? '+' : ''}${String(e.pct).replace('.', ',')} %</span>`
      : e.state === 'stängd'
      ? `<span class="${e.r > 0 ? 'pos' : 'neg'}">${e.r > 0 ? '+' : ''}${String(e.r).replace('.', ',')} R</span>`
      : e.state === 'öppen' ? `öppen${e.hit ? ' · TP' + e.hit : ''}` : esc(e.state);
    $('#log-body').innerHTML = d.entries.length
      ? `<p>${s.n} signaler sparade sedan start, ${s.closed} stängda och ${s.open} öppna.
          Stängda OMX: TP1 ${pc(s.tp1Rate)}, TP2 ${pc(s.tp2Rate)}, snitt ${s.avgR == null ? '–' : String(s.avgR).replace('.', ',') + ' R'}.
          ${s.crypto?.closed ? `Stängda krypto: ${s.crypto.closed}, snitt ${String(s.crypto.avgPct).replace('.', ',')} %.` : ''}
          ${s.short?.closed ? `Stängda blankningar (AI): ${s.short.closed}, snitt ${String(s.short.avgR).replace('.', ',')} R.` : ''}
          ${s.panic?.closed ? `Stängda panikveckor: ${s.panic.closed} affärer, snitt ${String(s.panic.avgPct).replace('.', ',')} %.` : ''}</p>
        <table><tr><th>Datum</th><th>Aktie</th><th class="r">Köp</th><th class="r">Utfall</th></tr>
        ${d.entries.slice(0, 15).map(e => `<tr data-symbol="${esc(e.symbol)}"><td>${esc(e.date)}</td><td>${esc(e.name)}${e.kind === 'panic' ? ' <span class="tag">panik</span>' : e.kind === 'short' ? ' <span class="tag">blankning</span>' : e.market === 'USA' ? ' <span class="tag">USA</span>' : ''}</td>
          <td class="r num">${e.entry ? fmt(e.entry) : '–'}</td><td class="r">${state(e)}</td></tr>`).join('')}</table>`
      : '<p>Inga signaler sparade än. Varje stark köpsignal sparas när dagens stängningskurs är klar, och utfallet följs med samma regler som backtestet. Det är det riktiga beviset på om strategin fungerar.</p>';
    for (const el of $('#log-body').querySelectorAll('[data-symbol]')) el.addEventListener('click', () => openSymbol(el.dataset.symbol));
  } catch {
    $('#log-body').textContent = 'Kunde inte läsa signalloggen.';
  }
}

async function loadSummary() {
  try {
    const s = await (await fetch('/api/summary')).json();
    normalBacktest = s.normal; renderNormal();
    const a = s.all;
    const pc = v => v == null ? '–' : String(v).replace('.', ',') + ' %';
    $('#summary').innerHTML = `<span>Backtest, starka köpsignaler med rapportspärr och makrofilter (${a.n} st):</span>
      <span class="pill">TP1 <b class="${a.tp1Rate >= 60 ? 'pos' : 'neg'}">${pc(a.tp1Rate)}</b></span>
      <span class="pill">TP2 <b class="${a.tp2Rate >= 54 ? 'pos' : 'neg'}">${pc(a.tp2Rate)}</b></span>
      <span class="pill">TP3 <b>${pc(a.tp3Rate)}</b></span>
      <span class="pill">Snitt <b>${String(a.avgR).replace('.', ',')} R</b></span>`;
  } catch {
    $('#summary').textContent = '';
  }
}

loadScan(false);
loadSummary();
loadLog();

// Börsen i Stockholm är öppen vardagar 09.00–17.30. Då uppdateras appen var
// femte minut, så att signaler, kravlistor och öppna affärer följer kursen live.
function marketOpen(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(now).map(x => [x.type, x.value]));
  const min = +p.hour * 60 + +p.minute;
  return !/lör|sön/.test(p.weekday) && min >= 9 * 60 && min <= 17 * 60 + 35;
}
setInterval(() => { if (marketOpen() && !document.hidden) { loadScan(true, true); loadLog(); } }, 5 * 60 * 1000);
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
