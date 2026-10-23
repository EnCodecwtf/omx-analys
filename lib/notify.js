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
