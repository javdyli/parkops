'use strict';
/* Email through Resend or SendGrid. Without a key, messages are kept in an outbox the admin can read,
   so nothing is lost while you set up email. */
const RESEND = process.env.RESEND_API_KEY || '';
const SENDGRID = process.env.SENDGRID_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'Parking <parking@example.com>';
const outbox = [];
const redact = t => String(t || '').replace(/([?&](?:token|reset|company)=)[^\s&]+/g, '$1…').replace(/(\/x\/)[A-Za-z0-9]+/g, '$1…');

async function send({ to, subject, text }) {
  if (!to) return false;
  // The outbox is readable by staff, so one-time links (invitations, password resets, add-time) are stored redacted.
  const entry = { at: Date.now(), to, subject, text: redact(text), sent: false };
  outbox.unshift(entry); outbox.length = Math.min(outbox.length, 200);
  try {
    if (RESEND) {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [to], subject, text }), signal: AbortSignal.timeout(15000) });
      entry.sent = r.ok; if (!r.ok) entry.error = 'Resend ' + r.status;
    } else if (SENDGRID) {
      const m = /<([^>]+)>/.exec(FROM); const fromEmail = m ? m[1] : FROM; const fromName = m ? FROM.replace(/<.*/, '').trim() : undefined;
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { Authorization: 'Bearer ' + SENDGRID, 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: fromEmail, name: fromName }, subject, content: [{ type: 'text/plain', value: text }] }), signal: AbortSignal.timeout(15000) });
      entry.sent = r.ok; if (!r.ok) entry.error = 'SendGrid ' + r.status;
    }
  } catch (e) { entry.error = e.message; }
  if (entry.error) console.error('Email failed:', to, subject, entry.error);
  return entry.sent;
}
module.exports = { send, outbox, redact, configured: !!(RESEND || SENDGRID) };
