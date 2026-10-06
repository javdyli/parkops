'use strict';
/* ParkOps server: console, driver accounts, Square payments and invoices, monthly parking, reservations,
   QR pay-by-plate lots, text messages, live LPR cameras, photo evidence and collections.
   Node 22.13+, no packages to install. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
/* Files live in lib/ and public/ as shipped, but an upload through github.com's website can drop the folders
   and leave everything at the top level. Either layout runs. */
const here = (folder, file) => fs.existsSync(path.join(__dirname, folder, file)) ? path.join(__dirname, folder, file) : path.join(__dirname, file);
const lib = name => require(here('lib', name + '.js'));
const Rules = require('./public-rules');
const makeStore = lib('store');
const { parseRead } = lib('lpr-parse');
const square = lib('square');
const mailer = lib('mailer');
const sms = lib('sms');
const plates = lib('plates');
const Auth = lib('auth');
const Photos = lib('photos');

const PORT = +process.env.PORT || 8080;
/* Every link we email or text is built from this, never from request headers (prevents link poisoning). */
const BASE = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TRUST_PROXY = process.env.TRUST_PROXY != null ? +process.env.TRUST_PROXY : process.env.RENDER ? 1 : 0;
const PHOTO_DAYS = +(process.env.PHOTO_RETENTION_DAYS || 90);
const COLLS = ['facilities', 'permitTypes', 'permits', 'sessions', 'citations', 'validations', 'members', 'tenants', 'cameras', 'reservations', 'companies', 'invoices', 'vips', 'ratings', 'settings'];
/* Roles (owner, manager, attendant, accountant, viewer) and what each may do come from the shared rules table, so the
   server refuses what the console greys out. Which permission a direct record write needs, by collection; null means
   staff never write it directly (the system does, through the ticket and portal endpoints). */
const DB_PERM = { facilities: 'facilities', cameras: 'cameras', settings: 'settings', validations: 'validations', tenants: 'validations', vips: 'vips', permitTypes: 'monthly', permits: 'monthly', companies: 'monthly', invoices: 'monthly', members: 'monthly', reservations: 'reservations', citations: 'citations', sessions: 'tickets.adjust', ratings: null };
/* Ticket actions and the permission each needs. Replacing a validation, complimentary tickets and anything that changes money after the fact need tickets.adjust (manager and up). */
const TK_PERM = { emailReceipt: 'tickets', create: 'tickets', pay: 'tickets', close: 'tickets', note: 'tickets', validate: 'tickets', valet: 'tickets', terminal: 'tickets', chargeCard: 'tickets', markCited: 'citations', reopen: 'tickets.adjust', waive: 'tickets.adjust', unwaive: 'tickets.adjust', adjust: 'tickets.adjust', setPlate: 'tickets.adjust', removeValidation: 'tickets.adjust', review: 'tickets.adjust' };
const STAFF_METHODS = ['cash', 'card', 'check', 'comp'];
const ROLE_LIST = ['owner', 'manager', 'attendant', 'accountant', 'viewer'];
const PUBLIC_OPS = ['prepay', 'reserve', 'cancelReservation', 'payBalance', 'payCitation', 'appeal', 'validate', 'payPermit', 'rate'];
const ACCOUNT_OPS = ['monthlySignup', 'cancelMonthly'];
const MAX_BODY = 12 * 1024 * 1024;
const H = 36e5, D = 864e5, M = 6e4;

/* ---------- state ---------- */
const S = { config: null };
COLLS.forEach(c => { S[c] = []; });
const R = Rules(S, null, { deferAutopay: true });
let FEED = [];
const store = makeStore();
let auth, photos;
const cfg = () => S.config || {};

/* Tickets by plate, kept in step with S.sessions, so looking up one plate doesn't mean reading every ticket in memory
   (the rules use it only while S.__byPlateArr is the current list). */
const plateIx = new Map();
function ixDrop(d) { if (!d) return; const k = Rules.normPlate(d.plate), a = plateIx.get(k); if (!a) return; const j = a.indexOf(d); if (j >= 0) a.splice(j, 1); if (!a.length) plateIx.delete(k); }
function ixAdd(d) { const k = Rules.normPlate(d.plate), a = plateIx.get(k); if (a) a.push(d); else plateIx.set(k, [d]); }
function rebuildPlateIndex() { plateIx.clear(); for (const d of S.sessions) ixAdd(d); S.__byPlate = plateIx; S.__byPlateArr = S.sessions; }
function applyDoc(coll, id, data) {
  if (coll === 'settings') { if (id === 'config') S.config = data; return; }
  const arr = S[coll]; if (!arr) return;
  const i = arr.findIndex(x => x.id === id), ix = coll === 'sessions' && S.__byPlateArr === arr;
  if (data === null) { if (i >= 0) { if (ix) ixDrop(arr[i]); arr.splice(i, 1); } return; }
  const d = Object.assign({ id }, data);
  if (i >= 0) { if (ix) ixDrop(arr[i]); arr[i] = d; } else arr.push(d);
  if (ix) ixAdd(d);
}
const strip = d => { const o = Object.assign({}, d); delete o.id; return o; };
/* Webhook and portal tokens never go into the audit log (attendants can read a ticket’s trail). */
const redactSecrets = d => { if (!d || typeof d !== 'object') return d; const o = Object.assign({}, d); ['token', 'portalToken', 'extendToken', 'pw'].forEach(k => { if (k in o) o[k] = '…'; }); return o; };
function getDoc(coll, id) { if (coll === 'settings') return id === 'config' ? S.config : null; const d = (S[coll] || []).find(x => x.id === id); return d ? strip(d) : null; }
const withPay = (ops, pid) => JSON.parse(JSON.stringify(ops).split('"__PAY__"').join(pid ? JSON.stringify(pid) : 'null'));
const paidSum = d => (d.payments || []).reduce((a, p) => a + (+p.amount || 0), 0);
const hasDebt = d => !!(d && d.endAt && (R.balanceOf(d) > 0 || (d.missedExit && !d.missedResolved) || R.needsReview(d)));

/* Payments added by a planner are appended to whatever the session holds at commit time, so two payments that
   finish around the same moment can't overwrite each other. Call right after planning, before any await. */
function normalize(ops) {
  ops.forEach(o => {
    if (o.type === 'update' && o.coll === 'sessions' && Array.isArray(o.data.payments)) {
      const cur = getDoc('sessions', o.id), before = cur ? (cur.payments || []).length : 0;
      o.newPayments = o.data.payments.slice(before); o.data = Object.assign({}, o.data); delete o.data.payments;
    }
  });
  return ops;
}
/* Apply to memory synchronously (so reads never race), then persist, audit and broadcast. */
async function commit(ops, actor) {
  const writes = [];
  for (const o of ops) {
    if (o.type === 'log') { FEED.unshift(o.data); FEED.length = Math.min(FEED.length, 100); writes.push(store.addRead(o.data)); broadcast({ type: 'feed', read: o.data }); continue; }
    let data; const before = actor ? getDoc(o.coll, o.id) : null;
    if (o.type === 'set') data = o.data;
    else if (o.type === 'update') {
      const cur = getDoc(o.coll, o.id); if (!cur) continue;
      data = Object.assign({}, cur, o.data);
      if (o.newPayments) data.payments = (cur.payments || []).concat(o.newPayments);
    } else if (o.type === 'delete') data = null;
    if (data && o.coll === 'citations') { if (data.fine != null) data.fine = Math.round((+data.fine || 0) * 100) / 100; (data.photoIds || []).forEach(x => { try { photos.keep(String(x)); } catch (e) {} }); }
    applyDoc(o.coll, o.id, data);
    writes.push(data === null ? store.del(o.coll, o.id) : store.put(o.coll, o.id, data, o.coll === 'sessions' && hasDebt(data)));
    if (actor) store.audit(actor, o.type, o.coll, o.id, { before: redactSecrets(before), change: redactSecrets(o.type === 'update' ? o.data : o.type === 'set' ? data : null) });
    broadcast({ type: 'doc', coll: o.coll, id: o.id, data });
  }
  await Promise.all(writes);
}
/* Per-record locks: payments and bookings on the same record run one at a time; unrelated ones run in parallel. */
const locks = new Map(); let lockDepth = 0;
async function withLocks(keys, fn) {
  keys = [...new Set(keys.filter(Boolean))].sort();
  if (lockDepth > 300) { const e = new Error('The system is busy. Try again in a moment.'); e.status = 503; throw e; }
  const prev = keys.map(k => locks.get(k) || Promise.resolve());
  let release; const mine = new Promise(r => { release = r; });
  keys.forEach(k => locks.set(k, mine)); lockDepth++;
  try { await Promise.all(prev); return await fn(); }
  finally { lockDepth--; release(); keys.forEach(k => { if (locks.get(k) === mine) locks.delete(k); }); }
}

/* ---------- live updates ---------- */
const clients = new Set(), perIp = new Map();
const publicConfig = () => { const c = cfg(); return { campusName: c.campusName || '', timeZone: c.timeZone || 'America/Chicago', unpaidGraceHours: c.unpaidGraceHours || 48, printerWidth: c.printerWidth || 3, violations: c.violations, taxRate: +c.taxRate || 0, taxIncluded: c.taxIncluded !== false, textNumber: process.env.TWILIO_DISPLAY_NUMBER || '', holidays: c.holidays || [], brandColor: c.brandColor || '', brandStripe: c.brandStripe || '' }; };
/* What each role gets to see. Owners and managers see everything. Attendants, accountants and viewers never get camera
   webhook tokens or company portal links; only accountants (and up) see invoices. The public sees locations and plans. */
function viewFor(role, coll, data, id) {
  if (!data) return data;
  if (role === 'owner' || role === 'manager') return data;
  if (role === 'public') {
    if (coll === 'permitTypes') return data.active === false ? undefined : Object.assign({}, data, { sold: R.soldOf(Object.assign({ id }, data)) });
    if (coll === 'facilities') { const o = Object.assign({}, data); delete o.terminalDeviceId; return o; }
    return undefined;
  }
  if (coll === 'cameras') { const o = Object.assign({}, data); delete o.token; return o; }
  if (coll === 'companies') { const o = Object.assign({}, data); delete o.portalToken; return o; }
  if (coll === 'members') return { name: data.name, plates: data.plates, accountId: data.accountId };
  if (coll === 'invoices') return role === 'accountant' ? data : undefined;
  return data;
}
const roleOf = u => u ? Rules.canonRole(u.role) : 'public';
const can = (u, perm) => !!u && Rules.can(roleOf(u), perm);
const roleName = u => Rules.ROLE_NAMES[roleOf(u)] || roleOf(u);
function broadcast(msg) {
  for (const c of clients) {
    let m = msg;
    if (msg.type === 'feed') { if (c.role === 'public') continue; }
    else if (msg.coll === 'settings') m = c.role === 'public' ? { type: 'doc', coll: 'settings', id: msg.id, data: publicConfig() } : msg;
    else if (msg.data === null) { if (viewFor(c.role, msg.coll, { id: msg.id }, msg.id) === undefined) continue; }
    else { const v = viewFor(c.role, msg.coll, msg.data, msg.id); if (v === undefined) continue; m = Object.assign({}, msg, { data: v }); }
    if (c.res.writableLength > 1024 * 1024) { c.res.destroy(); clients.delete(c); continue; }
    c.res.write('data: ' + JSON.stringify(m) + '\n\n');
  }
}
/* Live connections of one staff member end at once when their role changes or the account is turned off. */
function dropClientsOf(uid) { for (const c of clients) { if (c.uid === uid) { c.res.end(); clients.delete(c); } } }
setInterval(() => {
  for (const c of clients) {
    if (c.role !== 'public') { const u = staffFromToken(c.token); if (!u) { c.res.end(); clients.delete(c); continue; } c.role = roleOf(u); }
    c.res.write(': ping\n\n');
  }
}, 25000).unref();

/* ---------- http helpers ---------- */
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' https://*.squarecdn.com https://*.squareup.com https://*.squareupsandbox.com https://pay.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.squarecdn.com", "font-src 'self' data: https://fonts.gstatic.com https://*.squarecdn.com https://*.cloudfront.net",
  "img-src 'self' data: blob: https:", "connect-src 'self' https://*.squareup.com https://*.squareupsandbox.com https://*.squarecdn.com https://*.sentry.io https://pay.google.com https://google.com/pay",
  "frame-src https://*.squarecdn.com https://*.squareup.com https://*.squareupsandbox.com https://*.cardinalcommerce.com https://pay.google.com", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"].join('; ');
function headers(extra) {
  const h = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(self), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' };
  if (process.env.CSP_OFF !== '1') h['Content-Security-Policy'] = CSP;
  if (BASE.startsWith('https')) h['Strict-Transport-Security'] = 'max-age=31536000';
  return Object.assign(h, extra || {});
}
const gzCache = new WeakMap();
function send(res, code, body, extra) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  const h = Object.assign({ 'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json' }, extra);
  let out = isStr ? body : JSON.stringify(body);
  /* Big pages and lists (the console's first load, History, Activity) are compressed when the browser accepts it: about 10x smaller. */
  if (out.length > 2048 && code === 200 && !h['Content-Encoding'] && /\bgzip\b/.test(String((res.req && res.req.headers['accept-encoding']) || ''))) {
    let gz = typeof out === 'object' ? gzCache.get(out) : null;
    /* Big answers (a staff screen's first load, exports) are compressed off the main thread, so a few screens loading at
       once don't hold up camera reads and payments. */
    if (!gz && out.length > 65536 && typeof out !== 'object') {
      h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding';
      zlib.gzip(out, { level: 5 }, (err, z) => { if (res.destroyed) return; if (err) { delete h['Content-Encoding']; z = out; } res.writeHead(code, headers(h)); res.end(z); });
      return;
    }
    if (!gz) { gz = zlib.gzipSync(out, { level: 5 }); if (typeof out === 'object') gzCache.set(out, gz); }
    out = gz; h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding';
  }
  res.writeHead(code, headers(h));
  res.end(out);
}
const fail = (res, code, message, c, extra) => send(res, code, Object.assign({ error: { code: c || 'invalid_argument', message } }, extra || {}));
function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
async function readJson(req) { const b = await readBody(req, 2 * 1024 * 1024); if (!b.length) return {}; let j; try { j = JSON.parse(b.toString('utf8')); } catch (e) { throw Object.assign(new Error('Body must be valid JSON'), { status: 400 }); } if (!j || typeof j !== 'object' || Array.isArray(j)) throw Object.assign(new Error('Body must be a JSON object'), { status: 400 }); return j; }
const cookie = (req, name) => { const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(req.headers.cookie || ''); return m ? decodeURIComponent(m[1]) : null; };
const setCookie = (name, val, maxAge) => `${name}=${encodeURIComponent(val)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${BASE.startsWith('https') ? '; Secure' : ''}`;
/* Client address: only trust X-Forwarded-For entries added by our own proxy hops. */
/* CLIENT_IP_HEADER: when the host puts the visitor's address in a header of its own (for example cf-connecting-ip behind
   Cloudflare), name it here. Settings → System shows what the server sees, so you can tell whether it's needed. */
const CLIENT_IP_HEADER = String(process.env.CLIENT_IP_HEADER || '').trim().toLowerCase();
function clientIp(req) {
  const sock = req.socket.remoteAddress || '';
  if (CLIENT_IP_HEADER && req.headers[CLIENT_IP_HEADER]) return String(req.headers[CLIENT_IP_HEADER]).split(',')[0].trim();
  if (!TRUST_PROXY) return sock;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff.length >= TRUST_PROXY ? xff[xff.length - TRUST_PROXY] : sock;
}
const buckets = new Map();
/* perMin requests a minute from one internet address. `extra` narrows the bucket (one plate, one notice), so a crowd sharing
   one address (venue Wi-Fi, a phone carrier) isn't limited as if it were one person. */
function limited(req, key, perMin, extra) {
  if (buckets.size > 100000) buckets.clear();
  const k = key + ':' + clientIp(req) + (extra ? ':' + extra : ''), t = Date.now(); const b = buckets.get(k) || { n: 0, t };
  if (t - b.t > 60000) { b.n = 0; b.t = t; } b.n++; buckets.set(k, b); return b.n > perMin;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t - b.t > 120000) buckets.delete(k); for (const [k, c] of cardTries) if (t - c.t > 15 * 60000) cardTries.delete(k); }, 60000).unref();
/* Card testing (someone trying stolen cards one after another) shows up as many declines from one address. A crowd paying
   on shared Wi-Fi has a few declines among many good payments, so card payments from an address stop for 15 minutes only
   when at least 10 cards were declined there and they were most of its attempts. */
const cardTries = new Map();
const cardKey = req => clientIp(req);
function cardBlocked(req) { const c = cardTries.get(cardKey(req)); return !!(c && Date.now() - c.t < 15 * 60000 && c.bad >= 10 && c.bad / c.n >= 0.5); }
function cardTried(req, declined) {
  const k = cardKey(req), t = Date.now(); let c = cardTries.get(k); if (!c || t - c.t > 15 * 60000) c = { t, n: 0, bad: 0 };
  c.n++; if (declined) c.bad++; cardTries.set(k, c); if (cardTries.size > 20000) cardTries.delete(cardTries.keys().next().value);
}
let idxCache = { m: 0, name: null, buf: null };
/* The page carries the organization's name (browser tab, home-screen name, top bar) from the first byte, so drivers
   never see the product name flash by before the data loads. */
