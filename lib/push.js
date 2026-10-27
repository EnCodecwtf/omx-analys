// Webbnotiser (Web Push) utan extra app och utan externa paket. Webbläsaren
// prenumererar, och servern krypterar varje notis enligt RFC 8291 (aes128gcm)
// och signerar med en VAPID-nyckel (RFC 8292).
//
// VAPID-nycklarna tas från VAPID_PUBLIC_KEY och VAPID_PRIVATE_KEY om de finns,
// annars skapas de första gången och sparas i samma lagring som signalloggen.

import crypto from 'node:crypto';
import { kvGet, kvSet } from './log.js';

const VAPID_KEY = 'omx-analys:vapid';
const SUBS_KEY = 'omx-analys:push';
const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(s, 'base64url');

let vapidCache = null;
export async function vapidKeys() {
  if (vapidCache) return vapidCache;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    const pub = fromB64u(process.env.VAPID_PUBLIC_KEY);
    vapidCache = { publicKey: process.env.VAPID_PUBLIC_KEY, jwk: { kty: 'EC', crv: 'P-256', d: process.env.VAPID_PRIVATE_KEY, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } };
    return vapidCache;
  }
  const saved = await kvGet(VAPID_KEY, null);
  if (saved?.jwk) return (vapidCache = saved);
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  vapidCache = { publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])), jwk: { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y } };
  await kvSet(VAPID_KEY, vapidCache);
  return vapidCache;
}

// Krypterar meddelandet till en prenumeration (RFC 8291, en post).
export function encrypt(sub, payload, { salt = crypto.randomBytes(16), ecdh } = {}) {
  if (!ecdh) { ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); }
  const asPublic = ecdh.getPublicKey();
  const uaPublic = fromB64u(sub.keys.p256dh);
  const auth = fromB64u(sub.keys.auth);
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

// VAPID: en JWT signerad med ES256 för push-tjänstens adress.
export function vapidAuth(endpoint, keys, subject = 'mailto:omx-analys@example.com') {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

export async function subscriptions() {
  return kvGet(SUBS_KEY, []);
}

export async function subscribe(sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Ogiltig prenumeration');
  const list = (await subscriptions()).filter(s => s.endpoint !== sub.endpoint);
  list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, at: new Date().toISOString() });
  await kvSet(SUBS_KEY, list.slice(-20));
  return list.length;
}

export async function unsubscribe(endpoint) {
  await kvSet(SUBS_KEY, (await subscriptions()).filter(s => s.endpoint !== endpoint));
}

export async function sendPush(sub, message) {
  const keys = await vapidKeys();
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: vapidAuth(sub.endpoint, keys), TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
    body: encrypt(sub, JSON.stringify(message)),
  });
  return res.status;
}

// Skickar till alla prenumerationer och tar bort de som inte längre finns.
export async function pushAll(message, { only } = {}) {
  const list = (await subscriptions()).filter(s => !only || s.endpoint === only);
  let ok = 0;
  for (const s of list) {
    try {
      const status = await sendPush(s, message);
      if (status === 404 || status === 410) await unsubscribe(s.endpoint);
      else if (status < 300) ok++;
    } catch (err) {
      console.error('Webbnotisen kunde inte skickas:', err.message);
    }
  }
  return ok;
}
