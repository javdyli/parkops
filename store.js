'use strict';
/* SQLite storage (built into Node 22.13+). Keep DATA_DIR on a persistent disk. */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const KEEP_CLOSED_DAYS = +(process.env.KEEP_IN_MEMORY_DAYS || 90);
/* The screens hold finished tickets from the last KEEP_IN_MEMORY_DAYS days, but never more than KEEP_CLOSED_MAX of them, so a
   garage with thousands of cars a day still starts fast and fits in a small server. Everything older stays in the database and
   is reached through History and Activity. */
const KEEP_CLOSED_MAX = Math.max(500, +(process.env.KEEP_CLOSED_MAX || 5000));
/* When a ticket happened: arrival, else departure, else creation. History is sorted and filtered on this. */
const EVENT_AT = "COALESCE(json_extract(data,'$.startAt'), json_extract(data,'$.endAt'), json_extract(data,'$.createdAt'), 0)";

class Store {
  constructor(dir) { this.dir = dir; this.file = path.join(dir, 'parkops.db'); this.kind = 'sqlite'; }
  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, end_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (coll, id));
      CREATE TABLE IF NOT EXISTS reads (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, camera_id TEXT, plate TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reads_at ON reads (at DESC);
      CREATE INDEX IF NOT EXISTS reads_plate ON reads (plate);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, pw TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_login INTEGER, failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT, pw TEXT NOT NULL, plates TEXT NOT NULL DEFAULT '[]', autopay INTEGER NOT NULL DEFAULT 1,
        sq_customer TEXT, sq_card TEXT, card_brand TEXT, card_last4 TEXT, card_exp TEXT, created_at INTEGER NOT NULL, failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, reset_hash TEXT, reset_expires INTEGER);
      CREATE TABLE IF NOT EXISTS auth (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, expires INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL, coll TEXT, doc_id TEXT, detail TEXT);
      CREATE INDEX IF NOT EXISTS audit_at ON audit (at DESC);
      CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, sq_id TEXT, kind TEXT NOT NULL, ref TEXT, plate TEXT, amount_cents INTEGER NOT NULL, refunded_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, account_id TEXT, card_last4 TEXT, receipt_url TEXT, note TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS payments_at ON payments (created_at DESC);
      CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, plate TEXT, camera_id TEXT, file TEXT NOT NULL, bytes INTEGER NOT NULL, keep INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS photos_at ON photos (at);
      CREATE TABLE IF NOT EXISTS billing (owner TEXT PRIMARY KEY, sq_customer TEXT, sq_card TEXT, brand TEXT, last4 TEXT, exp TEXT, updated_at INTEGER);`);
    // Columns added after the first release.
    const addCol = (t, c) => { try { this.db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch (e) { /* already there */ } };
    addCol('payments', 'idem TEXT'); addCol('payments', 'net_cents INTEGER'); addCol('payments', 'tax_cents INTEGER');
    // v4: how it was paid (cash, card, check, comp, terminal, online, autopay), who took it, the ticket and location.
    addCol('payments', 'method TEXT'); addCol('payments', 'staff TEXT'); addCol('payments', 'ticket TEXT'); addCol('payments', 'facility_id TEXT'); addCol('payments', 'session_id TEXT');
    addCol('accounts', "plate_added TEXT NOT NULL DEFAULT '{}'");
    // v4: staff invitations (a link to choose a password) use the same token scheme as driver password resets.
    addCol('users', 'reset_hash TEXT'); addCol('users', 'reset_expires INTEGER'); addCol('users', 'invited_at INTEGER');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS payments_idem ON payments (idem) WHERE idem IS NOT NULL');
    // v4: Square Terminal checkouts started from the exit desk; applied to the ticket once Square reports COMPLETED.
    this.db.exec('CREATE TABLE IF NOT EXISTS scan_usage (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)'); // plate-reader lookups per day (what the plan is billed on)
    this.db.exec(`CREATE TABLE IF NOT EXISTS terminals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, device_id TEXT, amount_cents INTEGER NOT NULL, status TEXT NOT NULL, close_ticket INTEGER NOT NULL DEFAULT 0, staff TEXT, payment_id TEXT, applied INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER);
      CREATE INDEX IF NOT EXISTS terminals_session ON terminals (session_id, created_at DESC)`);
    addCol('terminals', 'full_balance INTEGER NOT NULL DEFAULT 1');
    // v5: every plate an officer checks (typed or scanned), violators and vehicles that were fine alike: the patrol log.
    this.db.exec(`CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, facility_id TEXT, plate TEXT NOT NULL, staff_id TEXT, officer TEXT, source TEXT, level TEXT, violator INTEGER NOT NULL DEFAULT 0, kind TEXT, title TEXT, suggest TEXT, detail TEXT);
      CREATE INDEX IF NOT EXISTS checks_at ON checks (at)`);
    // v4: staff roles were renamed; old rows keep working under their new names.
    this.db.exec("UPDATE users SET role='owner' WHERE role='admin'; UPDATE users SET role='attendant' WHERE role='officer'");
    // Every ticket stays in the database forever; this index keeps the History search fast with years of tickets.
    this.db.exec('CREATE INDEX IF NOT EXISTS docs_end ON docs (coll, end_at)');
    this.db.exec(`DROP INDEX IF EXISTS docs_sess_time; CREATE INDEX IF NOT EXISTS docs_sess_at ON docs (${EVENT_AT}, id) WHERE coll='sessions'`);
    const q = s => this.db.prepare(s);
    this.q = {
      put: q(`INSERT INTO docs (coll, id, data, end_at, updated_at) VALUES (?,?,?,?,?) ON CONFLICT (coll, id) DO UPDATE SET data=excluded.data, end_at=excluded.end_at, updated_at=excluded.updated_at`),
      del: q(`DELETE FROM docs WHERE coll=? AND id=?`),
      load: q(`SELECT coll, id, data FROM docs WHERE coll <> 'sessions' OR end_at IS NULL OR end_at > ?`),
      addRead: q(`INSERT INTO reads (at, camera_id, plate, data) VALUES (?,?,?,?)`),
      recent: q(`SELECT data FROM reads ORDER BY at DESC LIMIT ?`),
      audit: q(`INSERT INTO audit (at, actor, action, coll, doc_id, detail) VALUES (?,?,?,?,?,?)`),
    };
  }
  run(sql, ...p) { return this.db.prepare(sql).run(...p); }
  get(sql, ...p) { return this.db.prepare(sql).get(...p); }
  all(sql, ...p) { return this.db.prepare(sql).all(...p); }
  /* The earliest departure time the screens will hold: KEEP_IN_MEMORY_DAYS back, or the departure of the KEEP_CLOSED_MAX-th most
     recent finished ticket if that is later. */
  windowStart() {
    const byDays = Date.now() - KEEP_CLOSED_DAYS * 864e5;
    const nth = this.get("SELECT end_at AS e FROM docs WHERE coll='sessions' AND end_at IS NOT NULL ORDER BY end_at DESC LIMIT 1 OFFSET ?", KEEP_CLOSED_MAX - 1);
    return Math.max(byDays, nth && nth.e ? nth.e : 0);
  }
  async loadAll() { this.since = this.windowStart(); return this.q.load.all(this.since).map(r => ({ coll: r.coll, id: r.id, data: JSON.parse(r.data) })); }
  /* keepLoaded: sessions that still owe money are always loaded at startup, however old. */
  async put(coll, id, data, keepLoaded) { this.q.put.run(coll, id, JSON.stringify(data), data && data.endAt && !keepLoaded ? Math.round(data.endAt) : null, Date.now()); }
  async del(coll, id) { this.q.del.run(coll, id); }
  async addRead(r) { this.q.addRead.run(Math.round(r.at), r.cameraId || null, r.plate || null, JSON.stringify(r)); }
  async recentReads(n) { return this.q.recent.all(n).map(r => JSON.parse(r.data)); }
  /* Plate checks for the patrol log. */
  addCheck(c) {
    const r = this.run('INSERT INTO checks (at, facility_id, plate, staff_id, officer, source, level, violator, kind, title, suggest, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      Math.round(c.at), c.facilityId || null, c.plate, c.staffId || null, c.officer || null, c.source || null, c.level || null, c.violator ? 1 : 0, c.kind || null, c.title || null, c.suggest || null, c.detail ? JSON.stringify(c.detail).slice(0, 4000) : null);
    return Number(r.lastInsertRowid);
  }
  checksBetween(from, to, facility, limit = 20000) {
    const w = ['at >= ?', 'at < ?'], v = [+from, +to]; if (facility) { w.push('facility_id = ?'); v.push(String(facility)); }
    return this.all(`SELECT id, at, facility_id, plate, staff_id, officer, source, level, violator, kind, title, suggest, detail FROM checks WHERE ${w.join(' AND ')} ORDER BY at LIMIT ?`, ...v, limit)
      .map(r => { let d = null; try { d = r.detail ? JSON.parse(r.detail) : null; } catch (e) {} return Object.assign(r, { detail: d }); });
  }
  audit(actor, action, coll, docId, detail) {
    try { this.q.audit.run(Date.now(), actor || null, action, coll || null, docId || null, detail ? JSON.stringify(detail).slice(0, 20000) : null); } catch (e) { console.error('audit failed', e.message); }
  }
  /* When the oldest ticket arrived and how many there are, read from the index (a plain MIN over the JSON would read every ticket). */
  firstTicketAt() { const r = this.db.prepare(`SELECT ${EVENT_AT} AS t FROM docs INDEXED BY docs_sess_at WHERE coll='sessions' ORDER BY ${EVENT_AT} ASC LIMIT 1`).get(); return r && r.t ? r.t : null; }
  ticketCount() { return this.db.prepare("SELECT COUNT(*) AS n FROM docs INDEXED BY docs_end WHERE coll='sessions'").get().n; }
  /* Raw material for the Activity totals, read a window of days at a time so even years of tickets never sit in memory at once.
     arrivals(): tickets that arrived in [from, to). departures(): tickets that left in [from, to), including ones still owing
     money (their end_at column is kept empty so they stay loaded at start-up). payments(): the ledger rows created in the window. */
  arrivalRows(from, to) {
    return this.db.prepare(`SELECT json_extract(data,'$.startAt') AS t, json_extract(data,'$.facilityId') AS f FROM docs INDEXED BY docs_sess_at WHERE coll='sessions' AND ${EVENT_AT} >= ? AND ${EVENT_AT} < ?`).all(+from, +to);
  }
  departureRows(from, to) {
    const cols = `json_extract(data,'$.startAt') AS sa, json_extract(data,'$.facilityId') AS f, json_extract(data,'$.fee') AS fee, COALESCE(json_array_length(json_extract(data,'$.payments')),0) AS np, json_extract(data,'$.waived') AS w, json_extract(data,'$.cited') AS c, json_extract(data,'$.kind') AS k`;
    return this.db.prepare(`SELECT end_at AS t, ${cols} FROM docs INDEXED BY docs_end WHERE coll='sessions' AND end_at >= ? AND end_at < ?`).all(+from, +to);
  }
  /* Tickets that left but still owe money keep an empty end_at (so they stay loaded at start-up); find them for a whole range in one pass. */
  debtDepartureRows(from, to) {
    const cols = `json_extract(data,'$.startAt') AS sa, json_extract(data,'$.facilityId') AS f, json_extract(data,'$.fee') AS fee, COALESCE(json_array_length(json_extract(data,'$.payments')),0) AS np, json_extract(data,'$.waived') AS w, json_extract(data,'$.cited') AS c, json_extract(data,'$.kind') AS k`;
    return this.db.prepare(`SELECT json_extract(data,'$.endAt') AS t, ${cols} FROM docs INDEXED BY docs_end WHERE coll='sessions' AND end_at IS NULL AND json_extract(data,'$.endAt') >= ? AND json_extract(data,'$.endAt') < ?`).all(+from, +to);
  }
  paymentRows(from, to) {
    // Payments taken through the portal have no location of their own; they take it from their ticket.
    return this.db.prepare("SELECT p.created_at AS t, p.amount_cents AS a, p.refunded_cents AS r, COALESCE(p.tax_cents,0) AS x, p.kind AS k, p.method AS m, COALESCE(p.facility_id, json_extract(d.data,'$.facilityId')) AS f, p.status AS s FROM payments p LEFT JOIN docs d ON d.coll='sessions' AND d.id=p.session_id WHERE p.created_at >= ? AND p.created_at < ? AND COALESCE(p.method,'') <> 'comp'").all(+from, +to);
  }
  /* Ledger rows in a window, oldest first, a page at a time (for the payments export). after = {t, id} continues where the last page ended. */
  paymentPage(from, to, facility, after, limit = 2000) {
    const w = ['p.created_at >= ?', 'p.created_at < ?'], v = [+from, +to];
    if (facility) { w.push("COALESCE(p.facility_id, json_extract(d.data,'$.facilityId')) = ?"); v.push(String(facility)); }
    if (after) { w.push('(p.created_at > ? OR (p.created_at = ? AND p.id > ?))'); v.push(after.t, after.t, String(after.id)); }
    return this.db.prepare(`SELECT p.id, p.sq_id, p.kind, p.ref, p.plate, p.amount_cents, p.refunded_cents, COALESCE(p.net_cents, p.amount_cents) AS net_cents, COALESCE(p.tax_cents,0) AS tax_cents, p.status, p.created_at, p.method, p.staff, p.ticket, p.session_id, p.note, COALESCE(p.facility_id, json_extract(d.data,'$.facilityId')) AS facility_id FROM payments p LEFT JOIN docs d ON d.coll='sessions' AND d.id=p.session_id WHERE ${w.join(' AND ')} ORDER BY p.created_at, p.id LIMIT ?`).all(...v, limit);
  }
  /* One plate's tickets since a time, newest first, straight from the database (a driver's own history, for tickets the screens no longer hold). */
  platesSince(plate, from, limit = 100) {
    const sql = tbl => `SELECT id, data FROM ${tbl} WHERE coll='sessions' AND ${EVENT_AT} >= ? AND UPPER(json_extract(data,'$.plate')) = ? ORDER BY ${EVENT_AT} DESC LIMIT ?`;
    const a = [+from, String(plate).toUpperCase(), limit];
    try { return this.all(sql('docs INDEXED BY docs_sess_at'), ...a); } catch (e) { return this.all(sql('docs'), ...a); }
  }
  /* Every ticket ever saved, newest first, straight from the database (the screens only hold the last KEEP_IN_MEMORY_DAYS).
     q matches a plate (any part) or an exact ticket number. from/to are epoch ms (to is exclusive). after = {ev, id} pages by key. */
  history({ q, facility, from, to, status, limit = 50, offset = 0, after, countOnly } = {}) {
    const w = ["coll='sessions'"], v = [];
    if (facility) { w.push("json_extract(data,'$.facilityId') = ?"); v.push(String(facility)); }
    if (from != null) { w.push(`${EVENT_AT} >= ?`); v.push(+from); }
    if (to != null) { w.push(`${EVENT_AT} < ?`); v.push(+to); }
    if (status === 'open') w.push("json_extract(data,'$.endAt') IS NULL"); else if (status === 'closed') w.push("json_extract(data,'$.endAt') IS NOT NULL");
    const text = String(q || '').trim();
    if (text) {
      const plate = text.toUpperCase().replace(/[^A-Z0-9]/g, ''), tk = text.toUpperCase(), parts = [];
      if (plate) { parts.push("UPPER(json_extract(data,'$.plate')) LIKE ?"); v.push('%' + plate + '%'); }
      parts.push("UPPER(json_extract(data,'$.ticket')) = ?"); v.push(tk); parts.push('UPPER(id) = ?'); v.push(tk);
      w.push('(' + parts.join(' OR ') + ')');
    }
    const where = w.join(' AND '), ranged = from != null || to != null;
    let total; try { total = this.get(`SELECT COUNT(*) AS n FROM ${ranged ? 'docs INDEXED BY docs_sess_at' : 'docs'} WHERE ${where}`, ...v).n; } catch (e) { total = this.get(`SELECT COUNT(*) AS n FROM docs WHERE ${where}`, ...v).n; }
    if (countOnly) return { total, rows: [] };
    const pv = v.slice(), pw = w.slice();
    if (after) { pw.push(`(${EVENT_AT}, id) < (?, ?)`); pv.push(+after.ev, String(after.id)); }
    /* INDEXED BY makes SQLite walk the time index in order instead of sorting every ticket: 300,000 tickets page in milliseconds. */
    const sql = from => `SELECT id, data, ${EVENT_AT} AS ev FROM ${from} WHERE ${pw.join(' AND ')} ORDER BY ${EVENT_AT} DESC, id DESC LIMIT ? OFFSET ?`;
    const args = [...pv, Math.max(1, Math.min(5000, limit | 0)), after ? 0 : Math.max(0, offset | 0)];
    let rows; try { rows = this.all(sql('docs INDEXED BY docs_sess_at'), ...args); } catch (e) { rows = this.all(sql('docs'), ...args); }
    return { total, rows };
  }
  /* Delete the oldest backup copies, keeping the newest n. */
  pruneBackups(n) {
    const dir = path.join(this.dir, 'backups'); let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort(); } catch (e) { return 0; }
    let k = 0; while (files.length > n) { try { fs.unlinkSync(path.join(dir, files.shift())); k++; } catch (e) { break; } }
    return k;
  }
  /* Consistent point-in-time copy, safe while running. Keeps the newest `keep` files. */
  backup(keep = 14, manual = false) {
    const dir = path.join(this.dir, manual ? 'backups/manual' : 'backups'); fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 23);
    const file = path.join(dir, `parkops-${stamp}.db`);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();
    while (files.length > (manual ? 3 : keep)) fs.unlinkSync(path.join(dir, files.shift()));
    return file;
  }
}

module.exports = function makeStore() {
  /* Default data folder sits next to server.js, whether this file is in lib/ or (after a flat upload) beside it. */
  const root = fs.existsSync(path.join(__dirname, 'server.js')) ? __dirname : path.join(__dirname, '..');
  return new Store(process.env.DATA_DIR || path.join(root, 'data'));
};
