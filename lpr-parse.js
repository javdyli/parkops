'use strict';
/* Pull a plate read out of whatever a camera sends.
   Handles: Hikvision ANPR event push (multipart/form-data or raw XML/JSON with <licensePlate>),
   Axis License Plate Verifier event push (JSON with plateText / plateUnicode),
   and generic HTTP GET/POST with ?plate= or a JSON body. */

const PLATE_KEYS = ['licenseplate', 'plateunicode', 'plateutf8', 'platetext', 'platenumber', 'plate', 'lp', 'number'];
const CONF_KEYS = ['confidencelevel', 'plateconfidence', 'confidence', 'score'];

function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  for (const k of keys) {
    for (const [ok, ov] of Object.entries(obj)) {
      if (ok.toLowerCase() === k && (typeof ov === 'string' || typeof ov === 'number')) return ov;
    }
  }
  for (const v of Object.values(obj)) {
    const hit = deepFind(v, keys, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
const xmlTag = (text, tags) => {
  for (const t of tags) {
    const m = text.match(new RegExp('<' + t + '>\\s*(?:<!\\[CDATA\\[)?([^<\\]]*)', 'i'));
    if (m) return m[1].trim();
  }
  return undefined;
};
const jsonKey = (text, keys) => {
  for (const k of keys) {
    const m = text.match(new RegExp('"' + k + '"\\s*:\\s*"?([^",}]*)', 'i'));
    if (m) return m[1].trim();
  }
  return undefined;
};

function normConf(c) {
  if (c === undefined || c === null || c === '') return null;
  let n = parseFloat(c); if (!isFinite(n)) return null;
  if (n <= 1) n *= 100;
  return Math.round(Math.max(0, Math.min(100, n)));
}

function parseRead(query, contentType, body) {
  // 1. query string
  const q = {}; for (const [k, v] of Object.entries(query || {})) q[k.toLowerCase()] = v;
  let plate = PLATE_KEYS.map(k => q[k]).find(v => v !== undefined);
  let confidence = CONF_KEYS.map(k => q[k]).find(v => v !== undefined);
  let state = q.carstate || q.state;
  const text = body && body.length ? body.toString('latin1') : '';
  // 2. JSON body
  if (plate === undefined && /json/i.test(contentType || '') && text) {
    try {
      const j = JSON.parse(body.toString('utf8'));
      plate = deepFind(j, PLATE_KEYS); confidence = deepFind(j, CONF_KEYS); state = deepFind(j, ['carstate', 'state']);
    } catch (e) { /* fall through to text search */ }
  }
  // 3. XML / multipart / anything else: search the text
  if (plate === undefined && text) {
    plate = xmlTag(text, ['licensePlate', 'plateNumber', 'PlateNumber', 'plateText', 'LicensePlate', 'plate']);
    if (plate === undefined) plate = jsonKey(text, ['licensePlate', 'plateUnicode', 'plateUTF8', 'plateText', 'plateNumber', 'plate']);
    if (confidence === undefined) confidence = xmlTag(text, ['confidenceLevel', 'confidence', 'plateConfidence']) ?? jsonKey(text, ['confidenceLevel', 'plateConfidence', 'confidence']);
    if (state === undefined) state = jsonKey(text, ['carState']);
    if (plate === undefined && /heartBeat|videoloss/i.test(text)) return { ignore: 'heartbeat' };
  }
  // 4. urlencoded form
  if (plate === undefined && /x-www-form-urlencoded/i.test(contentType || '') && text) {
    const p = new URLSearchParams(text); for (const k of PLATE_KEYS) { for (const [pk, pv] of p) if (pk.toLowerCase() === k) { plate = pv; break; } if (plate !== undefined) break; }
  }
  if (plate === undefined) return { ignore: 'no plate field found' };
  // Axis sends new/update/lost for the same car: only count the first sighting.
  if (state && /^(update|lost)$/i.test(String(state))) return { ignore: 'car state ' + state };
  return { plate: String(plate), confidence: normConf(confidence) };
}

module.exports = { parseRead };
