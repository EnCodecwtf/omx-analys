// Månadsrapport med full ärlighet: alla affärer som AVSLUTADES under månaden räknas –
// vinnare, förlorare och break-even – med de nivåer som frystes när signalen publicerades.
// En affär som är öppen vid månadens slut räknas i den månad den stängs och visas under
// "Öppna affärer" tills dess. Break-even räknas inte som vinst.
// En kontrollsumma (SHA-256) över månadens frysta signaler gör att vem som helst kan
// jämföra mot ögonblicksbilderna av loggen som sparas på GitHub varje natt.

import crypto from 'node:crypto';

const BE = 0.1; // |R| under 0,1 räknas som break-even
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

const KIND = e => e.kind === 'exp' ? 'Experiment' : e.kind === 'panic' ? 'Panikvecka' : e.kind === 'crypto' ? 'Krypto' : e.kind === 'short' ? 'Blankning (AI)' : e.market === 'USA' ? 'USA' : 'OMX';
// Resultat i R för affärer med stopp, annars i procent.
function outcome(e) {
  const live = e.state === 'öppen' || e.state === 'väntar på köp';
  const val = e.pct != null ? e.pct : e.r;
  const unit = e.pct != null ? '%' : 'R';
  const beLimit = unit === 'R' ? BE : 0.5;
  const result = live ? 'öppen' : val == null ? 'okänd' : Math.abs(val) < beLimit ? 'break-even' : val > 0 ? 'vinst' : 'förlust';
  return { result, value: round(val), unit };
}

// Kontrollsumma över de frysta fälten (det som publicerades), inte utfallet.
export function frozenHash(entries) {
  const frozen = entries.map(e => ({ date: e.date, symbol: e.symbol, kind: e.kind || null, close: e.close, stop: e.stop ?? null, tps: e.tps ?? null, exitDate: e.kind ? e.exitDate ?? null : null, loggedAt: e.loggedAt ?? null }))
    .sort((a, b) => (a.date + a.symbol + (a.kind || '')).localeCompare(b.date + b.symbol + (b.kind || '')));
  return crypto.createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
}

