'use strict';
/* Passwords (scrypt), server-side sessions, lockout after repeated failures. */
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/* Async so a burst of sign-in attempts doesn't block camera reads. */
async function hashPw(pw) { const salt = crypto.randomBytes(16); const h = await scrypt(String(pw), salt, 64, OPTS); return 'scrypt$' + salt.toString('hex') + '$' + h.toString('hex'); }
async function checkPw(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) { await scrypt('x', 'yyyyyyyyyyyyyyyy', 64, OPTS); return false; }
  const [, s, h] = stored.split('$');
  const got = await scrypt(String(pw), Buffer.from(s, 'hex'), 64, OPTS);
  return crypto.timingSafeEqual(got, Buffer.from(h, 'hex'));
}
const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const pwProblem = pw => (String(pw || '').length < 10 ? 'Use at least 10 characters for the password.' : null);

module.exports = function Auth(store) {
  const LOCK_AFTER = 6, LOCK_MIN = 15;
  function startSession(kind, subject, hours) {
    const t = newToken(); const now = Date.now();
    store.run('INSERT INTO auth (token_hash, kind, subject, expires, created_at) VALUES (?,?,?,?,?)', tokenHash(t), kind, subject, now + hours * 3600e3, now);
    return t;
  }
  function session(kind, token) {
    if (!token) return null;
    const row = store.get('SELECT * FROM auth WHERE token_hash=? AND kind=?', tokenHash(token), kind);
    if (!row || row.expires < Date.now()) return null;
    return row.subject;
  }
  const endSession = token => { if (token) store.run('DELETE FROM auth WHERE token_hash=?', tokenHash(token)); };
  const endAll = (kind, subject) => store.run('DELETE FROM auth WHERE kind=? AND subject=?', kind, subject);
  setInterval(() => { try { store.run('DELETE FROM auth WHERE expires < ?', Date.now()); } catch (e) {} }, 3600e3).unref();

  /* Shared login routine for staff users and driver accounts. */
  async function login(table, email, pw) {
    if (table !== 'users' && table !== 'accounts') throw new Error('bad table');
    const row = store.get(`SELECT * FROM ${table} WHERE email=?`, String(email || '').trim().toLowerCase());
    const match = await checkPw(pw, row ? row.pw : null);
    if (!row) return { error: 'That email and password don’t match.' };
    if (row.locked_until && row.locked_until > Date.now()) return { error: `Too many attempts. Try again in ${Math.ceil((row.locked_until - Date.now()) / 60000)} minutes.` };
    if (table === 'users' && !row.active) return { error: 'That email and password don’t match.' };
    if (!match) {
      const failed = (row.failed || 0) + 1;
      store.run(`UPDATE ${table} SET failed=?, locked_until=? WHERE id=?`, failed >= LOCK_AFTER ? 0 : failed, failed >= LOCK_AFTER ? Date.now() + LOCK_MIN * 60000 : null, row.id);
      return { error: 'That email and password don’t match.' };
    }
    store.run(`UPDATE ${table} SET failed=0, locked_until=NULL${table === 'users' ? ', last_login=' + Date.now() : ''} WHERE id=?`, row.id);
    return { row };
  }
  return { hashPw, checkPw, pwProblem, startSession, session, endSession, endAll, login, newToken, tokenHash };
};
module.exports.hashPw = hashPw;
module.exports.pwProblem = pwProblem;
