// Coach för öppna affärer: korta, peppande men ärliga kommentarer som bara
// bygger på riktiga data – kursen, nådda mål, stöd och motstånd från analysen,
// EMA 20, RSI, bottnar sedan köpet och kommande rapport. Inga prognoser.

const day = t => new Date(t * 1000).toISOString().slice(0, 10);
const kr = v => (v >= 1000 ? Math.round(v).toLocaleString('sv-SE') : v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pc = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')} %`;
const pcAbs = v => `${Math.abs(v).toFixed(1).replace('.', ',')} %`;
const zone = z => `${kr(z.lo)}–${kr(z.hi)}`;

// e: loggad affär med utfall (entry, hit, last, state), bars: dagsstaplar,
// ev: evaluate() på staplarna, report: { date, days } eller null.
export function coachTrade(e, bars, ev, report) {
  const lines = [];
  let tone = 'calm';
  const name = e.name;
  if (e.state === 'väntar på köp') return { tone, lines: [`Signalen är klar. Köp ${name} på öppningen, sätt stoppet på ${kr(e.stop)} direkt och låt planen jobba.`] };
  if (e.kind === 'panic' || e.kind === 'crypto') {
    const pct = e.pct ?? 0;
    return { tone: pct >= 0 ? 'good' : 'calm', lines: [pct >= 0 ? `${name} ligger ${pc(pct)} sedan köpet.` : `${name} ligger ${pc(pct)} sedan köpet. Strategin har inget stopp – den säljer på säljdagen oavsett kurs.`, `Säljdag ${e.exitDate}. Håll fast vid den.`] };
  }
  const short = e.kind === 'short', dir = short ? -1 : 1;
  const price = e.last ?? bars[bars.length - 1].c, entry = e.entry ?? e.close, hit = e.hit || 0;
  const stop = hit >= 2 ? entry : e.stop;
  const fromEntry = dir * (price / entry - 1) * 100;
  const next = hit < 3 ? e.tps[hit] : null;
  const toNext = next ? dir * (next / price - 1) * 100 : null;
  const toStop = dir * (price / stop - 1) * 100;

  // 1. Läget i affären.
  if (hit >= 1) {
    // Att målet nåddes har coachen redan sagt en gång (coachTp). Här: läget nu.
    tone = fromEntry >= 0 ? 'good' : 'calm';
    lines.push(`${name}: ${pc(fromEntry)} sedan köpet${next ? `, ${pcAbs(toNext)} kvar till TP${hit + 1} (${kr(next)})` : ''}. ${hit === 1 ? `En tredjedel är såld vid TP1, stoppet ligger på ${kr(stop)}.` : 'Två tredjedelar är sålda och stoppet ligger på köpkursen.'}`);
  } else if (fromEntry >= 0) {
    tone = 'good';
    lines.push(`${name} går åt rätt håll: ${pc(fromEntry)} sedan köpet, ${pcAbs(toNext)} kvar till TP1 (${kr(next)}).`);
  } else {
    lines.push(`${name} ligger ${pc(fromEntry)} under köpkursen. Det är en del av spelet – stoppet på ${kr(stop)} ligger ${pcAbs(toStop)} bort och planen gäller.`);
  }

  // 2. Strukturen: stödet under kursen och bottnar sedan köpet.
  const t = bars.findIndex(b => day(b.t) === e.date);
  const since = t >= 0 ? bars.slice(t + 1) : [];
  const sup = ev.zones.filter(z => (short ? z.kind === 'resistance' && z.lo > price * 0.98 : z.kind === 'support' && z.lo < price * 1.02)).sort((a, b) => dir * (b.hi - a.hi))[0];
  if (!short && sup) {
    if (price > sup.hi) lines.push(`Studsen från stödet ${zone(sup)} håller – kursen ligger ${pcAbs((price / sup.hi - 1) * 100)} över det.`);
    else if (price >= sup.lo) { lines.push(`Kursen testar stödet ${zone(sup)} igen. Håller det ligger planen fast; bryts det är stoppet ${kr(stop)} nästa nivå.`); if (tone === 'good') tone = 'calm'; }
    else if (price > stop) { lines.push(`Stödet ${zone(sup)} har brutits, men stoppet ${kr(stop)} håller. Planen gäller tills stoppet nås – flytta det inte.`); tone = 'warn'; }
  }
  if (t >= 0 && since.length >= 2) {
    const signalLow = short ? bars[t].h : bars[t].l;
    const extreme = short ? Math.max(...since.map(b => b.h)) : Math.min(...since.map(b => b.l));
    if (dir * (extreme - signalLow) > 0) lines.push(short ? 'Inga nya toppar sedan signalen – nedtrenden håller.' : 'Inga nya bottnar sedan signalen – strukturen håller.');
    else if (hit === 0) lines.push(`Kursen gjorde en ny ${short ? 'topp' : 'botten'} efter signalen men vände innan stoppet – det är så rekylen ska se ut.`);
  }

  // 3. Vägen till nästa mål: EMA 20 och motstånd emellan.
  if (next) {
    const e20 = ev.ema?.e20;
    if (!short && e20) {
      if (price > e20) lines.push(`Kursen har tagit sig över EMA 20 (${kr(e20)}) – rekylen har vänt till styrka.`);
      else if (e20 < next) lines.push(`Nästa hinder är EMA 20 vid ${kr(e20)} på vägen mot TP${hit + 1}.`);
    }
    const block = ev.zones.filter(z => (short ? z.kind === 'support' && z.hi < price && z.hi > next : z.kind === 'resistance' && z.lo > price && z.lo < next)).sort((a, b) => dir * (a.lo - b.lo))[0];
    if (block) lines.push(`${short ? 'Stödet' : 'Motståndet'} ${zone(block)} ligger före TP${hit + 1} (${kr(next)}) – där kan det ta emot en stund.`);
    else lines.push(hit === 0 ? 'Inga motstånd före TP1 enligt stöd- och motståndsnivåerna.' : `Fri väg till TP${hit + 1} (${kr(next)}, ${pcAbs(toNext)} bort) enligt stöd- och motståndsnivåerna.`);
  }

  // 4. Momentum och risker.
  if (!short && ev.rsi >= 70) lines.push(`RSI ${Math.round(ev.rsi)} – överköpt på kort sikt, så en rekyl vore inte konstig. Låt målen göra jobbet.`);
  if (report && report.days != null && report.days <= 10) { lines.push(`Obs: rapport ${report.date} (om ${report.days} handelsdagar). Rapporter kan ge stora hopp åt båda hållen.`); tone = tone === 'good' ? 'calm' : tone; }

  return { tone, lines };
}

// Coachens meddelande när ett mål nås FÖRSTA gången: vad som ska göras nu (en tredjedel),
// hur den ser på nästa mål och vilka hinder som finns på vägen. Bara riktiga data.
// k = målet som nåddes (1–3), report = { date, days } eller null.
export function coachTp(e, k, bars, ev, report) {
  const name = e.name, short = e.kind === 'short', dir = short ? -1 : 1, act = short ? 'Stäng' : 'Sälj';
  const entry = e.entry ?? e.close, tp = e.tps[k - 1], next = k < 3 ? e.tps[k] : null;
  const price = e.last ?? bars[bars.length - 1].c, atrNow = ev.atr || (bars.at(-1).h - bars.at(-1).l);
  const lines = [];
  // 1. Vad som ska göras nu.
  if (k === 1) lines.push(`🎯 TP1 är nådd på ${name} (${kr(tp)}). ${act} en tredjedel nu och säkra vinsten. Stoppet ligger kvar på ${kr(e.stop)} tills TP2.`);
  else if (k === 2) lines.push(`🎯 TP2 är nådd på ${name} (${kr(tp)}). ${act} en tredjedel till och flytta stoppet till köpkursen ${kr(entry)} – sista tredjedelen kan inte längre gå med förlust.`);
  else lines.push(`🏁 TP3 är nådd på ${name} (${kr(tp)}). ${act} sista tredjedelen – affären är klar enligt planen. Snyggt genomfört!`);
  if (!next) return { tone: 'good', lines };
  // 2. Synen på nästa mål: avstånd i procent och i dagsrörelser (ATR), trend och momentum.
  const pct = dir * (next / price - 1) * 100, inAtr = Math.abs(next - price) / atrNow;
  const e20 = ev.ema?.e20, e50 = ev.ema?.e50, e200 = ev.ema?.e200;
  const trendOk = short ? price < e20 : price > e20;
  const rsiTxt = ev.rsi >= 70 ? `RSI ${Math.round(ev.rsi)} är högt – en rekyl först vore normalt` : ev.rsi <= 30 ? `RSI ${Math.round(ev.rsi)} är lågt` : `RSI ${Math.round(ev.rsi)} ger utrymme`;
  lines.push(`Nästa mål är TP${k + 1} vid ${kr(next)}, ${pcAbs(pct)} bort – ungefär ${inAtr.toFixed(1).replace('.', ',')} normala dagsrörelser. ${trendOk ? `Kursen ligger ${short ? 'under' : 'över'} EMA 20, så rörelsen har kraft.` : `Kursen är ${short ? 'över' : 'under'} EMA 20 – momentet har mattats.`} ${rsiTxt}.`);
  // 3. Hinder mellan kursen och nästa mål.
  const between = v => v != null && (short ? v < price && v > next : v > price && v < next);
  const hinder = [];
  const zones = ev.zones.filter(z => (short ? z.kind === 'support' && z.hi < price && z.hi > next : z.kind === 'resistance' && z.lo > price && z.lo < next)).sort((a, b) => dir * (a.lo - b.lo));
  for (const z of zones.slice(0, 2)) hinder.push(`${short ? 'stöd' : 'motstånd'} ${zone(z)}${z.touches ? ` (testat ${z.touches} gånger)` : ''}`);
  if (between(e200)) hinder.push(`EMA 200 vid ${kr(e200)}, som ofta bromsar en rekyl`);
  if (between(e50)) hinder.push(`EMA 50 vid ${kr(e50)}`);
  if (report && report.days != null && report.days <= 10) hinder.push(`rapport ${report.date} (om ${report.days} handelsdagar)`);
  lines.push(hinder.length ? `Hinder på vägen: ${hinder.join(', ')}. Där kan det ta emot en stund – planen gäller ändå.` : 'Inga tydliga hinder före nästa mål enligt stöd, motstånd och medelvärden.');
  return { tone: hinder.length > 1 || ev.rsi >= 70 ? 'calm' : 'good', lines };
}