const INDEX = () => {
  const f = here('public', 'index.html'), m = fs.statSync(f).mtimeMs, name = String(cfg().campusName || '').trim();
  if (idxCache.m !== m || idxCache.name !== name) {
    let html = fs.readFileSync(f, 'utf8');
    if (name) { const e = escH(name); html = html.replace('<title>ParkOps</title>', `<title>${e}</title>`).replace('name="apple-mobile-web-app-title" content="ParkOps"', `name="apple-mobile-web-app-title" content="${e}"`).replace('<b id="campusName">ParkOps</b>', `<b id="campusName">${e}</b>`); }
    const buf = Buffer.from(html, 'utf8'); idxCache = { m, name, buf, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"' };
  }
  return idxCache.buf;
};
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (Math.round((+n || 0) * 100) / 100).toFixed(2);
const orgName = () => cfg().campusName || 'Parking';
function stream(res, file, type, extra) {
  const s = fs.createReadStream(file);
  s.on('error', () => { if (!res.headersSent) fail(res, 404, 'File not found', 'not_found'); else res.destroy(); });
  s.once('open', () => { res.writeHead(200, headers(Object.assign({ 'Content-Type': type }, extra))); s.pipe(res); });
}
const LOGIN = err => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staff sign in</title>
<style>:root{--bg:#f1f4f8;--s:#fff;--fg:#121926;--m:#586475;--l:#d3dbe6;--a:#1a56cc;--bad:#bf3328}@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--s:#151b24;--fg:#e6ebf2;--m:#94a0b1;--l:#2a3442;--a:#5c8ff2;--bad:#ef6d62}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;padding:16px;box-sizing:border-box}
form{background:var(--s);border:1px solid var(--l);border-radius:10px;padding:24px;width:min(360px,100%);display:grid;gap:12px;box-sizing:border-box}h1{margin:0;font-size:1.4rem}
label{font-size:.8rem;font-weight:600;color:var(--m)}input,button{font:inherit;padding:10px;border-radius:6px;border:1px solid var(--l);background:var(--bg);color:var(--fg)}button{background:var(--a);border-color:var(--a);color:#fff;font-weight:600;cursor:pointer}.e{color:var(--bad);font-size:.9rem}a{color:var(--a);font-size:.9rem}</style></head>
<body><form method="post" action="/login"><h1>Staff sign in</h1>${cfg().campusName ? `<p style="margin:0;color:var(--m)">${escH(cfg().campusName)}</p>` : ''}${err ? `<div class="e">${escH(err)}</div>` : ''}<label for="em">Email</label><input id="em" name="email" autocomplete="username" required autofocus>
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required><button>Sign in</button><a href="/">Driver portal</a><p style="margin:4px 0 0;color:var(--m);font-size:.75rem;text-align:center">Powered by Avid Parking Systems</p></form></body></html>`;
const WELCOME = (u, err, token) => LOGIN(err).replace('<title>Staff sign in</title>', '<title>Welcome</title>').replace(/<form[\s\S]*<\/form>/, u
  ? `<form method="post" action="/staff/welcome"><h1>Welcome, ${escH(u.name.split(' ')[0])}</h1><p style="margin:0;color:var(--m)">You’re ${escH(Rules.ROLE_NAMES[Rules.canonRole(u.role)] || u.role)} on ${escH(orgName())} parking operations. Choose a password to finish.</p>${err ? `<div class="e">${escH(err)}</div>` : ''}<input type="hidden" name="token" value="${escH(token || '')}"><label for="em">Email</label><input id="em" value="${escH(u.email)}" disabled>
<label for="pw">Password (10+ characters)</label><input id="pw" name="password" type="password" autocomplete="new-password" required autofocus minlength="10"><button>Save and sign in</button></form>`
  : `<form><h1>Invitation</h1><div class="e">${escH(err || '')}</div><a href="/login">Staff sign in</a></form>`);

/* ---------- identity ---------- */
function staffFromToken(tok) {
  const uid = auth.session('staff', tok); if (!uid) return null;
  const u = store.get('SELECT id, email, name, role, active FROM users WHERE id=?', uid);
  return u && u.active ? u : null;
}
const staffOf = req => staffFromToken(cookie(req, 'po_staff'));
function accountOf(req) { const id = auth.session('acct', cookie(req, 'po_acct')); return id ? store.get('SELECT * FROM accounts WHERE id=?', id) : null; }
const acctPlates = a => { try { return JSON.parse(a.plates || '[]'); } catch (e) { return []; } };
const plateAdded = a => { try { return JSON.parse(a.plate_added || '{}'); } catch (e) { return {}; } };
const accountView = a => a && ({ id: a.id, name: a.name, email: a.email, phone: a.phone || '', plates: acctPlates(a), autopay: !!a.autopay, card: a.sq_card ? { brand: a.card_brand, last4: a.card_last4, exp: a.card_exp } : null });
const actorOf = u => u ? `${u.name} <${u.email}>` : 'system';
/* Accounts that held this plate at time t. A plate added later can't see or be billed for earlier visits. */
const accountsForPlate = (pl, t) => store.all("SELECT * FROM accounts WHERE plates LIKE ?", '%"' + pl + '"%').filter(a => acctPlates(a).includes(pl) && (plateAdded(a)[pl] || a.created_at) <= (t || Date.now()));
async function syncMember(a) {
  const id = 'acct-' + a.id, want = a.autopay && a.sq_card && acctPlates(a).length;
  if (want) await commit([{ type: 'set', coll: 'members', id, data: { name: a.name, email: a.email, plates: acctPlates(a), card: a.card_last4 || '', accountId: a.id, createdAt: a.created_at } }]);
  else if (getDoc('members', id)) await commit([{ type: 'delete', coll: 'members', id }]);
}
const billingOf = owner => store.get('SELECT * FROM billing WHERE owner=?', owner);

/* ---------- payments ---------- */
function recordPayment(r) {
  try {
    const id = 'pay_' + crypto.randomBytes(8).toString('hex');
    store.run('INSERT INTO payments (id, sq_id, kind, ref, plate, amount_cents, status, account_id, card_last4, receipt_url, note, created_at, idem, net_cents, tax_cents, method, staff, ticket, facility_id, session_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, r.sqId || null, r.kind, r.ref || null, r.plate || null, Math.round(r.total * 100), r.status, r.accountId || null, r.last4 || null, r.receiptUrl || null, r.note || null, Date.now(), r.idem || null, Math.round((r.net ?? r.total) * 100), Math.round((r.tax || 0) * 100),
      r.method || (r.kind === 'autopay' ? 'autopay' : r.sqId ? 'online' : null), r.staff || null, r.ticket || null, r.facilityId || null, r.sessionId || null);
    return id;
  } catch (e) {
    console.error('PAYMENT TAKEN BUT NOT RECORDED', r.sqId, r.total, e.message);
    alertOnce('record:' + r.sqId, 1, 'Payment taken but not recorded: ' + r.sqId, `Square payment ${r.sqId} for ${money(r.total)} (${r.kind} ${r.ref || ''}) succeeded but couldn’t be saved: ${e.message}. Check disk space.`);
    return null;
  }
}
/* Charges the price plus tax (or the tax-included price). Idempotency keys make retries safe: a repeat with the
   same key returns the first result instead of charging again. */
async function takePayment(chargeInfo, payment, account, email) {
  if (!chargeInfo || !(chargeInfo.amount > 0)) return null;
  payment = payment || {};
  const idem = payment.idempotencyKey ? String(payment.idempotencyKey).replace(/[^\w-]/g, '').slice(0, 44) : null;
  if (idem) {
    const prev = store.get("SELECT * FROM payments WHERE idem=? AND status IN ('COMPLETED','APPROVED')", idem);
    if (prev) { // a retry of the same charge returns the first result; the same key for a different charge is refused
      if (account && prev.account_id && prev.account_id !== account.id) throw new square.SquareError('That payment reference belongs to another account. Refresh the page and try again.', 'IDEMPOTENCY');
      return { id: prev.sq_id, receiptUrl: prev.receipt_url, last4: prev.card_last4, total: prev.amount_cents / 100, tax: (prev.tax_cents || 0) / 100, repeat: true };
    }
  }
  let sourceId, customerId, verificationToken;
  if (payment.savedCard) {
    if (!account || !account.sq_card) throw new square.SquareError('There’s no saved card on your account.', 'NO_CARD');
    sourceId = account.sq_card; customerId = account.sq_customer;
  } else {
    sourceId = payment.sourceId; verificationToken = payment.verificationToken;
    if (!sourceId) throw new square.SquareError('Enter your card details to pay.', 'NO_SOURCE');
    if (account && account.sq_customer) customerId = account.sq_customer;
  }
  const t = R.taxOf(chargeInfo.amount);
  const p = await square.charge({ sourceId, customerId, verificationToken, amount: t.total, idempotencyKey: idem, referenceId: `${chargeInfo.kind}:${chargeInfo.ref || ''}`, note: `${orgName()} ${chargeInfo.kind} ${chargeInfo.ref || ''}${t.tax ? ` (incl. ${money(t.tax)} tax)` : ''}`, buyerEmail: email || (account && account.email) });
  recordPayment({ sqId: p.id, kind: chargeInfo.kind, ref: chargeInfo.ref, plate: chargeInfo.plate, total: t.total, net: t.net, tax: t.tax, status: p.status, accountId: account && account.id, last4: p.last4, receiptUrl: p.receiptUrl, idem,
    method: chargeInfo.method || (payment.savedCard ? 'autopay' : 'online'), staff: chargeInfo.staff, ticket: chargeInfo.ticket, facilityId: chargeInfo.facilityId, sessionId: chargeInfo.sessionId });
  return Object.assign(p, { total: t.total, tax: t.tax });
}
const taxLine = amount => { const t = R.taxOf(amount); return t.tax ? ` (includes ${money(t.tax)} sales tax)` : ''; };

async function runAutopay(info, plate) {
  const keys = info.items.map(i => 's:' + i.sessionId);
  return withLocks(keys, async () => {
    const m = S.members.find(x => x.id === info.memberId);
    const a = m && m.accountId ? store.get('SELECT * FROM accounts WHERE id=?', m.accountId) : null;
    const items = info.items.map(it => { const s = S.sessions.find(x => x.id === it.sessionId); return s && { id: s.id, amount: info.idem ? +it.amount : R.balanceOf(s) }; }).filter(x => x && x.amount > 0);
    const total = Math.round(items.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    if (!(total > 0)) return;
    const log = (level, text) => commit([{ type: 'log', data: { at: Date.now(), plate, facilityId: null, dir: 'out', level, text } }]);
    if (!a || !a.sq_card) { await log('bad', `Autopay for ${plate} failed: no card on file. ${money(total)} owed.`); return; }
    // A retry after a network error reuses the first attempt's key and items, so Square never charges twice.
    const idem = info.idem || ('auto-' + crypto.createHash('sha256').update(items.map(i => i.id + ':' + i.amount).join('|')).digest('hex').slice(0, 32));
    let p;
    try { p = await takePayment({ amount: total, kind: 'autopay', ref: plate, plate }, { savedCard: true, idempotencyKey: idem }, a); }
    catch (e) {
      if (e.code === 'NETWORK') {
        await commit(items.map(i => ({ type: 'update', coll: 'sessions', id: i.id, data: { autopayRetryAt: Date.now() + 10 * M, autopayAttempts: ((getDoc('sessions', i.id) || {}).autopayAttempts || 0) + 1, autopayMember: info.memberId, autopayIdem: idem, autopayItems: items.map(x => ({ sessionId: x.id, amount: x.amount })) } })));
        await log('warn', `Autopay for ${plate} will retry: ${e.message}`); return;
      }
      await log('bad', `Card declined for ${plate}: ${e.message} ${money(total)} owed.`);
      mailer.send({ bulk: true, to: a.email, subject: 'Action needed: parking payment declined', text: `Hi ${a.name},\n\nWe couldn’t charge your card ending ${a.card_last4} for ${money(total)} of parking (${plate}): ${e.message}\n\nUpdate your card and pay here: ${BASE}/?account=1\n\n${orgName()}` });
      if (a.phone) sms.send(a.phone, `${orgName()}: your card was declined for ${money(total)} parking (${plate}). Update it: ${BASE}/?account=1`, { bulk: true });
      return;
    }
    const t = Date.now();
    try { await commit(items.map(i => ({ type: 'update', coll: 'sessions', id: i.id, newPayments: [{ amount: i.amount, at: t, method: 'autopay', pid: p.id }], data: { autopayRetryAt: null, autopayIdem: null, autopayItems: null } }))); }
    catch (e) { console.error('autopay commit failed', e); }
    mailer.send({ bulk: true, to: a.email, subject: `Receipt: ${money(p.total)} parking charge`, text: `Hi ${a.name},\n\nWe charged ${money(p.total)}${taxLine(total)} to your card ending ${a.card_last4} for parking (${plate}).${p.receiptUrl ? '\n\nReceipt: ' + p.receiptUrl : ''}\n\n${orgName()}` });
  });
}

/* ---------- exit desk: Square Terminal and card on file ----------
   Prices are stored tax-included by default. When Settings says prices are before tax, the card is charged price plus
   tax and only the price is applied to the ticket. */
const round2 = n => Math.round((+n || 0) * 100) / 100;
function taxFromTotal(total) {
  const c = cfg(), rate = +c.taxRate || 0;
  if (c.taxIncluded === false && rate > 0) { const net = round2(total / (1 + rate / 100)); return { total: round2(total), net, tax: round2(total - net), rate }; }
  return R.taxOf(total);
}
/* A card payment that already happened is always put on the ticket, even if the balance moved while the driver was
   tapping (a validation applied meanwhile): the money is recorded and any excess is flagged for a refund. */
async function applyCardPayment(s, amt, method, pid, staffName, closeTicket, note, actor, fullBalance) {
  const cur = S.sessions.find(x => x.id === s.id) || s;
  const due = Math.max(R.balanceOf(cur), R.entryDue(cur)), t = Date.now();
  let r = due > 0.004 ? R.TICKET.pay(cur, { amount: Math.min(amt, due), method, pid, by: staffName, close: closeTicket, note, quoted: fullBalance === false ? null : amt }) : null;
  if (!r || r.error) {
    const payment = { amount: amt, at: t, method, by: staffName, note: (note ? note + ' · ' : '') + 'received after the balance was cleared; refund if it is not owed', pid };
    r = { ops: [{ type: 'update', coll: 'sessions', id: cur.id, data: { payments: (cur.payments || []).concat([payment]), history: R.histAdd(cur, { action: 'payment', by: staffName, detail: money(amt) + ' ' + method + ' · received after the balance was cleared, check for a refund' }) } }], amount: amt, change: null, closed: false, overpaid: amt };
  } else if (amt > due + 0.004) {
    const pays = r.ops[0].data.payments; pays[pays.length - 1].amount = amt; r.amount = amt; r.overpaid = round2(amt - due);
    r.ops[0].data.history = R.histAdd(Object.assign({}, cur, { history: r.ops[0].data.history }), { action: 'note', by: staffName, detail: 'The card was charged ' + money(amt) + ' but only ' + money(due) + ' was owed by then: refund ' + money(amt - due) });
  }
  normalize(r.ops);
  await commit(r.ops, actor || staffName);
  return r;
}
async function startTerminal(res, s, args, staff) {
  const f = S.facilities.find(x => x.id === s.facilityId);
  const deviceId = String(args.deviceId || (f && f.terminalDeviceId) || process.env.SQUARE_TERMINAL_DEVICE_ID || (!square.live ? 'simulated-terminal' : '')).trim();
  if (!deviceId) return fail(res, 400, 'No Square Terminal is set up for this location. Add its device ID under Locations & rates → Edit.', 'no_device');
  if (R.needsReview(s) || (s.missedExit && !s.missedResolved)) return fail(res, 400, 'Resolve the plate review first.');
  // Event nights: the flat event rate can be charged at the entrance, before anything is owed by the clock.
  const due = Math.max(R.balanceOf(s), R.entryDue(s)); if (!(due > 0)) return fail(res, 400, 'Nothing is owed on this ticket.');
  const amt = args.amount != null && args.amount !== '' ? round2(args.amount) : due;
  if (!(amt > 0) || amt > due + 0.005) return fail(res, 400, `Enter an amount up to ${money(due)}.`);
  const open = store.get("SELECT * FROM terminals WHERE session_id=? AND status IN ('PENDING','IN_PROGRESS') AND applied=0 ORDER BY created_at DESC", s.id);
  if (open && Date.now() - open.created_at < 10 * M) return send(res, 200, { checkoutId: open.id, status: open.status, amount: open.amount_cents / 100, existing: true });
  const total = R.taxOf(amt).total, n = store.get('SELECT COUNT(*) AS n FROM terminals WHERE session_id=?', s.id).n;
  if (total < 1) return fail(res, 400, 'Square Terminal takes $1.00 or more. Take amounts under a dollar in cash.');
  let c;
  try { c = await square.createTerminalCheckout({ amount: total, deviceId, referenceId: R.ticketOf(s), note: `${orgName()} parking ${R.ticketOf(s)} ${s.plate}`, idempotencyKey: `tc-${s.id}-${n}-${Math.round(total * 100)}` }); }
  catch (e) { return fail(res, e.code === 'NETWORK' ? 503 : 400, e.message, e.code === 'NETWORK' ? 'network' : 'payment_failed'); }
  store.run('INSERT OR IGNORE INTO terminals (id, session_id, device_id, amount_cents, status, close_ticket, staff, created_at, updated_at, full_balance) VALUES (?,?,?,?,?,?,?,?,?,?)', c.id, s.id, deviceId, Math.round(total * 100), c.status, args.close ? 1 : 0, staff.name, Date.now(), Date.now(), Math.abs(amt - due) < 0.005 ? 1 : 0);
  store.audit(actorOf(staff), 'terminal_start', 'sessions', s.id, { checkout: c.id, amount: total, device: deviceId });
  return send(res, 200, { checkoutId: c.id, status: c.status, amount: total, simulated: !square.live });
}
async function pollTerminal(res, row, staff) {
  const cur = store.get('SELECT * FROM terminals WHERE id=?', row.id);
  if (cur.applied) { const s0 = S.sessions.find(x => x.id === cur.session_id); return send(res, 200, { status: 'COMPLETED', applied: true, amount: cur.amount_cents / 100, paymentId: cur.payment_id, closed: !!(s0 && s0.endAt) }); }
  let c; try { c = await square.getTerminalCheckout(cur.id); } catch (e) { return fail(res, e.code === 'NETWORK' ? 503 : 400, e.message, e.code === 'NETWORK' ? 'network' : 'payment_failed'); }
  if (c.status !== cur.status) store.run('UPDATE terminals SET status=?, updated_at=? WHERE id=?', c.status, Date.now(), cur.id);
  if (c.status !== 'COMPLETED') return send(res, 200, { status: c.status, applied: false, amount: cur.amount_cents / 100, cancelReason: c.cancelReason || null });
  const pid = (c.paymentIds || [])[0] || null;
  let pay = { receiptUrl: null, last4: null }; try { if (pid) pay = await square.getPayment(pid); } catch (e) { /* receipt details are optional */ }
  const s = S.sessions.find(x => x.id === cur.session_id), total = cur.amount_cents / 100, tx = taxFromTotal(total);
  recordPayment({ sqId: pid, kind: 'ticket', ref: s ? R.ticketOf(s) : cur.session_id, plate: s && s.plate, total, net: tx.net, tax: tx.tax, status: 'COMPLETED', last4: pay.last4, receiptUrl: pay.receiptUrl, method: 'terminal', staff: cur.staff, ticket: s && R.ticketOf(s), facilityId: s && s.facilityId, sessionId: cur.session_id, idem: 'tc:' + cur.id });
  store.run('UPDATE terminals SET applied=1, payment_id=?, status=?, updated_at=? WHERE id=?', pid, 'COMPLETED', Date.now(), cur.id);
  let r = null;
  if (s) r = await applyCardPayment(s, cfg().taxIncluded === false ? tx.net : total, 'terminal', pid, cur.staff || staff.name, !!cur.close_ticket, 'Square Terminal', actorOf(staff), !!cur.full_balance);
  store.audit(actorOf(staff), 'terminal_paid', 'sessions', cur.session_id, { checkout: cur.id, payment: pid, amount: total });
  return send(res, 200, { status: 'COMPLETED', applied: true, amount: total, paymentId: pid, receiptUrl: pay.receiptUrl, closed: !!(r && r.closed), overpaid: (r && r.overpaid) || 0 });
}
async function chargeCardOnFile(res, s, args, staff) {
  const member = (s.memberId && S.members.find(x => x.id === s.memberId)) || R.memberForPlate(Rules.normPlate(s.plate));
  const a = member && member.accountId ? store.get('SELECT * FROM accounts WHERE id=?', member.accountId) : null;
  if (!a || !a.sq_card) return fail(res, 400, 'This plate has no card on file.');
  if (R.needsReview(s) || (s.missedExit && !s.missedResolved)) return fail(res, 400, 'Resolve the plate review first.');
  const due = R.balanceOf(s); if (!(due > 0)) return fail(res, 400, 'Nothing is owed on this ticket.');
  const idem = `desk-${s.id}-${(s.payments || []).length}-${Math.round(due * 100)}`;
  let pay;
  try { pay = await takePayment({ amount: due, kind: 'ticket', ref: R.ticketOf(s), plate: s.plate, method: 'autopay', staff: staff.name, ticket: R.ticketOf(s), facilityId: s.facilityId, sessionId: s.id }, { savedCard: true, idempotencyKey: idem }, a); }
  catch (e) { return fail(res, e.code === 'NETWORK' ? 503 : 400, e.code === 'NETWORK' ? 'Couldn’t reach Square. Wait a moment and try again; the same charge is never taken twice.' : e.message, e.code === 'NETWORK' ? 'network' : 'payment_failed'); }
  if (pay.repeat && (s.payments || []).some(x => x.pid === pay.id)) return send(res, 200, { amount: due, total: pay.total, repeat: true, closed: !!s.endAt });
  const r = await applyCardPayment(s, due, 'autopay', pay.id, staff.name, !!args.close, 'Card on file', actorOf(staff));
  mailer.send({ bulk: true, to: a.email, subject: `Receipt: ${money(pay.total)} parking charge`, text: `Hi ${a.name},\n\nWe charged ${money(pay.total)}${taxLine(due)} to your card ending ${a.card_last4} for parking (${s.plate}, ticket ${R.ticketOf(s)}).${pay.receiptUrl ? '\n\nReceipt: ' + pay.receiptUrl : ''}\n\n${orgName()}` });
  store.audit(actorOf(staff), 'card_on_file', 'sessions', s.id, { payment: pay.id, amount: pay.total });
  return send(res, 200, { amount: due, total: pay.total, closed: !!r.closed, receiptUrl: pay.receiptUrl, change: null, overpaid: r.overpaid || 0 });
}

/* ---------- alerts ---------- */
const alerted = new Map();
function alertOnce(key, hours, subject, text) {
  const to = cfg().alertEmail; if (!to) { console.warn('ALERT', subject); return; }
  const t = Date.now(); if (alerted.get(key) > t - hours * H) return; alerted.set(key, t);
  if (alerted.size > 5000) alerted.clear();
  mailer.send({ to, subject, text });
}

/* ---------- camera webhook ---------- */
const recentCam = new Map();
async function handleCamera(req, res, token, query) {
  const cam = S.cameras.find(c => c.token && c.token === token);
  if (!cam) { req.resume(); return fail(res, 404, 'Unknown camera URL', 'not_found'); }
  let body = Buffer.alloc(0);
  try { if (req.method !== 'GET') body = await readBody(req); } catch (e) { return fail(res, 413, 'Payload too large'); }
  const parsed = parseRead(query, req.headers['content-type'], body);
  if (parsed.ignore) {
    // Keep what the camera sent (images cut out) so the Connect screen can show why it was not a plate read.
    const q = Object.keys(query || {}).length ? '?' + new URLSearchParams(query).toString() : '';
    const sample = (req.method + ' ' + (req.headers['content-type'] || '') + ' ' + q + '\n' + body.toString('utf8').replace(/[A-Za-z0-9+/=\r\n]{200,}/g, '<image data>')).slice(0, 800);
    await commit([{ type: 'update', coll: 'cameras', id: cam.id, data: { lastEventAt: Date.now(), lastIgnored: String(parsed.ignore).slice(0, 80), lastSample: sample } }]);
    return send(res, 200, { ok: true, ignored: parsed.ignore });
  }
  const t = Date.now(), pl = Rules.normPlate(parsed.plate), unread = /^(|UNKNOWN|NOPLATE|NOREAD|NONE|0+)$/.test(pl), key = cam.id + ':' + pl;
  if (!unread && recentCam.has(key) && t - recentCam.get(key) < 15000) return send(res, 200, { ok: true, ignored: 'duplicate within 15s' });
  recentCam.set(key, t); if (recentCam.size > 5000) for (const [k, v] of recentCam) if (t - v > 60000) recentCam.delete(k);
  let photoId = null;
  try { const imgs = photos.fromCameraEvent(body, req.headers['content-type']); if (imgs.length) photoId = photos.save(imgs[0].data, { kind: 'lpr', plate: pl, cameraId: cam.id }); } catch (e) { console.error('photo save failed', e.message); }
  const r = R.planRead({ plate: parsed.plate, cameraId: cam.id, at: t, confidence: parsed.confidence, photoId });
  if (r.error) return fail(res, 400, r.error);
  await commit(r.ops);
  send(res, 200, { ok: true, result: r.result.text });
  afterRead(r.result, cam);
}
function afterRead(result, cam) {
  if (result.charge) runAutopay(result.charge, (getDoc('sessions', result.charge.items[0].sessionId) || {}).plate).catch(e => console.error('autopay', e));
  if (result.hot) { const f = S.facilities.find(x => x.id === cam.facilityId); alertOnce('hot:' + result.hot.plate, 12, `Hot list vehicle ${result.hot.plate} entered ${f ? f.name : ''}`, `${result.hot.plate} owes ${money(result.hot.total)} and just entered ${f ? f.name : 'a facility'} through ${cam.name}.\n\nOpen the officer view: ${BASE}/`); }
}

/* ---------- monthly billing ---------- */
const periodLabel = period => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
/* The same group, the same permits and the same amount always give the same key, so a retry after a crash is recognised by Square; a different set of parkers is a different charge. */
const chargeKey = (prefix, items, base) => prefix + '-' + crypto.createHash('sha1').update(items.map(d => d.permit.id).sort().join(',') + '|' + base).digest('hex').slice(0, 10);
async function billMonthly() {
  const due = R.planMonthlyDue().filter(d => d.permit.invoicedPeriod !== d.period && (!d.permit.lastBillAttempt || Date.now() - d.permit.lastBillAttempt > 44 * H));
  if (!due.length) return 0;
  const groups = new Map();
  for (const d of due) { const k = d.permit.companyId ? 'co:' + d.permit.companyId : d.permit.accountId ? 'acct:' + d.permit.accountId : 'none:' + d.permit.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  let n = 0;
  /* Several cards are charged at once (BILLING_CONCURRENCY, default 4) so thousands of parkers finish in minutes, not hours. */
  const entries = [...groups.entries()]; let next = 0;
  /* Another run (the timer, the Run billing button) may have billed some of these while this one waited for its turn: look again inside the lock. */
  const stillDue = d => { const cur = S.permits.find(x => x.id === d.permit.id); return !!cur && cur.invoicedPeriod !== d.period && cur.paidThrough === d.permit.paidThrough && (!cur.lastBillAttempt || Date.now() - cur.lastBillAttempt > 44 * H); };
  const worker = async () => { while (next < entries.length) { const [k, items0] = entries[next++]; let items = items0;
    await withLocks(items0.map(d => 'p:' + d.permit.id), async () => {
      items = items0.filter(stillDue); if (!items.length) return;
      const period = items[0].period, periodEnd = items[0].periodEnd;
      const lines = [];
      items.forEach(d => { const p = d.permit; lines.push({ name: `${p.holder} · ${d.plan.name} · ${(p.plates || []).join(', ')} · ${periodLabel(period)}`, amount: +d.plan.price }); if (+p.prorateDue) lines.push({ name: `${p.holder} · first partial month`, amount: +p.prorateDue }); if (+p.lateFeeDue) lines.push({ name: `${p.holder} · late fee`, amount: +p.lateFeeDue }); });
      const base = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
      const ok = async payId => commit(items.map(d => ({ type: 'update', coll: 'permits', id: d.permit.id, data: { paidThrough: periodEnd, lastPaymentId: payId, lateFeeDue: 0, prorateDue: 0, pastDueSince: null, billAttempts: 0, lastBillAttempt: Date.now(), status: 'active' } })), 'billing');
      const failed = async (reason, to, phone) => {
        const g = (+cfg().monthlyGraceDays || 5) * D, late = +cfg().monthlyLateFee || 25;
        await commit(items.map(d => { const p = d.permit, since = p.pastDueSince || Date.now(), suspend = Date.now() - since > g;
          return { type: 'update', coll: 'permits', id: p.id, data: Object.assign({ pastDueSince: since, lastBillAttempt: Date.now(), billAttempts: (p.billAttempts || 0) + 1 }, suspend && p.status !== 'suspended' ? { status: 'suspended', suspendedAt: Date.now(), lateFeeDue: late } : {}) }; }), 'billing');
        if (to) mailer.send({ bulk: true, to, subject: 'Monthly parking payment failed', text: `We couldn’t charge ${money(R.taxOf(base).total)} for ${periodLabel(period)} monthly parking: ${reason}\n\nUpdate your card and pay: ${BASE}/?account=1\n\nParking is suspended if it isn’t paid within ${cfg().monthlyGraceDays || 5} days.\n\n${orgName()}` });
        if (phone) sms.send(phone, `${orgName()}: monthly parking payment failed. Update your card: ${BASE}/?account=1`, { bulk: true });
      };
      if (k.startsWith('co:')) {
        const co = S.companies.find(c => c.id === k.slice(3)); if (!co) return;
        if (co.billing === 'invoice') {
          const bp = billingOf('co:' + co.id); let cust = bp && bp.sq_customer;
          try {
            if (!cust) { cust = await square.createCustomer({ email: co.email, name: co.contactName || co.name, companyName: co.name, referenceId: co.id }); store.run('INSERT INTO billing (owner, sq_customer, updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET sq_customer=excluded.sq_customer', 'co:' + co.id, cust, Date.now()); }
            const tx = R.taxOf(base), invLines = cfg().taxIncluded === false && tx.tax ? lines.concat([{ name: `Sales tax ${tx.rate}%`, amount: tx.tax }]) : lines;
            const dueDate = new Date(Date.now() + (+cfg().invoiceDueDays || 5) * D).toISOString().slice(0, 10);
            const inv = await square.createInvoice({ customerId: cust, lines: invLines, dueDate, title: `${orgName()} monthly parking · ${periodLabel(period)}`, description: `${items.length} parker${items.length > 1 ? 's' : ''}${tx.tax ? `. Includes ${money(tx.tax)} sales tax.` : ''}`, number: `${co.id.slice(-6)}-${period}`, idempotencyKey: `inv-${co.id}-${period}` });
            const invId = R.uid('i');
            await commit([{ type: 'set', coll: 'invoices', id: invId, data: { companyId: co.id, companyName: co.name, period, periodEnd, amount: tx.total, tax: tx.tax, sqInvoiceId: inv.id, status: inv.status, publicUrl: inv.publicUrl, dueDate, permitIds: items.map(d => d.permit.id), createdAt: Date.now() } }]
              .concat(items.map(d => ({ type: 'update', coll: 'permits', id: d.permit.id, data: { invoicedPeriod: period, invoiceId: invId, lastBillAttempt: Date.now() } }))), 'billing');
            if (inv.simulated) mailer.send({ bulk: true, to: co.email, subject: `Invoice: ${orgName()} monthly parking ${periodLabel(period)}`, text: `Amount due: ${money(tx.total)} by ${dueDate}.\n\n(Test mode: Square isn’t connected, so this invoice is a placeholder.)` });
            n++;
          } catch (e) { console.error('invoice failed', co.name, e.message); alertOnce('inv:' + co.id + period, 24, `Invoice failed for ${co.name}`, e.message); await commit(items.map(d => ({ type: 'update', coll: 'permits', id: d.permit.id, data: { lastBillAttempt: Date.now() } }))); }
          return;
        }
        const bp = billingOf('co:' + co.id);
        if (!bp || !bp.sq_card) return failed('No card on file for the company.', co.email, co.phone);
        let p; try { p = await takePayment({ amount: base, kind: 'monthly', ref: `${co.name} ${period}` }, { savedCard: true, idempotencyKey: chargeKey('mo-' + co.id + '-' + period, items, base) }, { sq_card: bp.sq_card, sq_customer: bp.sq_customer, email: co.email }); }
        catch (e) { if (e.code !== 'NETWORK') await failed(e.message, co.email, co.phone); return; }
        /* The card was charged. If recording it fails, never tell the customer the charge failed: the next run asks Square again with the same key, gets the same payment back and records it. */
        try { await ok(p.id); n++; } catch (e) { console.error('billing: charged but could not record', co.name, e.message); alertOnce('bill-rec:' + k + period, 24, 'A monthly charge went through but was not recorded', `${co.name} ${period}: the card was charged ${money(p.total)} but saving the result failed (${e.message}). The next billing run records it without charging again.`); return; }
        mailer.send({ bulk: true, to: co.email, subject: `Receipt: monthly parking ${periodLabel(period)}`, text: `We charged ${money(p.total)}${taxLine(base)} to the company card ending ${bp.last4} for ${items.length} parker(s).${p.receiptUrl ? '\n\nReceipt: ' + p.receiptUrl : ''}\n\n${orgName()}` });
        return;
      }
      if (k.startsWith('acct:')) {
        const a = store.get('SELECT * FROM accounts WHERE id=?', k.slice(5));
        if (!a || !a.sq_card) return failed('No card on file.', a ? a.email : items[0].permit.email, a && a.phone);
        let p; try { p = await takePayment({ amount: base, kind: 'monthly', ref: items.map(d => d.permit.number).join(' ') + ' ' + period, plate: (items[0].permit.plates || [])[0] }, { savedCard: true, idempotencyKey: chargeKey('mo-' + a.id + '-' + period, items, base) }, a); }
        catch (e) { if (e.code !== 'NETWORK') await failed(e.message, a.email, a.phone); return; }
        try { await ok(p.id); n++; } catch (e) { console.error('billing: charged but could not record', a.id, e.message); alertOnce('bill-rec:' + k + period, 24, 'A monthly charge went through but was not recorded', `Account ${a.email} ${period}: the card was charged ${money(p.total)} but saving the result failed (${e.message}). The next billing run records it without charging again.`); return; }
        mailer.send({ bulk: true, to: a.email, subject: `Receipt: monthly parking ${periodLabel(period)}`, text: `We charged ${money(p.total)}${taxLine(base)} to your card ending ${a.card_last4}.${p.receiptUrl ? '\n\nReceipt: ' + p.receiptUrl : ''}\n\n${orgName()}` });
        return;
      }
      await failed('No billing account is linked to this monthly parker.', items[0].permit.email, items[0].permit.phone);
    }); } };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, +process.env.BILLING_CONCURRENCY || 4), entries.length) }, worker));
  return n;
}
async function pollInvoices() {
  for (const inv of S.invoices.filter(i => ['UNPAID', 'SCHEDULED', 'PARTIALLY_PAID'].includes(i.status))) {
    let st = null; try { st = await square.getInvoice(inv.sqInvoiceId); } catch (e) { continue; }
    if (st && st.status !== inv.status) await markInvoice(inv, st.status, 'square');
    const cur = S.invoices.find(x => x.id === inv.id), g = (+cfg().monthlyGraceDays || 5) * D;
    if (cur && cur.status !== 'PAID' && Date.parse(cur.dueDate) + g < Date.now() && !cur.suspended) {
      await commit([{ type: 'update', coll: 'invoices', id: cur.id, data: { suspended: true } }].concat((cur.permitIds || []).map(id => ({ type: 'update', coll: 'permits', id, data: { status: 'suspended', suspendedAt: Date.now(), pastDueSince: Date.parse(cur.dueDate), lateFeeDue: +cfg().monthlyLateFee || 25 } }))), 'billing');
      const co = S.companies.find(c => c.id === cur.companyId); if (co) mailer.send({ bulk: true, to: co.email, subject: 'Monthly parking suspended: invoice past due', text: `The invoice for ${periodLabel(cur.period)} (${money(cur.amount)}) is past due, so monthly parking for your employees is suspended until it’s paid.${cur.publicUrl ? '\n\nPay: ' + cur.publicUrl : ''}\n\n${orgName()}` });
    }
  }
}
async function markInvoice(inv, status, actor) {
  const ops = [{ type: 'update', coll: 'invoices', id: inv.id, data: { status, paidAt: status === 'PAID' ? Date.now() : null } }];
  if (status === 'PAID') (inv.permitIds || []).forEach(id => ops.push({ type: 'update', coll: 'permits', id, data: { paidThrough: inv.periodEnd, status: 'active', pastDueSince: null, lateFeeDue: 0, prorateDue: 0, invoicedPeriod: null } }));
  await commit(ops, actor);
}

/* ---------- background jobs ---------- */
function noticeText(n) {
  const s = n.session, f = S.facilities.find(x => x.id === s.facilityId), where = f ? f.name : 'our garage';
  const pay = `${BASE}/?plate=${encodeURIComponent(s.plate)}`;
  if (n.type === 'unpaid') return [`Payment due: ${money(n.balance)} for parking at ${where}`, `Your vehicle ${s.plate} left ${where} without paying ${money(n.balance)}.\n\nPay online: ${pay}\n\nPlease pay within ${cfg().unpaidGraceHours || 48} hours to avoid a late fee.`];
  if (n.type === 'reminder') return [`Reminder: ${money(n.balance)} parking balance`, `This is a reminder that ${money(n.balance)} is still owed for ${s.plate} at ${where}.\n\nPay online: ${pay}`];
  if (n.type === 'pastdue') return [`Past due: ${money(n.balance)} parking balance`, `The parking balance for ${s.plate} at ${where} is past due and now ${money(n.balance)} including the late fee.\n\nPay online: ${pay}`];
  return [`Parking citation issued for ${s.plate}`, `An unpaid parking balance for ${s.plate} at ${where} has been turned into a citation.\n\nPay or appeal online: ${pay}`];
}
async function collectionsRun() {
  const ns = R.planNoShows(); if (ns.length) await commit(ns, 'system');
  const c = R.planCollections(); if (c.ops.length) await commit(c.ops, 'system');
  for (const n of c.notices) {
    const pl = Rules.normPlate(n.session.plate), accts = accountsForPlate(pl, n.session.endAt || n.session.startAt);
    const emails = new Set(accts.map(a => a.email)), phones = new Set(accts.map(a => a.phone).filter(Boolean));
    const rv = n.session.reservationId && S.reservations.find(r => r.id === n.session.reservationId); if (rv) emails.add(rv.email);
    if (n.session.smsOptIn && n.session.phone) phones.add(n.session.phone);
    const [subject, text] = noticeText(n);
    // Queued, not awaited: the paced queue sends them in order, and billing below must not wait for thousands of notices.
    for (const to of emails) mailer.send({ bulk: true, to, subject, text: text + `\n\n${orgName()}` }).catch(() => {});
    for (const ph of phones) sms.send(ph, `${orgName()}: ${subject}. Pay: ${BASE}/?plate=${encodeURIComponent(pl)}`, { bulk: true }).catch(() => {});
  }
  const retry = S.sessions.filter(s => s.autopayRetryAt && s.autopayRetryAt <= Date.now() && (s.autopayAttempts || 0) < 6 && R.balanceOf(s) > 0 && s.autopayMember), seen = new Set();
  for (const s of retry) { if (s.autopayIdem && seen.has(s.autopayIdem)) continue; if (s.autopayIdem) seen.add(s.autopayIdem); await runAutopay({ memberId: s.autopayMember, idem: s.autopayIdem || null, items: s.autopayIdem && s.autopayItems ? s.autopayItems : [{ sessionId: s.id, amount: R.balanceOf(s) }] }, s.plate).catch(e => console.error(e)); }
  const quiet = +cfg().cameraQuietMinutes || 60, tz = cfg().timeZone || 'America/Chicago';
  const hour = +new Date().toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz });
  const start = cfg().opsStartHour ?? 6, end = cfg().opsEndHour ?? 22;
  if (hour >= +start && hour < +end) for (const cam of S.cameras) {
    const last = Math.max(cam.lastReadAt || 0, cam.lastEventAt || 0, cam.createdAt || 0);
    if (Date.now() - last > quiet * M) alertOnce('cam:' + cam.id, 6, `Camera quiet: ${cam.name}`, `${cam.name} hasn’t sent a plate read or heartbeat in ${Math.round((Date.now() - last) / M)} minutes. Check its power and network connection.`);
  }
  await billMonthly().catch(e => console.error('billing', e));
  await pollInvoices().catch(e => console.error('invoices', e));
}
/* Terminal checkouts the desk stopped watching (closed the dialog, lost the connection) are still settled here. */
async function terminalsRun() {
  // The desk dialog polls its own checkout for the first minute; this picks up whatever it stopped watching.
  const open = store.all("SELECT * FROM terminals WHERE applied=0 AND status IN ('PENDING','IN_PROGRESS','CANCEL_REQUESTED') AND created_at > ? AND created_at < ?", Date.now() - 2 * H, Date.now() - M);
  for (const row of open) {
    await withLocks(['s:' + row.session_id], async () => {
      const cur = store.get('SELECT * FROM terminals WHERE id=?', row.id); if (!cur || cur.applied) return;
      let c; try { c = await square.getTerminalCheckout(cur.id); } catch (e) { return; }
      if (c.status !== cur.status) store.run('UPDATE terminals SET status=?, updated_at=? WHERE id=?', c.status, Date.now(), cur.id);
      if (c.status !== 'COMPLETED') return;
      const pid = (c.paymentIds || [])[0] || null; let pay = { receiptUrl: null, last4: null }; try { if (pid) pay = await square.getPayment(pid); } catch (e) {}
      const s = S.sessions.find(x => x.id === cur.session_id), total = cur.amount_cents / 100, tx = taxFromTotal(total);
      recordPayment({ sqId: pid, kind: 'ticket', ref: s ? R.ticketOf(s) : cur.session_id, plate: s && s.plate, total, net: tx.net, tax: tx.tax, status: 'COMPLETED', last4: pay.last4, receiptUrl: pay.receiptUrl, method: 'terminal', staff: cur.staff, ticket: s && R.ticketOf(s), facilityId: s && s.facilityId, sessionId: cur.session_id, idem: 'tc:' + cur.id });
      store.run('UPDATE terminals SET applied=1, payment_id=?, status=?, updated_at=? WHERE id=?', pid, 'COMPLETED', Date.now(), cur.id);
      if (s) await applyCardPayment(s, cfg().taxIncluded === false ? tx.net : total, 'terminal', pid, cur.staff || 'Square Terminal', !!cur.close_ticket, 'Square Terminal', 'system', !!cur.full_balance);
      store.audit('system', 'terminal_paid', 'sessions', cur.session_id, { checkout: cur.id, payment: pid, amount: total, background: true });
    });
  }
}
/* Text a reminder 15 minutes before prepaid time runs out, with a link to add time. */
async function remindersRun() {
  const t = Date.now();
  for (const s of S.sessions.filter(x => x.mode === 'prepaid' && !x.endAt && x.smsOptIn && x.phone && !x.reminded && x.paidUntil > t && x.paidUntil - t <= 16 * M)) {
    await commit([{ type: 'update', coll: 'sessions', id: s.id, data: { reminded: true } }]);
    const f = S.facilities.find(x => x.id === s.facilityId);
    const at = new Date(s.paidUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: R.tzOf(f) });
    sms.send(s.phone, `${orgName()}: parking for ${s.plate}${f ? ' at ' + f.name : ''} ends at ${at}. Add time: ${BASE}/x/${s.extendToken}`);
  }
}
/* Monthly parker reminders. They go through the paced queue, so thousands can be sent without tripping the email or text limits.
   - a renewal notice monthlyReminderDays (default 5) days before the 1st
   - a warning when the card on file expires before the next charge
   - a follow-up two days after a failed charge, with the date parking will be suspended
   Each one is recorded on the permit only after the provider accepted it, so it is sent once, and a restart simply picks up
   whatever wasn't sent. Company parkers are left alone: the company is billed. Sent between 8 am and 8 pm local time. */
const remindBusy = new Set();
async function monthlyRemindersRun() {
  const c = cfg(), days = c.monthlyReminderDays == null || c.monthlyReminderDays === '' ? 5 : +c.monthlyReminderDays, withSms = c.monthlyReminderSms !== false;
  const t = Date.now(), fast = process.env.JOBS_FAST === '1';
  const hr = +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: c.timeZone || 'America/Chicago' }).format(t);
  if (!fast && (hr < 8 || hr >= 20)) return 0;
  if (!mailer.configured && !sms.configured) return 0; // nothing could be sent: don't fill the outbox with messages that go nowhere
  if (mailer.queue().waiting + sms.queue().waiting > 3000) return 0; // a big batch is still going out
  const acctCache = new Map(), acctOf = id => { if (!id) return null; if (!acctCache.has(id)) acctCache.set(id, store.get('SELECT email, name, phone, card_last4, card_exp FROM accounts WHERE id=?', id) || null); return acctCache.get(id); };
  const planById = new Map(S.permitTypes.map(x => [x.id, x])), facById = new Map(S.facilities.map(x => [x.id, x]));
  let queued = 0; const MAX = 3000, mbMemo = new Map();
  for (const p of S.permits) {
    if (queued >= MAX) break;
    if (p.status !== 'active' || p.billing === 'company' || p.companyId || (p.endAt && p.endAt < t)) continue; // someone else (an account) pays for these
    const plan = planById.get(p.permitTypeId); if (!plan) continue;
    const f = facById.get((plan.facilities || [])[0]) || S.facilities[0]; if (!f) continue;
    let bm = mbMemo.get(f.id); if (!bm) { bm = { mb: R.monthBounds(t, f), tz: R.tzOf(f) }; mbMemo.set(f.id, bm); }
    const mb = bm.mb, tz = bm.tz;
    const a = p.accountId ? acctOf(p.accountId) : null, to = (a && a.email) || p.email || '', phone = (withSms && ((a && a.phone) || p.phone)) || '';
    if (!to && !phone) continue;
    const fmt = x => new Date(x).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: tz });
    const who = p.holder || (a && a.name) || 'there', plates = (p.plates || []).join(', '), amt = money(R.taxOf(R.round2(+plan.price + (+p.lateFeeDue || 0))).total);
    const job = (key, val, subject, text, sms) => {
      const id = p.id + ':' + key; if (remindBusy.has(id)) return;
      if (p[key + 'Tried'] && t - p[key + 'Tried'] < 24 * H) return; // tried a moment ago and nobody could be reached: wait a day before trying again
      remindBusy.add(id); queued++;
      (async () => {
        const r = await Promise.all([to ? mailer.send({ bulk: true, to, subject, text: text + `\n\n${orgName()}` }) : false, phone && sms ? sms_(phone, sms) : false]);
        await commit([{ type: 'update', coll: 'permits', id: p.id, data: r.some(Boolean) ? { [key]: val } : { [key + 'Tried']: Date.now() } }]);
      })().catch(e => console.error('reminder', e.message)).finally(() => remindBusy.delete(id));
    };
    const sms_ = (ph, body) => sms.send(ph, `${orgName()}: ${body}`, { bulk: true });
    const paidThisMonth = p.paidThrough && p.paidThrough >= mb.end - 1;
    if (days > 0 && paidThisMonth && mb.end - t <= days * D && p.renewalNotice !== mb.end && !(p.endAt && p.endAt <= mb.end)) {
      const pay = p.billing === 'office' ? 'Please pay at the parking office on or before that day.' : a && a.card_last4 ? `${amt} will be charged to your card ending ${a.card_last4}. Nothing to do unless you want to change or cancel: ${BASE}/?account=1` : `Pay ${amt} by then: ${BASE}/?account=1`;
      job('renewalNotice', mb.end, `Your monthly parking renews ${fmt(mb.end)}`, `Hi ${who},\n\nYour monthly parking (${plan.name}, #${p.number}${plates ? ', ' + plates : ''}) renews on ${fmt(mb.end)}. ${pay}`, `monthly parking #${p.number} renews ${fmt(mb.end)} (${amt}). ${p.billing === 'office' ? 'Pay at the office.' : a && a.card_last4 ? 'Card ending ' + a.card_last4 + '.' : ''}`);
    }
    if (days > 0 && p.billing !== 'office' && a && a.card_exp && p.cardNotice !== mb.end && mb.end - t <= (days + 10) * D && !(p.endAt && p.endAt <= mb.end)) {
      const m = /^(\d{1,2})\s*\/\s*(\d{2,4})$/.exec(String(a.card_exp));
      if (m) { let y = +m[2]; if (y < 100) y += 2000; if (Date.UTC(y, +m[1], 1) <= mb.end) job('cardNotice', mb.end, 'Your card on file expires before your next monthly parking charge', `Hi ${who},\n\nThe card ending ${a.card_last4} expires ${m[1].padStart(2, '0')}/${y}, before your monthly parking is charged on ${fmt(mb.end)}. Add a new card so parking isn't interrupted: ${BASE}/?account=1`, `card ending ${a.card_last4} expires before ${fmt(mb.end)}. Update it: ${BASE}/?account=1`); }
    }
    if (p.pastDueSince && t - p.pastDueSince >= 2 * D && p.pastDueNotice !== p.pastDueSince) {
      const until = fmt(p.pastDueSince + (+c.monthlyGraceDays || 5) * D);
      job('pastDueNotice', p.pastDueSince, 'Monthly parking payment is past due', `Hi ${who},\n\nWe still haven't been able to collect ${amt} for monthly parking #${p.number}. Pay or update your card by ${until} to keep your space: ${BASE}/?account=1`, `monthly parking #${p.number} is past due (${amt}). Pay by ${until}: ${BASE}/?account=1`);
    }
  }
  return queued;
}
let lastBackup = 0;
/* What is stored and how much room is left. Tickets, plates, payments and the change log are kept forever;
   photos are the only thing that grows fast, so they have their own retention (PHOTO_RETENTION_DAYS). */
function dirBytes(dir) { let n = 0; try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); n += e.isDirectory() ? dirBytes(f) : fs.statSync(f).size; } } catch (e) {} return n; }
function storageInfo() {
  const size = f => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
  let disk = null; try { const st = fs.statfsSync(store.dir); disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch (e) {}
  const t = { n: store.ticketCount(), first: store.firstTicketAt() };
  const ph = store.get('SELECT COUNT(*) AS n, COALESCE(SUM(bytes),0) AS b FROM photos');
  return { database: size(store.file) + size(store.file + '-wal'), backups: dirBytes(path.join(store.dir, 'backups')), photos: ph.b, photoCount: ph.n, photoDays: PHOTO_DAYS,
    tickets: t.n, firstTicketAt: t.first || null, plateReads: store.get('SELECT COUNT(*) AS n FROM reads').n, disk, onScreenDays: +(process.env.KEEP_IN_MEMORY_DAYS || 90), onScreenSince: onScreenSince(), onScreenTickets: S.sessions.filter(s => s.endAt).length };
}
/* Retention in days for an optional cap; unset or 0 means keep forever. */
const retainDays = name => { const v = +process.env[name]; return v > 0 ? v : 0; };
function dailyRun() {
  /* Backups are whole copies of the database on the same disk. With years of tickets, keep fewer copies rather than fill the disk. */
  try {
    const info = storageInfo(), keep = +process.env.BACKUP_KEEP || 7;
    if (info.disk && info.disk.free < info.database * 2.5 + 64e6) store.pruneBackups(1);
    const free = info.disk ? info.disk.free : Infinity;
    if (free < info.database * 1.3 + 32e6) throw new Error('Not enough free disk space for another backup copy. Make the disk bigger in Render (Disks → Edit), then run Download backup from Settings.');
    const f = store.backup(keep); lastBackup = Date.now(); console.log('Backup written', path.basename(f));
  } catch (e) { console.error('Backup failed', e.message); alertOnce('backup', 24, 'ParkOps backup failed', e.message); }
  try {
    const i = storageInfo();
    if (i.disk && (i.disk.free < Math.min(i.disk.total * 0.15, 2e9) || i.disk.free < 200e6)) alertOnce('disk', 72, 'ParkOps storage is almost full', `Only ${Math.round(i.disk.free / 1e6)} MB is free of ${Math.round(i.disk.total / 1e6)} MB. Your tickets and payments are safe, but new data and backups need room. In Render open your parkops service, choose Disks, and make the disk bigger (it can grow, not shrink). Photos use the most space: they are removed after ${i.photoDays} days (PHOTO_RETENTION_DAYS).`);
  } catch (e) { console.error('Storage check failed', e.message); }
  try { let n = 0, k; do { k = photos.cleanup(PHOTO_DAYS); n += k; } while (k >= 5000 && n < 200000); if (n) console.log('Removed', n, 'old photos'); } catch (e) { console.error('Photo cleanup failed', e.message); }
  try {
    const rd = retainDays('RETAIN_READ_DAYS'), ad = retainDays('RETAIN_AUDIT_DAYS');
    if (rd) store.run('DELETE FROM reads WHERE at < ?', Date.now() - rd * D);
    if (ad) store.run('DELETE FROM audit WHERE at < ?', Date.now() - ad * D);
  } catch (e) {}
  try { trimSessions(); } catch (e) { console.error('Trim failed', e.message); }
}
/* Finished tickets leave the screens' memory after KEEP_IN_MEMORY_DAYS, and the oldest go first once more than KEEP_CLOSED_MAX are
   held, so a very busy garage never outgrows a small server. They stay in the database, History and Activity. Open tickets and
   ones that still owe money are always kept. Runs every hour and with the daily job. */
const KEEP_MAX = Math.max(500, +(process.env.KEEP_CLOSED_MAX || 5000));
function trimSessions() {
  let cutoff = Date.now() - (+(process.env.KEEP_IN_MEMORY_DAYS || 90)) * D;
  const closed = []; for (const s of S.sessions) if (s.endAt && !hasDebt(s)) closed.push(s.endAt);
  if (closed.length > KEEP_MAX) { closed.sort((a, b) => b - a); cutoff = Math.max(cutoff, closed[KEEP_MAX - 1]); }
  const before = S.sessions.length;
  S.sessions = S.sessions.filter(s => !s.endAt || s.endAt >= cutoff || hasDebt(s)); rebuildPlateIndex();
  store.since = Math.max(store.since || 0, cutoff);
  return before - S.sessions.length;
}
/* The earliest departure the screens still hold (older tickets: History and Activity). */
function onScreenSince() { return store.since || null; }

/* ---------- activity: arrivals, departures and money for any range of days, from the database ----------
   The screens only hold the most recent tickets, so this is how you look back at any day. Whole past days are counted once and
   remembered for a while; today is always counted fresh. Days follow the organisation's time zone (Settings). */
const tick = () => new Promise(r => setImmediate(r));
/* A real calendar day written YYYY-MM-DD (rejects 2026-02-31, which JavaScript would quietly turn into March 3). */
const calDay = x => { x = String(x || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return false; const t = Date.parse(x + 'T00:00:00Z'); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === x; };
let actLock = Promise.resolve(); const actSerial = fn => (actLock = actLock.then(fn, fn)); // one scan at a time: a second request waits for the first and then finds the days already counted
const actCache = new Map(); // local day start -> { at, facs: { locationId: { a, d, ms, mn, np, npa, pm, h[24] } } }
const actTtl = d => (d.e > Date.now() - H ? 0 : Date.now() - d.e < 3 * D ? 30 * M : 12 * H);
function actDays(fromStr, toStr) {
  const out = []; let t = Date.parse(fromStr + 'T00:00:00Z'); const last = Date.parse(toStr + 'T00:00:00Z');
  for (; t <= last && out.length < 800; t += D) { const str = new Date(t).toISOString().slice(0, 10); out.push({ str, s: R.endOfDate(new Date(t - D).toISOString().slice(0, 10), null), e: R.endOfDate(str, null) }); }
  return out;
}
const actIndex = days => t => { if (!(t >= days[0].s && t < days[days.length - 1].e)) return -1; let lo = 0, hi = days.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (days[mid].s <= t) lo = mid; else hi = mid - 1; } return lo; };
/* The hour (0-23, local) a moment falls in. On days the clocks change, a day isn't 24 hours long, so ask the calendar instead of counting. */
let hourFmt = null, hourFmtTz = '';
function hourOfDay(t, day) {
  if (day.e - day.s === 24 * H) return Math.min(23, Math.max(0, Math.floor((t - day.s) / H)));
  const tz = cfg().timeZone || 'America/Chicago'; if (!hourFmt || hourFmtTz !== tz) { hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }); hourFmtTz = tz; }
  const h = parseInt(hourFmt.format(t), 10); return h >= 0 && h < 24 ? h : 0;
}
async function actFill(days) {
  const need = days.filter(d => { const c = actCache.get(d.s); return !c || Date.now() - c.at > actTtl(d); });
  if (!need.length) return;
  const mk = () => ({ a: 0, d: 0, ms: 0, mn: 0, np: 0, npa: 0, pm: 0, h: new Array(24).fill(0) });
  const agg = new Map(need.map(d => [d.s, { facs: {}, pay: {} }])), idx = actIndex(days);
  const bucket = (t, f) => { const i = idx(+t); if (i < 0) return null; const d = days[i], m = agg.get(d.s); if (!m) return null; const k = f || ''; return { day: d, b: m.facs[k] || (m.facs[k] = mk()) }; };
  const from = Math.min(...need.map(d => d.s)), to = Math.max(...need.map(d => d.e));
  const leave = r => {
    const x = bucket(r.t, r.f); if (!x) return; x.b.d++;
    if (r.sa) { x.b.ms += (r.t - r.sa) / M; x.b.mn++; }
    if (r.k === 'permit') x.b.pm++;
    if (+r.fee > 0 && !r.np && !r.w && !r.c) { x.b.np++; x.b.npa += +r.fee; } // a fee, and nothing paid, waived or cited
  };
  await tick(); for (const r of store.debtDepartureRows(from, to)) leave(r); // tickets still owing money: looked up once for the whole range
  for (let a = from; a < to; a += 2 * D) {
    await tick(); // let camera reads and other requests in between the two-day slices
    const b = Math.min(to, a + 2 * D);
    for (const r of store.arrivalRows(a, b)) { if (r.t == null) continue; const x = bucket(r.t, r.f); if (!x) continue; x.b.a++; x.b.h[hourOfDay(r.t, x.day)]++; }
    for (const r of store.departureRows(a, b)) leave(r);
    for (const r of store.paymentRows(a, b)) {
      if (/FAIL|CANCEL|DECLIN/i.test(r.s || '')) continue;
      const i = idx(r.t); if (i < 0) continue; const m = agg.get(days[i].s); if (!m) continue;
      const kind = r.k === 'monthly' ? 'monthly' : r.k === 'citation' ? 'notices' : 'parking', meth = r.m || (r.k === 'autopay' ? 'autopay' : 'online'), key = kind + '|' + meth + '|' + (r.f || '');
      const o = m.pay[key] || (m.pay[key] = { kind, meth, f: r.f || '', g: 0, r: 0, x: 0, n: 0 }); o.g += r.a; o.r += r.r; o.x += r.x * (r.a ? (r.a - r.r) / r.a : 0); o.n++;
    }
  }
  const at = Date.now(); for (const d of need) actCache.set(d.s, Object.assign({ at }, agg.get(d.s)));
  if (actCache.size > 3000) for (const k of [...actCache.keys()].slice(0, 1000)) actCache.delete(k);
}
/* A refund changes the money of the day the payment was taken: count that day again next time. */
function actInvalidate(t) { for (const k of [...actCache.keys()]) if (t >= k && t - k < 25 * H) actCache.delete(k); }
async function activityReport(fromStr, toStr, facility) {
  const days = actDays(fromStr, toStr); if (!days.length) return null;
  await actSerial(() => actFill(days));
  const hours = new Array(24).fill(0), facTotals = new Map(), byMethod = new Map(), byFacMoney = new Map(), r2 = n => Math.round(n * 100) / 100;
  const tot = { arrivals: 0, departures: 0, ms: 0, mn: 0, leftUnpaid: 0, leftUnpaidAmount: 0, monthlyVisits: 0, parking: 0, monthly: 0, notices: 0, refunds: 0, tax: 0, payments: 0 };
  const rows = days.map(d => {
    const c = actCache.get(d.s) || { facs: {}, pay: {} }, s = { a: 0, d: 0, ms: 0, mn: 0, np: 0, npa: 0, pm: 0 }, m = { parking: 0, monthly: 0, notices: 0, refunds: 0, tax: 0, payments: 0 };
    for (const id of Object.keys(c.facs)) {
      if (facility && id !== facility) continue; const x = c.facs[id];
      s.a += x.a; s.d += x.d; s.ms += x.ms; s.mn += x.mn; s.np += x.np; s.npa += x.npa; s.pm += x.pm; x.h.forEach((n, h) => { hours[h] += n; });
      const ft = facTotals.get(id) || { id, arrivals: 0, departures: 0 }; ft.arrivals += x.a; ft.departures += x.d; facTotals.set(id, ft);
    }
    for (const o of Object.values(c.pay)) {
      if (facility && o.f !== facility) continue;
      const net = (o.g - o.r) / 100; m[o.kind] += net; m.refunds += o.r / 100; m.tax += o.x / 100; m.payments += o.n;
      const bm = byMethod.get(o.meth) || { method: o.meth, count: 0, amount: 0 }; bm.count += o.n; bm.amount += net; byMethod.set(o.meth, bm);
      byFacMoney.set(o.f, (byFacMoney.get(o.f) || 0) + net);
    }
    tot.arrivals += s.a; tot.departures += s.d; tot.ms += s.ms; tot.mn += s.mn; tot.leftUnpaid += s.np; tot.leftUnpaidAmount += s.npa; tot.monthlyVisits += s.pm;
    ['parking', 'monthly', 'notices', 'refunds', 'tax', 'payments'].forEach(k => { tot[k] += m[k]; });
    return { date: d.str, arrivals: s.a, departures: s.d, avgMinutes: s.mn ? Math.round(s.ms / s.mn) : null, leftUnpaid: s.np, leftUnpaidAmount: r2(s.npa), monthlyVisits: s.pm, parking: r2(m.parking), monthly: r2(m.monthly), notices: r2(m.notices), refunds: r2(m.refunds), net: r2(m.parking + m.monthly + m.notices), tax: r2(m.tax), payments: m.payments };
  });
  const byFacility = new Map(); for (const f of S.facilities) byFacility.set(f.id, { id: f.id, name: f.name, arrivals: 0, departures: 0, revenue: 0 });
  for (const [id, x] of facTotals) { const o = byFacility.get(id) || { id, name: id || 'Not tied to a location', arrivals: 0, departures: 0, revenue: 0 }; o.arrivals = x.arrivals; o.departures = x.departures; byFacility.set(id, o); }
  for (const [id, v] of byFacMoney) { const o = byFacility.get(id) || { id, name: id ? id : 'Monthly and other payments (no location)', arrivals: 0, departures: 0, revenue: 0 }; o.revenue = r2(v); byFacility.set(id, o); }
  return { from: fromStr, to: toStr, facility: facility || '', timeZone: cfg().timeZone || 'America/Chicago', days: rows, hours,
    totals: { arrivals: tot.arrivals, departures: tot.departures, avgMinutes: tot.mn ? Math.round(tot.ms / tot.mn) : null, leftUnpaid: tot.leftUnpaid, leftUnpaidAmount: r2(tot.leftUnpaidAmount), monthlyVisits: tot.monthlyVisits, parking: r2(tot.parking), monthly: r2(tot.monthly), notices: r2(tot.notices), refunds: r2(tot.refunds), net: r2(tot.parking + tot.monthly + tot.notices), tax: r2(tot.tax), payments: tot.payments },
    byFacility: [...byFacility.values()], byMethod: [...byMethod.values()].map(x => ({ method: x.method, count: x.count, amount: r2(x.amount) })).sort((a, b) => b.amount - a.amount), firstTicketAt: store.firstTicketAt() };
}

