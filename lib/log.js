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

const FILE = process.env.LOG_FILE
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'signal-log.json');
const KEY = 'omx-analys:signal-log';
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN } : null;

async function load() {
  try {
    if (redis) {
      const res = await fetch(`${redis.url}/get/${KEY}`, { headers: { Authorization: `Bearer ${redis.token}` } });
      const j = await res.json();
      return j.result ? JSON.parse(j.result) : [];
    }
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function save(list) {
  if (redis) {
    await fetch(`${redis.url}/set/${KEY}`, { method: 'POST', headers: { Authorization: `Bearer ${redis.token}` }, body: JSON.stringify(list) });
    return;
  }
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(list, null, 1));
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
