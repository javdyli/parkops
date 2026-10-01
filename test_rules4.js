/* Rules v4: validation types, rate snapshots, price breakdown, rolling days, tickets, VIP, AR aging, ratings, roles. */
const assert = require('assert');
const Rules = require('../src/rules.js');
const H = 36e5, M = 6e4, D = 864e5;
const T0 = Date.parse('2026-10-06T10:00:00-05:00'); // Tue 10:00 Central
let NOW = T0;
const S = {
  config: { timeZone: 'America/Chicago', taxRate: 8.25, taxIncluded: true, holidays: [], openVisitFlagHours: 24 },
  facilities: [
    { id: 'g3', name: 'Garage 3', timeZone: 'America/Chicago', rates: { mode: 'increment', incrementMin: 30, incrementPrice: 5, dailyMax: 25, graceMin: 10, resetTime: '03:00', specials: [] }, valetRate: 10 },
    { id: 'lot', name: 'Lot', timeZone: 'America/Chicago', rates: { mode: 'increment', incrementMin: 60, incrementPrice: 2, dailyMax: 12, graceMin: 5, resetTime: '00:00', rolling: true, specials: [] } },
  ],
  permitTypes: [{ id: 't', name: 'Monthly', price: 165, facilities: ['g3'] }], permits: [{ id: 'p1', permitTypeId: 't', plates: ['MON111'], status: 'active', holder: 'Ana', number: '1' }],
  sessions: [], citations: [], validations: [
    { id: 'v1', code: 'SQ25', name: 'Merchant 2.5 h', type: 'hours', value: 2.5, active: true, uses: 0, maxUses: 0, facilityIds: ['g3'] },
    { id: 'v2', code: 'HALF', type: 'percent', value: 50, active: true, uses: 0 },
    { id: 'v3', code: 'TEN', type: 'dollar', value: 10, active: true, uses: 0 },
    { id: 'v4', code: 'FLAT5', type: 'fixed', value: 5, active: true, uses: 0, validFrom: T0 + D },
    { id: 'v5', code: 'ALL', type: 'full', value: 0, active: true, uses: 0, expiresAt: T0 - D },
  ],
  members: [], tenants: [], cameras: [{ id: 'in', facilityId: 'g3', direction: 'in' }, { id: 'out', facilityId: 'g3', direction: 'out' }], reservations: [], companies: [], invoices: [],
  vips: [{ id: 'vip1', name: 'Mayor’s office', plates: ['VIP001'], freeParking: true, active: true, facilities: [] }, { id: 'vip2', name: 'Bank exec', plates: ['VIP002'], freeParking: false, active: true }], ratings: [],
};
const R = Rules(S, () => NOW);
const g3 = S.facilities[0], lot = S.facilities[1];
const apply = ops => ops.forEach(o => { if (o.type === 'log') return; const arr = S[o.coll]; const i = arr.findIndex(x => x.id === o.id); if (o.type === 'set') { const d = Object.assign({ id: o.id }, o.data); if (i >= 0) arr[i] = d; else arr.push(d); } else if (o.type === 'update') arr[i] = Object.assign({}, arr[i], o.data); else if (o.type === 'delete') arr.splice(i, 1); });
const get = id => S.sessions.find(s => s.id === id);

