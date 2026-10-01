'use strict';
/* Square REST API (no SDK needed). Without SQUARE_ACCESS_TOKEN it runs in simulated mode so the
   whole system can be tried before your Square account is connected. */
const crypto = require('crypto');

const ENV = (process.env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
const BASE = process.env.SQUARE_BASE_URL || (ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com');
const TOKEN = process.env.SQUARE_ACCESS_TOKEN || '';
const APP_ID = process.env.SQUARE_APPLICATION_ID || '';
const LOCATION = process.env.SQUARE_LOCATION_ID || '';
const VERSION = process.env.SQUARE_VERSION || '2026-09-16';
const SIM_TERMINAL_MS = +(process.env.SIM_TERMINAL_MS || 4000);
const simTerminals = new Map();
const CURRENCY = process.env.CURRENCY || 'USD';
const live = !!(TOKEN && APP_ID && LOCATION);

class SquareError extends Error { constructor(message, code, status) { super(message); this.code = code || 'PAYMENT_FAILED'; this.status = status; } }
const key = () => crypto.randomUUID();
const cents = amount => Math.round((+amount || 0) * 100);

/* Network problems and Square 5xx errors are "unknown" outcomes: the charge may or may not have happened.
   Retrying with the same idempotency key is safe, because Square returns the original result. */
async function call(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { Authorization: 'Bearer ' + TOKEN, 'Square-Version': VERSION, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) { throw new SquareError('We couldn’t reach the payment processor.', 'NETWORK', 0); }
  const j = await res.json().catch(() => ({}));
  if (res.status >= 500 || res.status === 429) throw new SquareError('The payment processor is busy. Try again in a minute.', 'NETWORK', res.status);
  if (!res.ok || (j.errors && j.errors.length)) {
    const e = (j.errors && j.errors[0]) || {};
    throw new SquareError(friendly(e.code, e.detail), e.code, res.status);
  }
  return j;
}
async function withRetry(fn) { try { return await fn(); } catch (e) { if (e.code !== 'NETWORK') throw e; await new Promise(r => setTimeout(r, 1500)); return fn(); } }
function friendly(code, detail) {
  const map = {
    CARD_DECLINED: 'The card was declined.', GENERIC_DECLINE: 'The card was declined.', INSUFFICIENT_FUNDS: 'The card was declined for insufficient funds.',
    CVV_FAILURE: 'The security code didn’t match.', ADDRESS_VERIFICATION_FAILURE: 'The ZIP code didn’t match the card.', INVALID_EXPIRATION: 'The expiration date is invalid.',
    EXPIRATION_FAILURE: 'The card is expired.', CARD_EXPIRED: 'The card is expired.', VERIFY_CVV_FAILURE: 'The security code didn’t match.', VERIFY_AVS_FAILURE: 'The ZIP code didn’t match the card.',
    INVALID_CARD: 'The card number is invalid.', CARD_NOT_SUPPORTED: 'That card type isn’t supported.', TRANSACTION_LIMIT: 'The card issuer declined the amount.',
  };
  return map[code] || detail || 'The payment didn’t go through.';
}

module.exports = {
  live, env: ENV, currency: CURRENCY, SquareError,
  clientConfig: () => ({ enabled: live, simulated: !live, env: ENV, applicationId: APP_ID, locationId: LOCATION, currency: CURRENCY,
    sdkUrl: process.env.SQUARE_SDK_URL || (ENV === 'production' ? 'https://web.squarecdn.com/v1/square.js' : 'https://sandbox.web.squarecdn.com/v1/square.js') }),

  async createCustomer({ email, name, companyName, phone, referenceId }) {
    if (!live) return 'sim_cust_' + key().slice(0, 8);
    const [given, ...rest] = String(name || '').trim().split(/\s+/);
    const j = await call('POST', '/v2/customers', { idempotency_key: key(), email_address: email, given_name: given || undefined, family_name: rest.join(' ') || undefined, company_name: companyName || undefined, phone_number: phone || undefined, reference_id: referenceId });
    return j.customer.id;
  },

  /* Save a tokenized card to a customer. Returns {id, brand, last4, exp}. */
  async createCard({ sourceId, verificationToken, customerId, postalCode, cardholderName, referenceId }) {
    if (!live) return { id: 'sim_card_' + key().slice(0, 8), brand: 'VISA', last4: '1111', exp: '12/30' };
    const body = { idempotency_key: key(), source_id: sourceId, card: { customer_id: customerId, reference_id: referenceId, cardholder_name: cardholderName || undefined } };
    if (postalCode) body.card.billing_address = { postal_code: postalCode };
    if (verificationToken) body.verification_token = verificationToken;
    const c = (await call('POST', '/v2/cards', body)).card;
    return { id: c.id, brand: c.card_brand, last4: c.last_4, exp: `${String(c.exp_month).padStart(2, '0')}/${String(c.exp_year).slice(-2)}` };
  },

  async disableCard(cardId) { if (!live || !cardId) return; await call('POST', `/v2/cards/${encodeURIComponent(cardId)}/disable`); },

  /* Charge a one-time token or a saved card id. Returns {id, status, receiptUrl, last4}. */
  async charge({ sourceId, customerId, verificationToken, amount, referenceId, note, buyerEmail, idempotencyKey }) {
    const amt = cents(amount);
    if (amt <= 0) throw new SquareError('Nothing to charge.', 'INVALID_AMOUNT');
    if (!live) {
      if (String(sourceId).includes('decline')) throw new SquareError('The card was declined.', 'CARD_DECLINED');
      return { id: 'sim_pay_' + key().slice(0, 10), status: 'COMPLETED', receiptUrl: null, last4: '1111', simulated: true };
    }
    const body = { idempotency_key: String(idempotencyKey || key()).slice(0, 45), source_id: sourceId, amount_money: { amount: amt, currency: CURRENCY }, location_id: LOCATION, autocomplete: true,
      reference_id: referenceId ? String(referenceId).slice(0, 40) : undefined, note: note ? String(note).slice(0, 500) : undefined };
    if (customerId) body.customer_id = customerId;
    if (verificationToken) body.verification_token = verificationToken;
    if (buyerEmail) body.buyer_email_address = buyerEmail;
    const p = (await withRetry(() => call('POST', '/v2/payments', body))).payment;
    if (p.status !== 'COMPLETED' && p.status !== 'APPROVED') throw new SquareError('The payment didn’t complete (' + p.status + ').', p.status);
    return { id: p.id, status: p.status, receiptUrl: p.receipt_url || null, last4: p.card_details && p.card_details.card ? p.card_details.card.last_4 : null };
  },

  /* Monthly invoices for companies: an order with one line per parker, then an invoice Square emails and collects. */
  async createInvoice({ customerId, lines, dueDate, title, description, number, idempotencyKey }) {
    if (!live) return { id: 'sim_inv_' + key().slice(0, 10), status: 'UNPAID', publicUrl: null, simulated: true };
    const k = String(idempotencyKey || key()).slice(0, 40);
    const order = (await withRetry(() => call('POST', '/v2/orders', { idempotency_key: k + '-o', order: { location_id: LOCATION, customer_id: customerId,
      line_items: lines.map(l => ({ name: String(l.name).slice(0, 500), quantity: '1', base_price_money: { amount: cents(l.amount), currency: CURRENCY } })) } }))).order;
    const inv = (await withRetry(() => call('POST', '/v2/invoices', { idempotency_key: k + '-i', invoice: { location_id: LOCATION, order_id: order.id, primary_recipient: { customer_id: customerId },
      payment_requests: [{ request_type: 'BALANCE', due_date: dueDate, automatic_payment_source: 'NONE', reminders: [{ relative_scheduled_days: -1, message: 'Your parking invoice is due tomorrow.' }] }],
      delivery_method: 'EMAIL', invoice_number: number ? String(number).slice(0, 191) : undefined, title: String(title || 'Parking').slice(0, 255), description: description ? String(description).slice(0, 65536) : undefined,
      accepted_payment_methods: { card: true, bank_account: true, square_gift_card: false } } }))).invoice;
    const pub = (await withRetry(() => call('POST', `/v2/invoices/${encodeURIComponent(inv.id)}/publish`, { version: inv.version, idempotency_key: k + '-p' }))).invoice;
    return { id: pub.id, status: pub.status, publicUrl: pub.public_url || null };
  },
  async getInvoice(id) {
    if (!live || String(id).startsWith('sim_')) return null;
    const inv = (await call('GET', `/v2/invoices/${encodeURIComponent(id)}`)).invoice;
    return { id: inv.id, status: inv.status, publicUrl: inv.public_url || null };
  },

  async refund({ paymentId, amount, reason }) {
    if (!live || String(paymentId).startsWith('sim_')) return { id: 'sim_refund_' + key().slice(0, 8), status: 'COMPLETED' };
    const r = (await call('POST', '/v2/refunds', { idempotency_key: key(), payment_id: paymentId, amount_money: { amount: cents(amount), currency: CURRENCY }, reason: reason ? String(reason).slice(0, 192) : undefined })).refund;
    return { id: r.id, status: r.status };
  },

  /* One payment's details (used after a Terminal checkout completes). */
  async getPayment(id) {
    if (!live || String(id).startsWith('sim_')) return { id, status: 'COMPLETED', receiptUrl: null, last4: '1111', simulated: true };
    const p = (await call('GET', `/v2/payments/${encodeURIComponent(id)}`)).payment;
    return { id: p.id, status: p.status, receiptUrl: p.receipt_url || null, last4: p.card_details && p.card_details.card ? p.card_details.card.last_4 : null, amount: p.amount_money ? p.amount_money.amount / 100 : null };
  },

  /* ---------- Square Terminal (booth card reader) ----------
     Push an amount to a paired Terminal; the driver taps or inserts their card on the device. Statuses:
     PENDING → IN_PROGRESS → COMPLETED (payment_ids filled in) or CANCELED / CANCEL_REQUESTED.
     Simulated mode (no Square keys) completes after a few seconds; a device id containing "cancel" is cancelled by the "driver". */
  async createTerminalCheckout({ amount, deviceId, referenceId, note, idempotencyKey }) {
    const amt = cents(amount);
    if (amt <= 0) throw new SquareError('Nothing to charge.', 'INVALID_AMOUNT');
    if (!deviceId) throw new SquareError('No Square Terminal is set up for this location.', 'NO_DEVICE');
    if (!live) {
      const id = 'sim_tc_' + key().slice(0, 10);
      simTerminals.set(id, { id, status: 'PENDING', at: Date.now(), deviceId, amount: amt, paymentIds: [] });
      return { id, status: 'PENDING', simulated: true };
    }
    const body = { idempotency_key: String(idempotencyKey || key()).slice(0, 45), checkout: { amount_money: { amount: amt, currency: CURRENCY }, device_options: { device_id: String(deviceId), skip_receipt_screen: false, collect_signature: false },
      reference_id: referenceId ? String(referenceId).slice(0, 40) : undefined, note: note ? String(note).slice(0, 500) : undefined, payment_type: 'CARD_PRESENT' } };
    const c = (await withRetry(() => call('POST', '/v2/terminals/checkouts', body))).checkout;
    return { id: c.id, status: c.status };
  },
  async getTerminalCheckout(id) {
    if (!live || String(id).startsWith('sim_')) {
      const t = simTerminals.get(id); if (!t) throw new SquareError('Checkout not found.', 'NOT_FOUND', 404);
      const age = Date.now() - t.at;
      if (t.status !== 'COMPLETED' && t.status !== 'CANCELED') {
        if (/cancel/i.test(t.deviceId) && age > SIM_TERMINAL_MS / 2) t.status = 'CANCELED';
        else if (age > SIM_TERMINAL_MS) { t.status = 'COMPLETED'; t.paymentIds = ['sim_pay_' + key().slice(0, 10)]; }
        else if (age > SIM_TERMINAL_MS / 3) t.status = 'IN_PROGRESS';
      }
      return { id, status: t.status, paymentIds: t.paymentIds, amount: t.amount / 100, simulated: true };
    }
    const c = (await call('GET', `/v2/terminals/checkouts/${encodeURIComponent(id)}`)).checkout;
    return { id: c.id, status: c.status, paymentIds: c.payment_ids || [], amount: c.amount_money ? c.amount_money.amount / 100 : null, cancelReason: c.cancel_reason || null };
  },
  async cancelTerminalCheckout(id) {
    if (!live || String(id).startsWith('sim_')) { const t = simTerminals.get(id); if (t && t.status !== 'COMPLETED') t.status = 'CANCELED'; return { id, status: t ? t.status : 'CANCELED' }; }
    const c = (await call('POST', `/v2/terminals/checkouts/${encodeURIComponent(id)}/cancel`)).checkout;
    return { id: c.id, status: c.status };
  },
};
