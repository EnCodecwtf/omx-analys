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
    renderScan();
  });
}
$('#refresh').addEventListener('click', () => loadScan(true));
$('#back').addEventListener('click', () => { document.body.classList.remove('show-detail'); history.replaceState(null, '', '#'); });

function spark(values, up) {
  const w = 64, h = 22, lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - (v - lo) / (hi - lo || 1) * h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${up ? '#22c55e' : '#ef4444'}" stroke-width="1.5" points="${pts}"/></svg>`;
}

async function loadScan(refresh) {
  $('#refresh').disabled = true;
  if (!scanData) $('#scan-list').innerHTML = '<div class="loading">Hämtar och analyserar 31 instrument…</div>';
  try {
    const res = await fetch('/api/scan' + (refresh ? '?refresh=1' : ''));
    scanData = await res.json();
    $('#updated').textContent = 'Analys ' + new Date(scanData.updated).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    renderScan();
    const fromHash = decodeURIComponent(location.hash.slice(1));
    const pick = scanData.rows.find(r => r.symbol === fromHash) || (refresh && current && scanData.rows.find(r => r.symbol === current)) || scanData.rows[0];
    if (pick) openSymbol(pick.symbol, { keepView: !fromHash && !refresh, refresh });
  } catch (e) {
    $('#scan-list').innerHTML = `<div class="loading">Kunde inte hämta data: ${esc(e.message)}</div>`;
  } finally {
    $('#refresh').disabled = false;
  }
}

function renderScan() {
  const rows = scanData.rows.slice().sort((a, b) =>
    (b.isIndex - a.isIndex) || ((STATUS[a.status]?.order ?? 9) - (STATUS[b.status]?.order ?? 9)) || ((b.score ?? 0) - (a.score ?? 0)));
  const visible = rows.filter(r => r.isIndex || filter === 'all'
    || (filter === 'signals' && (r.status === 'strong' || r.status === 'buy'))
    || (filter === 'watch' && r.status === 'watch'));
  const list = $('#scan-list');
  list.innerHTML = visible.map(r => {
    if (r.error) return `<div class="row"><div class="name">${esc(r.name)}</div><div class="meta">${esc(r.error)}</div></div>`;
    const up = r.changePct >= 0;
    return `<div class="row${r.isIndex ? ' index' : ''}${r.symbol === current ? ' active' : ''}" data-symbol="${esc(r.symbol)}">
      <div class="name">${esc(r.name)} ${badge(r.status)}</div>
      <div class="right">${spark(r.spark, r.spark[r.spark.length - 1] >= r.spark[0])}
        <div class="num"><div>${fmt(r.price)}</div><div class="${up ? 'pos' : 'neg'}" style="font-size:12px">${up ? '+' : ''}${String(r.changePct).replace('.', ',')} %</div></div>
      </div>
      <div class="meta"><span>Poäng ${r.score}</span><span>${esc(r.trendLabel)}</span><span>RSI ${Math.round(r.rsi)}</span>${r.elliott ? `<span>${esc(r.elliott.label)}</span>` : ''}</div>
    </div>`;
  }).join('') + (visible.length <= 1 ? '<div class="empty">Inga aktier matchar filtret just nu.</div>' : '');
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

function renderDetail(d) {
  const A = d.analysis, pl = A.plan;
  const lastT = new Date(d.bars[d.bars.length - 1][0] * 1000).toLocaleDateString('sv-SE');
  $('#d-name').textContent = d.name;
  $('#d-sub').innerHTML = `${esc(d.symbol)} · stängning ${lastT} · <span class="num">${fmt(A.price)}</span> · ATR ${fmt(A.atr)} · ${esc(A.trendLabel)}`;
  $('#d-badge').innerHTML = badge(A.status, true);
  chart.setData(d);

  // Signal
  const col = A.score >= 50 ? 'var(--green)' : A.score >= 30 ? 'var(--amber)' : 'var(--muted)';
  const explain = {
    strong: 'Kraftigt översåld rekyl under EMA 200 som vänder upp vid en stödzon. RSI och MACD vänder samtidigt.',
    buy: 'Rekyl under EMA 200 som vänder upp vid en stödzon. RSI och MACD vänder samtidigt.',
    watch: 'Intressant läge, men alla krav för köpsignal är inte uppfyllda än. Vänta på vändning vid stöd.',
    neutral: 'Inget tydligt köpläge just nu.',
    avoid: 'Sent eller överköpt läge. Vänta på en rekyl.',
  }[A.status];
  $('#c-signal').innerHTML = `<h3>Signal</h3>
    <div class="score"><span class="score-val num">${A.score}</span><div class="score-bar"><span style="width:${A.score}%;background:${col}"></span></div><span class="muted">/ 100</span></div>
    <p>${explain}</p>
    <ul class="reasons">${A.reasons.map(r => `<li><span class="pts ${r.pts >= 0 ? 'pos' : 'neg'}">${r.pts > 0 ? '+' : ''}${r.pts}</span><span>${esc(r.text)}</span></li>`).join('') || '<li class="muted">Inga faktorer slog till.</li>'}</ul>
    ${A.warnings.map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}`;

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

  // Elliott
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
    ${maj ? `<p style="font-size:13px;margin-top:10px"><span class="muted">Högre grad:</span> ${esc(maj.label)} <span class="muted">(${maj.confidence} %)</span></p>` : ''}`;

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
    Simulering: köp på öppningen dagen efter signalen, stoppet flyttas till köpkursen efter TP2. Om stopp och mål nås samma dag räknas stoppet. Courtage och glidning ingår inte.</p>`;
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
      </dl>
    </div>`;
  el.innerHTML = `<h3>Hävstång på Avanza ${active ? '' : '<span class="muted">(ingen köpsignal just nu – bara för bevakning)</span>'}</h3>
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

async function loadSummary() {
  try {
    const s = await (await fetch('/api/summary')).json();
    const a = s.all;
    const pc = v => v == null ? '–' : String(v).replace('.', ',') + ' %';
    $('#summary').innerHTML = `<span>Backtest, alla signaler (${a.n} st):</span>
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
