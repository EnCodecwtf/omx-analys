// Aviseringar till mobilen via ntfy.sh (gratis, inget konto). Installera
// appen ntfy på mobilen, prenumerera på ett eget hemligt ämne och sätt samma
// ämne i NTFY_TOPIC. APP_URL används för länken i notisen.

const fmt = v => (v >= 1000 ? Math.round(v).toLocaleString('sv-SE') : v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export async function notifySignal(e, { topic = process.env.NTFY_TOPIC, server = process.env.NTFY_URL || 'https://ntfy.sh', appUrl = process.env.APP_URL } = {}) {
  if (!topic) return false;
  if (e.kind === 'crypto') return send({
    topic, server, appUrl, e,
    title: `Krypto-utbrott: ${e.name}`,
    body: [
      `Ny 20-dagarstopp över EMA 200, stängde ${fmt(e.close)}.`,
      `Köp nu och sälj efter ${e.days} dagar (${e.exitDate}). Inget stopp i strategin.`,
      `${Math.round(e.size * 100)} % av kontot, utan hävstång. Handlas på kryptobörs (alla dagar) eller ETP på Avanza (vardagar).`,
    ].join('\n'),
  });
  const size = e.size == null ? '' : e.size === 1 ? 'Hel position.' : e.size === 0.5 ? 'Halv position.' : `Positionen × ${String(e.size).replace('.', ',')}.`;
  const body = [
    `Köp runt ${fmt(e.close)} (köp på öppningen).`,
    `Stopp ${fmt(e.stop)} · TP1 ${fmt(e.tps[0])} · TP2 ${fmt(e.tps[1])} · TP3 ${fmt(e.tps[2])}.`,
    size,
    'Kontrollera nyheter och köp- och säljkurs innan du handlar.',
  ].filter(Boolean).join('\n');
  return send({ topic, server, appUrl, e, title: `Stark köpsignal: ${e.name}`, body, actions: e.avanzaUrl ? `view, Avanza, ${e.avanzaUrl}` : null });
}

async function send({ topic, server, appUrl, e, title, body, actions }) {
  const headers = { Title: title, Priority: 'high', Tags: 'chart_with_upwards_trend' };
  if (actions) headers.Actions = actions;
  if (appUrl) headers.Click = `${appUrl.replace(/\/$/, '')}/#${encodeURIComponent(e.symbol)}`;
  try {
    const res = await fetch(`${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}`, { method: 'POST', headers, body });
    return res.ok;
  } catch (err) {
    console.error('Aviseringen kunde inte skickas:', err.message);
    return false;
  }
}

// Live-aviseringar under dagen: mål och stopp för öppna affärer, säljdag för
// krypto och förvarning när en köpsignal är på väg inför stängningen.
export async function notifyEvent(e, kind, o = {}, { topic = process.env.NTFY_TOPIC, server = process.env.NTFY_URL || 'https://ntfy.sh', appUrl = process.env.APP_URL } = {}) {
  if (!topic) return false;
  const r = o.r == null ? '' : ` Resultat ${o.r > 0 ? '+' : ''}${String(o.r).replace('.', ',')} R.`;
  const msg = {
    tp1: [`TP1 nådd: ${e.name}`, `Kursen har nått TP1 (${fmt(e.tps[0])}). Sälj en tredjedel.`],
    tp2: [`TP2 nådd: ${e.name}`, `Kursen har nått TP2 (${fmt(e.tps[1])}). Sälj en tredjedel och flytta stoppet till köpkursen (${fmt(o.entry ?? e.close)}).`],
    tp3: [`TP3 nådd: ${e.name}`, `Kursen har nått TP3 (${fmt(e.tps[2])}). Sälj resten, affären är klar.${r}`],
    stop: [`Stopp: ${e.name}`, o.hit >= 2 ? `Kursen är tillbaka på köpkursen efter TP2. Sälj resten.${r}` : `Stoppet (${fmt(e.stop)}) är nått. Sälj det som är kvar.${r}`],
    exit: [`Sälj idag: ${e.name}`, `Krypto-utbrottet från ${e.date} har gått ${e.days} dagar. Sälj enligt planen.`],
    warn: [`Trolig köpsignal: ${e.name}`, `Alla krav är uppfyllda med kursen just nu (${fmt(e.close)}). Bekräftas vid stängningen 17:30, köp i så fall på öppningen imorgon.`],
  }[kind];
  if (!msg) return false;
  const headers = { Title: msg[0], Priority: kind === 'warn' ? 'default' : 'high', Tags: kind === 'stop' ? 'warning' : 'chart_with_upwards_trend' };
  if (appUrl) headers.Click = `${appUrl.replace(/\/$/, '')}/#${encodeURIComponent(e.symbol)}`;
  try {
    const res = await fetch(`${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}`, { method: 'POST', headers, body: msg[1] });
    return res.ok;
  } catch (err) {
    console.error('Aviseringen kunde inte skickas:', err.message);
    return false;
  }
}
