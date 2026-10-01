'use strict';
/* Text messages through Twilio. Without keys, messages are kept in an outbox the admin can read. */
const crypto = require('crypto');
const SID = process.env.TWILIO_ACCOUNT_SID || '', TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const FROM = process.env.TWILIO_FROM || '', SERVICE = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
const configured = !!(SID && TOKEN && (FROM || SERVICE));
const BASE = process.env.TWILIO_BASE_URL || 'https://api.twilio.com';
const outbox = [];

/* US numbers only for now: 10 digits, or 11 starting with 1. */
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return null; }

async function send(to, body) {
  const num = e164(to); if (!num) return false;
  const entry = { at: Date.now(), to: num.slice(0, -4).replace(/\d/g, '•') + num.slice(-4), body: String(body).replace(/(\/x\/)[A-Za-z0-9]+/g, '$1…').replace(/([?&](?:token|reset|company)=)[^\s&]+/g, '$1…'), sent: false };
  outbox.unshift(entry); outbox.length = Math.min(outbox.length, 200);
  if (!configured) return false;
  try {
    const form = new URLSearchParams({ To: num, Body: String(body).slice(0, 640) });
    if (SERVICE) form.set('MessagingServiceSid', SERVICE); else form.set('From', FROM);
    const r = await fetch(`${BASE}/2010-04-01/Accounts/${SID}/Messages.json`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(15000) });
    entry.sent = r.ok; if (!r.ok) entry.error = 'Twilio ' + r.status;
  } catch (e) { entry.error = e.message; }
  if (entry.error) console.error('SMS failed:', entry.error);
  return entry.sent;
}
/* X-Twilio-Signature: base64 HMAC-SHA1 of the exact webhook URL followed by each POST parameter name and value, sorted by name. */
function validSignature(url, params, signature) {
  if (!TOKEN || !signature) return false;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const expect = crypto.createHmac('sha1', TOKEN).update(Buffer.from(data, 'utf8')).digest('base64');
  const a = Buffer.from(expect), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const twiml = msg => `<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${String(msg).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</Message>` : ''}</Response>`;
module.exports = { send, e164, validSignature, twiml, outbox, configured };
