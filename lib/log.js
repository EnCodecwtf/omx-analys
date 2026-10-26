// Signallogg: varje köpsignal sparas när den kommer, och utfallet följs
// framåt med samma regler som backtestet. Det är ett riktigt framåttest,
// eftersom signalerna sparas innan utfallet är känt.
//
// Sparas i Upstash Redis om UPSTASH_REDIS_REST_URL och UPSTASH_REDIS_REST_TOKEN
// finns (rekommenderas på gratis hosting), annars i en fil (LOG_FILE,
// standard data/signal-log.json).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateTrade } from './analyze.js';

// På Vercel går det bara att skriva i /tmp, och den rensas. Använd Upstash där.
const FILE = process.env.LOG_FILE
  || (process.env.VERCEL ? '/tmp/signal-log.json' : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'signal-log.json'));
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = 'omx-analys:signal-log';
const redis = REDIS_URL && REDIS_TOKEN ? { url: REDIS_URL, token: REDIS_TOKEN } : null;

async function load(key = KEY) {
  try {
    if (redis) {
      const res = await fetch(`${redis.url}/get/${key}`, { headers: { Authorization: `Bearer ${redis.token}` } });
      const j = await res.json();
      return j.result ? JSON.parse(j.result) : [];
    }
    return JSON.parse(await fs.readFile(key === KEY ? FILE : FILE.replace(/\.json$/, `-${key.split(':').pop()}.json`), 'utf8'));
  } catch {
    return [];
  }
}

async function save(list, key = KEY) {
  if (redis) {
    await fetch(`${redis.url}/set/${key}`, { method: 'POST', headers: { Authorization: `Bearer ${redis.token}` }, body: JSON.stringify(list) });
    return;
  }
  const file = key === KEY ? FILE : FILE.replace(/\.json$/, `-${key.split(':').pop()}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(list, null, 1));
}

let queue = Promise.resolve();
// Lägger till nya signaler (en per instrument och dag) och returnerar de nya.
export function record(entries) {
  queue = queue.then(async () => {
    const list = await load();
    const seen = new Set(list.map(e => `${e.date}|${e.symbol}`));
    const added = entries.filter(e => !seen.has(`${e.date}|${e.symbol}`));
    if (added.length) await save([...list, ...added]);
    return added;
  }).catch(err => { console.error('Signalloggen kunde inte sparas:', err.message); return []; });
  return queue;
}

export async function entries() {
  return load();
}

// Lägger till aviseringar som redan skickats för en loggad affär (till exempel
// 'tp1' eller 'stop') och returnerar de som är nya, så att varje notis bara
// skickas en gång.
export function markAlerts(id, kinds) {
  queue = queue.then(async () => {
    const list = await load();
    const e = list.find(x => `${x.date}|${x.symbol}` === id);
    if (!e) return [];
    const fresh = kinds.filter(k => !(e.alerts || []).includes(k));
    if (fresh.length) { e.alerts = [...(e.alerts || []), ...fresh]; await save(list); }
    return fresh;
  }).catch(err => { console.error('Signalloggen kunde inte uppdateras:', err.message); return []; });
  return queue;
}

// Förvarningar inför stängningen: sparas per dag och instrument så att samma
// varning inte skickas flera gånger. Returnerar sant om varningen är ny.
const WARN_KEY = 'omx-analys:warnings';
export function markWarning(id) {
  queue = queue.then(async () => {
    const list = await load(WARN_KEY);
    if (list.includes(id)) return false;
    await save([...list.slice(-200), id], WARN_KEY);
    return true;
  }).catch(() => false);
  return queue;
}

const day = t => new Date(t * 1000).toISOString().slice(0, 10);

// Räknar ut utfallet för en loggad signal från kurserna efter signaldagen.
export function outcome(entry, bars) {
  const t = bars.findIndex(b => day(b.t) === entry.date);
  if (t < 0) return { state: 'okänd' };
  if (t + 1 >= bars.length) return { state: 'väntar på köp' };
  const sim = simulateTrade(bars, t, { stop: entry.stop, tps: entry.tps.map(price => ({ price })) });
  if (!sim) return { state: 'köpkurs under stopp – ingen affär' };
  const r = Math.round(sim.result * 100) / 100;
  return {
    state: sim.open ? 'öppen' : 'stängd',
    entry: Math.round(sim.entry * 100) / 100,
    hit: sim.hit, r,
    exitDate: day(bars[sim.exitI].t),
    last: bars[bars.length - 1].c,
  };
}
