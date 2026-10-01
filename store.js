'use strict';
/* SQLite storage (built into Node 22.13+). Keep DATA_DIR on a persistent disk. */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const KEEP_CLOSED_DAYS = +(process.env.KEEP_IN_MEMORY_DAYS || 90);

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
    this.db.exec(`CREATE TABLE IF NOT EXISTS terminals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, device_id TEXT, amount_cents INTEGER NOT NULL, status TEXT NOT NULL, close_ticket INTEGER NOT NULL DEFAULT 0, staff TEXT, payment_id TEXT, applied INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER);
      CREATE INDEX IF NOT EXISTS terminals_session ON terminals (session_id, created_at DESC)`);
    addCol('terminals', 'full_balance INTEGER NOT NULL DEFAULT 1');
    // v4: staff roles were renamed; old rows keep working under their new names.
    this.db.exec("UPDATE users SET role='owner' WHERE role='admin'; UPDATE users SET role='attendant' WHERE role='officer'");
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
  async loadAll() { return this.q.load.all(Date.now() - KEEP_CLOSED_DAYS * 864e5).map(r => ({ coll: r.coll, id: r.id, data: JSON.parse(r.data) })); }
  /* keepLoaded: sessions that still owe money are always loaded at startup, however old. */
  async put(coll, id, data, keepLoaded) { this.q.put.run(coll, id, JSON.stringify(data), data && data.endAt && !keepLoaded ? Math.round(data.endAt) : null, Date.now()); }
  async del(coll, id) { this.q.del.run(coll, id); }
  async addRead(r) { this.q.addRead.run(Math.round(r.at), r.cameraId || null, r.plate || null, JSON.stringify(r)); }
  async recentReads(n) { return this.q.recent.all(n).map(r => JSON.parse(r.data)); }
  audit(actor, action, coll, docId, detail) {
    try { this.q.audit.run(Date.now(), actor || null, action, coll || null, docId || null, detail ? JSON.stringify(detail).slice(0, 20000) : null); } catch (e) { console.error('audit failed', e.message); }
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
  return new Store(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
};