/* ---------- patrol log: what officers checked, by day and location ----------
   A vehicle checked more than once the same day at the same location counts once, and the worst finding stands. Notices come
   from the notices themselves, so one written at the exit desk, or without a check first, still counts. Voided notices are
   listed but not counted. Days run midnight to midnight in the organisation's time zone. */
const KIND_LABEL = { monthly: 'Monthly parker', vip: 'VIP', reservation: 'Reservation', grace: 'In grace period', paid: 'Paid', validated: 'Validated', exit: 'Pays on exit', other: 'Other' };
function patrolReport(fromStr, toStr, facility) {
  const days = actDays(fromStr, toStr), from = days[0].s, to = days[days.length - 1].e, idx = actIndex(days);
  const facName = id => (S.facilities.find(f => f.id === id) || {}).name || 'Unknown location';
  const veh = new Map();
  const get = (t, fid, plate) => {
    const i = idx(t); if (i < 0) return null; const key = days[i].str + '|' + fid + '|' + plate; let v = veh.get(key);
    if (!v) { v = { date: days[i].str, facilityId: fid, facilityName: facName(fid), plate, first: t, last: t, checks: 0, flagged: false, kind: null, reason: '', lines: [], officers: [], sources: [], notices: [] }; veh.set(key, v); }
    if (t < v.first) v.first = t; if (t > v.last) v.last = t; return v;
  };
  const addOfficer = (v, o) => { o = String(o || '').trim(); if (o && !v.officers.includes(o)) v.officers.push(o); };
  for (const c of store.checksBetween(from, to, facility)) {
    const v = get(c.at, c.facility_id || '', c.plate); if (!v) continue;
    v.checks++; addOfficer(v, c.officer); if (c.source && !v.sources.includes(c.source)) v.sources.push(c.source);
    if (c.violator || !v.flagged) { v.kind = c.kind; v.reason = c.title || ''; v.lines = (c.detail && c.detail.lines) || []; }
    if (c.violator) v.flagged = true;
  }
  for (const c of S.citations) {
    if (!(c.issuedAt >= from && c.issuedAt < to) || (facility && c.facilityId !== facility)) continue;
    const v = get(c.issuedAt, c.facilityId || '', Rules.normPlate(c.plate)); if (!v) continue;
    v.notices.push({ id: c.id, number: c.number, violation: c.violation, violationName: c.violationName || c.violation, fine: +c.fine || 0, status: c.status, officer: c.officer || '', issuedAt: c.issuedAt });
    addOfficer(v, c.officer);
  }
  const blank = () => ({ checked: 0, violators: 0, flagged: 0, ok: 0, notices: 0, fines: 0 });
  const dayRows = new Map(days.map(d => [d.str, Object.assign({ date: d.str }, blank())]));
  const facRows = new Map(S.facilities.filter(f => !facility || f.id === facility).map(f => [f.id, Object.assign({ id: f.id, name: f.name }, blank())]));
  const offRows = new Map(), reasons = {}, tot = blank();
  const vehicles = [...veh.values()].map(v => {
    const live = v.notices.filter(n => n.status !== 'voided');
    v.result = live.length ? 'violator' : v.flagged || !v.checks ? 'flagged' : 'ok';
    v.label = v.result === 'violator' ? live[0].violationName : v.result === 'ok' ? KIND_LABEL[v.kind] || v.reason || 'OK' : v.checks ? v.reason || 'Flagged' : 'Notice voided';
    if (!v.reason) v.reason = v.label;
    const fines = Math.round(live.reduce((a, n) => a + n.fine, 0) * 100) / 100;
    const fr = facRows.get(v.facilityId) || facRows.set(v.facilityId, Object.assign({ id: v.facilityId, name: v.facilityName }, blank())).get(v.facilityId);
    for (const row of [dayRows.get(v.date), fr, tot]) { if (!row) continue; row.checked++; row[v.result === 'violator' ? 'violators' : v.result]++; row.notices += live.length; row.fines = Math.round((row.fines + fines) * 100) / 100; }
    for (const o of v.officers) { const r = offRows.get(o) || { name: o, checked: 0, notices: 0 }; r.checked++; r.notices += live.filter(n => n.officer === o).length; offRows.set(o, r); }
    if (v.result === 'ok') reasons[v.label] = (reasons[v.label] || 0) + 1;
    return v;
  }).sort((a, b) => b.last - a.last);
  const MAX = 5000;
  return { from: fromStr, to: toStr, facility: facility || '', timeZone: cfg().timeZone || 'America/Chicago', totals: tot,
    days: [...dayRows.values()], byFacility: [...facRows.values()], byOfficer: [...offRows.values()].sort((a, b) => b.checked - a.checked),
    reasons: Object.entries(reasons).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
    vehicles: vehicles.slice(0, MAX), truncated: vehicles.length > MAX };
}

