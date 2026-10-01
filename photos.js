'use strict';
/* Photo evidence: plate images from lane cameras and officer photos for citations. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || ''); if (!m) return [];
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const parts = []; let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (body.slice(start, start + 2).toString() === '--') break;
    const next = body.indexOf(boundary, start); if (next === -1) break;
    const chunk = body.slice(start + 2, next - 2); // skip CRLF after boundary and before next boundary
    const sep = chunk.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = chunk.slice(0, sep).toString('latin1'), data = chunk.slice(sep + 4);
      const name = (/name="([^"]*)"/i.exec(head) || [])[1] || '', filename = (/filename="([^"]*)"/i.exec(head) || [])[1] || '';
      const type = ((/content-type:\s*([^\r\n;]+)/i.exec(head) || [])[1] || '').trim().toLowerCase();
      parts.push({ name, filename, type, data });
    }
    pos = next;
  }
  return parts;
}
const isJpeg = b => b && b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
const isPng = b => b && b.length > 8 && b[0] === 0x89 && b[1] === 0x50;

module.exports = function Photos(store, dataDir) {
  const root = path.join(dataDir, 'photos');
  function save(buf, meta) {
    if (!(isJpeg(buf) || isPng(buf))) return null;
    if (buf.length > 8 * 1024 * 1024) return null;
    const id = crypto.randomBytes(12).toString('hex');
    const day = new Date().toISOString().slice(0, 10), dir = path.join(root, day);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(day, id + (isPng(buf) ? '.png' : '.jpg'));
    fs.writeFileSync(path.join(root, file), buf);
    store.run('INSERT INTO photos (id, at, kind, plate, camera_id, file, bytes, keep) VALUES (?,?,?,?,?,?,?,?)', id, Date.now(), meta.kind || 'lpr', meta.plate || null, meta.cameraId || null, file, buf.length, meta.keep ? 1 : 0);
    return id;
  }
  /* Pick the best image out of a camera event: plate close-up first, then the wide shot. */
  function fromCameraEvent(body, contentType) {
    const imgs = [];
    if (/multipart/i.test(contentType || '')) {
      for (const p of parseMultipart(body, contentType)) if (isJpeg(p.data) || isPng(p.data)) imgs.push({ label: (p.name + ' ' + p.filename).toLowerCase(), data: p.data });
    } else if (/json/i.test(contentType || '')) {
      const text = body.toString('utf8'); const re = /"([A-Za-z_]*[Ii]mage[A-Za-z_]*)"\s*:\s*"((?:\/9j\/|iVBOR)[A-Za-z0-9+/=]+)"/g; let m;
      while ((m = re.exec(text)) && imgs.length < 4) imgs.push({ label: m[1].toLowerCase(), data: Buffer.from(m[2], 'base64') });
    } else if (isJpeg(body)) imgs.push({ label: 'body', data: body });
    imgs.sort((a, b) => (/plate/.test(b.label) ? 1 : 0) - (/plate/.test(a.label) ? 1 : 0));
    return imgs;
  }
  const get = id => { const r = store.get('SELECT * FROM photos WHERE id=?', String(id)); if (!r) return null; const f = path.join(root, r.file); return fs.existsSync(f) ? { row: r, file: f } : null; };
  const keep = id => store.run('UPDATE photos SET keep=1 WHERE id=?', id);
  function cleanup(days) {
    const cutoff = Date.now() - days * 864e5; let n = 0;
    for (const r of store.all('SELECT id, file FROM photos WHERE at < ? AND keep = 0 LIMIT 5000', cutoff)) {
      try { fs.unlinkSync(path.join(root, r.file)); } catch (e) {}
      store.run('DELETE FROM photos WHERE id=?', r.id); n++;
    }
    return n;
  }
  return { save, fromCameraEvent, get, keep, cleanup, parseMultipart };
};
module.exports.parseMultipart = parseMultipart;
