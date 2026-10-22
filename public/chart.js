// Egen canvas-graf med candlesticks och analysens lager. Dra för att panorera,
// scrolla eller nyp för att zooma.

const C = {
  bg: '#151b23', grid: '#202a37', text: '#8b98a8', textStrong: '#e6edf3',
  up: '#22c55e', down: '#ef4444', blue: '#3b82f6', amber: '#f59e0b', purple: '#a78bfa',
  ema20: '#38bdf8', ema50: '#f59e0b', ema200: '#e879f9',
};
const AXIS_W = 70, TIME_H = 22, PAD_T = 10;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const fmt = v => v >= 1000 ? v.toLocaleString('sv-SE', { maximumFractionDigits: 0 }) : v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function niceStep(range, count) {
  const raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export class PriceChart {
  constructor(canvas, rsiCanvas, tooltip) {
    this.cv = canvas; this.rcv = rsiCanvas; this.tip = tooltip;
    this.ctx = canvas.getContext('2d'); this.rctx = rsiCanvas.getContext('2d');
    this.layers = { zones: true, fvg: true, elliott: true, zigzag: false, fib: false, ema: true, plan: true, history: true };
    this.data = null; this.hover = null;
    this.pointers = new Map();
    this.bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  setData(d) {
    this.data = d;
    this.n = d.bars.length;
    const span = Math.min(140, Math.max(50, Math.round(this.cv.getBoundingClientRect().width / 6)));
    this.start = Math.max(0, this.n - span);
    this.end = this.n + Math.round(span / 10);
    const idx = new Map(d.bars.map((b, i) => [b[0], i]));
    this.trades = (d.backtest?.trades || []).map(t => ({ ...t, ci: idx.get(t.t) })).filter(t => t.ci != null);
    this.resize();
  }

  setLayer(name, on) { this.layers[name] = on; this.draw(); }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    for (const cv of [this.cv, this.rcv]) {
      const r = cv.getBoundingClientRect();
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    }
    this.dpr = dpr;
    this.draw();
  }

  get W() { return this.cv.width / this.dpr; }
  get H() { return this.cv.height / this.dpr; }
  get plotW() { return this.W - AXIS_W; }
  get barW() { return this.plotW / (this.end - this.start); }
  x(i) { return (i - this.start + 0.5) * this.barW; }
  idxAt(px) { return Math.floor(px / this.barW + this.start); }
  y(p) { return PAD_T + (this.hi - p) / (this.hi - this.lo) * (this.H - PAD_T - TIME_H); }

  bind() {
    const cv = this.cv;
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, (e.clientX - rect.left) / this.plotW);
    }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragged = false;
    });
    cv.addEventListener('pointermove', e => {
      const rect = cv.getBoundingClientRect();
      const prev = this.pointers.get(e.pointerId);
      if (prev && this.pointers.size === 1) {
        const dx = e.clientX - prev.x;
        if (Math.abs(dx) > 0) { this.pan(-dx / this.barW); this.dragged = true; }
      } else if (prev && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.abs(a.x - b.x);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [c, d] = [...this.pointers.values()];
        const after = Math.abs(c.x - d.x);
        if (before > 10 && after > 10) this.zoom(before / after, ((c.x + d.x) / 2 - rect.left) / this.plotW);
        return;
      }
      if (prev) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.draw();
    });
    const up = e => { this.pointers.delete(e.pointerId); };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    cv.addEventListener('dblclick', () => { if (this.data) { this.setData(this.data); } });
  }

  pan(bars) {
    const span = this.end - this.start;
    this.start = Math.min(Math.max(this.start + bars, -5), this.n - 10);
    this.end = this.start + span;
    this.draw();
  }

  zoom(f, anchor) {
    const span = this.end - this.start;
    const ns = Math.min(Math.max(span * f, 20), this.n + 40);
    const a = this.start + span * Math.min(Math.max(anchor, 0), 1);
    this.start = a - (a - this.start) * ns / span;
    this.end = this.start + ns;
    this.draw();
  }

  draw() {
    if (!this.data) return;
    const { ctx, dpr } = this;
    const d = this.data, A = d.analysis, bars = d.bars;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.W, this.H);

    const i0 = Math.max(0, Math.floor(this.start)), i1 = Math.min(this.n - 1, Math.ceil(this.end));
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) { lo = Math.min(lo, bars[i][3]); hi = Math.max(hi, bars[i][2]); }
    if (!isFinite(lo)) return;
    if (this.layers.plan && i1 >= this.n - 1) {
      lo = Math.min(lo, A.plan.stop);
      hi = Math.max(hi, A.plan.tps[0].price);
    }
    const pad = (hi - lo) * 0.06;
    this.lo = lo - pad; this.hi = hi + pad;
    const PW = this.plotW, PH = this.H - TIME_H;

    // Rutnät och prisskala
    const step = niceStep(this.hi - this.lo, 7);
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let p = Math.ceil(this.lo / step) * step; p <= this.hi; p += step) {
      const y = this.y(p);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(PW, Math.round(y) + .5); ctx.stroke();
      ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.fillText(fmt(p), PW + 6, y);
    }
    // Tidsaxel
    ctx.textAlign = 'center';
    let lastM = null;
    for (let i = i0; i <= i1; i++) {
      const dt = new Date(bars[i][0] * 1000);
      const m = dt.getMonth();
      if (lastM !== null && m !== lastM) {
        const x = this.x(i);
        ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, PH); ctx.stroke();
        const label = m === 0 ? String(dt.getFullYear()) : MONTHS[m];
        ctx.fillStyle = C.text; ctx.fillText(label, x, PH + 11);
      }
      lastM = m;
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, PW, PH); ctx.clip();

    // Stöd/motstånd
    if (this.layers.zones) {
      for (const z of A.zones) {
        const col = z.kind === 'resistance' ? '239,68,68' : z.kind === 'support' ? '34,197,94' : '245,158,11';
        const a = 0.06 + 0.16 * z.score / 100;
        const y1 = this.y(z.hi), y2 = this.y(z.lo);
        ctx.fillStyle = `rgba(${col},${a})`; ctx.fillRect(0, y1, PW, Math.max(2, y2 - y1));
        ctx.strokeStyle = `rgba(${col},${a + .2})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(PW, y1); ctx.moveTo(0, y2); ctx.lineTo(PW, y2); ctx.stroke();
        ctx.fillStyle = `rgba(${col},.9)`; ctx.textAlign = 'left'; ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.fillText(`${z.kind === 'resistance' ? 'Motstånd' : z.kind === 'support' ? 'Stöd' : 'Zon'} · ${z.touches}×`, 6, (y1 + y2) / 2);
      }
    }

    // Fair value gaps
    if (this.layers.fvg) {
      for (const g of A.fvgs) {
        const col = g.type === 'bull' ? '45,212,191' : '244,114,182';
        const x1 = this.x(g.i) - this.barW / 2;
        const y1 = this.y(g.hi), y2 = this.y(g.lo);
        ctx.fillStyle = `rgba(${col},.16)`; ctx.fillRect(x1, y1, PW - x1, Math.max(1, y2 - y1));
        ctx.strokeStyle = `rgba(${col},.5)`; ctx.setLineDash([3, 3]); ctx.strokeRect(x1, y1, PW - x1, Math.max(1, y2 - y1)); ctx.setLineDash([]);
        ctx.fillStyle = `rgba(${col},.95)`; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(g.type === 'bull' ? 'FVG ↑' : 'FVG ↓', x1 + 3, (y1 + y2) / 2);
      }
    }

    // Fibonacci
    if (this.layers.fib && A.fib) {
      const x1 = this.x(A.fib.from.i);
      ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
      for (const l of [...A.fib.retrace, ...A.fib.ext.slice(0, 2)]) {
        const y = this.y(l.price);
        ctx.strokeStyle = 'rgba(167,139,250,.55)'; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(PW, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = C.purple; ctx.fillText(`${l.r}  ${fmt(l.price)}`, x1 + 4, y - 6);
      }
    }

    // EMA
    if (this.layers.ema) {
      for (const [key, col] of [['ema200', C.ema200], ['ema50', C.ema50], ['ema20', C.ema20]]) {
        const arr = d[key];
        ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.globalAlpha = .85; ctx.beginPath();
        let started = false;
        for (let i = i0; i <= i1; i++) {
          if (arr[i] == null) continue;
          const x = this.x(i), y = this.y(arr[i]);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    }

    // Candles
    const bw = Math.max(1, this.barW * 0.7);
    for (let i = i0; i <= i1; i++) {
      const [, o, h, l, c] = bars[i];
      const x = this.x(i);
      const col = c >= o ? C.up : C.down;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, this.y(h)); ctx.lineTo(Math.round(x) + .5, this.y(l)); ctx.stroke();
      const yo = this.y(o), yc = this.y(c);
      ctx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    }

    // ZigZag
    if (this.layers.zigzag) {
      ctx.strokeStyle = 'rgba(230,237,243,.55)'; ctx.lineWidth = 1.2; ctx.beginPath();
      A.zigzag.forEach((p, k) => { const x = this.x(p.i), y = this.y(p.price); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }

    // Elliott
    if (this.layers.elliott) {
      const drawCount = (e, col, dashed) => {
        if (!e) return;
        ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash(dashed ? [5, 4] : []);
        ctx.beginPath();
        e.waves.forEach((w, k) => { const x = this.x(w.i), y = this.y(w.price); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke(); ctx.setLineDash([]);
        ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
        e.waves.forEach((w, k) => {
          const isHigh = k < e.waves.length - 1 ? w.price > e.waves[k + 1].price : w.price > e.waves[k - 1].price;
          const x = this.x(w.i), y = this.y(w.price) + (isHigh ? -14 : 14);
          ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.fillStyle = col; ctx.fillText(w.label + (w.tentative ? '?' : ''), x, y + .5);
        });
      };
      const p = A.elliott.primary;
      drawCount(p, p && p.bias > 0 ? '#60a5fa' : '#fb923c', false);
      if (p && p.zone) {
        const x1 = this.x(this.n - 1);
        const y1 = this.y(p.zone[1]), y2 = this.y(p.zone[0]);
        ctx.fillStyle = 'rgba(96,165,250,.12)'; ctx.fillRect(x1, y1, PW - x1, y2 - y1);
        ctx.strokeStyle = 'rgba(96,165,250,.7)'; ctx.setLineDash([4, 3]); ctx.strokeRect(x1, y1, PW - x1, y2 - y1); ctx.setLineDash([]);
        ctx.fillStyle = '#93c5fd'; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(p.bias > 0 && p.setup ? 'Elliott köpzon' : 'Elliott målzon', x1 + 4, y1 - 6);
      }
    }

    // Historiska signaler från backtestet
    if (this.layers.history) {
      for (const t of this.trades) {
        if (t.ci < i0 - 1 || t.ci > i1 + 1) continue;
        const x = this.x(t.ci), y = this.y(bars[t.ci][3]) + 10;
        ctx.fillStyle = t.open ? C.blue : t.r > 0 ? C.up : C.down;
        ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x - 5, y + 3); ctx.lineTo(x + 5, y + 3); ctx.closePath(); ctx.fill();
        if (t.status === 'strong') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
      }
    }

    // Handelsplan
    const axisTags = [];
    if (this.layers.plan) {
      const x1 = this.x(this.n - 1);
      const line = (price, col, label, dash) => {
        const y = this.y(price);
        ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash(dash || []);
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(PW, y); ctx.stroke(); ctx.setLineDash([]);
        axisTags.push({ price, col, label });
      };
      const pl = A.plan;
      line(pl.stop, C.down, 'SL', [4, 3]);
      line(pl.entry, C.blue, 'IN');
      pl.tps.forEach((t, k) => line(t.price, C.up, `TP${k + 1}`, [6, 3]));
    }
    ctx.restore();

    // Etiketter på prisaxeln
    ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
    for (const t of axisTags) {
      const y = Math.min(Math.max(this.y(t.price), 8), PH - 8);
      ctx.fillStyle = t.col; ctx.fillRect(PW + 1, y - 8, AXIS_W - 2, 16);
      ctx.fillStyle = '#04130a';
      ctx.fillText(`${t.label} ${fmt(t.price)}`, PW + 4, y);
    }
    // Sista pris
    const lastC = bars[this.n - 1][4];
    const ly = this.y(lastC);
    if (ly > 0 && ly < PH) {
      ctx.fillStyle = C.textStrong; ctx.fillRect(PW + 1, ly - 8, AXIS_W - 2, 16);
      ctx.fillStyle = C.bg; ctx.fillText(fmt(lastC), PW + 6, ly);
    }

    // Hårkors och tooltip
    if (this.hover && this.hover.x < PW) {
      const i = Math.min(Math.max(this.idxAt(this.hover.x), 0), this.n - 1);
      const x = this.x(i);
      ctx.strokeStyle = 'rgba(230,237,243,.35)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PH); ctx.moveTo(0, this.hover.y); ctx.lineTo(PW, this.hover.y); ctx.stroke();
      ctx.setLineDash([]);
      const p = this.hi - (this.hover.y - PAD_T) / (PH - PAD_T) * (this.hi - this.lo);
      ctx.fillStyle = '#334155'; ctx.fillRect(PW + 1, this.hover.y - 8, AXIS_W - 2, 16);
      ctx.fillStyle = C.textStrong; ctx.fillText(fmt(p), PW + 6, this.hover.y);
      const [t, o, h, l, c, v] = bars[i];
      const dt = new Date(t * 1000).toLocaleDateString('sv-SE');
      const ch = i > 0 ? (c / bars[i - 1][4] - 1) * 100 : 0;
      const trade = this.trades.find(tr => tr.ci === i);
      this.tip.hidden = false;
      this.tip.innerHTML = `<b>${dt}</b> &nbsp;Ö ${fmt(o)} H ${fmt(h)} L ${fmt(l)} S ${fmt(c)} ` +
        `<span class="${ch >= 0 ? 'pos' : 'neg'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)} %</span>` +
        (v ? ` &nbsp;Vol ${(v / 1e6).toFixed(2)} M` : '') +
        (trade ? `<br>${trade.status === 'strong' ? 'Stark köpsignal' : 'Köpsignal'} · utfall ${trade.open ? 'pågår' : (trade.r > 0 ? '+' : '') + trade.r + ' R'} · ${trade.hit ? `nådde TP${trade.hit}` : 'nådde inget mål'}` : '');
    } else {
      this.tip.hidden = true;
    }

    this.drawRsi(i0, i1);
  }

  drawRsi(i0, i1) {
    const ctx = this.rctx, dpr = this.dpr;
    const W = this.rcv.width / dpr, H = this.rcv.height / dpr, PW = this.plotW;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const y = v => 6 + (100 - v) / 100 * (H - 12);
    ctx.fillStyle = 'rgba(139,152,168,.07)'; ctx.fillRect(0, y(70), PW, y(30) - y(70));
    ctx.strokeStyle = C.grid; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const v of [30, 50, 70]) {
      ctx.beginPath(); ctx.moveTo(0, y(v)); ctx.lineTo(PW, y(v)); ctx.stroke();
      ctx.fillText(String(v), PW + 6, y(v));
    }
    ctx.fillText('RSI 14', 6, 12);
    const arr = this.data.rsi;
    ctx.strokeStyle = C.purple; ctx.lineWidth = 1.3; ctx.beginPath();
    let s = false;
    for (let i = i0; i <= i1; i++) {
      if (arr[i] == null) continue;
      const xx = this.x(i), yy = y(arr[i]);
      if (!s) { ctx.moveTo(xx, yy); s = true; } else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    if (this.hover && this.hover.x < PW) {
      const i = Math.min(Math.max(this.idxAt(this.hover.x), 0), this.n - 1);
      ctx.strokeStyle = 'rgba(230,237,243,.35)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(this.x(i), 0); ctx.lineTo(this.x(i), H); ctx.stroke(); ctx.setLineDash([]);
      if (arr[i] != null) { ctx.fillStyle = C.textStrong; ctx.fillText(arr[i].toFixed(1), PW + 6, y(arr[i])); }
    }
  }
}
