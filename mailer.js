'use strict';
/* Email through Resend or SendGrid. Without a key, messages are kept in an outbox the admin can read,
   so nothing is lost while you set up email. */
const RESEND = process.env.RESEND_API_KEY || '';
const SENDGRID = process.env.SENDGRID_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'Parking <parking@example.com>';
const crypto = require('crypto');
const { makePacer, retryAfter, neverReached } = require('./pacer');
/* Resend allows 2 requests a second on its default plan; raise EMAIL_PER_SEC if yours allows more. */
const pacer = makePacer(() => +process.env.EMAIL_PER_SEC || 2);
const outbox = [];
const redact = t => String(t || '').replace(/([?&](?:token|reset|company)=)[^\s&]+/g, '$1…').replace(/(\/x\/)[A-Za-z0-9]+/g, '$1…');

/* bulk: true puts the message in the slow lane (reminders, billing receipts); everything else goes first. Resolves true once sent. */
async function send({ to, subject, text, bulk }) {
  if (!to) return false;
  // The outbox is readable by staff, so one-time links (invitations, password resets, add-time) are stored redacted.
  const entry = { at: Date.now(), to, subject, text: redact(text), sent: false, state: RESEND || SENDGRID ? 'queued' : 'not sent' };
  outbox.unshift(entry); outbox.length = Math.min(outbox.length, 200);
  if (!(RESEND || SENDGRID)) return false;
  const idem = crypto.randomUUID(); // Resend ignores a repeat with the same key, so a retry after a timeout can't send the email twice
  const ok = await pacer.push(async () => {
    try {
      let r;
      if (RESEND) r = await fetch((process.env.RESEND_BASE_URL || 'https://api.resend.com') + '/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json', 'Idempotency-Key': idem }, body: JSON.stringify({ from: FROM, to: [to], subject, text }), signal: AbortSignal.timeout(15000) });
      else {
        const m = /<([^>]+)>/.exec(FROM); const fromEmail = m ? m[1] : FROM; const fromName = m ? FROM.replace(/<.*/, '').trim() : undefined;
        r = await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { Authorization: 'Bearer ' + SENDGRID, 'Content-Type': 'application/json' },
          body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: fromEmail, name: fromName }, subject, content: [{ type: 'text/plain', value: text }] }), signal: AbortSignal.timeout(15000) });
      }
      if (r.ok) return { ok: true };
      entry.error = (RESEND ? 'Resend ' : 'SendGrid ') + r.status;
      return { ok: false, retry: r.status === 429 || r.status >= 500, retryAfterMs: retryAfter(r), error: entry.error };
    } catch (e) { entry.error = e.message; return { ok: false, retry: !!RESEND || neverReached(e), error: e.message }; } // SendGrid has no repeat protection: only retry when the request never left
  }, bulk ? 'low' : 'high');
  entry.sent = ok; entry.state = ok ? 'sent' : 'failed'; if (ok) delete entry.error;
  if (!ok) console.error('Email failed:', to, subject, entry.error);
  return ok;
}
const queue = () => ({ waiting: pacer.pending(), sent: pacer.stats.sent, failed: pacer.stats.failed, retried: pacer.stats.retried, perSecond: +process.env.EMAIL_PER_SEC || 2 });
module.exports = { send, outbox, redact, queue, configured: !!(RESEND || SENDGRID) };
