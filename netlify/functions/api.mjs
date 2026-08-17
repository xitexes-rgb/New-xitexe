import { getStore } from '@netlify/blobs';

const SESSION_TTL_MS = 15 * 60 * 1000;
const SESSION_STORE = 'xitexe-vplink-sessions';
const SESSION_KEY_PREFIX = 'sessions/';
const MAX_BODY_BYTES = 4096;

class ConfigurationError extends Error {}

function cleanString(value, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function randomToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('hex');
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function securityHeaders(contentType) {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'Content-Type': contentType,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...securityHeaders('application/json; charset=utf-8'),
      ...extraHeaders,
    },
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function htmlPage(title, content, status = 200) {
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#020712">
  <title>${escapeHtml(title)}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:radial-gradient(circle at 50% 10%,rgba(28,100,200,.3),transparent 42%),linear-gradient(145deg,#01040b,#061426 58%,#020610);color:#eafaff;font-family:Arial,sans-serif}.panel{width:min(100%,430px);padding:28px 22px;background:linear-gradient(160deg,rgba(6,23,43,.98),rgba(2,8,18,.99));border:1px solid rgba(92,220,255,.3);box-shadow:0 30px 110px rgba(0,0,0,.7);text-align:center}.head{display:flex;gap:9px;align-items:center;color:#86a9c5;font:700 9px monospace;letter-spacing:1.4px;text-align:left}.head b{margin-left:auto;color:#55f0ad;font-size:8px}.dot{width:8px;height:8px;border-radius:50%;background:#55f0ad;box-shadow:0 0 14px #55f0ad}.brand{margin-top:30px;font:900 34px monospace;text-shadow:0 0 20px rgba(99,232,255,.4)}.brand span{color:#ff57c7}.sub{margin-top:10px;color:#7896b4;font:700 9px monospace;letter-spacing:3px}.status{margin:24px 0 16px;padding:12px;border:1px solid rgba(99,232,255,.16);background:rgba(4,18,34,.7);color:#a9d9e9;font:700 10px/1.7 monospace}.key{overflow-wrap:anywhere;font-size:17px;color:#63e8ff;letter-spacing:1px}.continue{display:block;width:100%;margin-top:12px;padding:15px;border:1px solid rgba(174,244,255,.6);background:linear-gradient(100deg,#2c7bed,#63e8ff);color:#02101c;font:900 12px Arial;letter-spacing:1px;text-decoration:none}.foot{margin-top:18px;color:#52718f;font:700 8px/1.7 monospace}.error{margin:26px 0;color:#ff8ecf;font:700 12px/1.6 monospace}
  </style>
</head>
<body><main class="panel">${content}</main></body>
</html>`;

  return new Response(body, {
    status,
    headers: securityHeaders('text/html; charset=utf-8'),
  });
}

function errorPage(message, status = 400) {
  return htmlPage('XITEXE // ERROR', `<div class="head"><i class="dot"></i><span>SYS://XITEXE/ROUTE</span><b>ERROR</b></div><div class="brand">XITEXE <span>DENIED</span></div><div class="error">${escapeHtml(message)}</div><div class="foot">RETURN TO XITEXE AND TRY AGAIN</div>`, status);
}

function redirect(destination) {
  const url = parseHttpsUrl(destination, 'redirect destination');
  return new Response(null, {
    status: 303,
    headers: {
      ...securityHeaders('text/plain; charset=utf-8'),
      Location: url.toString(),
    },
  });
}

function parseHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`${label} is invalid.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new ConfigurationError(`${label} must be a secure HTTPS URL.`);
  }
  return url;
}

function requiredEnvironment(name) {
  const value = cleanString(process.env[name], 4096);
  if (!value) throw new ConfigurationError('Backend configuration is incomplete.');
  return value;
}

function firebaseBaseUrl() {
  const url = parseHttpsUrl(requiredEnvironment('FIREBASE_DB_BASE'), 'Firebase database base');
  if (url.search || url.hash) throw new ConfigurationError('Firebase database base is invalid.');
  return url;
}

function siteReturnUrl() {
  return parseHttpsUrl(requiredEnvironment('SITE_RETURN_URL'), 'Site return URL');
}

function sessionStore() {
  return getStore(SESSION_STORE, { consistency: 'strong' });
}

function sessionStorageKey(sessionId) {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

function validSessionId(value) {
  return /^[A-Za-z0-9_-]{32}$/.test(value);
}

function validItemId(value) {
  return /^[A-Za-z0-9_-]{1,180}$/.test(value);
}

async function readFirebaseItem(itemId) {
  const url = firebaseBaseUrl();
  url.pathname = `${url.pathname.replace(/\/$/, '')}/skintools2/items/${encodeURIComponent(itemId)}.json`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Firebase request failed.');
  return response.json();
}

async function createVplinkUrl(destination, alias) {
  const token = requiredEnvironment('VPLINK_API_TOKEN');
  const apiUrl = new URL('https://vplink.in/api');
  apiUrl.searchParams.set('api', token);
  apiUrl.searchParams.set('url', parseHttpsUrl(destination, 'Vplink destination').toString());
  apiUrl.searchParams.set('alias', alias);
  apiUrl.searchParams.set('format', 'json');

  const response = await fetch(apiUrl, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Vplink request failed.');

  const result = await response.json();
  if (!result || result.status === 'error' || !result.shortenedUrl) {
    throw new Error('Vplink did not create a short link.');
  }
  return parseHttpsUrl(String(result.shortenedUrl), 'Vplink response').toString();
}

function createReturnUrl(sessionId, itemId) {
  const url = siteReturnUrl();
  url.searchParams.set('session', sessionId);
  url.searchParams.set('itemId', itemId);
  return url.toString();
}

async function begin(request) {
  const itemId = cleanString(new URL(request.url).searchParams.get('itemId'), 180);
  if (!validItemId(itemId)) return errorPage('A valid item ID is required.', 400);

  let item;
  try {
    requiredEnvironment('VPLINK_API_TOKEN');
    siteReturnUrl();
    item = await readFirebaseItem(itemId);
  } catch (error) {
    return error instanceof ConfigurationError
      ? errorPage('The secure download service is not configured.', 503)
      : errorPage('Unable to read the selected item.', 502);
  }

  const downloadUrl = cleanString(item?.downloadLink, 4096);
  if (!downloadUrl) return errorPage('This item does not have a download link yet.', 404);

  try {
    parseHttpsUrl(downloadUrl, 'File destination');
  } catch {
    return errorPage('The file destination is not a secure HTTPS URL.', 400);
  }

  const sessionId = randomToken();
  const unlockKey = `XTX-${randomToken(18).toUpperCase()}`;
  const now = Date.now();
  const session = {
    createdAt: now,
    downloadUrl,
    expiresAt: now + SESSION_TTL_MS,
    itemId,
    itemName: cleanString(item?.name, 180) || 'XITEXE file',
    key: unlockKey,
    keyHash: await sha256(unlockKey),
    used: false,
  };
  const storageKey = sessionStorageKey(sessionId);

  try {
    const write = await sessionStore().setJSON(storageKey, session, {
      metadata: { expiresAt: session.expiresAt },
      onlyIfNew: true,
    });
    if (!write.modified) return errorPage('Unable to create a unique session. Please try again.', 503);

    const keyUrl = new URL('/api/key', request.url);
    keyUrl.searchParams.set('session', sessionId);
    const shortUrl = await createVplinkUrl(keyUrl.toString(), `XTX-${sessionId.slice(0, 8)}`);
    return redirect(shortUrl);
  } catch (error) {
    try {
      await sessionStore().delete(storageKey);
    } catch {}
    return error instanceof ConfigurationError
      ? errorPage('The secure download service is not configured.', 503)
      : errorPage('Unable to create the secure Vplink route.', 502);
  }
}

async function showKey(request) {
  const sessionId = cleanString(new URL(request.url).searchParams.get('session'), 120);
  if (!validSessionId(sessionId)) return errorPage('No active session.', 400);

  const storageKey = sessionStorageKey(sessionId);
  const current = await sessionStore().getWithMetadata(storageKey, { type: 'json' });
  const session = current?.data;
  if (!session || session.used) return errorPage('This unlock session has expired or was already used.', 403);

  if (Date.now() >= Number(session.expiresAt || 0)) {
    await sessionStore().delete(storageKey);
    return errorPage('This unlock session has expired or was already used.', 403);
  }

  let returnUrl;
  try {
    returnUrl = createReturnUrl(sessionId, session.itemId);
  } catch {
    return errorPage('The secure download service is not configured.', 503);
  }

  return htmlPage('XITEXE // SECURE KEY', `<div class="head"><i class="dot"></i><span>SYS://XITEXE/KEY-ISSUER</span><b>SECURE</b></div><div class="brand">XITEXE <span>KEY</span></div><div class="sub">ONE-TIME ACCESS CREDENTIAL</div><div class="status">SESSION READY<br>${escapeHtml(session.itemName)}</div><div class="status key">${escapeHtml(session.key)}</div><a class="continue" href="${escapeHtml(returnUrl)}">RETURN TO XITEXE ↗</a><div class="foot">THIS KEY EXPIRES 15 MINUTES AFTER THE SESSION STARTS AND CAN BE USED ONCE</div>`);
}

async function parseVerificationBody(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) return null;

  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return null;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  return null;
}

