/* v4 end-to-end: roles enforced on the server, staff invitations, the exit desk (search, collect cash, receipt),
   ticket actions with an audit trail, Square Terminal checkouts, card on file, reports and exports, monthly CSV import,
   ratings, VIP plates and the parking charge notice wording. Needs the server (test/restart.sh) and test/mock-square.js. */
import { chromium } from 'playwright';
import fs from 'fs';
const B = 'http://localhost:8092', SQ = 'http://localhost:8099'; const out = []; const ok = (c, m) => { out.push((c ? 'PASS ' : 'FAIL ') + m); };
const b = await chromium.launch(); const pages = []; const errs = [];
const mk = async (w = 1280) => { const ctx = await b.newContext({ viewport: { width: w, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push(m.text()); }); await p.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; }); pages.push(p); return p; };
const H = { 'X-ParkOps': '1', 'Content-Type': 'application/json' };
const state = async p => (await p.request.get(B + '/api/state')).json();
const wait = ms => new Promise(r => setTimeout(r, ms));
const login = async (p, email, pw) => { await p.goto(B + '/login'); await p.fill('#em', email); await p.fill('#pw', pw); await p.click('button'); await p.waitForTimeout(800); };
const post = async (p, url, data) => { const r = await p.request.post(B + url, { headers: H, data: data || {} }); let j = {}; try { j = await r.json(); } catch (e) {} return { status: r.status(), j }; };
try {
  const owner = await mk(); await login(owner, 'boss@example.com', 'supersecret1');
  let st = await state(owner);
  ok(st.role === 'owner' && st.user.role === 'owner', 'first account is the owner');
  ok(await owner.evaluate(() => S.role === 'owner' && can('users') && can('tickets.adjust')), 'console knows the owner’s permissions');
  ok(/Owner/.test(await owner.textContent('#brandSub')), 'role shown under the brand');

  /* ---------- people & access: invitations ---------- */
  let r = await post(owner, '/api/admin/users', { name: 'Pat Booth', email: 'pat@example.com', role: 'attendant', invite: true });
  ok(r.status === 200 && r.j.inviteSent === false && /\/staff\/welcome\?token=/.test(r.j.link || ''), 'invite without email set up returns the link and never claims it was sent');
  const inviteLink = r.j.link;
  r = await post(owner, '/api/admin/users', { name: 'Bad', email: 'not-an-email', role: 'attendant', invite: true }); ok(r.status === 400, 'invalid email rejected');
  r = await post(owner, '/api/admin/users', { name: 'Bad', email: 'x@example.com', role: 'king', invite: true }); ok(r.status === 400, 'unknown role rejected');
  await owner.click('#tabs [data-tab=settings]'); await owner.waitForTimeout(900);
  ok(/People & access/.test(await owner.textContent('#main')) && /Invited/.test(await owner.textContent('#main')), 'settings lists the invited attendant');
  await owner.click('[data-act=addUser]'); await owner.waitForTimeout(300);
  ok(await owner.locator('#f_role option').count() === 5, 'five roles offered');
  await owner.fill('#f_name', 'Sam Numbers'); await owner.fill('#f_email', 'sam@example.com'); await owner.selectOption('#f_role', 'accountant'); await owner.click('#dlgForm button.pri'); await owner.waitForTimeout(600);
  ok(/wasn’t emailed|couldn’t be sent/.test(await owner.textContent('#dlgForm')) && /staff\/welcome/.test(await owner.inputValue('#invLink')), 'UI shows the link instead of saying "sent"');
  const samLink = await owner.inputValue('#invLink'); await owner.click('#dlgForm [data-dlg=close]');
  await owner.screenshot({ path: 'shots/v4-people.png', fullPage: true });
  // Pat accepts the invitation
  const pat = await mk(1100); await pat.goto(inviteLink); await pat.waitForTimeout(300);
  ok(/Welcome, Pat/.test(await pat.textContent('body')) && /Attendant/.test(await pat.textContent('body')), 'welcome page names the person and role');
  await pat.fill('#pw', 'short'); await pat.click('button'); await pat.waitForTimeout(300); ok(/staff\/welcome/.test(pat.url()) && await pat.evaluate(() => document.querySelector('#pw').validity.tooShort), 'short password refused');
  await pat.fill('#pw', 'patpassword1'); await pat.click('button'); await pat.waitForTimeout(1200);
  ok(await pat.evaluate(() => !document.querySelector('#tabs').hidden && S.role === 'attendant'), 'invitation accepted and signed in as attendant');
  const again = await pat.request.get(inviteLink); ok(again.status() === 400, 'invitation link works once');
  const sam = await mk(); await sam.goto(samLink); await sam.fill('#pw', 'sampassword1'); await sam.click('button'); await sam.waitForTimeout(1000);
  ok(await sam.evaluate(() => S.role === 'accountant' && !can('tickets')), 'accountant signed in');
  r = await post(owner, '/api/admin/users', { name: 'Vic Viewer', email: 'vic@example.com', role: 'viewer', password: 'vicpassword1' }); ok(r.status === 200, 'viewer created with a password');
  const vic = await mk(); await login(vic, 'vic@example.com', 'vicpassword1');
  ok(await vic.evaluate(() => S.role === 'viewer' && !S.writable) && /view-only/.test(await vic.textContent('#main')), 'viewer sees the console read-only');

  /* ---------- server-side role enforcement ---------- */
  r = await pat.request.patch(B + '/api/db/facilities/f-main', { headers: H, data: { capacity: 1 } }); ok(r.status() === 403, 'attendant can’t change locations');
  r = await sam.request.patch(B + '/api/db/facilities/f-main', { headers: H, data: { capacity: 1 } }); ok(r.status() === 403, 'accountant can’t change locations');
  r = await vic.request.post(B + '/api/tickets', { headers: H, data: { plate: 'VIEW1', facilityId: 'f-main' } }); ok(r.status() === 403, 'viewer can’t open tickets');
  r = await sam.request.post(B + '/api/tickets', { headers: H, data: { plate: 'ACCT1', facilityId: 'f-main' } }); ok(r.status() === 403 && /Accountants can’t/.test((await r.json()).error.message), 'accountant can’t open tickets, with a plain reason');
  r = await pat.request.get(B + '/api/admin/users'); ok(r.status() === 403, 'attendant can’t list staff');
  r = await pat.request.get(B + '/api/admin/payments'); ok(r.status() === 403, 'attendant can’t read the ledger');
  r = await sam.request.get(B + '/api/admin/payments'); ok(r.status() === 200, 'accountant can read the ledger');
  r = await sam.request.get(B + '/api/admin/users'); ok(r.status() === 403, 'accountant can’t list staff');
  const pst = await state(pat); ok(pst.cameras.every(c => !c.token), 'attendant never receives camera webhook tokens');
  r = await pat.request.post(B + '/api/db/ratings', { headers: H, data: { stars: 5 } }); ok(r.status() === 403, 'ratings can’t be written by staff');
  r = await owner.request.post(B + '/api/db/ratings', { headers: H, data: { stars: 5 } }); ok(r.status() === 403, 'not even by the owner');
  r = await post(sam, '/api/admin/users/u_0/invite'); ok(r.status === 403, 'accountant can’t invite');
  const ownerId = st.user.id;
  r = await owner.request.patch(B + '/api/admin/users/' + ownerId, { headers: H, data: { role: 'viewer' } }); ok(r.status() === 400, 'owner can’t demote themselves');
  // a manager can do everything but staff
  r = await post(owner, '/api/admin/users', { name: 'Max Manager', email: 'max@example.com', role: 'manager', password: 'maxpassword1' });
  const max = await mk(); await login(max, 'max@example.com', 'maxpassword1');
  r = await max.request.get(B + '/api/admin/users'); ok(r.status() === 403, 'manager can’t manage staff');
  r = await max.request.patch(B + '/api/db/facilities/f-main', { headers: H, data: { terminalDeviceId: 'DEV-BOOTH-1' } }); ok(r.status() === 200, 'manager can edit locations (Terminal device id set)');

  /* ---------- exit desk: camera car arrives, attendant searches and collects cash ---------- */
  st = await state(owner); const camIn = st.cameras.find(c => c.direction === 'in'), camOut = st.cameras.find(c => c.direction === 'out');
  await post(owner, '/api/lpr/test', { cameraId: camIn.id, plate: 'DESK101', at: Date.now() - 95 * 60e3 });
  await pat.goto(B + '/'); await pat.waitForTimeout(900); await pat.click('#tabs [data-tab=selfparking]'); await pat.waitForTimeout(500);
  ok(await pat.evaluate(() => document.activeElement && document.activeElement.id === 'deskQ'), 'exit desk search box is focused');
  await pat.fill('#deskQ', 'desk101'); await pat.press('#deskQ', 'Enter'); await pat.waitForTimeout(500);
  const dueTxt = await pat.textContent('.due b');
  const expected = await pat.evaluate(() => money(R.balanceOf(S.sessions.find(s => s.plate === 'DESK101'))));
  ok(dueTxt === expected && expected !== '$0.00', `desk shows the amount due (${expected})`);
  ok(/Arrived/.test(await pat.textContent('.facts')) && /1h 3[0-9]m|1h 2[0-9]m/.test(await pat.textContent('.facts')), 'desk shows arrival and time parked');
  ok(await pat.locator('[data-act=deskTerminal]').count() === 1, 'Square Terminal button offered (device id on the location)');
  await pat.screenshot({ path: 'shots/v4-desk.png', fullPage: true });
  await pat.click('[data-act=deskPay]'); await pat.waitForTimeout(300);
  ok(await pat.locator('#f_method option[value=comp]').count() === 0, 'attendant isn’t offered complimentary');
  await pat.click('#payExact'); await pat.waitForTimeout(100); await pat.fill('#f_tendered', '20'); await pat.waitForTimeout(150);
  ok(/Change due/.test(await pat.textContent('#changeDue')), 'change due shown while typing the cash tendered');
  await pat.click('#dlgForm button.pri'); await pat.waitForTimeout(800);
  st = await state(owner); let desk = st.sessions.find(s => s.plate === 'DESK101');
  ok(desk.endAt && desk.payments.length === 1 && desk.payments[0].method === 'cash' && desk.payments[0].by === 'Pat Booth' && desk.payments[0].tendered === 20 && desk.payments[0].ledgerId, 'cash payment recorded on the ticket with staff name, tendered and ledger link; ticket closed');
  ok(/Paid/.test(await pat.textContent('.receipt')) && /change due/.test(await pat.textContent('.receipt')), 'desk confirms the payment and change');
  await pat.click('[data-act=printReceipt]'); ok(await pat.evaluate(() => window.__printed >= 1), 'receipt printed');
  const rcpt = await pat.evaluate(() => document.querySelector('#printArea').innerHTML);
  ok(/PARKING RECEIPT/.test(rcpt) && /sales tax/.test(rcpt) && /DESK101/.test(rcpt) && /tendered \$20\.00/.test(rcpt), 'printed receipt shows tax line, plate and tender');
  let led = await (await owner.request.get(B + '/api/admin/payments')).json();
  ok(led.some(p => p.method === 'cash' && p.staff === 'Pat Booth' && p.kind === 'ticket' && p.session_id === desk.id && p.facility_id === 'f-main'), 'cash payment is on the server ledger with staff, ticket and location');
  r = await post(pat, '/api/tickets/' + desk.id + '/pay', { method: 'terminal', amount: 1 }); ok(r.status === 400 && /Choose cash/.test(r.j.error.message), 'client can’t forge a Terminal payment');
  r = await post(pat, '/api/tickets/' + desk.id + '/pay', { method: 'comp', note: 'friend' }); ok(r.status === 403, 'attendant can’t give complimentary parking');
  r = await post(pat, '/api/tickets/' + desk.id + '/waive', { reason: 'x' }); ok(r.status === 403 && /Attendants can’t waive/.test(r.j.error.message), 'attendant can’t waive');
  r = await post(pat, '/api/tickets/' + desk.id + '/reopen', { reason: 'x' }); ok(r.status === 403, 'attendant can’t reopen');

  /* ---------- manual ticket, validation, ticket actions with audit trail ---------- */
  r = await post(pat, '/api/tickets', { plate: 'lost 22', facilityId: 'f-main', startAt: Date.now() - 3 * 3600e3, notes: 'lost ticket' });
  ok(r.status === 200 && /^T[0-9A-Z]{7}$/.test(r.j.ticket), 'attendant opened a manual ticket ' + r.j.ticket);
  const lost = r.j.sessionId;
  r = await post(pat, '/api/tickets', { plate: 'LOST22', facilityId: 'f-main' }); ok(r.status === 400 && r.j.sessionId === lost, 'a second open ticket for the same plate is refused, pointing at the open one');
  await post(owner, '/api/db/validations', { code: 'DENT25', name: 'Dentist', type: 'hours', value: 2, active: true, department: 'Dental' });
  r = await post(pat, '/api/tickets/' + lost + '/validate', { code: 'DENT25' }); ok(r.status === 200 && r.j.validation.code === 'DENT25', 'attendant applied a validation code');
  await wait(400); st = await state(owner); let ls = st.sessions.find(s => s.id === lost);
  const valChk = await owner.evaluate(id => { const s = S.sessions.find(x => x.id === id), f = R.facFor(s); const pd = R.priceDetail(f, s.startAt, Date.now(), s.validation); return { withVal: R.balanceOf(s), without: R.charge(f, s.startAt, Date.now(), null), free: pd.freeMinutes, code: s.validation && s.validation.code }; }, lost);
  ok(valChk.code === 'DENT25' && valChk.free === 120 && valChk.withVal <= valChk.without, `validation gives 2 free hours from arrival (${valChk.withVal} vs ${valChk.without} without)`);
  r = await post(pat, '/api/tickets/' + lost + '/validate', { code: 'DENT25', replace: true, reason: 'x' }); ok(r.status === 403, 'replacing a validation needs a manager');
  r = await post(max, '/api/tickets/' + lost + '/validate', { code: 'DENT25', replace: true }); ok(r.status === 400 && /reason/i.test(r.j.error.message), 'replacing needs a reason');
  r = await post(max, '/api/tickets/' + lost + '/note', { text: 'Driver said the machine ate the ticket' }); ok(r.status === 200, 'note added');
  r = await post(max, '/api/tickets/' + lost + '/close', { at: Date.now() }); ok(r.status === 200 && r.j.balance > 0, 'manager closed the ticket leaving a balance');
  r = await post(max, '/api/tickets/' + lost + '/adjust', { fee: 1, reason: 'Goodwill' }); ok(r.status === 200 && r.j.fee === 1, 'fee adjusted');
  r = await post(max, '/api/tickets/' + lost + '/waive', { reason: 'Equipment failure' }); ok(r.status === 200, 'balance waived');
  r = await post(max, '/api/tickets/' + lost + '/reopen', { reason: 'Car still inside' }); ok(r.status === 200, 'ticket reopened');
  r = await post(max, '/api/tickets/' + lost + '/setPlate', { plate: 'LOST23', reason: 'Typo' }); ok(r.status === 200, 'plate corrected');
  st = await state(owner); ls = st.sessions.find(s => s.id === lost);
  ok(ls.plate === 'LOST23' && ls.plateOriginal === 'LOST22' && ls.waived && !ls.endAt && ls.history.length >= 7 && ls.history.every(h => h.by), 'ticket history records every action and who did it');
  const aud = await (await pat.request.get(B + '/api/admin/audit?coll=sessions&id=' + lost)).json();
  ok(Array.isArray(aud) && aud.length >= 7 && aud.some(a => /Max Manager/.test(a.actor)), 'attendant can read the audit trail of a ticket');
  await max.goto(B + '/'); await max.waitForTimeout(900); await max.evaluate(id => { UI.tab = 'selfparking'; UI.spView = 'ticket'; UI.ticketId = id; render(); }, lost); await max.waitForTimeout(800);
  const tkText = await max.textContent('#main');
  ok(/Ticket T/.test(tkText) && /Plate corrected/.test(tkText) && /Balance waived/.test(tkText) && /Max Manager/.test(tkText) && !/Record update/.test(tkText), 'ticket page timeline shows every action once, with who did it');
  ok(await max.locator('[data-act=unwaive]').count() === 1 && await max.locator('[data-act=deskClose]').count() === 1, 'ticket page offers the right actions for its state');
  await max.screenshot({ path: 'shots/v4-ticket.png', fullPage: true });

  /* ---------- Square Terminal ---------- */
  await post(owner, '/api/lpr/test', { cameraId: camIn.id, plate: 'TERM77', at: Date.now() - 2 * 3600e3 });
  st = await state(owner); const term = st.sessions.find(s => s.plate === 'TERM77');
  const dueT = await owner.evaluate(id => R.balanceOf(S.sessions.find(s => s.id === id)), term.id);
  r = await post(pat, '/api/tickets/' + term.id + '/terminal', { close: true });
  ok(r.status === 200 && /^TC/.test(r.j.checkoutId) && r.j.status === 'PENDING' && Math.abs(r.j.amount - dueT) < 0.005, 'Terminal checkout created for the amount due');
  const ck = r.j.checkoutId;
  let mlog = await (await fetch(SQ + '/log')).json();
  const tc = mlog.find(x => x.path === '/v2/terminals/checkouts' && x.method === 'POST');
  ok(tc && tc.body.checkout.device_options.device_id === 'DEV-BOOTH-1' && tc.body.checkout.amount_money.amount === Math.round(dueT * 100) && tc.body.idempotency_key && tc.ver === '2026-09-16', 'Square Terminal API called with the device id, cents, idempotency key and current API version');
  r = await post(pat, '/api/tickets/' + term.id + '/terminal', { close: true }); ok(r.status === 200 && r.j.checkoutId === ck && r.j.existing, 'a second tap reuses the open checkout');
  let pr = await (await pat.request.get(B + '/api/terminal/' + ck)).json(); ok(pr.status === 'PENDING' || pr.status === 'IN_PROGRESS', 'poll: waiting for the driver');
  pr = await (await pat.request.get(B + '/api/terminal/' + ck)).json(); pr = await (await pat.request.get(B + '/api/terminal/' + ck)).json();
  ok(pr.status === 'COMPLETED' && pr.applied === true && pr.closed === true && /^PAYT/.test(pr.paymentId), 'checkout completed, payment applied, ticket closed');
  pr = await (await pat.request.get(B + '/api/terminal/' + ck)).json(); ok(pr.applied === true, 'polling again is harmless');
  st = await state(owner); const t2 = st.sessions.find(s => s.id === term.id);
  ok(t2.endAt && t2.payments.length === 1 && t2.payments[0].method === 'terminal' && t2.payments[0].pid === pr.paymentId && Math.abs(t2.payments[0].amount - dueT) < 0.005, 'ticket shows the Terminal payment with the Square payment id');
  ok(await owner.evaluate(id => R.balanceOf(S.sessions.find(s => s.id === id)) === 0, term.id), 'ticket closed with nothing owed even if an increment ticked over while paying');
  led = await (await owner.request.get(B + '/api/admin/payments')).json();
  const lt = led.find(p => p.sq_id === pr.paymentId); ok(lt && lt.method === 'terminal' && lt.staff === 'Pat Booth' && lt.card_last4 === '2222' && lt.receipt_url, 'ledger has the Terminal payment with card and receipt');
  // cancel flow through the UI dialog
  await owner.request.patch(B + '/api/db/facilities/f-main', { headers: H, data: { terminalDeviceId: 'cancel-device' } });
  await post(owner, '/api/lpr/test', { cameraId: camIn.id, plate: 'TERM78', at: Date.now() - 2 * 3600e3 });
  await pat.goto(B + '/'); await pat.waitForTimeout(900); await pat.click('#tabs [data-tab=selfparking]'); await pat.fill('#deskQ', 'TERM78'); await pat.press('#deskQ', 'Enter'); await pat.waitForTimeout(500);
  await pat.click('[data-act=deskTerminal]'); await pat.waitForTimeout(2200);
  ok(/Waiting for the driver|Driver is paying|Sending/.test(await pat.textContent('#termBox')), 'Terminal dialog shows progress');
  await pat.screenshot({ path: 'shots/v4-terminal.png' });
  await pat.waitForTimeout(4500);
  ok(/Cancelled/.test(await pat.textContent('#termBox')) && /No payment was taken/.test(await pat.textContent('#termBox')), 'driver cancelling on the device is shown, nothing charged');
  st = await state(owner); ok(!st.sessions.find(s => s.plate === 'TERM78').payments.length, 'no payment recorded after a cancel');
  await pat.click('#termDone'); await pat.waitForTimeout(200);
  await owner.request.patch(B + '/api/db/facilities/f-main', { headers: H, data: { terminalDeviceId: 'DEV-BOOTH-1' } });

  /* ---------- card on file from the desk ---------- */
  const d = await mk(400);
  r = await post(d, '/api/account/signup', { name: 'Maya Card', email: 'maya@example.com', password: 'drivingpass1', plates: 'COF555' }); ok(r.status === 200, 'driver account');
  r = await post(d, '/api/account/card', { sourceId: 'cnon:card-nonce-ok' }); ok(r.status === 200 && r.j.account.card, 'card saved');
  await post(owner, '/api/lpr/test', { cameraId: camIn.id, plate: 'COF555', at: Date.now() - 4 * 3600e3 });
  st = await state(owner); const cof = st.sessions.find(s => s.plate === 'COF555'); ok(cof.kind === 'member', 'camera saw the autopay member');
  const dueC = await owner.evaluate(id => R.balanceOf(S.sessions.find(s => s.id === id)), cof.id);
  r = await post(pat, '/api/tickets/' + cof.id + '/chargeCard', { close: true });
  ok(r.status === 200 && Math.abs(r.j.amount - dueC) < 0.005 && r.j.closed && r.j.receiptUrl, 'card on file charged from the desk and ticket closed');
  r = await post(pat, '/api/tickets/' + cof.id + '/chargeCard', { close: true }); ok(r.status === 400 && /Nothing is owed/.test(r.j.error.message), 'second charge refused: nothing owed');
  st = await state(owner); const cof2 = st.sessions.find(s => s.id === cof.id);
  ok(cof2.payments.length === 1 && cof2.payments[0].method === 'autopay' && /^PAY/.test(cof2.payments[0].pid), 'one card payment on the ticket');
  const ob = await (await owner.request.get(B + '/api/admin/outbox')).json(); ok(ob.messages.some(m => m.to === 'maya@example.com' && /Receipt/.test(m.subject)), 'driver emailed a receipt');
  r = await post(pat, '/api/tickets/' + cof.id + '/pay', { method: 'cash', amount: 5 }); ok(r.status === 400, 'can’t take cash on a settled ticket');

  /* ---------- VIP plates and ratings ---------- */
  await post(owner, '/api/db/vips', { name: 'Mayor', plates: ['VIP001'], freeParking: true, active: true, facilities: [] });
  await post(owner, '/api/lpr/test', { cameraId: camIn.id, plate: 'VIP001', at: Date.now() - 3600e3 });
  r = await post(owner, '/api/lpr/test', { cameraId: camOut.id, plate: 'VIP001' }); ok(/VIP/.test(r.j.text) || (await state(owner)).sessions.find(s => s.plate === 'VIP001').fee === 0, 'VIP plate exits without a charge');
  st = await state(owner); const vipS = st.sessions.find(s => s.plate === 'VIP001'); ok(vipS.kind === 'vip' && vipS.fee === 0, 'VIP visit recorded as free');
  // prepaid driver rates the visit from the receipt
  await d.goto(B + '/p/4201'); await d.waitForTimeout(900); await d.fill('#pPlate', 'RATE1'); await d.waitForTimeout(600); await d.click('#pGo'); await d.waitForSelector('#payGo'); await d.click('#payGo'); await d.waitForTimeout(900);
  ok(await d.locator('.stars .star').count() === 5, 'receipt offers a 1–5 star rating');
  await d.fill('#rateText', 'Easy'); await d.click('.stars .star[data-v="4"]'); await d.waitForTimeout(600);
  st = await state(owner); ok(st.ratings.length === 1 && st.ratings[0].stars === 4 && st.ratings[0].plate === 'RATE1' && st.ratings[0].comment === 'Easy', 'rating stored with the ticket');
  r = await post(d, '/api/portal/rate', { args: { sessionId: st.ratings[0].sessionId, stars: 1 } }); ok(r.j.error && /already rated/.test(r.j.error), 'one rating per visit');

  /* ---------- monthly CSV import ---------- */
  await post(owner, '/api/db/companies', { name: 'Pecan Coffee', email: 'ops@pecan.example', billing: 'invoice', portalToken: 'p'.repeat(40) });
  const csv = 'name,email,plates,plan,company,paid through\nAna Reyes,ana@example.com,IMP001;IMP002,Unreserved monthly,,2026-12-31\nBo Lin,bo@example.com,IMP003,Reserved monthly,Pecan Coffee,\nNo Plan,x@example.com,IMP004,Gold,,\nDup,y@example.com,IMP001,Unreserved monthly,,';
  await owner.goto(B + '/'); await owner.waitForTimeout(900); await owner.click('#tabs [data-tab=permits]'); await owner.waitForTimeout(400); await owner.click('[data-act=importMonthly]'); await owner.waitForTimeout(300);
  await owner.fill('#impText', csv); await owner.click('#impCheck'); await owner.waitForTimeout(700);
  ok(/2<\/b> ready to import/.test(await owner.innerHTML('#impPrev')) && /Unknown plan "Gold"/.test(await owner.textContent('#impPrev')) && /IMP001 is already/.test(await owner.textContent('#impPrev')), 'preview shows what will import and why rows are skipped');
  st = await state(owner); ok(!st.permits.some(p => p.plates.includes('IMP001')), 'preview changed nothing');
  await owner.click('#impGo'); await owner.waitForTimeout(900);
  st = await state(owner); const ana = st.permits.find(p => p.plates.includes('IMP001')), bo = st.permits.find(p => p.plates.includes('IMP003'));
  ok(ana && ana.status === 'active' && ana.billing === 'office' && ana.plates.length === 2 && new Date(ana.paidThrough).toISOString() === '2027-01-01T06:00:00.000Z' && bo && bo.companyId && bo.billing === 'company', 'two parkers imported with plans, company and paid-through');
  await owner.screenshot({ path: 'shots/v4-import.png' });
  await owner.click('#impGo'); await owner.waitForTimeout(200);
  r = await pat.request.post(B + '/api/admin/monthly/import', { headers: H, data: { rows: [] } }); ok(r.status() === 403, 'attendant can’t import');
  await post(owner, '/api/lpr/test', { cameraId: camIn.id, plate: 'IMP003', at: Date.now() - 3600e3 });
  r = await post(owner, '/api/lpr/test', { cameraId: camOut.id, plate: 'IMP003' }); ok(/Monthly/.test(r.j.text) || (await state(owner)).sessions.find(s => s.plate === 'IMP003').kind === 'permit', 'imported monthly parker recognised by the cameras');

  /* ---------- reports and exports ---------- */
  await post(owner, '/api/lpr/test', { cameraId: camIn.id, plate: 'OWE404', at: Date.now() - 3600e3 }); await post(owner, '/api/lpr/test', { cameraId: camOut.id, plate: 'OWE404' }); await wait(300);
  await owner.click('#tabs [data-tab=reports]'); await owner.waitForTimeout(1200);
  ok(await owner.locator('.rlist button').count() >= 20, 'twenty-plus reports listed');
  const pick = async id => { await owner.click(`[data-act=pickReport][data-v=${id}]`); await owner.waitForTimeout(700); return owner.textContent('.rep .panel:nth-child(2)'); };
  let t = await pick('payments'); ok(/Cash/.test(t) && /Pat Booth/.test(t) && /Card \(terminal\)/.test(t), 'payments report lists cash and Terminal payments with who took them');
  t = await pick('shift'); ok(/Pat Booth/.test(t) && /Cash/.test(t), 'shift close-out by attendant');
  t = await pick('ar'); ok(/Current/.test(t) && /31/.test(t) && /Oldest/.test(t) && /OWE404/.test(t), 'A/R aging buckets list the unpaid exit');
  t = await pick('validations'); ok(/DENT25/.test(t), 'validation report shows the code used');
  t = await pick('vip'); ok(/VIP001/.test(t) || /Mayor/.test(t), 'VIP report');
  t = await pick('ratings'); ok(/RATE1/.test(t) && /Easy/.test(t), 'ratings report shows the comment');
  t = await pick('users'); ok(/Pat Booth/.test(t) && /Attendant/.test(t) && /Max Manager/.test(t), 'staff & activity report from the server');
  t = await pick('waived'); ok(/Equipment failure/.test(t), 'waived report shows the reason');
  await owner.screenshot({ path: 'shots/v4-reports.png', fullPage: true });
  const [dl] = await Promise.all([owner.waitForEvent('download'), owner.click('[data-act=exportReport]')]);
  const csvText = fs.readFileSync(await dl.path(), 'utf8'); ok(csvText.split('\n')[0].split(',').length >= 4 && /Equipment failure/.test(csvText) && /Organization/.test(csvText) && /Report,Waived/.test(csvText), 'CSV export downloaded with metadata rows (' + dl.suggestedFilename() + ')');
  await sam.goto(B + '/'); await sam.waitForTimeout(900); await sam.click('#tabs [data-tab=reports]'); await sam.waitForTimeout(1000);
  ok(/Reports/.test(await sam.textContent('#main')) && await sam.locator('[data-act=exportReport]:not([disabled])').count() === 1, 'accountant can run and export reports');
  await pat.goto(B + '/'); await pat.waitForTimeout(900);
  ok(await pat.locator('#tabs [data-tab=reports]').count() === 0 || await pat.evaluate(() => !can('reports')), 'attendant has no reports access');

  /* ---------- payments tab and notice wording ---------- */
  await owner.click('#tabs [data-tab=payments]'); await owner.waitForTimeout(1000);
  ok(/Card \(terminal\)/.test(await owner.textContent('#main')) && /Cash/.test(await owner.textContent('#main')), 'payments tab lists desk and Terminal payments');
  await pat.click('.roles button[data-role=enf]'); await pat.waitForTimeout(300); await pat.fill('#enfPlate', 'NOTE99'); await pat.click('form[data-form=check] button.lg'); await pat.waitForTimeout(300);
  await pat.click('form[data-form=cite] button.lg'); await pat.waitForTimeout(800);
  const zpl = await pat.evaluate(() => { const c = S.citations.find(x => x.plate === 'NOTE99'); return window.citationZpl(c); });
  ok(/PARKING CHARGE NOTICE/.test(zpl) && /private parking charge notice/.test(zpl) && !/PARKING CITATION/.test(zpl), 'printed notice says it is a private charge notice, not a government citation');
  await pat.click('[data-act=printSys]'); ok(/not a government citation/.test(await pat.evaluate(() => document.querySelector('#printArea').textContent)), 'print dialog version carries the same wording');

  /* ---------- hardening (review findings) ---------- */
  const obx = await (await owner.request.get(B + '/api/admin/outbox')).json();
  ok(obx.messages.every(m => !/token=[A-Za-z0-9_-]{8}/.test(m.text)) && obx.messages.some(m => /token=…/.test(m.text)), 'outbox never stores invitation tokens');
  const camAud = await pat.request.get(B + '/api/admin/audit?coll=cameras&id=' + camIn.id); ok(camAud.status() === 403, 'attendant can’t read the audit trail of cameras');
  const ownAud = await (await owner.request.get(B + '/api/admin/audit?coll=cameras&id=' + camIn.id + '&limit=50')).json();
  ok(ownAud.every(a => JSON.stringify(a.detail || {}).indexOf(camIn.token) < 0), 'camera webhook tokens are never written to the audit log');
  ok((await pat.request.get(B + '/api/admin/audit?limit=-1')).status() === 403 && (await (await owner.request.get(B + '/api/admin/audit?limit=-1')).json()).length <= 1, 'negative limits are clamped');
  await post(owner, '/api/lpr/test', { cameraId: camIn.id, plate: 'CHEAP1', at: Date.now() - 5 * 3600e3 });
  st = await state(owner); const cheap = st.sessions.find(s => s.plate === 'CHEAP1');
  r = await post(pat, '/api/tickets/' + cheap.id + '/pay', { method: 'cash', amount: 1, quoted: 1, close: true });
  st = await state(owner); const cheap2 = st.sessions.find(s => s.id === cheap.id);
  ok(r.status === 200 && cheap2.endAt && cheap2.fee > 1 && !cheap2.feeQuoted, 'a fake low quote does not lower the fee: $1 paid, balance stays');
  r = await post(pat, '/api/tickets/' + cheap.id + '/markCited', {}); ok(r.status === 400 && /Issue the parking charge notice/.test(r.j.error.message), 'markCited needs a real notice');
  await post(owner, '/api/lpr/test', { cameraId: camIn.id, plate: 'BACK1', at: Date.now() - 5 * 3600e3 });
  st = await state(owner); const back = st.sessions.find(s => s.plate === 'BACK1');
  r = await post(pat, '/api/tickets/' + back.id + '/close', { at: back.startAt + 60e3 }); ok(r.status === 400 && /needs a manager/.test(r.j.error.message), 'attendant can’t backdate a departure to zero the fee');
  r = await post(max, '/api/tickets/' + back.id + '/close', { at: back.startAt + 60e3, reason: 'Camera outage' }); ok(r.status === 200, 'manager can backdate with a reason');
  r = await pat.request.post(B + '/api/db/reservations', { headers: H, data: { code: 'RFORGE1', email: 'me@x.example', status: 'booked', premium: 400, paymentId: cof2.payments[0].pid, facilityId: 'f-main', plate: 'FORGE1', start: Date.now() + 5 * 864e5, end: Date.now() + 5 * 864e5 + 3600e3, name: 'x' } });
  st = await state(owner); const forged = st.reservations.find(x => x.code === 'RFORGE1');
  ok(r.status() === 200 && forged && !forged.paymentId && !forged.premium, 'attendant-written reservations can’t carry payment ids or fees');
  r = await max.request.patch(B + '/api/db/reservations/' + forged.id, { headers: H, data: { paymentId: cof2.payments[0].pid, premium: 400 } });
  r = await post(pat, '/api/portal/cancelReservation', { args: { code: 'RFORGE1', email: 'me@x.example' } });
  ok(r.j.error && /can’t be refunded automatically/.test(r.j.error), 'a refund is only issued against the reservation’s own fee payment');
  r = await vic.request.post(B + '/api/photos?plate=X', { headers: { 'X-ParkOps': '1', 'Content-Type': 'image/jpeg' }, data: Buffer.from('xx') }); ok(r.status() === 403, 'viewer can’t upload photos');
  const pub = await (await d.request.get(B + '/api/state')).json(); ok(pub.facilities.every(f => !('terminalDeviceId' in f)), 'public state hides Terminal device ids');
  const cashRow = led.find(p => p.method === 'cash'); r = await post(owner, '/api/admin/refund', { id: cashRow.id, amount: 1 }); ok(r.status === 400 && /Only card payments/.test(r.j.error.message), 'cash rows can’t be "refunded" through Square');
  r = await post(owner, '/api/admin/refund', { sqId: cof2.payments[0].pid, amount: 1, reason: 'Overcharge' }); ok(r.status === 200, 'card refund from the ticket');
  st = await state(owner); ok(st.sessions.find(s => s.id === cof.id).history.some(h => h.action === 'refund' && /Overcharge/.test(h.detail)), 'refund noted on the ticket history');
  r = await owner.request.post(B + '/api/tickets', { headers: H, data: '{bad json' }); ok(r.status() === 400, 'malformed JSON is a 400, not a crash');
  r = await d.request.post(B + '/api/account/monthly/pay', { headers: H, data: { permitId: 'nope' } }); ok(r.status() === 400, 'monthly pay with a bad permit is a 400');
  ok((await vic.request.get(B + '/logout')).status() === 200 && (await state(vic)).role === 'viewer', 'GET /logout no longer signs anyone out');
  await vic.request.post(B + '/logout', { headers: { 'X-ParkOps': '1' } }); ok((await state(vic)).role === 'public', 'POST /logout signs out');

  /* ---------- health and state ---------- */
  st = await state(owner); ok(st.terminal && st.terminal.simulated === false && Array.isArray(st.vips) && Array.isArray(st.ratings), 'state carries terminal info, VIPs and ratings');
} catch (e) { console.log('ERROR', e.message.split('\n')[0]); for (const [i, p] of pages.entries()) await p.screenshot({ path: 'shots/v4-fail-' + i + '.png', fullPage: true }).catch(() => {}); }
console.log(out.join('\n')); console.log('page errors:', errs.length ? errs.join(' | ') : 'none'); await b.close();
