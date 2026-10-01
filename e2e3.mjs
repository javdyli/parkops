/* v3 end-to-end: QR lots, text-to-pay, SMS reminders, add time, rates editor, pay signs, monthly parking,
   waitlist approval, monthly billing, company portal and Square invoices, review queue, tax, idempotency. */
import { chromium } from 'playwright';
import crypto from 'crypto';
import fs from 'fs';
const B = 'http://localhost:8092'; const out = []; const ok = (c, m) => { out.push((c ? 'PASS ' : 'FAIL ') + m); };
const b = await chromium.launch(); const pages = []; const errs = [];
const mk = async (w = 1280) => { const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push(m.text()); }); await p.addInitScript(() => { window.print = () => { window.__printed = true; }; }); pages.push(p); return p; };
const H = { 'X-ParkOps': '1', 'Content-Type': 'application/json' };
const state = async p => (await p.request.get(B + '/api/state')).json();
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  const admin = await mk(); await admin.goto(B + '/login'); await admin.fill('#em', 'boss@example.com'); await admin.fill('#pw', 'supersecret1'); await admin.click('button'); await admin.waitForTimeout(800);
  let st = await state(admin);
  ok(st.facilities.some(f => f.payMode === 'qr' && f.lotCode === '4201'), 'starter QR lot 4201 exists');
  ok(st.config.taxRate === 8.25 && st.config.taxIncluded === true, 'Texas 8.25% tax, included in prices');

  /* ---------- QR lot: scan, pay by plate, text receipt ---------- */
  const d = await mk(390);
  await d.goto(B + '/p/4201'); await d.waitForTimeout(900);
  ok(/Elm Street Lot/.test(await d.textContent('#main')) && /LOT 4201/.test(await d.textContent('#main')), 'QR link opens the lot page');
  ok(/Only pay on/.test(await d.textContent('#main')), 'lot page warns about fake QR stickers');
  await d.fill('#pPlate', 'lot111'); await d.fill('#pPhone', '512-555-0199'); await d.waitForTimeout(700);
  const lotQ = await d.evaluate(() => money(R.quote('f-lot', 2)));
  ok((await d.textContent('#pQuote')) === lotQ, 'lot quote ' + lotQ + ' for 2 hours');
  ok(/sales tax/.test(await d.textContent('#pUntil')), 'quote shows the sales tax included');
  await d.click('#pGo'); await d.waitForSelector('#mockCardNum'); await d.click('#payGo'); await d.waitForTimeout(900);
  ok((await d.textContent('.receipt')).includes('Paid ' + lotQ + ' for LOT111'), 'paid at the QR lot');
  await d.screenshot({ path: 'shots/v3-lot.png', fullPage: true });
  let ob = await (await admin.request.get(B + '/api/admin/outbox')).json();
  const txt = ob.sms.messages.find(m => /0199$/.test(m.to) && /\/x\//.test(m.body));
  ok(!!txt && ob.sms.messages[0].sent === true, 'text receipt with add-time link sent through Twilio');
  let mlog = await (await fetch('http://localhost:8099/log')).json();
  ok(mlog.some(x => /Messages\.json/.test(x.path) && x.body.To === '+15125550199' && /^Basic /.test(x.auth)), 'Twilio API called with E.164 number and basic auth');
  st = await state(admin); let ls = st.sessions.find(s => s.plate === 'LOT111');
  ok(ls && ls.smsOptIn && ls.extendToken, 'session stored phone opt-in and add-time token');

  /* ---------- add time from the text link ---------- */
  const before = ls.paidUntil;
  await d.goto(B + '/x/' + ls.extendToken); await d.waitForTimeout(1000);
  ok(/LOT111<\/b> is paid until/.test(await d.innerHTML('#main')), 'add-time link shows the current paid time');
  await d.click('[data-act=ppDur][data-v="1"]'); await d.waitForTimeout(700);
  ok(/Adds time/.test(await d.textContent('#pUntil')), 'quote says it adds time');
  await d.click('#pGo'); await d.waitForSelector('#payGo'); await d.click('#payGo'); await d.waitForTimeout(900);
  st = await state(admin); ls = st.sessions.find(s => s.id === ls.id);
  ok(Math.abs(ls.paidUntil - before - 3600e3) < 2000 && ls.payments.length === 2, 'added one hour to the same session');

  /* ---------- reminder 15 minutes before expiry ---------- */
  await admin.request.patch(B + '/api/db/sessions/' + ls.id, { headers: H, data: { paidUntil: Date.now() + 10 * 60e3, reminded: false } });
  await wait(4000);
  ob = await (await admin.request.get(B + '/api/admin/outbox')).json();
  ok(ob.sms.messages.some(m => /ends at/.test(m.body) && /\/x\//.test(m.body)), 'reminder text sent before time runs out');

  /* ---------- officer grace after expiry ---------- */
  await admin.request.patch(B + '/api/db/sessions/' + ls.id, { headers: H, data: { paidUntil: Date.now() - 5 * 60e3 } });
  await admin.goto(B + '/'); await admin.waitForTimeout(900);
  let chk = await admin.evaluate(() => R.checkPlate('LOT111', 'f-lot').title);
  ok(chk === 'Expired, within grace', 'officer check: expired 5 min ago is within grace');
  await admin.request.patch(B + '/api/db/sessions/' + ls.id, { headers: H, data: { paidUntil: Date.now() - 25 * 60e3 } }); await admin.waitForTimeout(500);
  chk = await admin.evaluate(() => R.checkPlate('LOT111', 'f-lot').suggest);
  ok(chk === 'EXPIRED', 'officer check: 25 min past suggests an expired citation');

  /* ---------- text-to-pay ---------- */
  const sign = params => crypto.createHmac('sha1', 'twtoken').update(B + '/sms/inbound' + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64');
  const inb = { Body: ' 4201 ', From: '+15125550123', To: '+15125550100', MessageSid: 'SM1' };
  let r = await fetch(B + '/sms/inbound', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(inb) }, body: new URLSearchParams(inb) });
  let tx = await r.text(); ok(r.ok && /<Message>.*\/p\/4201/.test(tx), 'texting the lot number replies with the pay link');
  r = await fetch(B + '/sms/inbound', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'bad' }, body: new URLSearchParams(inb) });
  ok(r.status === 403, 'text webhook rejects a bad Twilio signature');
  const stop = { Body: 'STOP', From: '+15125550123' };
  r = await fetch(B + '/sms/inbound', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(stop) }, body: new URLSearchParams(stop) });
  ok((await r.text()).endsWith('<Response></Response>'), 'STOP gets no reply (Twilio handles opt-out)');

  /* ---------- idempotency: a retried payment isn't applied twice ---------- */
  const key = 'retry-' + Date.now();
  const q2 = await (await fetch(B + '/api/portal/quote?facilityId=f-lot&hours=1&untilEndOfDay=0&plate=IDEM1')).json();
  const pay1 = await (await d.request.post(B + '/api/portal/prepay', { headers: H, data: { args: { plate: 'IDEM1', facilityId: 'f-lot', hours: 1 }, payment: { sourceId: 'cnon:ok', idempotencyKey: key }, expectedAmount: q2.total } })).json();
  const pay2 = await (await d.request.post(B + '/api/portal/prepay', { headers: H, data: { args: { plate: 'IDEM1', facilityId: 'f-lot', hours: 1 }, payment: { sourceId: 'cnon:ok', idempotencyKey: key } } })).json();
  st = await state(admin); const idem = st.sessions.filter(s => s.plate === 'IDEM1');
  ok(pay1.receipt && pay2.repeat && idem.length === 1 && idem[0].payments.length === 1, 'retry with the same key: charged once, time added once');
  const wrong = await (await d.request.post(B + '/api/portal/prepay', { headers: H, data: { args: { plate: 'IDEM2', facilityId: 'f-lot', hours: 1 }, payment: { sourceId: 'cnon:ok', idempotencyKey: key + 'b' }, expectedAmount: 0.5 } })).json();
  ok(/amount is now/.test(wrong.error) && wrong.amount === q2.total, 'stale price is refused with the new amount');

  /* ---------- rates editor, specials, pay sign ---------- */
  await admin.click('#tabs [data-tab=facilities]'); await admin.waitForTimeout(500);
  await admin.click('[data-act=editFacility][data-id=f-lot]'); await admin.waitForTimeout(300);
  await admin.selectOption('#f_mode', 'table'); await admin.fill('#f_table', '30=2, 60=3, 120=5, 240=8'); await admin.click('#dlgForm [type=submit]'); await admin.waitForTimeout(700);
  st = await state(admin); let lot = st.facilities.find(f => f.id === 'f-lot');
  ok(lot.rates.mode === 'table' && lot.rates.table.length === 4 && lot.rates.table[1].price === 3, 'rate table saved');
  ok(await admin.evaluate(() => { const t = Date.parse('2026-09-29T10:00:00-05:00'); return R.charge(facById('f-lot'), t, t + 90 * 60e3) === 5 && R.charge(facById('f-lot'), t, t + 5 * 3600e3) === 12; }), 'rate table prices 90 min at $5 and past the last step at the daily max');
  await admin.click('[data-act=editRates][data-id=f-lot]'); await admin.waitForTimeout(300);
  await admin.click('[data-sp-add=eb]'); await admin.fill('#spp0', '6'); await admin.fill('#spHol', '2026-12-25'); await admin.click('#dlgForm [type=submit]'); await admin.waitForTimeout(700);
  st = await state(admin); lot = st.facilities.find(f => f.id === 'f-lot');
  ok(lot.rates.specials.length === 1 && lot.rates.specials[0].price === 6 && st.config.holidays.includes('2026-12-25'), 'early bird special and holiday saved');
  ok(/Early bird: \$6\.00/.test(await admin.textContent('#main')), 'rates column lists the special');
  await admin.screenshot({ path: 'shots/v3-facilities.png', fullPage: true });
  await admin.click('[data-act=makeSign][data-id=f-lot]'); await admin.waitForTimeout(300);
  await admin.selectOption('#f_tow', '1'); await admin.fill('#f_towCo', 'Lone Star Towing'); await admin.click('#dlgForm [type=submit]'); await admin.waitForTimeout(400);
  const signHtml = await admin.evaluate(() => document.querySelector('#printArea').innerHTML);
  ok(await admin.evaluate(() => window.__printed === true) && /LOT 4201/.test(signHtml) && /<svg/.test(signHtml) && /text <b>4201<\/b> to/.test(signHtml) && /Lone Star Towing/.test(signHtml), 'pay sign printed with QR, text-to-pay and tow notice');
  const qrSvg = await admin.evaluate(() => ParkQR.svg(HOSTED.webhookBase + '/p/4201'));
  fs.writeFileSync('/tmp/sign-qr.html', `<body style="margin:0;background:#fff"><div style="width:400px;height:400px">${qrSvg.replace('<svg ', '<svg width="400" height="400" ')}</div></body>`);
  const qp = await mk(420); await qp.goto('file:///tmp/sign-qr.html'); await qp.screenshot({ path: '/tmp/sign-qr.png', clip: { x: 0, y: 0, width: 400, height: 400 } });
  await admin.keyboard.press('Escape');

  /* ---------- monthly parking: account sign-up, waitlist, approval ---------- */
  const m1 = await mk(420); await m1.goto(B + '/?account=1'); await m1.waitForTimeout(700);
  await m1.fill('#suName', 'Ana Ruiz'); await m1.fill('#suEmail', 'ana@example.com'); await m1.fill('#suPw', 'monthlypass1'); await m1.fill('#suPlates', 'MON111'); await m1.fill('#suPhone', '5125550111'); await m1.click('form[data-form=acctSignup] button'); await m1.waitForTimeout(700);
  await m1.click('[data-act=pv][data-v=monthly]'); await m1.waitForTimeout(400);
  ok(/Add a card to your account first/.test(await m1.textContent('#main')), 'monthly sign-up asks for a card first');
  await m1.click('[data-act=addCard]'); await m1.waitForSelector('#mockCardNum'); await m1.click('#payGo'); await m1.waitForTimeout(800);
  await m1.click('[data-act=pv][data-v=monthly]'); await m1.waitForTimeout(400);
  await m1.selectOption('#moPlan', 't-unres'); await m1.click('form[data-form=monthlyH] button'); await m1.waitForTimeout(300);
  ok(/on the 1st of each month/.test(await m1.textContent('#dlgForm')), 'confirmation explains proration and renewal');
  await m1.click('#dlgForm [type=submit]'); await m1.waitForTimeout(900);
  ok(/Monthly parking started/.test(await m1.textContent('.receipt')), 'monthly parking started');
  st = await state(admin); const mp = st.permits.find(p => p.plates.includes('MON111'));
  ok(mp && mp.status === 'active' && mp.accountId && /^PAY/.test(mp.firstPaymentId) && mp.paidThrough > Date.now(), 'monthly parker active, first partial month charged');
  let pays = await (await admin.request.get(B + '/api/admin/payments')).json();
  ok(pays.some(p => p.kind === 'monthly' && p.tax_cents > 0 && p.net_cents + p.tax_cents === p.amount_cents), 'monthly payment recorded with tax split');
  r = await admin.request.post(B + '/api/lpr/test', { headers: H, data: { cameraId: 'c-main-in', plate: 'MON111' } });
  ok((await r.json()).text === 'Monthly parker entered', 'camera recognizes the monthly parker');
  r = await admin.request.post(B + '/api/lpr/test', { headers: H, data: { cameraId: 'c-main-out', plate: 'MON111' } });
  ok(/no charge/.test((await r.json()).text), 'monthly parker exits with no charge');
  // waitlist
  r = await admin.request.post(B + '/api/db/permitTypes', { headers: H, data: { name: 'Rooftop reserved', kind: 'reserved', price: 120, quota: 1, maxVehicles: 2, facilities: ['f-main'], active: true } }); const tiny = (await r.json()).id;
  const m2 = await mk(420); await m2.request.post(B + '/api/account/signup', { headers: H, data: { name: 'Ben Cho', email: 'ben@example.com', password: 'monthlypass2', plates: 'MON222' } });
  await m2.request.post(B + '/api/account/card', { headers: H, data: { sourceId: 'cnon:ok' } });
  let j = await (await m2.request.post(B + '/api/portal/monthlySignup', { headers: H, data: { args: { planId: tiny, plates: 'MON222' }, payment: { idempotencyKey: 'k1' } } })).json();
  ok(/started/.test(j.receipt.title), 'second driver takes the last rooftop spot');
  await m1.goto(B + '/'); await m1.waitForTimeout(500); await m1.click('[data-act=pv][data-v=monthly]'); await m1.waitForTimeout(300);
  await m1.selectOption('#moPlan', tiny); await m1.click('form[data-form=monthlyH] button'); await m1.waitForTimeout(300);
  ok(/Join the waitlist/.test(await m1.textContent('#dlgForm')), 'full plan offers the waitlist');
  await m1.click('#dlgForm [type=submit]'); await m1.waitForTimeout(800);
  st = await state(admin); const wl = st.permits.find(p => p.permitTypeId === tiny && p.plates.includes('MON111'));
  ok(wl && wl.status === 'waitlist' && !wl.firstPaymentId, 'waitlisted without a charge');
  j = await (await m2.request.post(B + '/api/portal/cancelMonthly', { headers: H, data: { args: { permitId: st.permits.find(p => p.plates.includes('MON222')).id } } })).json();
  ok(/stays active through/.test(j.receipt.body), 'driver cancels: active through the end of the paid month');
  await admin.request.patch(B + '/api/db/permits/' + st.permits.find(p => p.plates.includes('MON222')).id, { headers: H, data: { status: 'cancelled', endAt: Date.now() } });
  await admin.goto(B + '/'); await admin.waitForTimeout(600); await admin.click('#tabs [data-tab=permits]'); await admin.waitForTimeout(500);
  await admin.click('[data-act=permitStatus][data-v=waitlist]'); await admin.waitForTimeout(300);
  await admin.click(`[data-act=approvePermit][data-id=${wl.id}]`); await admin.waitForTimeout(900);
  st = await state(admin); const wl2 = st.permits.find(p => p.id === wl.id);
  ok(wl2.status === 'active' && /^PAY/.test(wl2.firstPaymentId), 'approving the waitlist charges the saved card and activates');
  await admin.click('[data-act=permitStatus][data-v=all]'); await admin.waitForTimeout(300);
  await admin.screenshot({ path: 'shots/v3-monthly.png', fullPage: true });

  /* ---------- monthly billing on the 1st ---------- */
  const mb = await admin.evaluate(() => R.monthBounds(Date.now(), facById('f-main')));
  await admin.request.patch(B + '/api/db/permits/' + mp.id, { headers: H, data: { paidThrough: mb.start } });
  await admin.waitForTimeout(300);
  j = await (await admin.request.post(B + '/api/admin/billing/run', { headers: H })).json();
  st = await state(admin);
  ok(st.permits.find(p => p.id === mp.id).paidThrough === mb.end && /^PAY/.test(st.permits.find(p => p.id === mp.id).lastPaymentId), 'billing run charged the card on file for the month' + (j.billed ? '' : ' (the background job got there first)'));
  ob = await (await admin.request.get(B + '/api/admin/outbox')).json();
  ok(ob.messages.some(m => m.to === 'ana@example.com' && /Receipt: monthly parking/.test(m.subject)), 'monthly receipt emailed');
  j = await (await admin.request.post(B + '/api/admin/billing/run', { headers: H })).json();
  ok(j.billed === 0, 'running billing again charges nothing twice');
  // past due → pay from account
  await admin.request.patch(B + '/api/db/permits/' + mp.id, { headers: H, data: { status: 'suspended', pastDueSince: Date.now() - 7 * 864e5, lateFeeDue: 25 } });
  await m1.goto(B + '/?account=1'); await m1.waitForTimeout(1200);
  ok(await m1.locator('[data-act=payMonthly]').count() === 1, 'account shows the past-due monthly payment');
  await m1.click('[data-act=payMonthly]'); await m1.waitForSelector('#payGo'); await m1.click('#payGo'); await m1.waitForTimeout(900);
  st = await state(admin); ok(st.permits.find(p => p.id === mp.id).status === 'active', 'paying past due reactivates monthly parking');
  await m1.screenshot({ path: 'shots/v3-account.png', fullPage: true });

  /* ---------- companies: portal, invoice, company card ---------- */
  await admin.goto(B + '/'); await admin.waitForTimeout(500); await admin.click('#tabs [data-tab=permits]'); await admin.waitForTimeout(400);
  await admin.click('[data-act=editCompany]'); await admin.fill('#f_name', 'Bluebonnet Law'); await admin.fill('#f_contactName', 'Priya Shah'); await admin.fill('#f_email', 'priya@bluebonnet.example'); await admin.click('#dlgForm [type=submit]'); await admin.waitForTimeout(700);
  st = await state(admin); const co = st.companies.find(c => c.name === 'Bluebonnet Law');
  ok(co && co.billing === 'invoice' && co.portalToken.length === 40, 'company created with a private portal link');
  await admin.click(`[data-act=sendCompanyLink][data-id=${co.id}]`); await admin.waitForTimeout(500);
  ob = await (await admin.request.get(B + '/api/admin/outbox')).json();
  ok(ob.messages.some(m => m.to === 'priya@bluebonnet.example' && m.text.includes('?company=…')), 'portal link emailed to the company contact (token redacted in the outbox)');
  const cp = await mk(1100); await cp.goto(B + '/?company=' + co.portalToken); await cp.waitForTimeout(900);
  ok(/Bluebonnet Law/.test(await cp.textContent('#main')), 'company portal opens from the link');
  await cp.fill('#ceName', 'Omar Lee'); await cp.fill('#ceEmail', 'omar@bluebonnet.example'); await cp.selectOption('#cePlan', 't-unres'); await cp.fill('#cePlates', 'CO1111'); await cp.click('form[data-form=companyAdd] button'); await cp.waitForTimeout(900);
  ok(/Omar Lee added/.test(await cp.textContent('.receipt')) && /CO1111/.test(await cp.textContent('#main')), 'company added an employee');
  await cp.screenshot({ path: 'shots/v3-company.png', fullPage: true });
  st = await state(admin); const ce = st.permits.find(p => p.plates.includes('CO1111'));
  ok(ce.companyId === co.id && ce.billing === 'company' && ce.prorateDue > 0, 'employee billed to the company, first month prorated');
  await admin.request.patch(B + '/api/db/permits/' + ce.id, { headers: H, data: { paidThrough: mb.start } }); await admin.waitForTimeout(300);
  await admin.request.post(B + '/api/admin/billing/run', { headers: H });
  st = await state(admin); let inv = st.invoices.find(i => i.companyId === co.id);
  ok(inv && /^INV/.test(inv.sqInvoiceId) && inv.status === 'UNPAID' && inv.publicUrl && Math.abs(inv.amount - (165 + ce.prorateDue)) < 0.01, 'Square invoice created for the month plus the partial month');
  mlog = await (await fetch('http://localhost:8099/log')).json();
  ok(mlog.some(x => x.path === '/v2/orders') && mlog.some(x => /\/publish$/.test(x.path)), 'order, invoice and publish sent to Square');
  await cp.reload(); await cp.waitForTimeout(900); ok(/Bluebonnet Law/.test(await cp.textContent('#main')), 'company portal survives a page reload'); ok(await cp.locator('a:has-text("Pay")').count() >= 1, 'company sees the invoice with a pay link');
  await fetch('http://localhost:8099/invoice-paid/' + inv.sqInvoiceId);
  await admin.request.post(B + '/api/admin/billing/run', { headers: H });
  st = await state(admin); inv = st.invoices.find(i => i.id === inv.id);
  ok(inv.status === 'PAID' && st.permits.find(p => p.id === ce.id).paidThrough === mb.end, 'paid invoice detected and the month marked paid');
  // officer can't see invoices or the portal token
  await admin.request.post(B + '/api/admin/users', { headers: H, data: { name: 'Ofc Diaz', email: 'diaz@example.com', role: 'attendant', password: 'officerpass1' } });
  const o = await mk(400); await o.goto(B + '/login'); await o.fill('#em', 'diaz@example.com'); await o.fill('#pw', 'officerpass1'); await o.click('button'); await o.waitForTimeout(700);
  const ost = await state(o); ok(!(ost.invoices || []).length && ost.companies.length >= 1 && ost.companies.every(c => !c.portalToken), 'officers don’t get invoices or company links');
  // company card billing
  r = await admin.request.post(B + '/api/db/companies', { headers: H, data: { name: 'Pecan Coffee', email: 'ops@pecan.example', billing: 'card', portalToken: crypto.randomBytes(20).toString('hex') } });
  st = await state(admin); const co2 = st.companies.find(c => c.name === 'Pecan Coffee');
  r = await cp.request.post(B + `/api/company/${co2.portalToken}/card`, { headers: H, data: { sourceId: 'cnon:ok' } }); ok(r.ok(), 'company saved a card');
  await cp.request.post(B + `/api/company/${co2.portalToken}/employees`, { headers: H, data: { name: 'Jo Kim', email: 'jo@pecan.example', planId: 't-unres', plates: 'CO2222' } });
  st = await state(admin); const ce2 = st.permits.find(p => p.plates.includes('CO2222'));
  await admin.request.patch(B + '/api/db/permits/' + ce2.id, { headers: H, data: { paidThrough: mb.start } }); await admin.waitForTimeout(300);
  await admin.request.post(B + '/api/admin/billing/run', { headers: H });
  st = await state(admin); ok(st.permits.find(p => p.id === ce2.id).paidThrough === mb.end && st.permits.find(p => p.id === ce2.id).prorateDue === 0, 'company card charged on the 1st');
  r = await cp.request.get(B + '/api/company/' + 'x'.repeat(40)); ok(r.status() === 404, 'wrong company link is refused');

  /* ---------- review queue ---------- */
  await admin.request.post(B + '/api/lpr/test', { headers: H, data: { cameraId: 'c-main-in', plate: 'FUZ123', at: Date.now() - 3600e3 } });
  r = await admin.request.post(B + '/api/lpr/test', { headers: H, data: { cameraId: 'c-main-out', plate: 'FUZ128' } });
  ok(/held for staff review/.test((await r.json()).text), 'one-character misread held for review, not billed');
  await admin.request.post(B + '/api/lpr/test', { headers: H, data: { cameraId: 'c-main-in', plate: 'MISS01', at: Date.now() - 30 * 3600e3 } });
  await admin.request.post(B + '/api/lpr/test', { headers: H, data: { cameraId: 'c-main-in', plate: 'MISS01' } });
  await admin.goto(B + '/'); await admin.waitForTimeout(700); await admin.click('#tabs [data-tab=overview]'); await admin.waitForTimeout(300);
  ok(/held for review/.test(await admin.textContent('#main')), 'overview flags exits held for review');
  await admin.click('#tabs [data-tab=activity]'); await admin.waitForTimeout(400); await admin.selectOption('#auditRange', 'week'); await admin.waitForTimeout(300); await admin.click('[data-act=auditFilter][data-v=problems]'); await admin.waitForTimeout(300);
  await admin.screenshot({ path: 'shots/v3-review.png', fullPage: true });
  st = await state(admin); const fz = st.sessions.find(s => s.plate === 'FUZ123'), ms = st.sessions.find(s => s.plate === 'MISS01' && s.missedExit);
  await admin.click(`[data-act=confirmMatch][data-id=${fz.id}]`); await admin.waitForTimeout(500);
  await admin.click(`[data-act=missedFree][data-id=${ms.id}]`); await admin.waitForTimeout(500);
  const bal = await admin.evaluate(id => R.balanceOf(S.sessions.find(s => s.id === id)), fz.id);
  st = await state(admin);
  ok(bal > 0 && st.sessions.find(s => s.id === fz.id).matchConfirmed, 'confirming the match makes the balance collectible');
  ok(st.sessions.find(s => s.id === ms.id).fee === 0 && st.sessions.find(s => s.id === ms.id).missedResolved, 'missed exit closed with no charge');

  /* ---------- payments tab, tax summary, overview revenue ---------- */
  await admin.click('#tabs [data-tab=payments]'); await admin.waitForTimeout(900);
  ok(/Sales tax by month/.test(await admin.textContent('#main')), 'sales tax by month summary');
  await admin.screenshot({ path: 'shots/v3-payments.png', fullPage: true });
  await admin.click('#tabs [data-tab=overview]'); await admin.waitForTimeout(900);
  ok(/Monthly/.test(await admin.textContent('.legend')), 'overview revenue includes monthly');
  await admin.click('#tabs [data-tab=settings]'); await admin.waitForTimeout(900);
  ok(/Recent texts/.test(await admin.textContent('#main')) && /sms\/inbound/.test(await admin.textContent('#main')), 'settings show texting status, webhook and recent texts');
  await admin.screenshot({ path: 'shots/v3-settings.png', fullPage: true });

  /* ---------- guards ---------- */
  r = await d.request.post(B + '/api/portal/monthlySignup', { headers: H, data: { args: { planId: 't-unres', plates: 'X1' } } }); ok(r.status() === 401, 'monthly sign-up needs an account');
  r = await d.request.post(B + '/api/portal/apply', { headers: H, data: { args: {} } }); ok(r.status() === 404, 'old permit application endpoint is gone');
} catch (e) { console.log('ERROR', e.message.split('\n')[0]); for (const [i, p] of pages.entries()) await p.screenshot({ path: 'shots/v3-fail-' + i + '.png', fullPage: true }).catch(() => {}); }
console.log(out.join('\n')); console.log('page errors:', errs.length ? errs.join(' | ') : 'none'); await b.close();
