// Fear & Greed för aktier, byggt med samma metod som CNN:s index (som inte får hämtas automatiskt):
// sex mått som vart och ett jämförs med sitt eget senaste år (percentil 0–100), sedan snittet.
//   1. Momentum: S&P 500 mot sitt 125-dagars snitt.
//   2. Styrka: S&P 500:s avstånd till 52-veckorshögsta.
//   3. Bredd: likaviktat S&P 500 (RSP) mot sitt 50-dagars snitt – hur brett uppgången (eller fallet) är.
//   4. Volatilitet: VIX mot sitt 50-dagars snitt (hög VIX = rädsla).
//   5. Säker hamn: aktier (SPY) mot statsobligationer (IEF) senaste 20 dagarna.
//   6. Skräpobligationer: högavkastande (HYG) mot statsobligationer (IEF) senaste 20 dagarna.
//   7. Put/call: CBOE:s totala put/call-kvot, 5-dagarssnitt (hög kvot = rädsla). Från CBOE:s öppna dagsstatistik.

const LABELS = [[25, 'extrem rädsla'], [45, 'rädsla'], [56, 'neutralt'], [76, 'girighet'], [101, 'extrem girighet']];
export const fgLabel = v => LABELS.find(([lim]) => v < lim)[1];

// series: { SPY, RSP, IEF, HYG, VIX, PC? } som [{ d, c }] i datumordning (PC = put/call, valfri). Returnerar värdet för varje dag (från dag 300).
export function fearGreed(series, { window = 252 } = {}) {
  const dates = series.SPY.map(x => x.d);
  const at = k => { const m = new Map(series[k].map(x => [x.d, x.c])); let last = null; return dates.map(d => (m.has(d) ? (last = m.get(d)) : last)); };
  const S = at('SPY'), R = at('RSP'), I = at('IEF'), H = at('HYG'), V = at('VIX');
  // Put/call: bara dagar med egen notering räknas (ingen utfyllnad bakåt längre än en dag).
  const pcMap = new Map((series.PC || []).map(x => [x.d, x.c]));
  const pc5 = i => { const v = []; for (let k = i; k >= 0 && v.length < 5 && k > i - 8; k--) { const x = pcMap.get(dates[k]); if (x != null) v.push(x); } return v.length >= 3 ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  const ret = (A, i, n) => (A[i] && A[i - n] ? A[i] / A[i - n] - 1 : null);
  const smaAt = (A, i, n) => { let s = 0; for (let k = i - n + 1; k <= i; k++) { if (A[k] == null) return null; s += A[k]; } return s / n; };
  const raw = dates.map((_, i) => {
    if (i < 260) return null;
    let hi = 0; for (let k = i - 251; k <= i; k++) hi = Math.max(hi, S[k]);
    return [S[i] / smaAt(S, i, 125) - 1, S[i] / hi - 1, R[i] / smaAt(R, i, 50) - 1, -(V[i] / smaAt(V, i, 50) - 1), ret(S, i, 20) - ret(I, i, 20), ret(H, i, 20) - ret(I, i, 20), pcMap.size ? (pc5(i) == null ? null : -pc5(i)) : null];
  });
  const NAMES = ['Momentum', 'Styrka', 'Bredd', 'Volatilitet', 'Säker hamn', 'Skräpobligationer', 'Put/call'];
  const out = [];
  for (let i = 260 + window; i < dates.length; i++) {
    const parts = raw[i].map((x, j) => {
      if (x == null || !isFinite(x)) return null;
      let below = 0, n = 0; for (let k = i - window; k < i; k++) { const y = raw[k]?.[j]; if (y == null || !isFinite(y)) continue; n++; if (y < x) below++; }
      return n >= 120 ? Math.round(below / n * 100) : null;
    });
    const ok = parts.filter(p => p != null);
    const value = Math.round(ok.reduce((a, p) => a + p, 0) / ok.length);
    out.push({ d: dates[i], value, label: fgLabel(value), parts: Object.fromEntries(NAMES.map((n, j) => [n, parts[j]])) });
  }
  return out;
}