// pricing: 3 hours at $5/30min = $30 → capped at $25
assert.strictEqual(R.charge(g3, T0, T0 + 3 * H), 25);
// hours validation: 2.5 h free from arrival, 3 h stay → 30 min → $5. Applied "later" doesn't matter.
assert.strictEqual(R.charge(g3, T0, T0 + 3 * H, { type: 'hours', value: 2.5 }), 5);
let pd = R.priceDetail(g3, T0, T0 + 3 * H, { type: 'hours', value: 2.5 });
assert.strictEqual(pd.freeMinutes, 150); assert.strictEqual(pd.discount, 20); assert.strictEqual(pd.days.length, 1);
// percent, dollar, fixed
assert.strictEqual(R.charge(g3, T0, T0 + 2 * H, { type: 'percent', value: 50 }), 10);
assert.strictEqual(R.charge(g3, T0, T0 + 2 * H, { type: 'dollar', value: 10 }), 10);
assert.strictEqual(R.charge(g3, T0, T0 + 2 * H, { type: 'dollar', value: 50 }), 0);
assert.strictEqual(R.charge(g3, T0, T0 + 2 * H, { type: 'fixed', value: 5 }), 5);
assert.strictEqual(R.charge(g3, T0, T0 + 30 * M, { type: 'fixed', value: 5 }), 5); // 30 min = $5 standard → min(5,5)
assert.strictEqual(R.charge(g3, T0, T0 + 20 * M, { type: 'fixed', value: 5 }), 5);
assert.strictEqual(R.charge(g3, T0, T0 + 5 * M, { type: 'fixed', value: 5 }), 0); // grace
// breakdown across a 3 AM reset: in Tue 22:00, out Wed 05:00 → 5 h before reset ($25 cap) + 2 h after ($20)
const e1 = Date.parse('2026-10-06T22:00:00-05:00');
pd = R.priceDetail(g3, e1, e1 + 7 * H);
assert.strictEqual(pd.days.length, 2); assert.strictEqual(pd.days[0].amount, 25); assert.ok(pd.days[0].capped); assert.strictEqual(pd.days[1].amount, 20); assert.strictEqual(pd.amount, 45);
// rolling 24h lot: in 22:00, out +26 h → day 1 capped $12, day 2: 2 h = $4
pd = R.priceDetail(lot, e1, e1 + 26 * H);
assert.strictEqual(pd.days.length, 2); assert.strictEqual(pd.days[0].amount, 12); assert.strictEqual(pd.days[1].amount, 4); assert.strictEqual(pd.amount, 16);
assert.ok(/per 24 hours/.test(R.rateSummary(lot)[1]));

