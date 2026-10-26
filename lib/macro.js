// Marknadsläge (makro). Köpsignalerna har fungerat bäst när marknaden är
// rädd, och sämst när den är lugn eller när ett räntebesked från Fed är nära.
//
//   +1  OMXS30 under EMA 200
//   +1  färre än 40 % av OMXS30-aktierna över EMA 50 (svag bredd)
//   +1  VIX 20 eller högre
//   -1  VIX under 15
//   -1  räntebesked (FOMC) inom 7 dagar
//
// Bara poäng 1 eller mer ger köpsignal. Med poäng 0 hade signalerna ingen
// fördel på aktier som reglerna inte tagits fram på.

import { ema } from './indicators.js';
import { FOMC } from './events.js';

const day = t => new Date(t * 1000).toISOString().slice(0, 10);

function lastAtOrBefore(sortedDays, map, d) {
  let lo = 0, hi = sortedDays.length - 1, ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDays[mid] <= d) { ans = sortedDays[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans == null ? null : map.get(ans);
}

// Bygger en funktion som ger marknadsläget för ett datum ('ÅÅÅÅ-MM-DD').
// Använder bara data fram till och med det datumet.
export function buildMacro({ omxBars, vixBars, stockBars }) {
  const omxE = ema(omxBars.map(b => b.c), 200);
  const omx = new Map(omxBars.map((b, i) => [day(b.t), { c: b.c, e200: omxE[i] }]));
  const omxDays = [...omx.keys()];
  const vix = new Map(vixBars.map(b => [day(b.t), b.c]));
  const vixDays = [...vix.keys()];
  const above = new Map(), count = new Map();
  for (const bars of stockBars) {
    const e = ema(bars.map(b => b.c), 50);
    bars.forEach((b, i) => {
      if (e[i] == null) return;
      const d = day(b.t);
      count.set(d, (count.get(d) || 0) + 1);
      if (b.c > e[i]) above.set(d, (above.get(d) || 0) + 1);
    });
  }
  const breadth = new Map([...count].map(([d, n]) => [d, (above.get(d) || 0) / n]));
  const breadthN = new Map([...count].map(([d, n]) => [d, { above: above.get(d) || 0, n }]));
  const breadthDays = [...breadth.keys()].sort();

  return function macroAt(d) {
    const o = lastAtOrBefore(omxDays, omx, d);
    const v = lastAtOrBefore(vixDays, vix, d);
    const br = lastAtOrBefore(breadthDays, breadth, d);
    const brN = lastAtOrBefore(breadthDays, breadthN, d);
    const pct = x => String(Math.round(x * 10) / 10).replace('.', ',');
    const nf = FOMC.find(f => f >= d);
    const fomcDays = nf ? Math.round((new Date(nf) - new Date(d)) / 86400000) : null;
    const parts = [];
    let score = 0;
    if (o?.e200 != null) {
      const down = o.c < o.e200;
      if (down) score++;
      parts.push({ ok: down, pts: down ? 1 : 0, text: `OMXS30 ${down ? 'under' : 'över'} EMA 200`,
        need: down ? `OMXS30 ligger ${pct((1 - o.c / o.e200) * 100)} % under EMA 200 (${Math.round(o.e200)}): marknaden har fallit, det är där rekylerna fungerar bäst.`
          : `+1 om OMXS30 faller ${pct((1 - o.e200 / o.c) * 100)} % till under EMA 200 (${Math.round(o.e200)}).` });
    }
    if (br != null) {
      const weak = br < 0.4;
      if (weak) score++;
      // Antal aktier som måste falla under EMA 50 för att bredden ska bli under 40 %.
      const fall = brN ? Math.max(0, brN.above - (Math.ceil(0.4 * brN.n) - 1)) : null;
      parts.push({ ok: weak, pts: weak ? 1 : 0, text: `${Math.round(br * 100)} % av aktierna över EMA 50`,
        need: weak ? 'Under 40 %: de flesta aktier har fallit, många är översålda.'
          : `+1 om under 40 % av aktierna är över EMA 50${fall ? ` (${fall} ${fall === 1 ? 'aktie' : 'aktier'} till behöver falla under)` : ''}.` });
    }
    if (v != null) {
      const pts = v >= 20 ? 1 : v < 15 ? -1 : 0;
      score += pts;
      parts.push({ ok: pts > 0, bad: pts < 0, pts, text: `VIX ${v.toFixed(1)}`,
        need: pts > 0 ? 'VIX 20 eller högre: oro i marknaden, då har signalerna fungerat bäst.'
          : pts < 0 ? `−1 när VIX är under 15 (för lugnt). Försvinner när VIX stiger till 15, och +1 vid 20.`
          : `+1 om VIX stiger till 20 (${pct(20 - v)} enheter upp). Under 15 ger −1.` });
    }
    if (fomcDays != null) {
      const near = fomcDays <= 7;
      if (near) score--;
      const after = new Date(Date.parse(nf) + 86400000).toISOString().slice(0, 10);
      parts.push({ ok: false, bad: near, pts: near ? -1 : 0, text: `Räntebesked från Fed ${nf} (om ${fomcDays} dagar)`,
        need: near ? `−1 veckan före ett räntebesked, då har signalerna gått sämre. Försvinner ${after}, dagen efter beskedet.`
          : `Ger −1 från ${new Date(Date.parse(nf) - 7 * 86400000).toISOString().slice(0, 10)}, en vecka före beskedet.` });
    }
    const size = score >= 1 ? 1 : 0;
    // Sammanfattning: vad som saknas för köpsignaler (poäng 1).
    const fomcPart = parts.find(p => p.text.startsWith('Räntebesked') && p.bad);
    const missing = 1 - score;
    const summary = score >= 1 ? `Poäng ${score}: köpsignaler gäller.`
      : `Poäng ${score}. Köpsignaler kräver poäng 1, så ${missing} poäng saknas.`
        + (fomcPart ? ` Räntebeskedet ger −1 till och med ${nf}, därefter blir poängen ${score + 1} om inget annat ändras.` : '');
    // Förklaring i klartext: varför läget inte är bra för strategin just nu.
    const reasons = [];
    const omxUp = o?.e200 != null && o.c >= o.e200, broad = br != null && br >= 0.4, calm = v != null && v < 20;
    if (omxUp && broad && calm) reasons.push('Marknaden är lugn och stigande. Strategin köper aktier som har fallit för mycket när marknaden är rädd, och sådana lägen finns det få av nu.');
    else {
      if (omxUp) reasons.push('OMXS30 ligger över sitt 200-dagarssnitt, alltså ingen större nedgång att köpa i.');
      if (broad) reasons.push('De flesta aktier ligger över sitt 50-dagarssnitt, så få är översålda.');
      if (calm) reasons.push(v < 15 ? 'VIX är under 15, ovanligt lugnt. Då har rekylerna gett minst.' : 'VIX är under 20, oron i marknaden är måttlig.');
    }
    if (fomcDays != null && fomcDays <= 7) reasons.push(`Feds räntebesked ${nf}: veckan före ett räntebesked har signalerna gått sämre, så då väntar appen.`);
    const comment = score >= 1 ? 'Marknaden är orolig och har fallit: det är lägen där rekylköpen har fungerat bäst.' : reasons.join(' ');
    const label = score < 0 ? 'Ogynnsamt – inga nya köp' : score === 0 ? 'Neutralt – bara bevaka' : 'Gynnsamt – köpsignaler gäller';
    return { date: d, score, size, label, parts, summary, comment, vix: v, breadth: br, fomc: nf, fomcDays };
  };
}
