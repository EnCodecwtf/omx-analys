// Aviseringar till mobilen via ntfy.sh (gratis, inget konto). Installera
// appen ntfy på mobilen, prenumerera på ett eget hemligt ämne och sätt samma
// ämne i NTFY_TOPIC. APP_URL används för länken i notisen.

const fmt = v => (v >= 1000 ? Math.round(v).toLocaleString('sv-SE') : v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export async function notifySignal(e, { topic = process.env.NTFY_TOPIC, server = process.env.NTFY_URL || 'https://ntfy.sh', appUrl = process.env.APP_URL } = {}) {
  if (!topic) return false;
  const size = e.size == null ? '' : e.size === 1 ? 'Hel position.' : e.size === 0.5 ? 'Halv position.' : `Positionen × ${String(e.size).replace('.', ',')}.`;
  const body = [
    `Köp runt ${fmt(e.close)} (köp på öppningen).`,
    `Stopp ${fmt(e.stop)} · TP1 ${fmt(e.tps[0])} · TP2 ${fmt(e.tps[1])} · TP3 ${fmt(e.tps[2])}.`,
    size,
    'Kontrollera nyheter och köp- och säljkurs innan du handlar.',
  ].filter(Boolean).join('\n');
  const headers = { Title: `Stark köpsignal: ${e.name}`, Priority: 'high', Tags: 'chart_with_upwards_trend' };
  if (appUrl) headers.Click = `${appUrl.replace(/\/$/, '')}/#${encodeURIComponent(e.symbol)}`;
  try {
    const res = await fetch(`${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}`, { method: 'POST', headers, body });
    return res.ok;
  } catch (err) {
    console.error('Aviseringen kunde inte skickas:', err.message);
    return false;
  }
}
