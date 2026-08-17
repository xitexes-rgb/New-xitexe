import { getStore } from '@netlify/blobs';

const SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_FIREBASE_DB_BASE = 'https://my-website-broken-default-rtdb.europe-west1.firebasedatabase.app';
const DEFAULT_RETURN_URL = 'https://xitexes-rgb.github.io/New-xitexe/';
const STORE = 'xitexe-vplink-sessions';

function cleanString(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function randomToken(bytes = 18) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  let binary = '';
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function page(title, body) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#020712"><title>${escapeHtml(title)}</title><style>
  :root{--bg:#020712;--panel:#06172b;--line:rgba(92,220,255,.3);--cyan:#63e8ff;--green:#55f0ad;--pink:#ff57c7;--muted:#7896b4}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:radial-gradient(circle at 50% 10%,rgba(28,100,200,.3),transparent 42%),linear-gradient(145deg,#01040b,#061426 58%,#020610);color:#eafaff;font-family:Arial,sans-serif}.shell{width:min(100%,430px);padding:1px;border:1px solid var(--line);box-shadow:0 30px 110px rgba(0,0,0,.7)}.panel{padding:26px 22px;background:linear-gradient(160deg,rgba(6,23,43,.98),rgba(2,8,18,.99));text-align:center}.head{display:flex;gap:9px;align-items:center;color:#86a9c5;font:700 9px monospace;letter-spacing:1.4px;text-align:left}.head b{margin-left:auto;color:var(--green);font-size:8px}.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 14px var(--green)}.brand{margin-top:32px;font:900 34px monospace;text-shadow:0 0 20px rgba(99,232,255,.4)}.brand span{color:var(--pink)}.sub{margin-top:10px;color:var(--muted);font:700 9px monospace;letter-spacing:3px}.status{margin:25px 0 18px;padding:12px;border:1px solid rgba(99,232,255,.16);background:rgba(4,18,34,.7);color:#a9d9e9;font:700 10px/1.7 monospace;text-transform:uppercase}.status strong{color:var(--green)}.continue{display:block;width:100%;margin-top:16px;padding:15px;border:1px solid rgba(174,244,255,.6);background:linear-gradient(100deg,#2c7bed,#63e8ff);color:#02101c;font:900 12px Arial;letter-spacing:1px;text-decoration:none;cursor:pointer}.foot{margin-top:18px;color:#52718f;font:700 8px/1.7 monospace}.foot strong{color:#75ddff}.error{color:#ff8ecf;font:700 12px/1.6 monospace;padding:25px 4px}small{color:#7896b4;font:700 9px monospace}</style></head><body><main class="shell"><section class="panel">${body}</section></main></body></html>`, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function errorPage(message, status = 400) {
  return new Response(page('XITEXE // ERROR', `<div class="head"><i class="dot"></i><span>SYS://XITEXE/ROUTE</span><b>ERROR</b></div><div class="brand">XITEXE <span>DENIED</span></div><div class="error">${escapeHtml(message)}</div><div class="foot">RETURN TO XITEXE AND TRY AGAIN</div>`).body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function redirect(url, label) {
  if (!/^https:\/\//i.test(String(url))) return errorPage('Unsafe redirect URL.', 502);
  const safeUrl = escapeHtml(url);
  const html = page(`XITEXE // ${label}`, `<div class="head"><i class="dot"></i><span>SYS://XITEXE/ROUTE</span><b>SECURE</b></div><div class="brand">XITEXE <span>LINK</span></div><div class="sub">${escapeHtml(label)}</div><div class="status">&gt; SECURE ROUTE ... <strong>READY</strong></div><a class="continue" target="_top" href="${safeUrl}">CONTINUE ↗</a><script>setTimeout(()=>window.top.location.replace(${JSON.stringify(url)}),700);</script><div class="foot">XTX // SECURE CHANNEL</div>`);
  return new Response(html.body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function readFirebaseItem(itemId) {
  const base = process.env.FIREBASE_DB_BASE || DEFAULT_FIREBASE_DB_BASE;
  const url = `${base.replace(/\/$/, '')}/skintools2/items/${encodeURIComponent(itemId)}.json`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Database returned HTTP ${response.status}`);
  return response.json();
}

async function createVplinkUrl(destination, alias) {
  const token = process.env.VPLINK_API_TOKEN;
  if (!token) throw new Error('Vplink service is not configured.');
  const api = new URL('https://vplink.in/api');
  api.searchParams.set('api', token);
  api.searchParams.set('url', destination);
  api.searchParams.set('alias', alias);
  api.searchParams.set('format', 'json');
  const response = await fetch(api, { method: 'GET', cache: 'no-store' });
  if (!response.ok) throw new Error(`Vplink returned HTTP ${response.status}`);
  let result;
  try { result = await response.json(); } catch { throw new Error('Vplink returned an invalid response.'); }
  if (!result || result.status === 'error' || !result.shortenedUrl) throw new Error(result?.message || 'Vplink could not create the short link.');
  if (!/^https:\/\//i.test(String(result.shortenedUrl))) throw new Error('Vplink returned an unsafe URL.');
  return String(result.shortenedUrl);
}

function store() { return getStore(STORE); }
function sessionReturnUrl(sessionId, itemId) {
  const base = process.env.SITE_RETURN_URL || DEFAULT_RETURN_URL;
  const url = new URL(base);
  url.searchParams.set('session', sessionId);
  url.searchParams.set('itemId', itemId);
  return url.toString();
}

async function begin(request) {
  const url = new URL(request.url);
  const itemId = cleanString(url.searchParams.get('itemId'), 180);
  if (!itemId || !/^[A-Za-z0-9_-]+$/.test(itemId)) return errorPage('A valid item ID is required.', 400);
  if (!process.env.VPLINK_API_TOKEN) return errorPage('Vplink service is not configured yet.', 503);

  let item;
  try { item = await readFirebaseItem(itemId); } catch { return errorPage('Unable to read the selected item.', 502); }
  if (!item || !item.downloadLink) return errorPage('This item does not have a download link yet.', 404);
  if (!/^https:\/\//i.test(String(item.downloadLink))) return errorPage('The file destination is not a secure HTTPS URL.', 400);

  const sessionId = randomToken(18);
  const unlockKey = `XTX-${sessionId.toUpperCase()}-${randomToken(8).toUpperCase()}`;
  const now = Date.now();
  const session = { itemId, itemName: cleanString(item.name, 180) || 'XITEXE file', downloadUrl: String(item.downloadLink), key: unlockKey, keyHash: await sha256(unlockKey), createdAt: now, expiresAt: now + SESSION_TTL_MS, used: false };
  try {
    const sessions = store();
    const result = await sessions.setJSON(sessionId, session, { onlyIfNew: true });
    if (!result.modified) return errorPage('Please try again.', 503);
    const keyUrl = new URL('/api/key', request.url);
    keyUrl.searchParams.set('session', sessionId);
    const shortUrl = await createVplinkUrl(keyUrl.toString(), `XTX-${sessionId.slice(0, 8)}`);
    return redirect(shortUrl, 'OPENING VPLINK ADS');
  } catch (error) {
    try { await store().delete(sessionId); } catch {}
    return errorPage(error.message || 'Unable to create the Vplink route.', 502);
  }
}

async function showKey(request) {
  const sessionId = cleanString(new URL(request.url).searchParams.get('session'), 120);
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(sessionId)) return errorPage('No active session.', 400);
  const result = await store().getWithMetadata(sessionId, { type: 'json' });
  const session = result?.data;
  if (!session || session.used || Date.now() > Number(session.expiresAt || 0)) return errorPage('This unlock session has expired or was already used.', 403);
  const returnUrl = sessionReturnUrl(sessionId, session.itemId);
  const body = `<div class="head"><i class="dot"></i><span>SYS://XITEXE/KEY-ISSUER</span><b>SECURE</b></div><div class="brand">XITEXE <span>KEY</span></div><div class="sub">ONE-TIME ACCESS CREDENTIAL</div><div class="status">&gt; SESSION HANDSHAKE ... <strong>KEY ISSUED</strong><br><small>${escapeHtml(session.itemName)}</small></div><div class="status" style="font-size:18px;color:#63e8ff;letter-spacing:1px">${escapeHtml(session.key)}</div><button class="continue" id="copy">COPY KEY</button><a class="continue" href="${escapeHtml(returnUrl)}">RETURN TO XITEXE ↗</a><div class="foot">KEY IS <strong>ONE-TIME</strong> &nbsp;•&nbsp; EXPIRES IN 15 MINUTES<br>COPY IT, RETURN TO XITEXE, PASTE IT, THEN VERIFY</div><script>document.getElementById('copy').onclick=()=>navigator.clipboard.writeText(${JSON.stringify(session.key)}).then(()=>document.getElementById('copy').textContent='KEY COPIED').catch(()=>document.getElementById('copy').textContent='SELECT KEY MANUALLY');</script>`;
  return page('XITEXE // SECURE KEY', body);
}

async function verify(request) {
  const form = await request.formData();
  const sessionId = cleanString(form.get('session'), 120);
  const submittedKey = cleanString(form.get('key'), 160).toUpperCase();
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(sessionId) || !submittedKey) return errorPage('Session and key are required.', 400);
  const sessions = store();
  const current = await sessions.getWithMetadata(sessionId, { type: 'json' });
  const session = current?.data;
  const etag = current?.etag;
  if (!session || !etag || session.used || Date.now() > Number(session.expiresAt || 0) || session.keyHash !== await sha256(submittedKey)) return errorPage('Invalid, expired, or already-used key.', 403);
  const updated = { ...session, used: true, usedAt: Date.now() };
  const result = await sessions.setJSON(sessionId, updated, { onlyIfMatch: etag });
  if (!result.modified) return errorPage('This key was already used or the session changed. Try again.', 403);
  return redirect(session.downloadUrl, 'ACCESS GRANTED — OPENING FILE');
}


async function responseToNetlify(response) {
  const headers = {};
  for (const [key, value] of response.headers.entries()) headers[key] = value;
  return { statusCode: response.status, headers, body: await response.text(), isBase64Encoded: false };
}

export async function handler(event) {
  const rawUrl = event.rawUrl || `https://${event.headers?.host || 'netlify.local'}${event.path || '/'}`;
  const method = String(event.httpMethod || 'GET').toUpperCase();
  const headers = event.headers || {};
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : undefined;
  const request = new Request(rawUrl, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body });
  const requestUrl = new URL(rawUrl);
  const route = requestUrl.searchParams.get('route') || requestUrl.pathname.split('/').filter(Boolean).pop() || '';
  try {
    if (route === 'begin' && method === 'GET') return responseToNetlify(await begin(request));
    if (route === 'key' && method === 'GET') return responseToNetlify(await showKey(request));
    if (route === 'verify' && method === 'POST') return responseToNetlify(await verify(request));
    if (route === 'health' && method === 'GET') return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: true, service: 'xitexe-vplink-api' }) };
    return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found.' };
  } catch (error) {
    return responseToNetlify(errorPage(error?.message || 'Unexpected backend error.', 500));
  }
}