// tickets: manual create, rate snapshot survives a rate change
let r = R.TICKET.create({ plate: 'abc 1234', facilityId: 'g3', startAt: T0 - 2 * H, by: 'Ofc Diaz' });
assert.ok(!r.error, r.error); apply(r.ops); const t1 = get(r.sessionId);
assert.ok(/^T[0-9A-Z]{7}$/.test(t1.ticket)); assert.strictEqual(t1.rates.incrementPrice, 5); assert.strictEqual(t1.history[0].action, 'created');
r = R.TICKET.create({ plate: 'ABC1234', facilityId: 'g3' }); assert.ok(/already has an open ticket/.test(r.error));
g3.rates.incrementPrice = 8; // rate change: new visits only
assert.strictEqual(R.sessionFee(t1), 20, 'existing ticket keeps $5/30min');
assert.strictEqual(R.charge(g3, T0, T0 + H), 16, 'new visits pay the new rate');
g3.rates.incrementPrice = 5;
// bill
let bill = R.ticketBill(t1); assert.strictEqual(bill.parking, 20); assert.strictEqual(bill.due, 20); assert.strictEqual(bill.tax.tax, 1.52); assert.strictEqual(bill.minutes, 120);
// validation eligibility: FLAT5 not yet valid, ALL expired, SQ25 ok
r = R.TICKET.validate(t1, { code: 'FLAT5', by: 'x' }); assert.ok(/can’t be used before/.test(r.error));
r = R.TICKET.validate(t1, { code: 'ALL' }); assert.ok(/expired/.test(r.error));
r = R.TICKET.validate(t1, { code: 'sq25', by: 'Ofc Diaz' }); assert.ok(!r.error, r.error); apply(r.ops);
assert.strictEqual(S.validations[0].uses, 1); assert.strictEqual(R.balanceOf(get(t1.id)), 0, '2 h stay fully inside 2.5 h free');
// second validation is refused unless replaced with a reason
r = R.TICKET.validate(get(t1.id), { code: 'HALF' }); assert.ok(/already has validation/.test(r.error));
r = R.TICKET.validate(get(t1.id), { code: 'HALF', replace: true }); assert.ok(/reason/.test(r.error));
r = R.TICKET.validate(get(t1.id), { code: 'HALF', replace: true, reason: 'wrong code', by: 'Mgr' }); assert.ok(!r.error); apply(r.ops);
assert.strictEqual(get(t1.id).validation.code, 'HALF'); assert.strictEqual(get(t1.id).validationHistory.length, 2);
assert.strictEqual(R.balanceOf(get(t1.id)), 10);
// cash payment with change, closes the ticket
r = R.TICKET.pay(get(t1.id), { method: 'cash', tendered: 20, by: 'Ofc Diaz', close: true }); assert.ok(!r.error, r.error);
assert.strictEqual(r.amount, 10); assert.strictEqual(r.change, 10); assert.ok(r.closed); apply(r.ops);
assert.ok(get(t1.id).endAt); assert.strictEqual(R.exitStatus(get(t1.id)), 'paid'); assert.strictEqual(get(t1.id).fee, 10);
r = R.TICKET.pay(get(t1.id), { method: 'cash' }); assert.ok(/Nothing is owed/.test(r.error));
// validating a paid ticket is refused; adjusting needs a reason; reopen
r = R.TICKET.validate(get(t1.id), { code: 'TEN', replace: true, reason: 'x' }); assert.ok(/already paid/.test(r.error));
r = R.TICKET.adjust(get(t1.id), { fee: 4 }); assert.ok(/reason/.test(r.error));
r = R.TICKET.adjust(get(t1.id), { fee: 4, reason: 'goodwill', by: 'Mgr' }); apply(r.ops); assert.strictEqual(get(t1.id).fee, 4); assert.strictEqual(get(t1.id).feeOriginal, 10);
assert.ok(R.ticketBill(get(t1.id)).adjusted);
r = R.TICKET.reopen(get(t1.id), { reason: 'left again', by: 'Mgr' }); apply(r.ops); assert.strictEqual(get(t1.id).endAt, null); assert.strictEqual(get(t1.id).fee, null);
// waive an open ticket → exit by camera reads as waived
r = R.TICKET.waive(get(t1.id), { reason: 'system outage', by: 'Mgr' }); apply(r.ops); assert.ok(get(t1.id).waived);
NOW = T0 + H;
r = R.planRead({ cameraId: 'out', plate: 'ABC1234' }); assert.ok(/waived/.test(r.result.text)); apply(r.ops);
assert.strictEqual(R.exitStatus(get(t1.id)), 'waived');
// close with a backdated time; unpaid balance goes to collections
NOW = T0 + 2 * H;
r = R.TICKET.create({ plate: 'XYZ9', facilityId: 'g3', startAt: NOW - 4 * H }); apply(r.ops); const t2 = get(r.sessionId);
assert.ok(/needs a manager/.test(R.TICKET.close(t2, { at: NOW - H, by: 'Att' }).error), 'attendant cannot backdate a close by an hour');
r = R.TICKET.close(t2, { at: NOW - H, reason: 'let out, system down', by: 'Att', allowBackdate: true }); assert.ok(!r.error, r.error); apply(r.ops);
assert.strictEqual(get(t2.id).fee, 25); assert.strictEqual(r.balance, 25); assert.strictEqual(R.exitStatus(get(t2.id)), 'unpaid');
assert.strictEqual(R.TICKET.close(get(t2.id), {}).error, 'This ticket is already closed.');
// plate correction, note
r = R.TICKET.setPlate(get(t2.id), { plate: 'XYZ 8', reason: 'misread', by: 'Mgr' }); apply(r.ops); assert.strictEqual(get(t2.id).plate, 'XYZ8'); assert.strictEqual(get(t2.id).plateOriginal, 'XYZ9');
r = R.TICKET.note(get(t2.id), { text: 'Driver called', by: 'Att' }); apply(r.ops); assert.strictEqual(get(t2.id).history.slice(-1)[0].action, 'note');
// VIP free parking by camera, VIP without free parking pays
r = R.planRead({ cameraId: 'in', plate: 'VIP001', at: NOW - 3 * H }); assert.ok(/VIP entered: Mayor/.test(r.result.text)); apply(r.ops);
r = R.planRead({ cameraId: 'out', plate: 'VIP001', at: NOW }); assert.ok(/VIP exited, no charge/.test(r.result.text)); apply(r.ops);
r = R.planRead({ cameraId: 'in', plate: 'VIP002', at: NOW - 3 * H }); apply(r.ops);
r = R.planRead({ cameraId: 'out', plate: 'VIP002', at: NOW }); assert.ok(/owing \$25/.test(r.result.text)); apply(r.ops);
assert.strictEqual(R.checkPlate('VIP001', 'g3').title, 'VIP · no charge');
// monthly parker via manual ticket → no charge
r = R.TICKET.create({ plate: 'MON111', facilityId: 'g3' }); apply(r.ops); assert.strictEqual(r.kind, 'permit'); assert.strictEqual(R.ticketBill(get(r.sessionId)).due, 0);
// valet ticket with a valet fee and a code, then status flow
r = R.TICKET.create({ plate: 'VAL1', facilityId: 'g3', valet: true, tag: '42', space: 'B7', vehicle: 'Blue Tesla', phone: '817-555-0100', by: 'Runner' }); assert.ok(!r.error, r.error); apply(r.ops);
const tv = get(r.sessionId); assert.strictEqual(tv.valetFee, 10); assert.strictEqual(tv.valet.status, 'parked');
assert.ok(/can’t go straight/.test(R.TICKET.valet(tv, { status: 'ready' }).error));
r = R.TICKET.valet(tv, { status: 'requested' }); apply(r.ops); r = R.TICKET.valet(get(tv.id), { status: 'retrieving', by: 'Kai' }); apply(r.ops);
assert.strictEqual(get(tv.id).valet.runner, 'Kai'); r = R.TICKET.valet(get(tv.id), { status: 'ready' }); apply(r.ops);
NOW += H; assert.strictEqual(R.ticketBill(get(tv.id)).due, 20, 'parking $10 + valet $10');
// code occupancy across a period: two cars with SQ25 overlapping
NOW = T0 + 10 * H;
['C1', 'C2', 'C3'].forEach((p, i) => { r = R.TICKET.create({ plate: p, facilityId: 'g3', startAt: NOW - (3 - i) * H, code: 'SQ25' }); assert.ok(!r.error, r.error); apply(r.ops); });
r = R.TICKET.close(S.sessions.find(s => s.plate === 'C1'), { at: NOW - 1.5 * H, allowBackdate: true }); apply(r.ops);
let oc = R.codeOccupancy('SQ25', 'g3', NOW - 4 * H, NOW);
assert.strictEqual(oc.cars, 3); assert.strictEqual(oc.peak, 2); assert.strictEqual(oc.stale.length, 0);
S.sessions.find(s => s.plate === 'C2').startAt = NOW - 30 * H; oc = R.codeOccupancy('SQ25', 'g3', NOW - 4 * H, NOW); assert.strictEqual(oc.stale.length, 1, 'old open visit flagged');
// AR aging buckets
S.citations.push({ id: 'c1', plate: 'XYZ8', status: 'open', fine: 50, issuedAt: NOW - 45 * D, number: 'C1' });
S.invoices.push({ id: 'i1', companyId: 'co', companyName: 'Acme', status: 'UNPAID', amount: 330, dueDate: new Date(NOW - 100 * D).toISOString().slice(0, 10), createdAt: NOW - 105 * D, period: '2026-06' });
const ar = R.arAging(NOW);
const xyz = ar.find(x => x.label === 'XYZ8'); assert.strictEqual(xyz.total, 75); assert.strictEqual(xyz.buckets[0], 25); assert.strictEqual(xyz.buckets[2], 50);
assert.strictEqual(ar.find(x => x.label === 'Acme').buckets[4], 330);
// vehicle profile
const vp = R.vehicleProfile('xyz8'); assert.strictEqual(vp.visits, 1); assert.strictEqual(vp.owed, 75); assert.strictEqual(vp.citations.length, 1);
// ratings
r = R.PORTAL.rate({ sessionId: t1.id, plate: 'ABC1234', stars: 5, comment: 'Easy' }); assert.ok(!r.error, r.error); apply(r.ops);
assert.strictEqual(S.ratings.length, 1); assert.ok(/already rated/.test(R.PORTAL.rate({ sessionId: t1.id, stars: 4 }).error));
assert.ok(/doesn’t match/.test(R.PORTAL.rate({ sessionId: t2.id, plate: 'NOPE', stars: 4 }).error));
// roles
assert.ok(Rules.can('owner', 'users') && !Rules.can('manager', 'users') && Rules.can('manager', 'tickets.adjust'));
assert.ok(Rules.can('attendant', 'tickets') && !Rules.can('attendant', 'tickets.adjust') && !Rules.can('attendant', 'reports'));
assert.ok(Rules.can('accountant', 'reports') && Rules.can('accountant', 'refunds') && !Rules.can('accountant', 'tickets'));
assert.ok(!Rules.can('viewer', 'tickets') && Rules.can('admin', 'users') && Rules.can('officer', 'citations'));
assert.strictEqual(Rules.canonRole('admin'), 'owner');
// lookup exposes ticket numbers and VIP
const lk = R.lookup('VIP001'); assert.ok(lk.vip && lk.vip.freeParking);

