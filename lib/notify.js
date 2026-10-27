// Aviseringar på två sätt: webbnotiser direkt i webbläsaren (ingen extra app,
// se lib/push.js) och ntfy.sh om NTFY_TOPIC är satt. APP_URL används för länken
// i ntfy-notisen.

import { pushAll } from './push.js';

const fmt = v => (v >= 1000 ? Math.round(v).toLocaleString('sv-SE') : v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export async function notifySignal(e, { topic = process.env.NTFY_TOPIC, server = process.env.NTFY_URL || 'https://ntfy.sh', appUrl = process.env.APP_URL } = {}) {
  if (e.kind === 'crypto') return send({
    topic, server, appUrl, e,
    title: `Krypto-utbrott: ${e.name}`,
    body: [
      `Ny 20-dagarstopp över EMA 200, stängde ${fmt(e.close)}.`,
      `Köp nu och sälj efter ${e.days} dagar (${e.exitDate}). Inget stopp i strategin.`,
      `${Math.round(e.size * 100)} % av kontot, utan hävstång. Handlas på kryptobörs (alla dagar) eller ETP på Avanza (vardagar).`,
    ].join('\n'),
  });
  if (e.kind === 'panic') return send({
    topic, server, appUrl, e,
    title: `Panikvecka: ${e.name}`,
    body: [
      `VIX ${String(e.vix).replace('.', ',')} och ${e.name} har fallit ${String(Math.abs(e.ret5)).replace('.', ',')} % på 5 dagar.`,
      `Köp på öppningen och sälj efter ${e.days} handelsdagar (cirka ${e.exitDate}). Inget stopp.`,
      `${Math.round(e.size * 100)} % av kontot, utan hävstång.`,
    ].join('\n'),
    actions: e.avanzaUrl ? `view, Avanza, ${e.avanzaUrl}` : null,
  });
  const size = e.size == null ? '' : e.size === 1 ? 'Hel position.' : e.size === 0.5 ? 'Halv position.' : `Positionen × ${String(e.size).replace('.', ',')}.`;
  const body = [
    `Köp runt ${fmt(e.close)} (köp på öppningen).`,
    `Stopp ${fmt(e.stop)} · TP1 ${fmt(e.tps[0])} · TP2 ${fmt(e.tps[1])} · TP3 ${fmt(e.tps[2])}.`,
    size,
    'Kontrollera nyheter och köp- och säljkurs innan du handlar.',
  ].filter(Boolean).join('\n');
  return send({ topic, server, appUrl, e, title: `Stark köpsignal: ${e.name}${e.market ? ` (${e.market})` : ''}`, body, actions: e.avanzaUrl ? `view, Avanza, ${e.avanzaUrl}` : null });
}

// Skickar som webbnotis till alla som slagit på notiser i appen, och via ntfy
// om ett ämne är satt. Sant om minst en notis kom fram.
async function send({ topic, server, appUrl, e, title, body, actions, priority = 'high', tags = 'chart_with_upwards_trend' }) {
  let ok = false;
  try { ok = (await pushAll({ title, body, url: `/#${encodeURIComponent(e.symbol)}`, tag: `${e.symbol}-${title.split(':')[0]}` })) > 0; } catch (err) { console.error('Webbnotisen kunde inte skickas:', err.message); }
  if (!topic) return ok;
  const headers = { Title: title, Priority: priority, Tags: tags };
  if (actions) headers.Actions = actions;
  if (appUrl) headers.Click = `${appUrl.replace(/\/$/, '')}/#${encodeURIComponent(e.symbol)}`;
  try {
    const res = await fetch(`${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}`, { method: 'POST', headers, body });
    return res.ok || ok;
  } catch (err) {
    console.error('Aviseringen kunde inte skickas:', err.message);
    return ok;
  }
}

// Live-aviseringar under dagen: mål och stopp för öppna affärer, säljdag för
// krypto och förvarning när en köpsignal är på väg inför stängningen.
export async function notifyEvent(e, kind, o = {}, { topic = process.env.NTFY_TOPIC, server = process.env.NTFY_URL || 'https://ntfy.sh', appUrl = process.env.APP_URL } = {}) {
  const r = o.r == null ? '' : ` Resultat ${o.r > 0 ? '+' : ''}${String(o.r).replace('.', ',')} R.`;
  const msg = {
    tp1: [`TP1 nådd: ${e.name}`, `Kursen har nått TP1 (${fmt(e.tps[0])}). Sälj en tredjedel.`],
    tp2: [`TP2 nådd: ${e.name}`, `Kursen har nått TP2 (${fmt(e.tps[1])}). Sälj en tredjedel och flytta stoppet till köpkursen (${fmt(o.entry ?? e.close)}).`],
    tp3: [`TP3 nådd: ${e.name}`, `Kursen har nått TP3 (${fmt(e.tps[2])}). Sälj resten, affären är klar.${r}`],
    stop: [`Stopp: ${e.name}`, o.hit >= 2 ? `Kursen är tillbaka på köpkursen efter TP2. Sälj resten.${r}` : `Stoppet (${fmt(e.stop)}) är nått. Sälj det som är kvar.${r}`],
    exit: [e.kind === 'panic' ? `Säljdag: ${e.name}` : `Sälj idag: ${e.name}`, e.kind === 'panic' ? `Panikveckan från ${e.date}: säljdag ${e.exitDate}. Sälj på stängningen (före 17.30).` : `Krypto-utbrottet från ${e.date} har gått ${e.days} dagar. Sälj enligt planen.`],
    warn: [`Trolig köpsignal: ${e.name}`, `Alla krav är uppfyllda med kursen just nu (${fmt(e.close)}). Bekräftas vid stängningen 17:30, köp i så fall på öppningen imorgon.`],
  }[kind];
  if (!msg) return false;
  return send({ topic, server, appUrl, e, title: msg[0], body: msg[1], priority: kind === 'warn' ? 'default' : 'high', tags: kind === 'stop' ? 'warning' : 'chart_with_upwards_trend' });
}