/* A private account link can only add so many parkers a day (PORTAL_ADDS_PER_DAY, default 500), so a link that gets out can't flood the lot.
   Counted from the parkers the link itself added in the last 24 hours. */
const PORTAL_ADDS = Math.max(10, +(process.env.PORTAL_ADDS_PER_DAY || 500));
function portalRoom(co) { const since = Date.now() - D; let n = 0; for (const p of S.permits) if (p.companyId === co.id && p.source === 'company' && (p.createdAt || 0) > since) n++; return Math.max(0, PORTAL_ADDS - n); }
/* ---------- live plate scanning: usage, limits ----------
   Every photo sent to the plate-reading service counts, and the service bills by the lookup, so there is a monthly cap
   (SCAN_MONTHLY_CAP, default 60,000) and an email warning at 80% and when it is reached. Typing a plate is always free. */
const SCAN_CAP = Math.max(100, +process.env.SCAN_MONTHLY_CAP || 60000);
const orgDay = t => new Intl.DateTimeFormat('en-CA', { timeZone: cfg().timeZone || 'America/Chicago' }).format(t == null ? new Date() : new Date(t));
let scanMemo = { month: '', n: 0 };
function scanUsed() {
  const month = orgDay().slice(0, 7); if (scanMemo.month !== month) scanMemo = { month, n: store.get("SELECT COALESCE(SUM(n),0) AS n FROM scan_usage WHERE day LIKE ?", month + '-%').n };
  return scanMemo.n;
}
function scanBump() { const day = orgDay(); scanUsed(); scanMemo.n++; store.run('INSERT INTO scan_usage (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1', day); return scanMemo.n; }
const scanBuckets = new Map(); // per officer: a phone sends a couple of frames a second, never a flood
function scanLimited(id) { const t = Date.now(), b = scanBuckets.get(id) || { n: 0, t }; if (t - b.t > 10000) { b.n = 0; b.t = t; } b.n++; scanBuckets.set(id, b); if (scanBuckets.size > 500) scanBuckets.clear(); return b.n > 60; }
/* "2026-10-04 18:10" in a time zone. The formatter is made once per zone: building one for every row made big exports about 30 times slower. */
const stampFmt = new Map();
function localStamp(t, tz) {
  let f = stampFmt.get(tz); if (!f) { try { f = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); } catch (e) { f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); } stampFmt.set(tz, f); }
  return f.format(t);
}
/* A download that waits for a slow browser instead of piling the whole file up in memory, and stops if the browser goes away. */
function sink(res) {
  let gone = false; res.on('close', () => { gone = true; });
  return { get gone() { return gone; }, async put(text) {
    if (gone) return false;
    if (!res.write(text)) await new Promise(done => { const f = () => { res.off('drain', f); res.off('close', f); done(); }; res.on('drain', f); res.on('close', f); });
    return !gone;
  } };
}
/* ---------- routes ---------- */
function portalKeys(op, a) {
  const pl = Rules.normPlate(a.plate);
  return { prepay: ['plate:' + pl + ':' + a.facilityId], payBalance: ['s:' + a.sessionId], payCitation: ['c:' + a.citationId], appeal: ['c:' + a.citationId], reserve: ['res:' + a.facilityId],
    cancelReservation: ['resv'], payPermit: ['p:' + a.permitId], validate: ['plate:' + pl], monthlySignup: ['plan:' + a.planId], cancelMonthly: ['p:' + a.permitId], rate: ['s:' + a.sessionId] }[op] || ['op:' + op];
}
async function runPortal(op, args, payment, acct, expectedAmount) {
  return withLocks(portalKeys(op, args), async () => {
    const r = R.PORTAL[op](args);
    if (r.error) return { error: r.error };
    normalize(r.ops);
    if (r.refund) { // refund first; only cancel once the money is on its way back. The payment must be this reservation's own fee.
      const row = store.get('SELECT * FROM payments WHERE sq_id=?', r.refund.paymentId), want = Math.round(R.taxOf(r.refund.amount).total * 100);
      if (!row || row.kind !== 'reservation' || row.ref !== r.refund.ref || want > row.amount_cents - row.refunded_cents) return { error: 'The reservation fee for this booking can’t be refunded automatically. Contact the parking office.' };
      try {
        await square.refund({ paymentId: r.refund.paymentId, amount: R.taxOf(r.refund.amount).total, reason: 'Reservation cancelled' });
        const row = store.get('SELECT * FROM payments WHERE sq_id=?', r.refund.paymentId); if (row) { store.run('UPDATE payments SET refunded_cents=refunded_cents+? WHERE id=?', Math.round(R.taxOf(r.refund.amount).total * 100), row.id); actInvalidate(row.created_at); }
      } catch (e) { return { error: 'We couldn’t process the refund right now, so the reservation is still active. Try again in a few minutes.' }; }
    }
    let pay = null;
    if (r.charge && r.charge.amount > 0) {
      const sess = (r.sessionId && S.sessions.find(x => x.id === r.sessionId)) || (args.sessionId && S.sessions.find(x => x.id === args.sessionId)) || null, cit = args.citationId ? S.citations.find(x => x.id === args.citationId) : null;
      Object.assign(r.charge, { facilityId: r.charge.facilityId || args.facilityId || (sess && sess.facilityId) || (cit && cit.facilityId) || null, sessionId: r.charge.sessionId || r.sessionId || (sess && sess.id) || null, ticket: r.ticket || (sess && R.ticketOf(sess)) || null });
      const total = R.taxOf(r.charge.amount).total;
      if (expectedAmount != null && Math.abs(+expectedAmount - total) > 0.005) return { error: `The amount is now ${money(total)}. Review it and pay again.`, amount: total };
      try { pay = await takePayment(r.charge, payment, acct, args.email); }
      catch (e) { return { error: e.code === 'NETWORK' ? 'We couldn’t confirm your payment. Wait a minute and check your email for a receipt before trying again.' : e.message, code: e.code === 'NETWORK' ? 'network' : 'payment_failed' }; }
    }
    // Same idempotency key as a payment that already went through (a retry after a dropped connection): don't apply it twice.
    if (pay && pay.repeat) return { receipt: { title: `Already paid ${money(pay.total)}`, body: 'This payment went through the first time. Check your email or texts for the receipt.' }, receiptUrl: pay.receiptUrl, total: pay.total, repeat: true };
    try { await commit(withPay(r.ops, pay && pay.id)); }
    catch (e) { console.error('commit after payment failed', e); alertOnce('commit:' + (pay && pay.id), 1, 'Payment taken but record not saved', `${op} ${pay && pay.id}: ${e.message}`); }
    const to = args.email || (acct && acct.email);
    const extra = pay && pay.tax ? `\n\nTotal ${money(pay.total)} includes ${money(pay.tax)} sales tax.` : '';
    const sid = r.sessionId || (r.receipt && r.receipt.sessionId) || (op === 'payBalance' ? args.sessionId : null), sess = sid && (op === 'prepay' || op === 'payBalance') ? S.sessions.find(x => x.id === sid) : null;
    if (to && sess) { const m = R.receiptText(sess, { org: orgName(), receiptUrls: pay && pay.receiptUrl ? [pay.receiptUrl] : [], addTimeUrl: op === 'prepay' && sess.extendToken && !sess.endAt ? `${BASE}/x/${sess.extendToken}` : null }); mailer.send({ to, subject: m.subject, text: m.text }); }
    else if (to && r.receipt) mailer.send({ to, subject: r.receipt.title, text: `${r.receipt.body}${extra}${pay && pay.receiptUrl ? '\n\nReceipt: ' + pay.receiptUrl : ''}${op === 'reserve' ? `\n\nManage or cancel: ${BASE}/?reservation=${r.code}` : ''}\n\n${orgName()}` });
    if (op === 'prepay' && args.smsOptIn && args.phone) { const s = S.sessions.find(x => x.id === r.sessionId); if (s && s.extendToken) sms.send(args.phone, `${orgName()}: ${r.receipt.title}. ${r.receipt.body.split('.')[0]}. Add time: ${BASE}/x/${s.extendToken}`); }
    return { receipt: r.receipt, receiptUrl: pay && pay.receiptUrl, emailedTo: to && (sess || r.receipt) && mailer.configured ? to : null, total: pay && pay.total, tax: pay && pay.tax, code: r.code, sessionId: r.sessionId || (r.receipt && r.receipt.sessionId) || null };
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname, m = req.method, query = Object.fromEntries(url.searchParams);
  if (p === '/health') { const full = process.env.HEALTH_TOKEN && query.token === process.env.HEALTH_TOKEN; return send(res, 200, full ? { ok: true, store: store.kind, payments: square.live ? square.env : 'simulated', email: mailer.configured, sms: sms.configured, plateReader: plates.configured, lastBackup: lastBackup || null, cameras: S.cameras.map(c => ({ name: c.name, lastReadAt: c.lastReadAt || null })) } : { ok: true }); }
  if (p.startsWith('/lpr/')) { let tok = ''; try { tok = decodeURIComponent(p.slice(5)); } catch (e) { tok = p.slice(5); } return handleCamera(req, res, tok, query); }
  /* The page is the same for everyone until an update or a name change, so a phone that has it already (a driver opening
     the pay link again, a staff screen reloading) gets a 304 and nothing to download. */
  if (p === '/' && m === 'GET') { const buf = INDEX(), et = idxCache.etag; if (et && req.headers['if-none-match'] === et) { res.writeHead(304, headers({ ETag: et, 'Cache-Control': 'no-cache' })); return res.end(); } return send(res, 200, buf, { ETag: et, 'Cache-Control': 'no-cache' }); }
  if (p === '/.well-known/apple-developer-merchantid-domain-association') {
    const f = process.env.APPLE_PAY_DOMAIN_FILE || path.join(store.dir, 'apple-developer-merchantid-domain-association');
    return fs.existsSync(f) ? stream(res, f, 'text/plain') : fail(res, 404, 'Not configured', 'not_found');
  }
  let mm;
  if ((mm = /^\/c\/([A-Za-z0-9]{1,20})$/.exec(p))) { const c = S.citations.find(x => x.number === mm[1]); return send(res, 302, '', { Location: '/?plate=' + encodeURIComponent(c ? c.plate : '') + '&citation=' + encodeURIComponent(mm[1]) }); }
  if ((mm = /^\/p\/([A-Za-z0-9-]{1,20})$/.exec(p))) return send(res, 302, '', { Location: '/?lot=' + encodeURIComponent(mm[1].toUpperCase()) });
  if ((mm = /^\/x\/([A-Za-z0-9]{6,40})$/.exec(p))) return send(res, 302, '', { Location: '/?extend=' + encodeURIComponent(mm[1]) });

  /* ----- text messages from Twilio: text a lot number to get a pay link ----- */
  if (p === '/sms/inbound' && m === 'POST') {
    const raw = (await readBody(req, 20000)).toString('utf8'), params = Object.fromEntries(new URLSearchParams(raw));
    if (!sms.validSignature(BASE + '/sms/inbound', params, req.headers['x-twilio-signature'])) return fail(res, 403, 'Bad signature', 'forbidden');
    const text = String(params.Body || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|START|UNSTOP|YES|OPTOUT|REVOKE)$/.test(text)) return send(res, 200, sms.twiml(''), { 'Content-Type': 'text/xml' }); // Twilio handles opt-out keywords itself
    const f = S.facilities.find(x => x.lotCode && String(x.lotCode).toUpperCase() === text);
    const reply = f ? `${orgName()}: pay for parking at ${f.name} here: ${BASE}/p/${f.lotCode}` : text === 'HELP' ? `${orgName()} parking. Text the lot number on the sign to get a pay link. Reply STOP to opt out.` : `We didn’t find lot "${String(params.Body || '').trim().slice(0, 12)}". Text the lot number shown on the sign.`;
    return send(res, 200, sms.twiml(reply), { 'Content-Type': 'text/xml' });
  }

  if (p === '/login' && m === 'GET') return send(res, 200, LOGIN());
  if (p === '/login' && m === 'POST') {
    if (limited(req, 'login', 10)) return send(res, 429, LOGIN('Too many attempts. Wait a minute and try again.'));
    const form = new URLSearchParams((await readBody(req, 10000)).toString('utf8'));
    const r = await auth.login('users', form.get('email'), form.get('password'));
    if (r.error) { store.audit(String(form.get('email') || '').slice(0, 100), 'login_failed'); return send(res, 401, LOGIN(r.error)); }
    store.audit(actorOf(r.row), 'login');
    return send(res, 303, '', { Location: '/', 'Set-Cookie': setCookie('po_staff', auth.startSession('staff', r.row.id, 12), 43200) });
  }
  if (p === '/logout' && m === 'POST') { auth.endSession(cookie(req, 'po_staff')); return send(res, 200, { ok: true }, { 'Set-Cookie': 'po_staff=; Path=/; Max-Age=0' }); }
  if (p === '/logout' && m === 'GET') return send(res, 200, `<!doctype html><meta charset="utf-8"><form method="post" action="/logout" id="f"><button>Sign out</button></form><script>document.getElementById('f').submit()</script>`);
  /* Staff invitation: the emailed link opens a page to choose a password, then signs the person in. */
  if (p === '/staff/welcome') {
    const tokenOf = t => { const u = store.get('SELECT * FROM users WHERE reset_hash=?', auth.tokenHash(String(t || ''))); return u && u.active && u.reset_expires > Date.now() ? u : null; };
    if (m === 'GET') { const u = tokenOf(query.token); return send(res, u ? 200 : 400, WELCOME(u, u ? null : 'This invitation link has expired or was already used. Ask the parking office for a new one.', query.token)); }
    if (m === 'POST') {
      if (limited(req, 'welcome', 10)) return send(res, 429, WELCOME(null, 'Too many attempts. Wait a minute and try again.'));
      const form = new URLSearchParams((await readBody(req, 10000)).toString('utf8')), u = tokenOf(form.get('token'));
      if (!u) return send(res, 400, WELCOME(null, 'This invitation link has expired or was already used. Ask the parking office for a new one.'));
      const e = Auth.pwProblem(form.get('password')); if (e) return send(res, 400, WELCOME(u, e, form.get('token')));
      store.run('UPDATE users SET pw=?, reset_hash=NULL, reset_expires=NULL, failed=0, locked_until=NULL, last_login=? WHERE id=?', await Auth.hashPw(form.get('password')), Date.now(), u.id);
      store.audit(actorOf(u), 'invite_accepted', 'users', u.id);
      return send(res, 303, '', { Location: '/', 'Set-Cookie': setCookie('po_staff', auth.startSession('staff', u.id, 12), 43200) });
    }
  }

  // Every change needs this header, which other websites can't send (blocks cross-site request forgery).
  if (p.startsWith('/api/') && m !== 'GET' && req.headers['x-parkops'] !== '1') return fail(res, 403, 'Missing request header', 'forbidden');

  const staff = staffOf(req);
  const acct = accountOf(req);
  const role = roleOf(staff);

  if (p === '/api/state' && m === 'GET') {
    const out = { role, user: staff ? { id: staff.id, name: staff.name, email: staff.email, role } : null, webhookBase: BASE, feed: [], payments: square.clientConfig(), account: accountView(acct), sms: { enabled: sms.configured, number: process.env.TWILIO_DISPLAY_NUMBER || '' },
      terminal: { defaultDevice: !!process.env.SQUARE_TERMINAL_DEVICE_ID, simulated: !square.live }, email: mailer.configured };
    if (staff) { COLLS.filter(c => c !== 'settings').forEach(c => { out[c] = S[c].map(d => { const v = viewFor(role, c, strip(d), d.id); return v === undefined ? undefined : Object.assign({ id: d.id }, v); }).filter(Boolean); }); out.config = S.config; out.feed = FEED; out.scan = { on: plates.configured && can(staff, 'citations') }; const ft = store.firstTicketAt(), sc = onScreenSince(); out.screenSince = sc && ft && ft < sc ? sc : null; }
    else { out.facilities = S.facilities.map(f => Object.assign({ id: f.id }, viewFor('public', 'facilities', strip(f), f.id))); out.permitTypes = S.permitTypes.filter(t => t.active !== false).map(t => Object.assign({}, t, { sold: R.soldOf(t) })); out.config = publicConfig(); }
    return send(res, 200, out);
  }
  if (p === '/api/stream' && m === 'GET') {
    /* Staff screens and drivers are counted apart, so drivers can never use up the room staff screens need. Staff are limited
       per person (a booth computer, the office and a phone each hold one), not per address: a whole office or a set of
       booths often shares one internet address. Driver pages no longer open a live connection; older copies of the page
       still might, so they get a small allowance. */
    const ip = clientIp(req);
    if (staff) { let mine = 0, all = 0; for (const x of clients) if (x.uid) { all++; if (x.uid === staff.id) mine++; } if (all >= 2000 || mine >= 25) return fail(res, 429, 'Too many live connections', 'rate_limited'); }
    else { let pub = 0; for (const x of clients) if (!x.uid) pub++; if (pub >= 200 || (perIp.get(ip) || 0) >= 4) return fail(res, 429, 'Too many live connections', 'rate_limited'); }
    res.writeHead(200, headers({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }));
    res.write('retry: 5000\n\n');
    const c = { res, role, token: cookie(req, 'po_staff'), ip, uid: staff ? staff.id : null }; clients.add(c); if (!staff) perIp.set(ip, (perIp.get(ip) || 0) + 1);
    req.on('close', () => { clients.delete(c); if (staff) return; const n = (perIp.get(ip) || 1) - 1; if (n > 0) perIp.set(ip, n); else perIp.delete(ip); });
    return;
  }

  /* ----- photos ----- */
  const ph = /^\/photos\/([a-f0-9]{24})$/.exec(p);
  if (ph && m === 'GET') {
    const got = photos.get(ph[1]); if (!got) return fail(res, 404, 'Photo not found', 'not_found');
    if (!staff && !S.citations.some(c => (c.photoIds || []).includes(ph[1]))) return fail(res, 403, 'Sign in as staff to view this photo.', 'forbidden');
    return stream(res, got.file, got.file.endsWith('.png') ? 'image/png' : 'image/jpeg', { 'Cache-Control': 'private, max-age=86400' });
  }
  if (p === '/api/photos' && m === 'POST') {
    if (!can(staff, 'citations')) return fail(res, 403, 'Sign in as staff who can issue notices.', 'forbidden');
    if (limited(req, 'photos', 60)) return fail(res, 429, 'Too many uploads. Wait a minute.', 'rate_limited');
    const buf = await readBody(req, 9 * 1024 * 1024);
    const id = photos.save(buf, { kind: 'citation', plate: Rules.normPlate(query.plate || ''), keep: true });
    if (!id) return fail(res, 400, 'Upload a JPEG or PNG photo under 8 MB.');
    store.audit(actorOf(staff), 'photo', 'photos', id); return send(res, 200, { id });
  }

  /* ----- live plate scanning: one camera frame in, the plates in it out. The key stays here; the phone never sees it. ----- */
  if (p === '/api/enforcement/scan' && m === 'POST') {
    if (!can(staff, 'citations')) return fail(res, 403, 'Sign in as staff who can issue notices.', 'forbidden');
    if (!plates.configured) { req.resume(); return fail(res, 503, 'Live plate reading isn’t set up yet. Type the plate instead.', 'scan_off'); }
    if (scanLimited(staff.id)) { req.resume(); return fail(res, 429, 'Too many frames a second. Hold steady on a plate.', 'rate_limited'); }
    if (scanUsed() >= SCAN_CAP) {
      req.resume(); alertOnce('scan-cap:' + orgDay().slice(0, 7), 24 * 31, 'Live plate scanning stopped: monthly limit reached', `Officers have used all ${SCAN_CAP.toLocaleString()} scans allowed this month, so scanning is off until next month. Typing plates still works. To allow more, raise SCAN_MONTHLY_CAP in Render (and check your Plate Recognizer plan covers it).`);
      return fail(res, 429, `This month’s limit of ${SCAN_CAP.toLocaleString()} scans is used up. Type plates instead, or ask the owner to raise it.`, 'scan_cap', { used: scanUsed(), cap: SCAN_CAP });
    }
    const buf = await readBody(req, 3 * 1024 * 1024);
    if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) return fail(res, 400, 'That wasn’t a camera frame.');
    const used = scanBump();
    if (used >= SCAN_CAP * 0.8) alertOnce('scan-80:' + orgDay().slice(0, 7), 24 * 31, 'Live plate scanning is at 80% of its monthly limit', `${used.toLocaleString()} of ${SCAN_CAP.toLocaleString()} scans used this month. Scanning stops at the limit; typing plates keeps working. Raise SCAN_MONTHLY_CAP in Render if you want more.`);
    const t0 = Date.now();
    try { const r = await plates.read(buf, { cameraId: 'officer-' + staff.id }); return send(res, 200, { plates: r.plates, ms: Date.now() - t0, used, cap: SCAN_CAP }); }
    catch (e) {
      if (e.code === 'AUTH') alertOnce('scan-auth', 12, 'Plate scanning key problem', 'Plate Recognizer refused ParkOps’s key, or the plan is used up. Check the PLATE_RECOGNIZER_TOKEN value in Render and your Plate Recognizer plan. Officers can still type plates.');
      return fail(res, e.code === 'THROTTLED' || e.code === 'BUSY' ? 429 : e.code === 'AUTH' || e.code === 'OFF' ? 503 : 502, e.message, e.code === 'THROTTLED' || e.code === 'BUSY' ? 'rate_limited' : 'scan_failed', { retryAfterMs: e.retryAfterMs || 0 });
    }
  }

  /* ----- patrol log: every plate an officer checks is saved with what the check found ----- */
  if (p === '/api/enforcement/check' && m === 'POST') {
    if (!can(staff, 'citations')) return fail(res, 403, 'Sign in as staff who can issue notices.', 'forbidden');
    if (limited(req, 'checks', 300)) return fail(res, 429, 'Too many checks a minute.', 'rate_limited');
    let b; try { b = await readJson(req); } catch (e) { return fail(res, 400, 'Body must be a JSON object'); }
    const plate = Rules.normPlate(b.plate || ''), f = S.facilities.find(x => x.id === b.facilityId);
    if (plate.length < 2 || !f) return fail(res, 400, 'Send a plate and a location.');
    const zone = b.zone === 'reserved' ? 'reserved' : 'general', r = R.checkPlate(plate, f.id, zone), k = R.checkKind(r);
    const source = ['typed', 'scanner', 'list'].includes(b.source) ? b.source : 'typed', score = +b.score > 0 && +b.score <= 1 ? Math.round(+b.score * 100) / 100 : undefined;
    const id = store.addCheck({ at: Date.now(), facilityId: f.id, plate, staffId: staff.id, officer: staff.name, source, level: r.level, violator: k.violator, kind: k.kind, title: r.title, suggest: r.suggest, detail: { lines: (r.lines || []).slice(0, 4), zone: zone === 'reserved' ? zone : undefined, score } });
    return send(res, 200, { id, plate, level: r.level, title: r.title, violator: k.violator, kind: k.kind });
  }
  if ((p === '/api/enforcement/patrol' || p === '/api/enforcement/patrol.csv') && m === 'GET') {
    if (!can(staff, 'citations') && !can(staff, 'reports')) return fail(res, 403, 'Sign in as staff who can see notices or reports.', 'forbidden');
    const today = orgDay();
    let from = calDay(query.from) ? query.from : today, to = calDay(query.to) ? query.to : from; if (to < from) [from, to] = [to, from];
    if ((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / D > 366) return fail(res, 400, 'Pick a range of a year or less.');
    const fid = /^[\w-]{1,60}$/.test(String(query.facility || '')) ? String(query.facility) : '';
    const rep = patrolReport(from, to, fid);
    if (p === '/api/enforcement/patrol') { if (query.summary) { delete rep.vehicles; delete rep.truncated; } return send(res, 200, rep); }
    const q = v => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const tz = cfg().timeZone || 'America/Chicago', hm = t => t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
    const RES = { violator: 'Violator', flagged: 'Flagged, no notice', ok: 'Not violating' };
    const lines = [['Date', 'Location', 'Plate', 'Result', 'Reason', 'Notice', 'Fine', 'Notice status', 'First checked', 'Last checked', 'Times checked', 'Officer'].join(',')]
      .concat(rep.vehicles.map(v => { const c = v.notices[0] || {}; return [v.date, v.facilityName, v.plate, RES[v.result], v.label, v.notices.map(n => n.number).join(' '), v.notices.length ? v.notices.reduce((a, n) => a + (n.status === 'voided' ? 0 : n.fine), 0).toFixed(2) : '', c.status || '', hm(v.first), hm(v.last), v.checks, v.officers.join('; ')].map(q).join(','); }));
    return send(res, 200, lines.join('\n') + '\n', { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="patrol-${from}${to !== from ? '-to-' + to : ''}.csv"` });
  }

  /* ----- staff data ----- */
  const dm = /^\/api\/db\/([A-Za-z]+)(?:\/([A-Za-z0-9_\-.~:@+]+))?$/.exec(p);
  if (dm) {
    const [, coll, id] = dm;
    if (!staff) return fail(res, 403, 'Sign in as staff to change records.', 'forbidden');
    if (!COLLS.includes(coll)) return fail(res, 400, 'Unknown collection.');
    const need = DB_PERM[coll];
    if (need === null) return fail(res, 403, 'Those records are written by the system, not edited by hand.', 'forbidden');
    if (coll === 'members' && m !== 'DELETE') return fail(res, 400, 'Autopay members are managed from driver accounts. You can only remove them here.');
    if (coll === 'settings' && id !== 'config') return fail(res, 400, 'Unknown settings document');
    let body = {};
    if (m !== 'DELETE') { try { body = await readJson(req); } catch (e) { return fail(res, 400, 'Body must be a JSON object'); } }
    const denied = () => fail(res, 403, `${roleName(staff)}s can’t change ${coll === 'permitTypes' ? 'monthly plans' : coll}. Ask a manager or the owner.`, 'forbidden');
    if (coll === 'citations') {
      // Attendants issue notices and add notes or photos; deciding appeals, voiding, marking paid or changing fines takes citations.decide.
      const decide = can(staff, 'citations.decide');
      if (!can(staff, 'citations')) return denied();
      if (m === 'PATCH' && !decide) { const allowed = ['notes', 'photoIds', 'plateState']; if (Object.keys(body).some(k => !allowed.includes(k))) return fail(res, 403, 'Attendants can add notes and photos to a notice, but not change its amount or status.', 'forbidden'); }
      if ((m === 'PUT' && getDoc(coll, id) && !decide) || (m === 'DELETE' && !decide)) return fail(res, 403, 'Only managers and the owner can replace or delete a notice.', 'forbidden');
    } else if (!can(staff, need)) return denied();
    if (m === 'DELETE' && coll === 'sessions' && !can(staff, 'settings')) return fail(res, 403, 'Only managers and the owner can delete tickets.', 'forbidden');
    if (coll === 'reservations' && !can(staff, 'tickets.adjust')) ['paymentId', 'premium', 'refunded', 'accountId'].forEach(k => { delete body[k]; });
    if (coll === 'companies') { if (!can(staff, 'settings')) delete body.portalToken; if (m !== 'PATCH' && !body.portalToken) body.portalToken = crypto.randomBytes(20).toString('hex'); }
    if (coll === 'cameras' && m !== 'PATCH' && !body.token) body.token = crypto.randomBytes(12).toString('hex');
    const actor = actorOf(staff);
    const write = async () => {
      if (m === 'POST' && !id) { const nid = R.uid(coll.slice(0, 1)); await commit([{ type: 'set', coll, id: nid, data: body }], actor); return send(res, 200, { id: nid }); }
      if (!id) return fail(res, 400, 'Missing id');
      if (m === 'PUT') { await commit([{ type: 'set', coll, id, data: body }], actor); return send(res, 200, { ok: true }); }
      if (m === 'PATCH') { if (!getDoc(coll, id)) return fail(res, 404, 'Not found'); await commit([{ type: 'update', coll, id, data: body }], actor); return send(res, 200, { ok: true }); }
      if (m === 'DELETE') { await commit([{ type: 'delete', coll, id }], actor); return send(res, 200, { ok: true }); }
      return fail(res, 405, 'Method not allowed');
    };
    /* A monthly parker on an account has to fit the account: its plans, its location and its parker limit. Checked here as well as in the
       screens, so no other route into the data can go over. Editing someone already on the account never counts them twice. */
    if (coll === 'permits' && m !== 'DELETE' && body && typeof body === 'object') {
      if (body.companyId != null && typeof body.companyId !== 'string') return fail(res, 400, 'That monthly parker isn’t tied to a valid account.');
      const nextOf = () => Object.assign({}, m === 'PATCH' && id ? getDoc('permits', id) || {} : {}, body), first = nextOf();
      if (first.companyId) return withLocks(['acct:' + first.companyId], async () => {
        const prev = id ? getDoc('permits', id) : null, next = nextOf(), HOLD = ['active', 'suspended', 'approved', 'pending'], holds = x => x && HOLD.includes(x.status) && (!x.endAt || x.endAt > Date.now());
        if (holds(next) && (!prev || !holds(prev) || prev.companyId !== next.companyId || prev.permitTypeId !== next.permitTypeId)) { const rm = R.accountRoom(next.companyId, next.permitTypeId, { exclude: id }); if (rm.error) return fail(res, 400, rm.error); }
        return write();
      });
    }
    return write();
  }
  if (p === '/api/lpr/test' && m === 'POST') {
    if (!can(staff, 'cameras')) return fail(res, 403, 'Only managers and the owner can send test reads.', 'forbidden');
    const b = await readJson(req); const r = R.planRead(b);
    if (r.error) return send(res, 200, { level: 'bad', text: r.error });
    await commit(r.ops, actorOf(staff)); afterRead(r.result, S.cameras.find(c => c.id === b.cameraId) || { name: 'manual', facilityId: b.facilityId });
    return send(res, 200, r.result);
  }

  /* ----- tickets: every action goes through the shared planner, under a per-ticket lock, with the staff name on the record ----- */
  if (p === '/api/tickets' && m === 'POST') {
    if (!staff) return fail(res, 403, 'Sign in as staff.', 'forbidden');
    if (!can(staff, 'tickets')) return fail(res, 403, `${roleName(staff)}s can’t open tickets.`, 'forbidden');
    const b = await readJson(req); b.by = staff.name;
    return withLocks(['plate:' + Rules.normPlate(b.plate) + ':' + b.facilityId], async () => {
      const r = R.TICKET.create(b); if (r.error) return fail(res, 400, r.error, 'invalid_argument', r.sessionId ? { sessionId: r.sessionId } : undefined);
      await commit(r.ops, actorOf(staff)); return send(res, 200, { sessionId: r.sessionId, ticket: r.ticket, kind: r.kind });
    });
  }
  const tkm = /^\/api\/tickets\/([A-Za-z0-9_\-.~:@+]+)\/([a-zA-Z]+)$/.exec(p);
  if (tkm && m === 'POST') {
    const [, sid, action] = tkm;
    if (!staff) return fail(res, 403, 'Sign in as staff.', 'forbidden');
    let perm = TK_PERM[action]; if (!perm) return fail(res, 404, 'Unknown ticket action', 'not_found');
    const b = await readJson(req);
    if (action === 'validate' && b.replace) perm = 'tickets.adjust';
    if (action === 'pay' && b.method === 'comp') perm = 'tickets.adjust';
    if (!can(staff, perm)) return fail(res, 403, `${roleName(staff)}s can’t ${({ pay: b.method === 'comp' ? 'give complimentary parking' : 'take payments', reopen: 'reopen tickets', waive: 'waive balances', unwaive: 'remove waivers', adjust: 'adjust fees', setPlate: 'correct plates', removeValidation: 'remove validations', review: 'decide plate reviews', validate: 'replace validations', markCited: 'issue notices' })[action] || 'do that'}. Ask a manager.`, 'forbidden');
    return withLocks(['s:' + sid], async () => {
      const s = S.sessions.find(x => x.id === sid); if (!s) return fail(res, 404, 'Ticket not found', 'not_found');
      const mgr = can(staff, 'tickets.adjust'); // set here, never taken from the request, so a client can't claim manager rights
      const args = Object.assign({}, b, { by: staff.name, allowBackdate: mgr, allowUnpaid: mgr, requireFull: !mgr });
      if (action === 'emailReceipt') { // a booth attendant emails the driver a receipt for this ticket
        const to = String(b.email || '').trim().toLowerCase();
        if (!Rules.emailOk(to)) return fail(res, 400, 'Check the email address.');
        if (limited(req, 'receiptMail', 30)) return fail(res, 429, 'Too many receipts a minute. Wait a moment.', 'rate_limited');
        const urls = store.all('SELECT receipt_url FROM payments WHERE session_id=? AND receipt_url IS NOT NULL ORDER BY created_at', s.id).map(x => x.receipt_url);
        const m = R.receiptText(s, { org: orgName(), receiptUrls: urls });
        const sent = await mailer.send({ to, subject: m.subject, text: m.text });
        await commit([{ type: 'update', coll: 'sessions', id: s.id, data: { receiptEmail: to, history: R.histAdd(s, { action: 'receipt_emailed', by: staff.name, detail: to }) } }], actorOf(staff));
        return send(res, 200, { sent: !!sent, emailConfigured: !!mailer.configured, to });
      }
      if (action === 'terminal') return startTerminal(res, s, args, staff);
      if (action === 'chargeCard') return chargeCardOnFile(res, s, args, staff);
      if (action === 'pay') { if (!STAFF_METHODS.includes(args.method)) return fail(res, 400, 'Choose cash, card, check or complimentary. Card-on-file and Terminal payments have their own buttons.'); delete args.pid; }
      const r = R.TICKET[action](s, args); if (r.error) return fail(res, 400, r.error);
      normalize(r.ops);
      if (action === 'pay') { // cash, checks and external card readers go on the ledger too, so reports and the shift close-out see every dollar
        const t = R.taxOf(r.amount), lid = recordPayment({ kind: 'ticket', ref: R.ticketOf(s), plate: s.plate, total: t.total, net: t.net, tax: t.tax, status: 'COMPLETED', method: args.method, staff: staff.name, ticket: R.ticketOf(s), facilityId: s.facilityId, sessionId: s.id, note: args.note });
        const np = r.ops[0].newPayments && r.ops[0].newPayments[0]; if (np && lid) np.ledgerId = lid;
      }
      await commit(r.ops, actorOf(staff));
      const out = Object.assign({}, r); delete out.ops; return send(res, 200, out);
    });
  }
  const trm = /^\/api\/terminal\/([A-Za-z0-9_\-]+)(\/cancel)?$/.exec(p);
  if (trm) {
    if (!can(staff, 'tickets')) return fail(res, 403, 'Sign in as staff.', 'forbidden');
    const row = store.get('SELECT * FROM terminals WHERE id=?', trm[1]); if (!row) return fail(res, 404, 'Checkout not found', 'not_found');
    if (trm[2] && m === 'POST') {
      try { const c = await square.cancelTerminalCheckout(row.id); store.run('UPDATE terminals SET status=?, updated_at=? WHERE id=?', c.status, Date.now(), row.id); store.audit(actorOf(staff), 'terminal_cancel', 'sessions', row.session_id, { checkout: row.id }); return send(res, 200, { status: c.status }); }
      catch (e) { return fail(res, e.code === 'NETWORK' ? 503 : 400, e.message, 'payment_failed'); }
    }
    if (m === 'GET') return withLocks(['s:' + row.session_id], () => pollTerminal(res, row, staff));
  }
  if (p === '/api/lpr/import' && m === 'POST') {
    if (!can(staff, 'cameras')) return fail(res, 403, 'Only managers and the owner can import reads.', 'forbidden');
    const b = await readJson(req); const reads = (b.reads || []).slice(0, 500).sort((a, c) => (a.at || 0) - (c.at || 0));
    // Imported history: reads more than 2 hours old build the visits but don't charge saved cards or send alerts.
    let count = 0; for (const x of reads) { const r = R.planRead(x); if (!r.error) { await commit(r.ops); if (!(x.at < Date.now() - 2 * H)) afterRead(r.result, S.cameras.find(c => c.id === x.cameraId) || { name: 'import' }); count++; } }
    store.audit(actorOf(staff), 'import_reads', null, null, { count }); return send(res, 200, { count });
  }

  /* ----- admin ----- */
  if (p.startsWith('/api/admin/')) {
    if (!staff) return fail(res, 403, 'Sign in as staff.', 'forbidden');
    /* Which permission each admin endpoint needs. The ticket audit trail is open to anyone who works tickets. */
    const ADMIN_PERM = { users: 'users', invite: 'users', audit: query.coll === 'sessions' && query.id ? 'tickets' : 'reports', history: can(staff, 'tickets') ? 'tickets' : 'reports', 'history.csv': 'export', activity: 'reports', 'activity.csv': 'export', 'payments.csv': 'export', storage: 'settings', connection: 'settings', scan: 'reports', outbox: 'settings', hotlist: 'enforcement', payments: 'payments', refund: 'refunds', backup: 'settings', 'collections.csv': 'export', approveMonthly: 'monthly', billing: 'monthly', invoices: 'monthly', companies: 'settings', monthly: 'import' };
    const seg = p.slice(11).split('/')[0], needP = ADMIN_PERM[seg];
    if (!needP || !can(staff, needP)) return fail(res, 403, needP ? `${roleName(staff)}s can’t do that. It needs the ${needP} permission (${ROLE_LIST.filter(r => Rules.can(r, needP)).map(r => Rules.ROLE_NAMES[r]).join(', ')}).` : 'Not found', needP ? 'forbidden' : 'not_found');
    const actor = actorOf(staff);
    const userRow = u => ({ id: u.id, email: u.email, name: u.name, role: Rules.canonRole(u.role), active: !!u.active, created_at: u.created_at, last_login: u.last_login, invited: !!(u.reset_hash && !u.last_login), inviteExpired: !!(u.reset_hash && !u.last_login && u.reset_expires < Date.now()) });
    if (p === '/api/admin/users' && m === 'GET') return send(res, 200, store.all('SELECT id, email, name, role, active, created_at, last_login, reset_hash, reset_expires FROM users ORDER BY name').map(userRow));
    /* Invitations: a link to choose a password, valid 7 days. The response says whether the email actually went out;
       when email isn’t set up the link is returned so the owner can pass it on themselves. */
    const inviteLink = async u => { const t = auth.newToken(); store.run('UPDATE users SET reset_hash=?, reset_expires=?, invited_at=? WHERE id=?', auth.tokenHash(t), Date.now() + 7 * D, Date.now(), u.id); const link = `${BASE}/staff/welcome?token=${t}`;
      const sent = await mailer.send({ to: u.email, subject: `${orgName()}: your staff invitation`, text: `Hi ${u.name},\n\n${staff.name} added you as ${Rules.ROLE_NAMES[Rules.canonRole(u.role)] || u.role} on the ${orgName()} parking system. Choose your password here within 7 days:\n\n${link}\n\nIf you weren’t expecting this, ignore it.` });
      return { inviteSent: !!sent, link: sent ? undefined : link, emailConfigured: mailer.configured }; };
    if (p === '/api/admin/users' && m === 'POST') {
      const b = await readJson(req); const email = String(b.email || '').trim().toLowerCase(), role = Rules.canonRole(b.role);
      if (!b.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'Add a name and a valid email.');
      if (!ROLE_LIST.includes(role)) return fail(res, 400, 'Choose a role.');
      if (store.get('SELECT id FROM users WHERE email=?', email)) return fail(res, 400, 'A staff account with that email already exists.');
      const invite = !!b.invite || !b.password;
      if (!invite) { const pwErr = Auth.pwProblem(b.password); if (pwErr) return fail(res, 400, pwErr); }
      const id = 'u_' + crypto.randomBytes(6).toString('hex');
      store.run('INSERT INTO users (id, email, name, role, pw, created_at) VALUES (?,?,?,?,?,?)', id, email, String(b.name).trim().slice(0, 80), role, invite ? 'invite$' + crypto.randomBytes(16).toString('hex') : await Auth.hashPw(b.password), Date.now());
      const out = { id, role }; if (invite) Object.assign(out, await inviteLink(store.get('SELECT * FROM users WHERE id=?', id)));
      store.audit(actor, 'user_create', 'users', id, { email, role, invite, inviteSent: out.inviteSent }); return send(res, 200, out);
    }
    const um = /^\/api\/admin\/users\/(u_[a-f0-9]+)(\/invite)?$/.exec(p);
    if (um && um[2] && m === 'POST') { const u = store.get('SELECT * FROM users WHERE id=?', um[1]); if (!u) return fail(res, 404, 'Not found'); if (!u.active) return fail(res, 400, 'Turn the account on first.'); const out = await inviteLink(u); store.audit(actor, 'user_invite', 'users', u.id, { inviteSent: out.inviteSent }); return send(res, 200, out); }
    if (um && !um[2] && m === 'PATCH') {
      const b = await readJson(req); const u = store.get('SELECT * FROM users WHERE id=?', um[1]); if (!u) return fail(res, 404, 'Not found');
      const role = b.role ? Rules.canonRole(b.role) : null;
      if (role && !ROLE_LIST.includes(role)) return fail(res, 400, 'Choose a role.');
      if (u.id === staff.id && (b.active === false || (role && role !== 'owner'))) return fail(res, 400, 'You can’t turn off or demote your own account.');
      if (role === 'owner' && roleOf(staff) !== 'owner') return fail(res, 403, 'Only an owner can make someone an owner.', 'forbidden');
      if (Rules.canonRole(u.role) === 'owner' && roleOf(staff) !== 'owner' && (role || b.active === false || b.password)) return fail(res, 403, 'Only an owner can change an owner’s account.', 'forbidden');
      if (b.password) { const e = Auth.pwProblem(b.password); if (e) return fail(res, 400, e); }
      if (b.name != null && String(b.name).trim()) store.run('UPDATE users SET name=? WHERE id=?', String(b.name).trim().slice(0, 80), u.id);
      if (role) { store.run('UPDATE users SET role=? WHERE id=?', role, u.id); if (u.id !== staff.id) { auth.endAll('staff', u.id); dropClientsOf(u.id); } }
      if (typeof b.active === 'boolean') { store.run('UPDATE users SET active=? WHERE id=?', b.active ? 1 : 0, u.id); if (!b.active) { auth.endAll('staff', u.id); dropClientsOf(u.id); } }
      if (b.password) { store.run('UPDATE users SET pw=?, failed=0, locked_until=NULL, reset_hash=NULL, reset_expires=NULL WHERE id=?', await Auth.hashPw(b.password), u.id); auth.endAll('staff', u.id); }
      store.audit(actor, 'user_update', 'users', u.id, { role, active: b.active, password: b.password ? 'reset' : undefined }); return send(res, 200, { ok: true });
    }
    /* Which address the server takes for this browser, for the per-address limits. Behind Cloudflare the visitor's own address
       is in cf-connecting-ip; if the server is using a different one, every visitor would share Cloudflare's address. */
    if (p === '/api/admin/connection' && m === 'GET') {
      const seenAs = clientIp(req), cf = req.headers['cf-connecting-ip'] ? String(req.headers['cf-connecting-ip']) : null;
      return send(res, 200, { seenAs, cloudflare: cf, forwardedFor: String(req.headers['x-forwarded-for'] || ''), socket: req.socket.remoteAddress || '', trustProxy: TRUST_PROXY, header: CLIENT_IP_HEADER || null, ok: !cf || cf === seenAs });
    }
    if (p === '/api/admin/audit' && m === 'GET') {
      const lim = Math.max(1, Math.min(5000, +query.limit || 200)), w = [], v = [];
      if (query.coll) { w.push('coll=?'); v.push(String(query.coll)); } if (query.id) { w.push('doc_id=?'); v.push(String(query.id)); } if (+query.since) { w.push('at>=?'); v.push(+query.since); }
      return send(res, 200, store.all(`SELECT at, actor, action, coll, doc_id, detail FROM audit${w.length ? ' WHERE ' + w.join(' AND ') : ''} ORDER BY at DESC LIMIT ?`, ...v, lim).map(a => { let d = null; try { d = a.detail ? JSON.parse(a.detail) : null; } catch (e) {} return Object.assign({}, a, { detail: d }); }));
    }
    /* ---------- activity for any range of days ---------- */
    if ((p === '/api/admin/activity' || p === '/api/admin/activity.csv') && m === 'GET') {
      const okDay = calDay;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: cfg().timeZone || 'America/Chicago' }).format(new Date());
      let from = okDay(query.from) ? query.from : today, to = okDay(query.to) ? query.to : from; if (to < from) [from, to] = [to, from];
      if ((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / D > 799) return fail(res, 400, 'Pick a range of about two years or less.');
      const fid = /^[\w-]{1,60}$/.test(String(query.facility || '')) ? String(query.facility) : '';
      const rep = await activityReport(from, to, fid);
      if (p === '/api/admin/activity') return send(res, 200, rep);
      const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const lines = [['Date', 'Cars in', 'Cars out', 'Average minutes parked', 'Left without paying', 'Amount left unpaid', 'Parking collected', 'Monthly parking collected', 'Notices collected', 'Refunded', 'Net collected', 'Sales tax included', 'Payments'].join(',')]
        .concat(rep.days.map(d => [d.date, d.arrivals, d.departures, d.avgMinutes ?? '', d.leftUnpaid, d.leftUnpaidAmount.toFixed(2), d.parking.toFixed(2), d.monthly.toFixed(2), d.notices.toFixed(2), d.refunds.toFixed(2), d.net.toFixed(2), d.tax.toFixed(2), d.payments].map(q).join(',')));
      const T = rep.totals; lines.push(['Total', T.arrivals, T.departures, T.avgMinutes ?? '', T.leftUnpaid, T.leftUnpaidAmount.toFixed(2), T.parking.toFixed(2), T.monthly.toFixed(2), T.notices.toFixed(2), T.refunds.toFixed(2), T.net.toFixed(2), T.tax.toFixed(2), T.payments].map(q).join(','));
      store.audit(actor, 'activity_export', null, null, { from, to, facility: fid });
      return send(res, 200, lines.join('\r\n') + '\r\n', { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="activity-${from}-to-${to}.csv"` });
    }
    /* ---------- every payment in a range of days, as a spreadsheet (the screens only list the latest) ---------- */
    if (p === '/api/admin/payments.csv' && m === 'GET') {
      const okDay = calDay;
      const tz = cfg().timeZone || 'America/Chicago', today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      let from = okDay(query.from) ? query.from : today, to = okDay(query.to) ? query.to : from; if (to < from) [from, to] = [to, from];
      if ((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / D > 799) return fail(res, 400, 'Pick a range of about two years or less.');
      const fid = /^[\w-]{1,60}$/.test(String(query.facility || '')) ? String(query.facility) : '';
      const t0 = R.endOfDate(new Date(Date.parse(from + 'T00:00:00Z') - D).toISOString().slice(0, 10), null), t1 = R.endOfDate(to, null);
      const esc = v => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const fname = id => (S.facilities.find(f => f.id === id) || {}).name || id || '', local = t => localStamp(t, tz), money = c => ((+c || 0) / 100).toFixed(2);
      res.writeHead(200, headers({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="payments-${from}-to-${to}.csv"` }));
      const out = sink(res); let n = 0, note = '';
      await out.put(['Date', 'Type', 'Reference', 'Ticket', 'Plate', 'Location', 'Method', 'Status', 'Amount', 'Refunded', 'Net of tax', 'Sales tax', 'Taken by', 'Processor id', 'Note'].map(esc).join(',') + '\n');
      try {
        let after = null;
        for (;;) {
          const rows = store.paymentPage(t0, t1, fid, after, 2000);
          let chunk = '';
          for (const r of rows) {
            const comp = r.method === 'comp'; // complimentary parking is listed, but it is not money: amount 0, value in the note
            chunk += [local(r.created_at), r.kind, r.ref, r.ticket, r.plate, fname(r.facility_id), r.method, comp ? 'Complimentary (no money)' : r.status, money(comp ? 0 : r.amount_cents), money(comp ? 0 : r.refunded_cents), money(comp ? 0 : r.net_cents), money(comp ? 0 : r.tax_cents), r.staff, r.sq_id, comp ? `Complimentary, worth ${money(r.amount_cents)}. ${r.note || ''}`.trim() : r.note].map(esc).join(',') + '\n';
          }
          if (chunk && !(await out.put(chunk))) break;
          n += rows.length; if (rows.length < 2000) break;
          if (n >= 2000000) { note = 'This file stops here because it is very large. Pick a shorter range to see the rest.'; break; }
          after = { t: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id }; await tick();
        }
      } catch (e) { console.error('payments export', e.message); note = 'This file stopped early because of a problem on the server. Try again, or pick a shorter range.'; }
      if (note && !out.gone) await out.put(esc('*** ' + note) + '\n');
      store.audit(actor, 'payments_export', null, null, { from, to, facility: fid, rows: n, partial: note ? true : undefined });
      return res.end();
    }
    /* ---------- ticket history: every ticket ever saved, searched straight from the database ---------- */
    const dayStartMs = (str, f) => { const d = calDay(str) && /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str)); if (!d) return null; return R.endOfDate(new Date(Date.UTC(+d[1], +d[2] - 1, +d[3] - 1)).toISOString().slice(0, 10), f); };
    const histFilter = () => {
      const fid = /^[\w-]{1,60}$/.test(String(query.facility || '')) ? String(query.facility) : '', f = fid ? S.facilities.find(x => x.id === fid) || null : null;
      return { q: String(query.q || '').slice(0, 40), facility: fid, from: dayStartMs(query.from, f), to: calDay(query.to) ? R.endOfDate(String(query.to), f) : null, status: query.status === 'open' || query.status === 'closed' ? query.status : '' };
    };
    const histSession = r => Object.assign({ id: r.id }, JSON.parse(r.data));
    const histRow = r => {
      const s = histSession(r), f = S.facilities.find(x => x.id === s.facilityId); let b = null; try { b = R.ticketBill(s); } catch (e) {}
      return { id: s.id, ticket: R.ticketOf(s), plate: s.plate || '', facilityId: s.facilityId || '', facility: f ? f.name : '', startAt: s.startAt || null, endAt: s.endAt || null, kind: s.kind || '', mode: s.mode || '',
        total: b ? b.total : null, paid: b ? b.paid : R.paidOf(s), due: b ? b.due : null, minutes: b ? b.minutes : null, waived: !!s.waived, cited: !!s.cited, validation: s.validation ? String(s.validation.code || '') : '',
        methods: [...new Set((s.payments || []).map(x => x.method).filter(Boolean))] };
    };
    if (p === '/api/admin/history' && m === 'GET') {
      const lim = Math.max(1, Math.min(200, +query.limit || 50)), off = Math.max(0, +query.offset || 0), r = store.history(Object.assign(histFilter(), { limit: lim, offset: off }));
      return send(res, 200, { total: r.total, offset: off, limit: lim, rows: r.rows.map(histRow) });
    }
    const hm = /^\/api\/admin\/history\/([\w-]{1,80})$/.exec(p);
    if (hm && m === 'GET') {
      const row = store.get("SELECT id, data FROM docs WHERE coll='sessions' AND id=?", hm[1]); if (!row) return fail(res, 404, 'Ticket not found', 'not_found');
      const s = histSession(row); let bill = null; try { const b = R.ticketBill(s); bill = { parking: b.parking, extras: b.extras, late: b.late, paid: b.paid, total: b.total, due: b.due, minutes: b.minutes, rule: b.detail && b.detail.rule }; } catch (e) {}
      return send(res, 200, { row: histRow(row), bill, notes: s.notes || s.note || '', plateOriginal: s.plateOriginal || '', waived: !!s.waived, cited: !!s.cited, valet: s.valet ? { tag: s.valet.tag || '', space: s.valet.space || '' } : null,
        payments: (s.payments || []).map(x => ({ at: x.at, amount: +x.amount || 0, method: x.method || '', by: x.by || '', refunded: +x.refunded || 0, simulated: String(x.pid || '').startsWith('sim_') })),
        history: (s.history || []).slice(-100).map(x => ({ at: x.at, action: x.action, by: x.by || '', detail: x.detail || '' })), photos: { entry: s.entryPhotoId || '', exit: s.exitPhotoId || '' } });
    }
    if (p === '/api/admin/history.csv' && m === 'GET') {
      const fl = histFilter(), fname = id => (S.facilities.find(f => f.id === id) || {}).name || id || '', esc = v => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const local = (t, f) => t ? localStamp(t, R.tzOf(f)) : '';
      res.writeHead(200, headers({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ticket-history.csv"' }));
      const out = sink(res); let n = 0, note = '';
      await out.put(['Ticket', 'Plate', 'Location', 'Arrived', 'Left', 'Minutes parked', 'Status', 'Charged', 'Paid', 'Balance due', 'How paid', 'Validation', 'Type', 'Ticket ID'].map(esc).join(',') + '\n');
      try {
        let after = null;
        for (;;) {
          const r = store.history(Object.assign({}, fl, { limit: 2000, after })); let chunk = '';
          for (const row of r.rows) { const x = histRow(row), f = S.facilities.find(y => y.id === x.facilityId);
            chunk += [x.ticket, x.plate, fname(x.facilityId), local(x.startAt, f), local(x.endAt, f), x.minutes == null ? '' : x.minutes, x.endAt ? (x.waived ? 'Waived' : x.cited ? 'Cited' : x.due > 0 ? 'Unpaid' : 'Paid / closed') : 'On site', x.total == null ? '' : x.total.toFixed(2), (+x.paid || 0).toFixed(2), x.due == null ? '' : x.due.toFixed(2), x.methods.join(' + '), x.validation, x.kind || x.mode, x.id].map(esc).join(',') + '\n'; n++; }
          if (chunk && !(await out.put(chunk))) break;
          if (r.rows.length < 2000) break;
          if (n >= 1000000) { note = 'This file stops here because it is very large. Pick a shorter range to see the rest.'; break; }
          const last = r.rows[r.rows.length - 1]; after = { ev: last.ev, id: last.id }; await tick();
        }
      } catch (e) { console.error('history export', e.message); note = 'This file stopped early because of a problem on the server. Try again, or pick a shorter range.'; }
      if (note && !out.gone) await out.put(esc('*** ' + note) + '\n');
      store.audit(actor, 'history_export', null, null, { rows: n, filter: fl, partial: note ? true : undefined });
      return res.end();
    }
    if (p === '/api/admin/storage' && m === 'GET') return send(res, 200, storageInfo());
    if (p === '/api/admin/scan' && m === 'GET') {
      const month = orgDay().slice(0, 7), days = store.all("SELECT day, n FROM scan_usage WHERE day >= ? ORDER BY day", orgDay(Date.now() - 31 * D));
      return send(res, 200, { configured: plates.configured, month, used: scanUsed(), cap: SCAN_CAP, regions: plates.regions, days, reader: plates.stats });
    }
    if (p === '/api/admin/outbox' && m === 'GET') return send(res, 200, { configured: mailer.configured, queue: mailer.queue(), messages: mailer.outbox.slice(0, 50), sms: { configured: sms.configured, queue: sms.queue(), messages: sms.outbox.slice(0, 50) } });
    if (p === '/api/admin/hotlist' && m === 'GET') return send(res, 200, R.hotList().map(h => ({ plate: h.plate, total: h.debt.total, count: h.debt.count, citations: h.debt.cits.length })));
    if (p === '/api/admin/payments' && m === 'GET') {
      const w = [], v = []; if (+query.since) { w.push('created_at>=?'); v.push(+query.since); }
      return send(res, 200, store.all(`SELECT id, sq_id, kind, ref, plate, amount_cents, refunded_cents, net_cents, tax_cents, status, card_last4, receipt_url, created_at, method, staff, ticket, facility_id, session_id, note FROM payments${w.length ? ' WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, ...v, Math.max(1, Math.min(5000, +query.limit || 200))));
    }
    /* Monthly parkers from a spreadsheet: one row per parker, matched to plans and companies by name. Nothing is charged. */
    if (p === '/api/admin/monthly/import' && m === 'POST') {
      const b = await readJson(req), rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : [], dry = !!b.dryRun;
      const acctKeys = [...new Set(rows.map(r => { const k = String(r.company || r.companyId || '').trim().toLowerCase(), c = k && S.companies.find(x => x.id === r.companyId || x.id === r.company || String(x.name || '').trim().toLowerCase() === k); return c ? 'acct:' + c.id : null; }).filter(Boolean))];
      return withLocks(acctKeys, async () => {
      const norm = s => String(s || '').trim().toLowerCase(), created = [], skipped = [];
      const planOf = x => S.permitTypes.find(t => t.id === x || norm(t.name) === norm(x)), coOf = x => x && S.companies.find(c => c.id === x || norm(c.name) === norm(x));
      const taken = new Map(), numbers = new Set(S.permits.map(pm => String(pm.number))); S.permits.forEach(pm => { if (['active', 'approved', 'pending', 'suspended'].includes(pm.status) && (!pm.endAt || pm.endAt > Date.now())) (pm.plates || []).forEach(pl => taken.set(Rules.normPlate(pl), pm.number)); });
      const ops = [], usedBy = {};
      rows.forEach((r, i) => {
        const line = i + 1, holder = String(r.name || r.holder || '').trim().slice(0, 80), plates = [...new Set(String(r.plates || r.plate || '').split(/[,;|\s]+/).map(Rules.normPlate).filter(Boolean))];
        const plan = planOf(r.plan || r.planId || r.type), co = coOf(r.company || r.companyId);
        if (!holder) return skipped.push({ line, reason: 'No name' });
        if (!plates.length) return skipped.push({ line, reason: 'No license plate' });
        if (!plan) return skipped.push({ line, reason: `Unknown plan "${r.plan || r.type || ''}"` });
        if ((r.company || r.companyId) && !co) return skipped.push({ line, reason: `Unknown company "${r.company || r.companyId}"` });
        const dup = plates.find(pl => taken.has(pl)); if (dup) return skipped.push({ line, reason: `${dup} is already on monthly #${taken.get(dup)}` });
        if (r.number && numbers.has(String(r.number).trim())) return skipped.push({ line, reason: `Monthly #${String(r.number).trim()} already exists` });
        if (co) { const rm = R.accountRoom(co.id, plan.id, { used: (usedBy[co.id] ??= R.accountUsed(co.id)) }); if (rm.error) return skipped.push({ line, reason: rm.error }); usedBy[co.id]++; }
        const f = S.facilities.find(x => x.id === (plan.facilities || [])[0]), mb = R.monthBounds(Date.now(), f);
        let paidThrough = mb.end; if (r.paidThrough) { const t = R.endOfDate(r.paidThrough, f) || Date.parse(r.paidThrough); if (t > 0) paidThrough = t; }
        const email = norm(r.email).slice(0, 200); let number = String(r.number || '').trim().slice(0, 12); if (!number || numbers.has(number)) number = R.newMonthlyNumber(numbers); numbers.add(number);
        const data = { holder, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '', phone: String(r.phone || '').trim().slice(0, 30), permitTypeId: plan.id, plates: plates.slice(0, plan.maxVehicles || 3), companyId: co ? co.id : null, companyName: co ? co.name : '', number, status: 'active', billing: co ? 'company' : 'office', createdAt: Date.now(), startAt: r.startAt && Date.parse(r.startAt) > 0 ? Date.parse(r.startAt) : Date.now(), endAt: null, paidThrough, source: 'import', importedAt: Date.now(), notes: String(r.notes || '').slice(0, 300) };
        plates.forEach(pl => taken.set(pl, number)); created.push({ line, holder, plates, plan: plan.name, company: co ? co.name : '', paidThrough });
        ops.push({ type: 'set', coll: 'permits', id: R.uid('p'), data });
      });
      if (!dry && ops.length) { await commit(ops, actor); store.audit(actor, 'monthly_import', 'permits', null, { created: ops.length, skipped: skipped.length }); }
      return send(res, 200, { created, skipped, dryRun: dry });
      });
    }
    if (p === '/api/admin/refund' && m === 'POST') {
      const b = await readJson(req); const pay = b.id ? store.get('SELECT * FROM payments WHERE id=?', b.id) : store.get('SELECT * FROM payments WHERE sq_id=?', String(b.sqId || '')); if (!pay) return fail(res, 404, 'Payment not found');
      return withLocks(['pay:' + pay.id], async () => {
        const cur = store.get('SELECT * FROM payments WHERE id=?', pay.id), left = cur.amount_cents - cur.refunded_cents, want = Math.round((+b.amount) * 100);
        if (!cur.sq_id) return fail(res, 400, 'Only card payments can be refunded here. Cash and checks are refunded from the drawer; record it as a note on the ticket.');
        if (!(want > 0) || want > left) return fail(res, 400, `Enter an amount up to ${money(left / 100)}.`);
        try { await square.refund({ paymentId: cur.sq_id, amount: want / 100, reason: b.reason || 'Refund' }); } catch (e) { return fail(res, 400, e.message, 'payment_failed'); }
        store.run('UPDATE payments SET refunded_cents=refunded_cents+? WHERE id=?', want, cur.id); actInvalidate(cur.created_at);
        store.audit(actor, 'refund', 'payments', cur.id, { amount: want / 100, reason: b.reason, ticket: cur.session_id || null });
        const sess = cur.session_id ? S.sessions.find(x => x.id === cur.session_id) : null;
        if (sess) await withLocks(['s:' + sess.id], () => commit([{ type: 'update', coll: 'sessions', id: sess.id, data: { payments: (sess.payments || []).map(x => x.pid === cur.sq_id ? Object.assign({}, x, { refunded: Math.round(((+x.refunded || 0) + want / 100) * 100) / 100 }) : x), history: R.histAdd(sess, { action: 'refund', by: staff.name, detail: money(want / 100) + ' refunded to the card' + (b.reason ? ' · ' + b.reason : '') }) } }], actor));
        else if (cur.session_id) { // an older ticket no longer held in memory: record the refund on it straight in the database
          try {
            const row = store.get("SELECT data, end_at FROM docs WHERE coll='sessions' AND id=?", cur.session_id);
            if (row) { const old = JSON.parse(row.data), at = Date.now(); old.payments = (old.payments || []).map(x => x.pid === cur.sq_id ? Object.assign({}, x, { refunded: Math.round(((+x.refunded || 0) + want / 100) * 100) / 100 }) : x);
              old.history = R.histAdd(old, { action: 'refund', by: staff.name, detail: money(want / 100) + ' refunded to the card' + (b.reason ? ' · ' + b.reason : '') });
              store.run("UPDATE docs SET data=?, updated_at=? WHERE coll='sessions' AND id=?", JSON.stringify(old), at, cur.session_id); }
          } catch (e) { console.error('Refund noted on the ledger but not on the old ticket:', e.message); }
        }
        return send(res, 200, { ok: true, refunded: want / 100 });
      });
    }
    if (p === '/api/admin/backup' && m === 'POST') {
      const f = store.backup(3, true); store.audit(actor, 'backup_download');
      return stream(res, f, 'application/octet-stream', { 'Content-Disposition': `attachment; filename="${path.basename(f)}"` });
    }
    if (p === '/api/admin/collections.csv' && m === 'GET') {
      const g = (cfg().unpaidGraceHours || 48) * H, rows = [['Plate', 'Type', 'Reference', 'Facility', 'Date', 'Amount owed', 'Stage', 'Photo links']];
      const fname = id => (S.facilities.find(f => f.id === id) || {}).name || '';
      S.sessions.filter(s => s.endAt && R.balanceOf(s) > 0 && Date.now() - s.endAt > g).forEach(s => rows.push([s.plate, 'Unpaid parking', s.id, fname(s.facilityId), new Date(s.endAt).toISOString(), R.balanceOf(s).toFixed(2), 'Past due', [s.entryPhotoId, s.exitPhotoId].filter(Boolean).map(x => BASE + '/photos/' + x).join(' ')]));
      S.citations.filter(c => c.status === 'open' && Date.now() - c.issuedAt > g).forEach(c => rows.push([c.plate, 'Citation', c.number, fname(c.facilityId), new Date(c.issuedAt).toISOString(), (+c.fine).toFixed(2), 'Open citation', (c.photoIds || []).map(x => BASE + '/photos/' + x).join(' ')]));
      store.audit(actor, 'collections_export', null, null, { rows: rows.length - 1 });
      const csv = rows.map(r => r.map(v => { v = String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
      return send(res, 200, csv, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="collections.csv"' });
    }
    if (p === '/api/admin/approveMonthly' && m === 'POST') {
      const b = await readJson(req);
      const pre = S.permits.find(x => x.id === b.id);
      return withLocks(['p:' + b.id, pre && pre.companyId ? 'acct:' + pre.companyId : null], async () => {
        const pm = S.permits.find(x => x.id === b.id); if (!pm) return fail(res, 404, 'Monthly parker not found');
        if (!['pending', 'waitlist'].includes(pm.status)) return fail(res, 400, 'Only waitlisted or pending parkers can be approved.');
        if (pm.companyId) { const rm = R.accountRoom(pm.companyId, pm.permitTypeId, { exclude: pm.id }); if (rm.error) return fail(res, 400, rm.error); }
        const t = S.permitTypes.find(x => x.id === pm.permitTypeId); if (!t) return fail(res, 400, 'Monthly plan missing');
        const f = S.facilities.find(x => x.id === (t.facilities || [])[0]), mb = R.monthBounds(Date.now(), f), first = Math.round(+t.price * (mb.end - Date.now()) / (mb.end - mb.start) * 100) / 100;
        if (pm.companyId) { await commit([{ type: 'update', coll: 'permits', id: pm.id, data: { status: 'active', startAt: Date.now(), paidThrough: mb.end, prorateDue: first } }], actor); return send(res, 200, { status: 'active', message: `Approved. ${money(first)} for the rest of this month goes on the company’s next bill.` }); }
        const a = pm.accountId ? store.get('SELECT * FROM accounts WHERE id=?', pm.accountId) : null;
        if (first > 0 && a && a.sq_card) {
          try {
            const pay = await takePayment({ amount: first, kind: 'monthly', ref: pm.number, plate: (pm.plates || [])[0] }, { savedCard: true, idempotencyKey: 'approve-' + pm.id }, a);
            await commit([{ type: 'update', coll: 'permits', id: pm.id, data: { status: 'active', startAt: Date.now(), paidThrough: mb.end, firstPaymentId: pay.id } }], actor);
            mailer.send({ to: a.email, subject: `Monthly parking #${pm.number} is active`, text: `Your ${t.name} monthly parking is active. We charged ${money(pay.total)} for the rest of this month to your card ending ${a.card_last4}; after that ${money(t.price)} is charged on the 1st.\n\n${orgName()}` });
            return send(res, 200, { status: 'active', message: `Approved and charged ${money(pay.total)} to the card on file.` });
          } catch (e) { if (e.code === 'NETWORK') return fail(res, 503, 'Couldn’t reach Square. Try again in a minute.'); }
        }
        await commit([{ type: 'update', coll: 'permits', id: pm.id, data: { status: 'approved', approvedAt: Date.now() } }], actor);
        mailer.send({ to: pm.email, subject: 'Monthly parking approved: pay to start', text: `A spot opened for ${t.name}. Pay ${money(first)} for the rest of this month to start: ${BASE}/?plate=${encodeURIComponent((pm.plates || [])[0] || '')}\n\n${orgName()}` });
        return send(res, 200, { status: 'approved', message: 'Approved. The driver was emailed a link to pay and start.' });
      });
    }
    if (p === '/api/admin/billing/run' && m === 'POST') { const n = await billMonthly(); await pollInvoices(); store.audit(actor, 'billing_run', null, null, { groups: n }); return send(res, 200, { billed: n }); }
    const im = /^\/api\/admin\/invoices\/([\w-]+)\/paid$/.exec(p);
    if (im && m === 'POST') { const inv = S.invoices.find(x => x.id === im[1]); if (!inv) return fail(res, 404, 'Invoice not found'); await markInvoice(inv, 'PAID', actor); return send(res, 200, { ok: true }); }
    /* Add many parkers to one account at once: a pasted list or spreadsheet. dryRun previews without saving. */
    const bm = /^\/api\/admin\/companies\/([\w-]+)\/parkers$/.exec(p);
    if (bm && m === 'POST') {
      const co = S.companies.find(x => x.id === bm[1]); if (!co) return fail(res, 404, 'Account not found');
      const b = await readJson(req), rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) return fail(res, 400, 'Add at least one parker.');
      return withLocks(['acct:' + co.id].concat([...new Set(rows.map(r => r.plan || b.planId).filter(Boolean))].map(x => 'plan:' + x)), async () => {
        const r = R.planAccountParkers({ companyId: co.id, planId: b.planId, rows, prorate: !!b.prorate, staff: true, source: 'account' });
        if (r.error) return fail(res, 400, r.error);
        if (!b.dryRun && r.ops.length) { await commit(r.ops, actor); store.audit(actor, 'account_parkers_added', 'companies', co.id, { added: r.ops.length, skipped: r.skipped.length }); }
        return send(res, 200, { created: r.created, skipped: r.skipped, dryRun: !!b.dryRun, used: R.accountUsed(co.id) + (b.dryRun ? r.created.filter(c => c.status !== 'waitlist').length : 0) });
      });
    }
    const cm = /^\/api\/admin\/companies\/([\w-]+)\/send-link$/.exec(p);
    if (cm && m === 'POST') {
      const co = S.companies.find(x => x.id === cm[1]); if (!co || !co.portalToken) return fail(res, 404, 'Company not found');
      mailer.send({ to: co.email, subject: `${orgName()} monthly parking for ${co.name}`, text: `Hi ${co.contactName || ''},\n\nUse this private link to add or remove employees, see invoices${co.billing === 'card' ? ' and keep the company card up to date' : ''}:\n\n${BASE}/?company=${co.portalToken}\n\nDon’t share it outside your company.\n\n${orgName()}` });
      store.audit(actor, 'company_link_sent', 'companies', co.id); return send(res, 200, { ok: true });
    }
    return fail(res, 404, 'Not found', 'not_found');
  }

  /* ----- company portal (private link) ----- */
  const cpm = /^\/api\/company\/([A-Za-z0-9]{20,64})(\/.*)?$/.exec(p);
  if (cpm) {
    if (limited(req, 'company', 60)) return fail(res, 429, 'Too many requests. Wait a minute.', 'rate_limited');
    const co = S.companies.find(x => x.portalToken && x.portalToken === cpm[1]); if (!co) return fail(res, 404, 'This link is no longer valid. Ask the parking office for a new one.', 'not_found');
    const sub = cpm[2] || '';
    if (!sub && m === 'GET') {
      const bp = billingOf('co:' + co.id);
      const room = R.accountRoom(co.id, null, { adding: 0 });
      return send(res, 200, { company: { name: co.name, contactName: co.contactName, billing: co.billing, card: bp && bp.sq_card ? { brand: bp.brand, last4: bp.last4, exp: bp.exp } : null, max: room.max || 0, used: room.used || 0, left: room.left == null ? null : room.left, locations: (co.facilityIds || []).map(id => (S.facilities.find(f => f.id === id) || {}).name).filter(Boolean) },
        plans: S.permitTypes.filter(t => t.active !== false && !R.accountRoom(co.id, t.id, { adding: 0 }).error).map(t => ({ id: t.id, name: t.name, price: t.price, kind: t.kind, maxVehicles: t.maxVehicles || 3, facilities: (t.facilities || []).map(id => (S.facilities.find(f => f.id === id) || {}).name).filter(Boolean), left: +t.quota ? Math.max(0, t.quota - R.soldOf(t)) : null })),
        employeeTotal: S.permits.reduce((n, x) => n + (x.companyId === co.id && x.status !== 'cancelled' ? 1 : 0), 0),
        employees: S.permits.filter(x => x.companyId === co.id && x.status !== 'cancelled').slice(0, 3000).map(x => ({ id: x.id, number: x.number, holder: x.holder, email: x.email, plates: x.plates, plan: (S.permitTypes.find(t => t.id === x.permitTypeId) || {}).name, status: x.status, paidThrough: x.paidThrough, endAt: x.endAt })),
        invoices: S.invoices.filter(i => i.companyId === co.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 24).map(i => ({ period: i.period, amount: i.amount, status: i.status, dueDate: i.dueDate, publicUrl: i.publicUrl })) });
    }
    if (sub === '/employees' && m === 'POST') {
      const b = await readJson(req);
      return withLocks(['plan:' + b.planId, 'acct:' + co.id], async () => {
        if (!portalRoom(co)) return fail(res, 429, `This link has added ${PORTAL_ADDS} parkers in the last day, which is the daily limit. Try again tomorrow, or ask the parking office to add the rest.`, 'rate_limited');
        const r = R.PORTAL.monthlySignup({ planId: b.planId, name: b.name, email: b.email, phone: b.phone, plates: b.plates, companyId: co.id, companyName: co.name, source: 'company' });
        if (r.error) return fail(res, 400, r.error);
        const plan = S.permitTypes.find(t => t.id === b.planId), f = S.facilities.find(x => x.id === (plan.facilities || [])[0]), mb = R.monthBounds(Date.now(), f);
        const first = Math.round(+plan.price * (mb.end - Date.now()) / (mb.end - mb.start) * 100) / 100;
        const ops = withPay(r.ops, null).map(o => o.type === 'set' && o.coll === 'permits' && o.data.status === 'active' ? Object.assign({}, o, { data: Object.assign({}, o.data, { prorateDue: first }) }) : o);
        await commit(ops, 'company:' + co.name);
        return send(res, 200, { receipt: r.receipt.title === 'Monthly parking started' ? { title: `${String(b.name).slice(0, 80)} added`, body: `${plan.name}. ${money(first)} for the rest of this month and ${money(plan.price)} a month after that go on the company’s bill.` } : r.receipt });
      });
    }
    /* A pasted list of employees, for the plan chosen: the same checks as the office, and the rest of the month goes on the next bill. */
    if (sub === '/parkers' && m === 'POST') {
      const b = await readJson(req), rows = Array.isArray(b.rows) ? b.rows.slice(0, 300) : [];
      if (!rows.length) return fail(res, 400, 'Paste at least one employee.');
      return withLocks(['acct:' + co.id, 'plan:' + b.planId], async () => {
        const room = portalRoom(co); if (!room) return fail(res, 429, `This link has added ${PORTAL_ADDS} parkers in the last day, which is the daily limit. Try again tomorrow, or ask the parking office to add the rest.`, 'rate_limited');
        const r = R.planAccountParkers({ companyId: co.id, planId: b.planId, rows: rows.slice(0, room).map(x => ({ name: x.name, email: x.email, phone: x.phone, plates: x.plates })), prorate: true, staff: false, source: 'company' });
        if (r.error) return fail(res, 400, r.error);
        if (!b.dryRun && r.ops.length) await commit(r.ops, 'company:' + co.name);
        return send(res, 200, { created: r.created, skipped: r.skipped.concat(rows.length > room ? [{ line: room + 1, reason: `Daily limit of ${PORTAL_ADDS} parkers per link reached; the rows from here on were not added.` }] : []), dryRun: !!b.dryRun });
      });
    }
    const em = /^\/employees\/([\w-]+)\/cancel$/.exec(sub);
    if (em && m === 'POST') { const r = R.PORTAL.cancelMonthly({ permitId: em[1], companyId: co.id }); if (r.error) return fail(res, 400, r.error); await commit(r.ops, 'company:' + co.name); return send(res, 200, { receipt: r.receipt }); }
    if (sub === '/card' && m === 'POST') {
      const b = await readJson(req);
      try {
        const bp = billingOf('co:' + co.id); let cust = bp && bp.sq_customer;
        if (!cust) cust = await square.createCustomer({ email: co.email, name: co.contactName || co.name, companyName: co.name, referenceId: co.id });
        const card = await square.createCard({ sourceId: b.sourceId, verificationToken: b.verificationToken, customerId: cust, postalCode: b.postalCode, cardholderName: co.name, referenceId: co.id });
        if (bp && bp.sq_card) square.disableCard(bp.sq_card).catch(() => {});
        store.run('INSERT INTO billing (owner, sq_customer, sq_card, brand, last4, exp, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET sq_customer=excluded.sq_customer, sq_card=excluded.sq_card, brand=excluded.brand, last4=excluded.last4, exp=excluded.exp, updated_at=excluded.updated_at', 'co:' + co.id, cust, card.id, card.brand, card.last4, card.exp, Date.now());
        await commit([{ type: 'update', coll: 'companies', id: co.id, data: { card: { brand: card.brand, last4: card.last4 } } }], 'company:' + co.name);
        return send(res, 200, { card: { brand: card.brand, last4: card.last4, exp: card.exp } });
      } catch (e) { return fail(res, 400, e.message || 'Couldn’t save that card.', 'payment_failed'); }
    }
    return fail(res, 404, 'Not found', 'not_found');
  }

  /* ----- driver accounts ----- */
  if (p.startsWith('/api/account/')) {
    const op = p.slice(13);
    if (op === 'signup' && m === 'POST') {
      if (limited(req, 'signup', 5)) return fail(res, 429, 'Too many sign-ups from here. Wait a minute.', 'rate_limited');
      const b = await readJson(req); const email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 80);
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return fail(res, 400, 'Add your name and a valid email.');
      const e = Auth.pwProblem(b.password); if (e) return fail(res, 400, e);
      if (store.get('SELECT id FROM accounts WHERE email=?', email)) return fail(res, 400, 'Couldn’t create an account with that email. If you already have one, sign in or reset your password.');
      const plates = [...new Set(String(b.plates || '').split(',').map(Rules.normPlate).filter(Boolean))].slice(0, 5);
      const clash = plates.find(pl => S.members.some(mm => (mm.plates || []).includes(pl)));
      if (clash) return fail(res, 400, `${clash} is already on another account with autopay. Contact the parking office if it’s yours.`);
      const id = 'a_' + crypto.randomBytes(8).toString('hex'), t = Date.now();
      store.run('INSERT INTO accounts (id, email, name, phone, pw, plates, plate_added, created_at) VALUES (?,?,?,?,?,?,?,?)', id, email, name, String(b.phone || '').trim().slice(0, 30), await Auth.hashPw(b.password), JSON.stringify(plates), JSON.stringify(Object.fromEntries(plates.map(pl => [pl, t]))), t);
      mailer.send({ to: email, subject: 'Your parking account is ready', text: `Your parking account is ready. Add a card and turn on autopay so you can drive in and out without stopping.\n\n${BASE}/?account=1` });
      return send(res, 200, { account: accountView(store.get('SELECT * FROM accounts WHERE id=?', id)) }, { 'Set-Cookie': setCookie('po_acct', auth.startSession('acct', id, 24 * 30), 2592000) });
    }
    if (op === 'login' && m === 'POST') {
      if (limited(req, 'alogin', 10)) return fail(res, 429, 'Too many attempts. Wait a minute.', 'rate_limited');
      const b = await readJson(req); const r = await auth.login('accounts', b.email, b.password);
      if (r.error) return fail(res, 401, r.error, 'unauthenticated');
      return send(res, 200, { account: accountView(r.row) }, { 'Set-Cookie': setCookie('po_acct', auth.startSession('acct', r.row.id, 24 * 30), 2592000) });
    }
    if (op === 'logout' && m === 'POST') { auth.endSession(cookie(req, 'po_acct')); return send(res, 200, { ok: true }, { 'Set-Cookie': 'po_acct=; Path=/; Max-Age=0' }); }
    if (op === 'reset' && m === 'POST') {
      if (limited(req, 'reset', 5)) return fail(res, 429, 'Too many requests. Wait a minute.', 'rate_limited');
      const b = await readJson(req); const a = store.get('SELECT * FROM accounts WHERE email=?', String(b.email || '').trim().toLowerCase());
      if (a && !(a.reset_expires && a.reset_expires - H > Date.now() - 5 * M)) {
        const t = auth.newToken(); store.run('UPDATE accounts SET reset_hash=?, reset_expires=? WHERE id=?', auth.tokenHash(t), Date.now() + H, a.id);
        mailer.send({ to: a.email, subject: 'Reset your parking account password', text: `Use this link within 1 hour to choose a new password:\n\n${BASE}/?reset=${t}\n\nIf you didn’t ask for this, ignore this email.` });
      }
      return send(res, 200, { ok: true });
    }
    if (op === 'reset/confirm' && m === 'POST') {
      const b = await readJson(req); const a = store.get('SELECT * FROM accounts WHERE reset_hash=?', auth.tokenHash(String(b.token || '')));
      if (!a || a.reset_expires < Date.now()) return fail(res, 400, 'That reset link has expired. Request a new one.');
      const e = Auth.pwProblem(b.password); if (e) return fail(res, 400, e);
      store.run('UPDATE accounts SET pw=?, reset_hash=NULL, reset_expires=NULL, failed=0, locked_until=NULL WHERE id=?', await Auth.hashPw(b.password), a.id); auth.endAll('acct', a.id);
      return send(res, 200, { account: accountView(a) }, { 'Set-Cookie': setCookie('po_acct', auth.startSession('acct', a.id, 24 * 30), 2592000) });
    }
    if (!acct) return fail(res, 401, 'Sign in to your account.', 'unauthenticated');
    if (op === 'me' && m === 'GET') return send(res, 200, { account: accountView(acct) });
    if (op === 'me' && m === 'PATCH') {
      const b = await readJson(req); const sets = [], vals = [];
      if (b.name != null) { sets.push('name=?'); vals.push(String(b.name).trim().slice(0, 80) || acct.name); }
      if (b.phone != null) { sets.push('phone=?'); vals.push(String(b.phone).trim().slice(0, 30)); }
      if (b.plates != null) {
        const plates = [...new Set((Array.isArray(b.plates) ? b.plates : String(b.plates).split(',')).map(Rules.normPlate).filter(Boolean))].slice(0, 5);
        const clash = plates.find(pl => S.members.some(mm => mm.accountId !== acct.id && (mm.plates || []).includes(pl)));
        if (clash) return fail(res, 400, `${clash} is already on another account with autopay. Contact the parking office if it’s yours.`);
        const added = plateAdded(acct), next = {}; plates.forEach(pl => { next[pl] = added[pl] || Date.now(); });
        sets.push('plates=?', 'plate_added=?'); vals.push(JSON.stringify(plates), JSON.stringify(next));
      }
      if (typeof b.autopay === 'boolean') { sets.push('autopay=?'); vals.push(b.autopay ? 1 : 0); }
      if (sets.length) store.run(`UPDATE accounts SET ${sets.join(', ')} WHERE id=?`, ...vals, acct.id);
      const a = store.get('SELECT * FROM accounts WHERE id=?', acct.id); await syncMember(a);
      return send(res, 200, { account: accountView(a) });
    }
    if (op === 'card' && m === 'POST') {
      const b = await readJson(req);
      const clash = acctPlates(acct).find(pl => S.members.some(mm => mm.accountId !== acct.id && (mm.plates || []).includes(pl)));
      if (clash && acct.autopay) return fail(res, 400, `${clash} is already on another account with autopay. Remove it from your plates first.`);
      try {
        let cust = acct.sq_customer;
        if (!cust) { cust = await square.createCustomer({ email: acct.email, name: acct.name, referenceId: acct.id }); store.run('UPDATE accounts SET sq_customer=? WHERE id=?', cust, acct.id); }
        const card = await square.createCard({ sourceId: b.sourceId, verificationToken: b.verificationToken, customerId: cust, postalCode: b.postalCode, cardholderName: acct.name, referenceId: acct.id });
        if (acct.sq_card) square.disableCard(acct.sq_card).catch(() => {});
        store.run('UPDATE accounts SET sq_card=?, card_brand=?, card_last4=?, card_exp=? WHERE id=?', card.id, card.brand, card.last4, card.exp, acct.id);
      } catch (e) { return fail(res, 400, e.message || 'Couldn’t save that card.', 'payment_failed'); }
      const a = store.get('SELECT * FROM accounts WHERE id=?', acct.id); await syncMember(a);
      return send(res, 200, { account: accountView(a) });
    }
    if (op === 'card' && m === 'DELETE') {
      if (acct.sq_card) square.disableCard(acct.sq_card).catch(() => {});
      store.run('UPDATE accounts SET sq_card=NULL, card_brand=NULL, card_last4=NULL, card_exp=NULL WHERE id=?', acct.id);
      const a = store.get('SELECT * FROM accounts WHERE id=?', acct.id); await syncMember(a); return send(res, 200, { account: accountView(a) });
    }
    if (op === 'activity' && m === 'GET') {
      const plates = acctPlates(acct), added = plateAdded(acct), since = Date.now() - 90 * D, fname = id => (S.facilities.find(f => f.id === id) || {}).name || '';
      const mine = x => { const pl = Rules.normPlate(x.plate); return plates.includes(pl) && ((x.endAt || x.startAt || x.issuedAt) >= (added[pl] || acct.created_at)); };
      const myPids = new Set(store.all('SELECT sq_id FROM payments WHERE account_id=?', acct.id).map(x => x.sq_id));
      const involved = s => s.memberId === 'acct-' + acct.id || (s.payments || []).some(x => x.pid && myPids.has(x.pid)) || R.balanceOf(s) > 0; // visits on autopay, paid from this account, or still owed
      const held = new Set(S.sessions.map(s => s.id)), older = []; // visits that have left the screens' memory still show here, read from the database
      for (const pl of plates.slice(0, 5)) { try { for (const r of store.platesSince(pl, since, 100)) if (!held.has(r.id)) older.push(Object.assign({ id: r.id }, JSON.parse(r.data))); } catch (e) { console.error('driver history', e.message); } }
      const sessions = (older.length ? S.sessions.concat(older) : S.sessions).filter(s => mine(s) && (s.startAt || s.endAt) > since && !s.noEntry && involved(s)).sort((a, b) => (b.startAt || 0) - (a.startAt || 0)).slice(0, 100)
        .map(s => ({ id: s.id, plate: s.plate, facilityName: fname(s.facilityId), startAt: s.startAt, endAt: s.endAt, fee: R.sessionFee(s), paid: R.paidOf(s), balance: R.balanceOf(s), lateFee: +s.lateFee || 0, validation: s.validation ? s.validation.code : null, status: R.exitStatus(s) }));
      const owed = S.sessions.filter(s => mine(s) && s.endAt && R.balanceOf(s) > 0), cits = S.citations.filter(c => mine(c) && c.status === 'open');
      const resv = S.reservations.filter(r => r.accountId === acct.id).sort((a, b) => b.start - a.start).slice(0, 30)
        .map(r => ({ code: r.code, facilityName: fname(r.facilityId), start: r.start, end: r.end, status: r.status, premium: r.premium, plate: r.plate }));
      const monthly = S.permits.filter(x => x.accountId === acct.id && x.status !== 'cancelled').map(x => { const t = S.permitTypes.find(y => y.id === x.permitTypeId) || {}; const due = x.status === 'suspended' || !!x.pastDueSince; return { id: x.id, number: x.number, plan: t.name, price: t.price, plates: x.plates, status: x.status, paidThrough: x.paidThrough, endAt: x.endAt, pastDue: due, amountDue: due ? R.taxOf((+t.price || 0) + (+x.lateFeeDue || 0)).total : 0 }; });
      const pays = store.all('SELECT kind, ref, plate, amount_cents, refunded_cents, tax_cents, card_last4, receipt_url, created_at FROM payments WHERE account_id=? ORDER BY created_at DESC LIMIT 50', acct.id);
      const owedBase = owed.reduce((a, s) => a + R.balanceOf(s), 0) + cits.reduce((a, c) => a + (+c.fine || 0), 0);
      return send(res, 200, { sessions, owed: owed.map(s => ({ id: s.id, plate: s.plate, facilityName: fname(s.facilityId), endAt: s.endAt, balance: R.balanceOf(s) })), citations: cits.map(c => ({ id: c.id, number: c.number, plate: c.plate, fine: c.fine, violationName: c.violationName, issuedAt: c.issuedAt })), owedTotal: owedBase > 0 ? R.taxOf(owedBase).total : 0, reservations: resv, monthly, payments: pays });
    }
    if (op === 'pay-all' && m === 'POST') {
      const b = await readJson(req), plates = acctPlates(acct), added = plateAdded(acct);
      const mine = x => { const pl = Rules.normPlate(x.plate); return plates.includes(pl) && ((x.endAt || x.startAt || x.issuedAt) >= (added[pl] || acct.created_at)); };
      const keys = S.sessions.filter(s => mine(s) && s.endAt && R.balanceOf(s) > 0).map(s => 's:' + s.id).concat(S.citations.filter(c => mine(c) && c.status === 'open').map(c => 'c:' + c.id), ['acct:' + acct.id]);
      return withLocks(keys, async () => {
        const owed = S.sessions.filter(s => mine(s) && s.endAt && R.balanceOf(s) > 0), cits = S.citations.filter(c => mine(c) && c.status === 'open');
        const base = Math.round((owed.reduce((a, s) => a + R.balanceOf(s), 0) + cits.reduce((a, c) => a + (+c.fine || 0), 0)) * 100) / 100;
        if (!(base > 0)) return fail(res, 400, 'Nothing is owed on your plates.');
        const total = R.taxOf(base).total;
        if (b.expectedAmount != null && Math.abs(+b.expectedAmount - total) > 0.005) return fail(res, 409, `The amount is now ${money(total)}. Review it and pay again.`, 'amount_changed', { amount: total });
        let pay; try { pay = await takePayment({ amount: base, kind: 'pay_all', ref: acct.id, plate: plates.join(' ') }, b.payment, acct); } catch (e) { return fail(res, 400, e.code === 'NETWORK' ? 'We couldn’t confirm your payment. Check your email for a receipt before trying again.' : e.message, e.code === 'NETWORK' ? 'network' : 'payment_failed'); }
        if (pay.repeat) return send(res, 200, { receipt: { title: `Already paid ${money(pay.total)}`, body: 'This payment went through the first time.' }, receiptUrl: pay.receiptUrl });
        const t = Date.now();
        try {
          await commit(owed.map(s => ({ type: 'update', coll: 'sessions', id: s.id, newPayments: [{ amount: R.balanceOf(s), at: t, method: 'online', pid: pay.id }], data: {} }))
            .concat(cits.map(c => ({ type: 'update', coll: 'citations', id: c.id, data: { status: 'paid', paidAt: t, paidVia: 'online', paymentId: pay.id } }))));
        } catch (e) { console.error(e); alertOnce('commit:' + pay.id, 1, 'Payment taken but record not saved', e.message); }
        mailer.send({ to: acct.email, subject: `Receipt: ${money(pay.total)} paid`, text: `We received ${money(pay.total)}${taxLine(base)} for ${owed.length} parking balance(s) and ${cits.length} citation(s).${pay.receiptUrl ? '\n\nReceipt: ' + pay.receiptUrl : ''}\n\n${orgName()}` });
        return send(res, 200, { receipt: { title: `Paid ${money(pay.total)}`, body: `${owed.length} parking balance${owed.length === 1 ? '' : 's'} and ${cits.length} citation${cits.length === 1 ? '' : 's'} are settled.` }, receiptUrl: pay.receiptUrl });
      });
    }
    if (op === 'monthly/pay' && m === 'POST') {
      const b = await readJson(req);
      return withLocks(['p:' + b.permitId], async () => {
        const pm = S.permits.find(x => x.id === b.permitId && x.accountId === acct.id); if (!pm || !(pm.status === 'suspended' || pm.pastDueSince)) return fail(res, 400, 'Nothing is due on that monthly plan.');
        const t = S.permitTypes.find(x => x.id === pm.permitTypeId); if (!t) return fail(res, 400, 'That monthly plan no longer exists. Contact the parking office.');
        const f = S.facilities.find(x => x.id === (t.facilities || [])[0]), mb = R.monthBounds(Date.now(), f);
        const base = Math.round(((+t.price || 0) + (+pm.lateFeeDue || 0)) * 100) / 100;
        let pay; try { pay = await takePayment({ amount: base, kind: 'monthly', ref: pm.number + ' ' + mb.period, plate: (pm.plates || [])[0] }, b.payment, acct); } catch (e) { return fail(res, 400, e.message, e.code === 'NETWORK' ? 'network' : 'payment_failed'); }
        if (pay.repeat) return fail(res, 409, 'That payment already went through. Refresh the page to see your monthly parking.', 'already_paid');
        await commit([{ type: 'update', coll: 'permits', id: pm.id, data: { status: 'active', paidThrough: mb.end, pastDueSince: null, lateFeeDue: 0, billAttempts: 0, lastPaymentId: pay.id } }], 'account:' + acct.email);
        return send(res, 200, { receipt: { title: `Paid ${money(pay.total)}`, body: `Monthly #${pm.number} is active through the end of the month.` }, receiptUrl: pay.receiptUrl });
      });
    }
    return fail(res, 404, 'Not found', 'not_found');
  }

  /* ----- driver portal ----- */
  /* Driver limits are per plate (or link) on top of a high ceiling per address: many phones share one address on venue
     Wi-Fi and on phone carriers, so a per-address limit alone turns away a crowd on a busy night. */
  const plateKey = x => Rules.normPlate(x || '').slice(0, 12) || '-';
  if (p === '/api/portal/lookup' && m === 'GET') {
    if (limited(req, 'lookupIp', 600) || limited(req, 'lookup', 30, plateKey(query.plate))) return fail(res, 429, 'Too many lookups. Wait a minute.', 'rate_limited');
    return send(res, 200, R.lookup(query.plate) || {});
  }
  if (p === '/api/portal/extend' && m === 'GET') {
    if (limited(req, 'lookupIp', 600) || limited(req, 'extend', 30, String(query.token || '').slice(0, 40))) return fail(res, 429, 'Too many lookups. Wait a minute.', 'rate_limited');
    const s = R.sessionByToken(String(query.token || '')); if (!s) return fail(res, 404, 'That link has expired. Start a new payment instead.', 'not_found');
    return send(res, 200, { plate: s.plate, facilityId: s.facilityId, paidUntil: s.paidUntil || null, phone: s.phone ? '•••' + String(s.phone).slice(-4) : null });
  }
  if (p === '/api/portal/quote' && m === 'GET') {
    if (limited(req, 'quoteIp', 3000) || limited(req, 'quote', 120, plateKey(query.plate))) return fail(res, 429, 'Too many requests. Wait a minute.', 'rate_limited');
    const f = S.facilities.find(x => x.id === query.facilityId); if (!f) return fail(res, 400, 'Choose where you are parked.');
    const base = R.quote(f.id, Math.min(72, Math.max(0, +query.hours || 0)), query.untilEndOfDay === '1', query.plate || '');
    const live = query.plate ? R.liveForPlate(Rules.normPlate(query.plate), f.id) : null, from = live && live.paidUntil > Date.now() ? live.paidUntil : Date.now();
    const until = query.untilEndOfDay === '1' ? R.nextDayStart(R.dayStart(from, f), f) : from + (+query.hours || 0) * H;
    const t = R.taxOf(base); return send(res, 200, { amount: base, total: t.total, tax: t.tax, until, extending: !!(live && live.paidUntil > Date.now()) });
  }
  if (p === '/api/portal/availability' && m === 'GET') {
    const f = S.facilities.find(x => x.id === query.facilityId); const start = +query.start, hours = +query.hours || 2;
    if (!f || !start) return fail(res, 400, 'Choose a garage and time.');
    const av = R.resAvailability(f.id, start, start + hours * H);
    return send(res, 200, { left: av.left, cap: av.cap, premium: +f.reservationPremium || 0, premiumTotal: R.taxOf(+f.reservationPremium || 0).total, estParking: R.charge(f, start, start + hours * H, null) });
  }
  const pm = /^\/api\/portal\/([a-zA-Z]+)$/.exec(p);
  if (pm && m === 'POST') {
    const op = pm[1];
    if (!PUBLIC_OPS.includes(op) && !ACCOUNT_OPS.includes(op)) return fail(res, 404, 'Unknown action');
    if (ACCOUNT_OPS.includes(op) && !acct) return fail(res, 401, 'Sign in to your account first.', 'unauthenticated');
    if (limited(req, 'portalIp', 300)) return fail(res, 429, 'Too many requests. Wait a minute.', 'rate_limited');
    let b; try { b = await readJson(req); } catch (e) { return fail(res, 400, 'Body must be JSON'); }
    const args = Object.assign({}, b.args || {});
    const who = args.plate ? plateKey(args.plate) : String(args.citationId || args.sessionId || args.permitId || args.code || args.reservationId || '-').slice(0, 40);
    if (limited(req, 'portal', 12, op + ':' + who)) return fail(res, 429, 'Too many requests. Wait a minute.', 'rate_limited');
    const card = !!(b.payment && (b.payment.sourceId || b.payment.savedCard));
    if (card && cardBlocked(req)) return fail(res, 429, 'Too many cards were declined from this network. Try again in 15 minutes, use your phone’s data instead of Wi-Fi, or pay at the booth.', 'rate_limited');
    delete args.accountId; delete args.companyId; delete args.companyName; delete args.source;
    // An email for the receipt (optional): checked here so nothing odd reaches a mail header.
    if (args.email != null && String(args.email).trim() !== '') { const em = String(args.email).trim().toLowerCase(); if (!Rules.emailOk(em)) return send(res, 200, { error: 'Check the email address.' }); args.email = em; } else delete args.email;
    if (acct) { args.accountId = acct.id; if (['reserve', 'monthlySignup'].includes(op)) { args.name = args.name || acct.name; args.email = acct.email; } }
    if (op === 'monthlySignup' && !acct.sq_card) return send(res, 200, { error: 'Add a card to your account first. Monthly parking is billed to it on the 1st.' });
    if (op === 'monthlySignup') b.payment = { savedCard: true, idempotencyKey: b.payment && b.payment.idempotencyKey };
    try { const out = await runPortal(op, args, b.payment, acct, b.expectedAmount); const declined = !!(out && out.error && out.code === 'payment_failed'); if (card && out && (declined || (out.receipt && !out.error))) cardTried(req, declined); return send(res, 200, out); }
    catch (e) { return fail(res, e.status || 500, e.message, 'unavailable'); }
  }
  return fail(res, 404, 'Not found', 'not_found');
}

/* ---------- boot ---------- */
async function bootstrap() {
  await store.init();
  auth = Auth(store); photos = Photos(store, store.dir);
  const rows = await store.loadAll();
  rows.forEach(r => applyDoc(r.coll, r.id, r.data)); rebuildPlateIndex();
  FEED = await store.recentReads(100);
  if (!store.get('SELECT id FROM users LIMIT 1')) {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase(), pw = process.env.ADMIN_PASSWORD || '';
    if (email && !Auth.pwProblem(pw)) { store.run('INSERT INTO users (id, email, name, role, pw, created_at) VALUES (?,?,?,?,?,?)', 'u_' + crypto.randomBytes(6).toString('hex'), email, process.env.ADMIN_NAME || 'Owner', 'owner', await Auth.hashPw(pw), Date.now()); console.log('Created first owner', email); }
    else console.warn('No staff accounts yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) and restart to create the first owner.');
  }
  if (!rows.length && process.env.NO_STARTER !== '1') {
    const t = Date.now(), tok = () => crypto.randomBytes(12).toString('hex');
    await commit([
      { type: 'set', coll: 'settings', id: 'config', data: { campusName: '', timeZone: 'America/Chicago', taxRate: 8.25, taxIncluded: true, unpaidGraceHours: 48, lateFee: 10, autoCiteHours: 96, hotListAmount: 100, hotListCount: 3, printerWidth: 3, cameraQuietMinutes: 60, enforcementGraceMin: 10, monthlyLateFee: 25, monthlyGraceDays: 5, invoiceDueDays: 5, holidays: [] } },
      { type: 'set', coll: 'facilities', id: 'f-main', data: { name: 'Main Street Garage', type: 'garage', payMode: 'lpr', capacity: 500, baseline: 0, timeZone: 'America/Chicago', reservedSpaces: 20, reservationPremium: 5, reservationGraceMin: 60, cancelHours: 2,
        rates: { mode: 'increment', incrementMin: 30, incrementPrice: 3, dailyMax: 22, graceMin: 10, resetTime: '03:00', specials: [{ id: 'sp-eb', name: 'Early bird', days: [1, 2, 3, 4, 5], enterFrom: '05:00', enterUntil: '09:00', exitBy: '19:00', price: 14 }, { id: 'sp-ev', name: 'Evening', days: [0, 1, 2, 3, 4, 5, 6], enterFrom: '16:00', enterUntil: '02:00', exitBy: '06:00', exitNextDay: true, price: 8 }] }, address: 'Starter garage: edit to match yours', sample: true, createdAt: t } },
      { type: 'set', coll: 'facilities', id: 'f-lot', data: { name: 'Elm Street Lot', type: 'lot', payMode: 'qr', lotCode: '4201', capacity: 80, baseline: 0, timeZone: 'America/Chicago', reservedSpaces: 0,
        rates: { mode: 'increment', incrementMin: 60, incrementPrice: 2, dailyMax: 12, graceMin: 5, resetTime: '00:00', specials: [] }, address: 'Starter QR lot: edit to match yours', sample: true, createdAt: t } },
      { type: 'set', coll: 'cameras', id: 'c-main-in', data: { name: 'Main Entry 1', facilityId: 'f-main', direction: 'in', model: '', token: tok(), sample: true, createdAt: t } },
      { type: 'set', coll: 'cameras', id: 'c-main-out', data: { name: 'Main Exit 1', facilityId: 'f-main', direction: 'out', model: '', token: tok(), sample: true, createdAt: t } },
      { type: 'set', coll: 'permitTypes', id: 't-unres', data: { name: 'Unreserved monthly', kind: 'unreserved', price: 165, quota: 250, maxVehicles: 3, facilities: ['f-main'], active: true, sample: true } },
      { type: 'set', coll: 'permitTypes', id: 't-res', data: { name: 'Reserved monthly', kind: 'reserved', price: 245, quota: 30, maxVehicles: 2, facilities: ['f-main'], active: true, sample: true } },
    ]);
  }
  const server = http.createServer((req, res) => {
    route(req, res).catch(e => { if (!e.status || e.status >= 500) console.error(e); if (!res.headersSent) fail(res, e.status || 500, e.status === 413 ? 'Upload too large' : e.status && e.status < 500 ? e.message : e.status === 503 ? e.message : 'Server error', e.status && e.status < 500 ? 'invalid_argument' : 'unavailable'); else res.end(); });
  });
  server.requestTimeout = 60000; server.headersTimeout = 20000;
  server.listen(PORT, () => console.log(`ParkOps on :${PORT} · ${rows.length} records · links ${BASE} · payments ${square.live ? 'Square ' + square.env : 'SIMULATED'} · email ${mailer.configured ? 'on' : 'outbox only'} · texts ${sms.configured ? 'on' : 'outbox only'}`));
  if (!process.env.PUBLIC_URL && !process.env.RENDER_EXTERNAL_URL) console.warn('PUBLIC_URL is not set: email and text links will point to ' + BASE);
  const every = process.env.JOBS_FAST === '1' ? 5000 : 5 * M;
  let collBusy = false; // a slow run (thousands of card charges) must not be started again on top of itself
  const runCollections = () => { if (collBusy) return; collBusy = true; collectionsRun().catch(e => console.error('collections', e)).finally(() => { collBusy = false; }); };
  setInterval(runCollections, every).unref();
  setTimeout(runCollections, Math.min(15000, every)).unref();
  setInterval(() => remindersRun().catch(e => console.error('reminders', e)), process.env.JOBS_FAST === '1' ? 3000 : M).unref();
  setInterval(() => monthlyRemindersRun().catch(e => console.error('monthly reminders', e)), process.env.JOBS_FAST === '1' ? 4000 : 15 * M).unref();
  setTimeout(() => monthlyRemindersRun().catch(e => console.error('monthly reminders', e)), process.env.JOBS_FAST === '1' ? 2500 : 2 * M).unref();
  setInterval(() => terminalsRun().catch(e => console.error('terminals', e)), process.env.JOBS_FAST === '1' ? 3000 : M).unref();
  setInterval(dailyRun, D).unref();
  /* Count the last 40 days in the background after start-up and each night, so Yesterday, Last 7 days, Last 30 days and Last month open instantly. */
  const warmActivity = () => { const tz = cfg().timeZone || 'America/Chicago', fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz }); activityReport(fmt.format(new Date(Date.now() - 40 * D)), fmt.format(new Date())).catch(e => console.error('activity warm-up', e.message)); };
  setTimeout(warmActivity, process.env.JOBS_FAST === '1' ? 3000 : 20000).unref(); setInterval(warmActivity, 6 * H).unref();
  setInterval(() => { try { const n = trimSessions(); if (n) console.log('Released', n, 'old tickets from memory'); } catch (e) { console.error('trim', e.message); } }, H).unref();
  setTimeout(dailyRun, process.env.JOBS_FAST === '1' ? 6000 : 60000).unref();
  const stop = () => { console.log('Shutting down'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
process.on('unhandledRejection', e => console.error('Unhandled', e));
process.on('uncaughtException', e => { console.error('Fatal', e); process.exit(1); });
bootstrap().catch(e => { console.error('Startup failed:', e); process.exit(1); });
