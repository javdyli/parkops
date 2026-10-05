'use strict';
/* Reads license plates out of a photo, for live scanning from a phone. Uses Plate Recognizer's Snapshot API: their cloud, or their own
   container running on your network at PLATE_RECOGNIZER_URL (it speaks the same API). Without a key nothing is sent anywhere and
   live scanning is simply off (officers type the plate instead).

   Settings: PLATE_RECOGNIZER_TOKEN (required), PLATE_RECOGNIZER_URL, PLATE_REGIONS (default "us"; for example "us-tx"),
   PLATE_CONFIG (optional JSON passed through as their "config" field), PLATE_CONCURRENCY (default 6). */
const TOKEN = process.env.PLATE_RECOGNIZER_TOKEN || '';
const ENDPOINT = process.env.PLATE_RECOGNIZER_URL || 'https://api.platerecognizer.com/v1/plate-reader/';
const REGIONS = String(process.env.PLATE_REGIONS || 'us').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
const CONFIG = process.env.PLATE_CONFIG || '';
const MAX_INFLIGHT = Math.max(1, +process.env.PLATE_CONCURRENCY || 6);
const stats = { sent: 0, ok: 0, empty: 0, failed: 0, throttled: 0, busy: 0 };
let inflight = 0;

class ReaderError extends Error { constructor(message, code, status, retryAfterMs) { super(message); this.code = code; this.status = status || 0; this.retryAfterMs = retryAfterMs || 0; } }

const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/* "us-tx" -> "TX". Anything that isn't a US state comes back empty. */
const stateOf = region => { const m = /^us-([a-z]{2})$/i.exec(String(region && region.code || '')); return m ? m[1].toUpperCase() : ''; };

function parse(json) {
  const out = [];
  for (const r of (json && json.results) || []) {
    const plate = clean(r.plate); if (plate.length < 2 || plate.length > 8) continue;
    out.push({ plate, score: +r.score || 0, dscore: r.dscore == null ? null : +r.dscore, state: stateOf(r.region), vehicle: (r.vehicle && r.vehicle.type) || '',
      box: r.box ? { x1: r.box.xmin, y1: r.box.ymin, x2: r.box.xmax, y2: r.box.ymax } : null,
      candidates: (r.candidates || []).slice(0, 3).map(c => ({ plate: clean(c.plate), score: +c.score || 0 })) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/* One photo in, the plates in it out. A frame is worth nothing a second later, so when too many are already in flight this refuses
   straight away instead of queueing. */
async function read(buf, opts) {
  if (!TOKEN) throw new ReaderError('Live plate reading isn’t set up.', 'OFF');
  if (inflight >= MAX_INFLIGHT) { stats.busy++; throw new ReaderError('The plate reader is busy. Try again.', 'BUSY', 429, 500); }
  inflight++; stats.sent++;
  try {
    const fd = new FormData(); fd.append('upload', new Blob([buf], { type: 'image/jpeg' }), 'frame.jpg');
    for (const r of ((opts && opts.regions) || REGIONS)) fd.append('regions', r);
    if (opts && opts.cameraId) fd.append('camera_id', String(opts.cameraId).slice(0, 60));
    if (CONFIG) fd.append('config', CONFIG);
    let res;
    try { res = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: 'Token ' + TOKEN }, body: fd, signal: AbortSignal.timeout(9000) }); }
    catch (e) { stats.failed++; throw new ReaderError('Couldn’t reach the plate reader.', 'NETWORK'); }
    if (res.status === 429) { stats.throttled++; const ra = +res.headers.get('retry-after'); throw new ReaderError('The plate reader asked us to slow down.', 'THROTTLED', 429, ra > 0 ? ra * 1000 : 1000); }
    if (res.status === 401 || res.status === 403) { stats.failed++; throw new ReaderError('The plate reader refused our key, or this month’s plan is used up.', 'AUTH', res.status); }
    if (res.status === 400) { stats.empty++; return { plates: [] }; } // a frame they couldn't use (too small, not a photo): nothing to read
    if (res.status >= 500) { stats.failed++; throw new ReaderError('The plate reader is having trouble.', 'NETWORK', res.status); }
    if (!res.ok) { stats.failed++; throw new ReaderError('The plate reader said no (' + res.status + ').', 'REFUSED', res.status); }
    const plates = parse(await res.json()); if (plates.length) stats.ok++; else stats.empty++;
    return { plates };
  } finally { inflight--; }
}
module.exports = { read, parse, stateOf, ReaderError, configured: !!TOKEN, regions: REGIONS, stats, inflight: () => inflight };
