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

// Läser en nyckel. Saknas den blir det en tom lista, men ett fel (nätverk,
// Redis nere, trasig data) kastas – annars skulle ett tillfälligt fel tolkas som
// en tom logg och nästa sparning skriva över hela historiken.
async function load(key = KEY) {
  if (redis) {
    const res = await fetch(`${redis.url}/get/${key}`, { headers: { Authorization: `Bearer ${redis.token}` }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Redis svarade ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(`Redis: ${j.error}`);
    return j.result == null ? [] : JSON.parse(j.result);
  }
  try {
    return JSON.parse(await fs.readFile(key === KEY ? FILE : FILE.replace(/\.json$/, `-${key.split(':').pop()}.json`), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function redisCmd(cmd) {
  const res = await fetch(redis.url, { method: 'POST', headers: { Authorization: `Bearer ${redis.token}` }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Redis svarade ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`Redis: ${j.error}`);
  return j.result;
}

async function save(list, key = KEY) {
  if (redis) {
    await redisCmd(['SET', key, JSON.stringify(list)]);
    return;
  }
  const file = key === KEY ? FILE : FILE.replace(/\.json$/, `-${key.split(':').pop()}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(list, null, 1));
}

// Sparar signalloggen utan att tappa något: poster som en annan körning hunnit
// lägga till sedan vi läste behålls, och bara poster i `removed` får försvinna.
// En säkerhetskopia per dag sparas i Redis i 35 dagar.
async function saveLog(list, { removed = [] } = {}) {
  const cur = await load(KEY);
  const ids = new Set(list.map(idOf)), drop = new Set(removed);
  const merged = [...list, ...cur.filter(e => !ids.has(idOf(e)) && !drop.has(idOf(e)))];
  await save(merged, KEY);
  if (redis) {
    try { await redisCmd(['SET', `${KEY}:backup:${new Date().toISOString().slice(0, 10)}`, JSON.stringify(merged), 'EX', '3024000']); } catch (err) { console.error('Säkerhetskopian kunde inte sparas:', err.message); }
  }
  return merged;
}

// Id för en loggad signal. Typen ingår så att samma aktie kan ha både en vanlig
// signal och en panikaffär samma dag.
export const idOf = e => `${e.date}|${e.symbol}${e.kind ? '|' + e.kind : ''}`;

let queue = Promise.resolve();
// Lägger till nya signaler (en per instrument och dag) och returnerar de nya.
export function record(entries) {
  queue = queue.then(async () => {
    const list = await load();
    const seen = new Set(list.map(idOf));
    const added = entries.filter(e => !seen.has(idOf(e)));
    if (added.length) await saveLog([...list, ...added]);
    return added;
  }).catch(err => { console.error('Signalloggen kunde inte sparas:', err.message); return []; });
  return queue;
}

// Tar bort loggade signaler (till exempel dubbletter medan en affär var öppen).
export function remove(ids) {
  const drop = new Set(ids);
  queue = queue.then(async () => {
    const list = await load();
    const kept = list.filter(e => !drop.has(idOf(e)));
    if (kept.length !== list.length) await saveLog(kept, { removed: [...drop] });
    return list.length - kept.length;
  }).catch(err => { console.error('Signalloggen kunde inte uppdateras:', err.message); return 0; });
  return queue;
}

// En affär i taget per instrument och strategi, som i backtestet. Tar loggade
// signaler med utfall (state, exitDate) och ger för varje instrument och strategi
// sista dagen det är upptaget ('9999-12-31' om affären är öppen eller väntar på köp),
// samt de signaler som kom medan en tidigare affär redan var öppen.
export const slotOf = (symbol, kind) => `${symbol}|${kind || ''}`;
export function busy(withOutcomes) {
  const until = new Map(), dupes = [];
  for (const e of withOutcomes.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    if (e.kind === 'panic') continue; // panikveckan har en egen spärr
    const k = slotOf(e.symbol, e.kind);
    if (until.has(k) && e.date <= until.get(k)) { dupes.push(idOf(e)); continue; }
    const live = e.state === 'öppen' || e.state === 'väntar på köp';
    if (live || e.exitDate) until.set(k, live ? '9999-12-31' : e.exitDate);
  }
  return { until, dupes };
}

// Enkel nyckel–värde-lagring i samma lagring som signalloggen (för webbnotiser).
export async function kvGet(key, def) {
  const v = await load(key);
  return v == null || (Array.isArray(v) && !v.length && !Array.isArray(def)) ? def : v;
}
export async function kvSet(key, value) {
  await save(value, key);
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
    const e = list.find(x => idOf(x) === id);
    if (!e) return [];
    const fresh = kinds.filter(k => !(e.alerts || []).includes(k));
    if (fresh.length) { e.alerts = [...(e.alerts || []), ...fresh]; await saveLog(list); }
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
