'use strict';
/* Paces outgoing email and text messages so a burst (thousands of receipts on the 1st, renewal reminders for every monthly
   parker) never goes faster than Resend, SendGrid or Twilio allow, and retries the ones the provider turns away.

   - one message at a time, spaced by 1 / perSecond()
   - two lanes: "high" (a person is waiting: invitations, password resets, receipts for a payment they just made) always goes
     before "low" (bulk: reminders, billing receipts, notices)
   - a provider answer of 429 or 5xx, or a network error, pauses the lane (honouring Retry-After) and tries again, up to 4 times
   A job returns { ok: true } or { ok: false, retry: bool, retryAfterMs, error }. push() resolves true when it was sent. */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_TRIES = 4;

function makePacer(perSecond) {
  const lanes = { high: [], low: [] };
  let running = false, nextAt = 0, pausedUntil = 0;
  const stats = { sent: 0, failed: 0, retried: 0 };
  const interval = () => 1000 / Math.max(0.05, +perSecond() || 1);
  async function pump() {
    if (running) return; running = true;
    try {
      for (;;) {
        const item = lanes.high.shift() || lanes.low.shift(); if (!item) break;
        const wait = Math.max(nextAt, pausedUntil) - Date.now(); if (wait > 0) await sleep(wait);
        nextAt = Date.now() + interval();
        let res; try { res = await item.job(); } catch (e) { res = { ok: false, retry: true, error: e.message }; }
        if (res && res.ok) { stats.sent++; item.resolve(true); continue; }
        item.tries++;
        if (res && res.retry && item.tries < MAX_TRIES) {
          stats.retried++; pausedUntil = Date.now() + Math.min(60000, res.retryAfterMs || 1500 * 2 ** item.tries);
          lanes[item.lane].unshift(item); continue;
        }
        stats.failed++; item.resolve(false);
      }
    } finally { running = false; }
  }
  return {
    push(job, lane = 'high') { return new Promise(resolve => { lanes[lane === 'low' ? 'low' : 'high'].push({ job, resolve, tries: 0, lane: lane === 'low' ? 'low' : 'high' }); pump(); }); },
    pending: () => lanes.high.length + lanes.low.length,
    stats,
  };
}
/* Retry-After is seconds (or a date); give the provider a little extra. */
const retryAfter = r => { const v = r && r.headers && r.headers.get && r.headers.get('retry-after'); const n = +v; return n > 0 ? Math.min(60000, n * 1000 + 250) : 0; };
/* A network failure that happened before the request could have reached the provider (so trying again can't send it twice). A timeout
   is not one of these: the provider may have accepted the message and just been slow to answer. */
const neverReached = e => { const c = String((e && (e.cause && e.cause.code || e.code)) || ''); return ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'].includes(c); };
module.exports = { makePacer, retryAfter, neverReached, sleep };