// quote cap: a driver quoted $10 at 1h59 who pays at 2h01 (fee now $15) closes at $10; a fake low quote does not
NOW = T0 + 6 * H;
let q = R.TICKET.create({ plate: 'QUOTE1', facilityId: 'g3', startAt: NOW - 2 * H - 1 * M, by: 'Att' }); apply(q.ops); const qs = get(q.sessionId);
assert.strictEqual(R.balanceOf(qs), 25); // 2h01 → 5 increments = $25
let qr = R.TICKET.pay(qs, { amount: 20, quoted: 20, method: 'cash', close: true, by: 'Att' }); // $20 was the correct fee (4 increments) within the last 10 min
assert.ok(!qr.error, qr.error); assert.strictEqual(qr.ops[0].data.fee, 20); assert.strictEqual(qr.ops[0].data.feeQuoted, 25);
qr = R.TICKET.pay(qs, { amount: 5, quoted: 5, method: 'cash', close: true, by: 'Att' }); // never a valid quote in the last 10 min
assert.ok(!qr.error); assert.strictEqual(qr.ops[0].data.fee, 25, 'a low fake quote does not lower the fee'); assert.strictEqual(qr.ops[0].data.feeQuoted, undefined);
// markCited needs a real notice for this ticket
assert.ok(/Issue the parking charge notice/.test(R.TICKET.markCited(qs, { by: 'Att' }).error));
S.citations.push({ id: 'cq', sessionId: qs.id, number: 'C1', status: 'open', plate: 'QUOTE1', fine: 30, issuedAt: NOW });
assert.ok(!R.TICKET.markCited(qs, { citationId: 'cq', by: 'Att' }).error);
assert.ok(R.TICKET.markCited(qs, { citationId: 'nope', by: 'Att' }).error);
// comp needs a reason
assert.ok(/reason/i.test(R.TICKET.pay(qs, { amount: 25, method: 'comp', by: 'Mgr' }).error));
assert.ok(!R.TICKET.pay(qs, { amount: 25, method: 'comp', note: 'Owner’s guest', by: 'Mgr' }).error);
console.log('rules4 ok');