async function verify(request) {
  const body = await parseVerificationBody(request);
  const sessionId = cleanString(body?.session, 120);
  const submittedKey = cleanString(body?.key, 160).toUpperCase();
  if (!validSessionId(sessionId) || !submittedKey) return errorPage('Session and key are required.', 400);

  const sessions = sessionStore();
  const storageKey = sessionStorageKey(sessionId);
  const current = await sessions.getWithMetadata(storageKey, { type: 'json' });
  const session = current?.data;
  const etag = current?.etag;

  if (!session || !etag || session.used || Date.now() >= Number(session.expiresAt || 0)) {
    return errorPage('Invalid, expired, or already-used key.', 403);
  }

  const submittedHash = await sha256(submittedKey);
  if (!constantTimeEqual(session.keyHash, submittedHash)) {
    return errorPage('Invalid, expired, or already-used key.', 403);
  }

  const consumed = await sessions.setJSON(storageKey, {
    ...session,
    key: null,
    used: true,
    usedAt: Date.now(),
  }, { onlyIfMatch: etag });

  if (!consumed.modified) {
    return errorPage('This key was already used or the session changed.', 403);
  }

  try {
    return redirect(session.downloadUrl);
  } catch {
    return errorPage('The file destination is not a secure HTTPS URL.', 502);
  }
}

function methodNotAllowed(allowedMethod) {
  return json({ error: 'Method not allowed.' }, 405, { Allow: allowedMethod });
}

function health() {
  try {
    requiredEnvironment('VPLINK_API_TOKEN');
    firebaseBaseUrl();
    siteReturnUrl();
    return json({ ok: true, service: 'xitexe-vplink-api' });
  } catch {
    return json({ ok: false, service: 'xitexe-vplink-api' }, 503);
  }
}

export default async function handler(request) {
  const pathname = new URL(request.url).pathname.replace(/\/$/, '');
  const method = request.method.toUpperCase();

  try {
    if (pathname === '/api/health') return method === 'GET' ? health() : methodNotAllowed('GET');
    if (pathname === '/api/begin') return method === 'GET' ? begin(request) : methodNotAllowed('GET');
    if (pathname === '/api/key') return method === 'GET' ? showKey(request) : methodNotAllowed('GET');
    if (pathname === '/api/verify') return method === 'POST' ? verify(request) : methodNotAllowed('POST');
    return json({ error: 'Not found.' }, 404);
  } catch {
    return errorPage('Unexpected backend error.', 500);
  }
}

export const config = {
  path: '/api/*',
};