// month: 'ÅÅÅÅ-MM'. entries: signalloggen med utfall. ai: AI-traderns konto (valfritt).
// omx: dagsstaplar för OMXS30 som jämförelse.
export function buildReport({ month, entries, ai, omx = [] }) {
  const inMonth = entries.filter(e => e.date.startsWith(month)); // publicerade i månaden (för kontrollsumman)
  const end = month + '-31';
  const isLive = e => e.state === 'öppen' || e.state === 'väntar på köp';
  const toRow = e => ({ date: e.date, symbol: e.symbol, name: e.name, type: KIND(e), side: e.kind === 'short' ? 'kort' : 'lång',
    entry: e.entry ?? null, close: e.close, stop: e.stop ?? null, tps: e.tps ?? null, hit: e.hit || 0, exitDate: e.exitDate ?? null,
    loggedAt: e.loggedAt ?? null, ...outcome(e) });
  // Avslutade i månaden (efter säljdatum) och öppna vid månadens slut (eller nu, för innevarande månad).
  const rows = entries.filter(e => !isLive(e) && e.exitDate && e.exitDate.startsWith(month))
    .sort((a, b) => a.exitDate.localeCompare(b.exitDate) || a.name.localeCompare(b.name)).map(toRow);
  const openRows = entries.filter(e => e.date <= end && (isLive(e) || (e.exitDate && e.exitDate > end)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)).map(toRow);
  const closedR = rows.filter(r => r.unit === 'R' && r.result !== 'öppen' && r.result !== 'okänd');
  const closedAll = rows.filter(r => r.result !== 'öppen' && r.result !== 'okänd');
  const count = k => rows.filter(r => r.result === k).length;
  const sumR = closedR.reduce((a, r) => a + r.value, 0);
  // Största nedgång i R under månaden (stängda affärer i datumordning).
  let eq = 0, peak = 0, dd = 0;
  for (const r of closedR.slice().sort((a, b) => (a.exitDate || a.date).localeCompare(b.exitDate || b.date))) { eq += r.value; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  // OMXS30 under månaden: från sista stängningen före månaden till sista i månaden.
  const day = t => new Date(t * 1000).toISOString().slice(0, 10);
  const before = omx.filter(b => day(b.t) < month + '-01').at(-1), last = omx.filter(b => day(b.t).startsWith(month)).at(-1);
  const bench = before && last ? round((last.c / before.c - 1) * 100) : null;
  // AI-traderns konto: värdet vid månadens början och slut.
  let account = null;
  if (ai?.curve?.length) {
    const startPt = ai.curve.filter(c => c.date < month + '-01').at(-1) || { equity: ai.start, date: 'start' };
    const endPt = ai.curve.filter(c => c.date.startsWith(month)).at(-1);
    if (endPt) account = { start: startPt.equity, end: endPt.equity, changePct: round((endPt.equity / startPt.equity - 1) * 100), changeKr: round(endPt.equity - startPt.equity),
      decisions: ai.log.filter(l => l.date.startsWith(month)).length, skipped: ai.log.filter(l => l.date.startsWith(month) && l.action === 'avstår').length };
  }
  const wins = count('vinst');
  // Experimenten (NFP-guld, Fed-vändning) redovisas för sig i procent.
  const expC = rows.filter(r => r.type === 'Experiment' && r.value != null), expO = openRows.filter(r => r.type === 'Experiment');
  const experiments = expC.length || expO.length ? { closed: expC.length, open: expO.length, sumPct: expC.length ? round(expC.reduce((a, r) => a + r.value, 0)) : null,
    wins: expC.filter(r => r.value > 0).length, rows: expC.map(r => ({ name: r.name, date: r.date, exitDate: r.exitDate, value: r.value })) } : null;
  // Panikveckan räknas i procent (inget stopp, inget R) och redovisas för sig.
  const panClosed = rows.filter(r => r.type === 'Panikvecka' && r.value != null), panOpen = openRows.filter(r => r.type === 'Panikvecka');
  const pan = [...panClosed, ...panOpen];
  const panic = pan.length ? { trades: pan.length, closed: panClosed.length, open: panOpen.length,
    sumPct: panClosed.length ? round(panClosed.reduce((a, r) => a + r.value, 0)) : null,
    avgPct: panClosed.length ? round(panClosed.reduce((a, r) => a + r.value, 0) / panClosed.length) : null,
    worstPct: panClosed.length ? Math.min(...panClosed.map(r => r.value)) : null, bestPct: panClosed.length ? Math.max(...panClosed.map(r => r.value)) : null,
    nowPct: panOpen.length ? round(panOpen.filter(r => r.value != null).reduce((a, r) => a + r.value, 0) / Math.max(1, panOpen.filter(r => r.value != null).length)) : null } : null;
  return {
    month, generated: new Date().toISOString(), rows, openRows, published: inMonth.length, experiments,
    summary: {
      signals: rows.length, closed: closedAll.length, open: openRows.length, wins, losses: count('förlust'), breakeven: count('break-even'),
      winRate: closedAll.length ? round(wins / closedAll.length * 100, 1) : null,
      winRateAll: rows.length ? round(wins / rows.length * 100, 1) : null,
      sumR: closedR.length ? round(sumR) : null, avgR: closedR.length ? round(sumR / closedR.length) : null,
      bestR: closedR.length ? Math.max(...closedR.map(r => r.value)) : null, worstR: closedR.length ? Math.min(...closedR.map(r => r.value)) : null,
      maxDrawdownR: closedR.length ? round(dd) : null,
    },
    panic,
    expected: { avgR: 0.26, tp1Rate: 63, note: 'Tioårstestet 2017–2026 med de bolag som faktiskt var med i OMXS30.' },
    benchmark: { name: 'OMXS30', changePct: bench },
    account,
    hash: frozenHash(inMonth),
  };
}
