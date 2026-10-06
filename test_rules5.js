/* Sundance Square update: event nights (flat $25 collected at the entrance), event-night validation codes,
   occupancy that counts monthly parkers, repeat-use flags, garages that only charge on exit, flat daily lots
   and Axis camera pushes. */
const Rules = require('../src/rules.js'); const assert = require('assert');
const path = require('path'), fs = require('fs');
const H = 36e5, M = 6e4; let T = Date.parse('2026-10-09T12:00:00-05:00'); const clock = () => T;
const ct = (d, h, mi = 0) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00-05:00`);
const event = { id: 'sp1', name: 'Event', dates: ['2026-10-09'], days: [], enterFrom: '17:00', enterUntil: '23:59', exitBy: '03:00', exitNextDay: true, price: 25, flat: true };
const g3 = { id: 'g3', name: 'Garage 3', type: 'garage', payMode: 'lpr', capacity: 100, onlinePrepay: false, timeZone: 'America/Chicago', rates: { mode: 'increment', incrementMin: 30, incrementPrice: 5, dailyMax: 25, graceMin: 15, resetTime: '03:00', specials: [event] } };
const g4 = { id: 'g4', name: 'Garage 4', type: 'garage', payMode: 'lpr', capacity: 80, timeZone: 'America/Chicago', rates: { mode: 'increment', incrementMin: 30, incrementPrice: 5, dailyMax: 25, graceMin: 15, resetTime: '03:00', specials: [] } };
const l7 = { id: 'l7', name: 'Lot 7', type: 'lot', payMode: 'qr', lotCode: '7', capacity: 50, timeZone: 'America/Chicago', rates: { mode: 'table', table: [{ upTo: 1440, price: 15 }], dailyMax: 15, graceMin: 15, resetTime: '03:00', specials: [] } };
const l15 = { id: 'l15', name: 'Lot 15', type: 'lot', payMode: 'qr', lotCode: '15', capacity: 40, timeZone: 'America/Chicago', rates: { mode: 'increment', incrementMin: 60, incrementPrice: 10, dailyMax: 40, graceMin: 15, resetTime: '03:00', specials: [] } };
const S = { facilities: [g3, g4, l7, l15], permitTypes: [{ id: 'm3', name: 'Garage 3 monthly', price: 178.61, facilities: ['g3'] }, { id: 'm7', name: 'Lot 7 monthly', price: 216.5, facilities: ['l7'] }, { id: 'm4', name: 'Garage 4 monthly', price: 178.61, facilities: ['g4', 'g3'] }],
  permits: [], sessions: [], citations: [], validations: [
    { id: 'v1', code: 'BURGER', name: 'Burger place', type: 'hours', value: 2.5, active: true, facilityIds: ['g3', 'g4'] },
    { id: 'v2', code: 'THEATER', name: 'Theater', type: 'hours', value: 4, active: true, facilityIds: ['g3', 'g4'], eventNights: true }],
  members: [], tenants: [], cameras: [], reservations: [], vips: [], companies: [], invoices: [], config: { taxRate: 8.25, taxIncluded: true } };
const R = Rules(S, clock, { deferAutopay: true });
const apply = ops => ops.forEach(o => { const c = S[o.coll]; const i = c.findIndex(x => x.id === o.id); if (o.type === 'set') { if (i >= 0) c[i] = Object.assign({ id: o.id }, o.data); else c.push(Object.assign({ id: o.id }, o.data)); } else if (o.type === 'update') Object.assign(c[i], o.data); else if (o.type === 'delete') c.splice(i, 1); });

// ---- event night: a flat $25 for cars entering after the start time, regular rates before it and on other nights
assert.strictEqual(R.charge(g3, ct(9, 18), ct(9, 19)), 25, 'event night: 1 hour costs the flat $25');
assert.strictEqual(R.charge(g3, ct(9, 18), ct(9, 18, 10)), 0, 'grace period still applies');
assert.strictEqual(R.charge(g3, ct(9, 16), ct(9, 17)), 10, 'entered before the event start: regular rate');
assert.strictEqual(R.charge(g3, ct(10, 18), ct(10, 19)), 10, 'not an event date: regular rate');
assert.strictEqual(R.charge(g3, ct(9, 18), ct(10, 5)), 45, 'stays past the 3 AM reset: day one capped at $25, then $20 more');
assert.ok(R.eventAt(g3, ct(9, 18)) && !R.eventAt(g3, ct(9, 16)) && !R.eventAt(g3, ct(10, 18)), 'event detection by entry time and date');
assert.ok(/Event: \$25\.00 flat/.test(R.rateSummary(g3).join('|')), 'event shows as flat in the rate summary');

// ---- validations on event nights
T = ct(9, 18, 5);
let r = R.TICKET.create({ plate: 'EV1', facilityId: 'g3', startAt: ct(9, 18) }); apply(r.ops); const evStay = S.sessions.find(s => s.id === r.sessionId);
assert.ok(/event nights/.test(R.planApplyValidation(evStay, 'BURGER', 'office', { by: 'Att' }).error || ''), 'regular code refused on an event night');
r = R.planApplyValidation(evStay, 'THEATER', 'office', { by: 'Att' }); assert.ok(!r.error, r.error); apply(r.ops);
assert.strictEqual(R.charge(R.facFor(evStay), evStay.startAt, ct(9, 22, 30), evStay.validation), 5, 'event-night code: 4 free hours, then regular rates (not the $25 flat)');
assert.strictEqual(R.charge(R.facFor(evStay), evStay.startAt, ct(9, 21), evStay.validation), 0, 'inside the free time: nothing to pay');
T = ct(10, 12, 5);
r = R.TICKET.create({ plate: 'DAY1', facilityId: 'g3', startAt: ct(10, 12) }); apply(r.ops); const dayStay = S.sessions.find(s => s.id === r.sessionId);
r = R.planApplyValidation(dayStay, 'BURGER', 'office', { by: 'Att' }); assert.ok(!r.error, r.error); apply(r.ops);
assert.strictEqual(R.charge(R.facFor(dayStay), dayStay.startAt, ct(10, 15), dayStay.validation), 5, 'normal night: 2.5 free hours, then paying starts');

// ---- pay at the entrance: an open event-night ticket already owes the flat rate
T = ct(9, 18, 6);
r = R.TICKET.create({ plate: 'EV2', facilityId: 'g3', startAt: ct(9, 18, 6) }); apply(r.ops); const ev2 = S.sessions.find(s => s.id === r.sessionId);
T = ct(9, 18, 7);
assert.strictEqual(R.balanceOf(ev2), 0, 'inside the grace period nothing is owed yet');
assert.strictEqual(R.entryDue(ev2), 25, 'but the attendant can collect the $25 event rate at the entrance');
r = R.TICKET.pay(ev2, { method: 'card', amount: 25, by: 'Att' }); assert.ok(!r.error, r.error); apply(r.ops);
assert.ok(!S.sessions.find(s => s.id === ev2.id).endAt, 'the ticket stays open after paying at the entrance');
assert.strictEqual(R.entryDue(ev2), 0, 'nothing more to collect at the entrance');
T = ct(9, 18, 9);
assert.strictEqual(R.sessionFee(ev2, ct(9, 18, 9)), 25, 'paid at the entrance, left inside the grace period: the $25 stands');
r = R.TICKET.create({ plate: 'TURN1', facilityId: 'g3', startAt: ct(9, 18, 6) }); apply(r.ops);
assert.strictEqual(R.sessionFee(S.sessions.find(s => s.id === r.sessionId), ct(9, 18, 9)), 0, 'turned away without paying inside the grace period: free');
T = ct(9, 22);
assert.strictEqual(R.balanceOf(ev2), 0, 'leaving before 3 AM: already paid');
T = ct(10, 5);
assert.strictEqual(R.balanceOf(ev2), 20, 'still inside after the 3 AM reset: the new day is owed on exit');
T = ct(9, 19, 1);
r = R.TICKET.create({ plate: 'EV3', facilityId: 'g3', startAt: ct(9, 19) }); apply(r.ops);
assert.ok(/more than/.test(R.TICKET.pay(S.sessions.find(s => s.id === r.sessionId), { method: 'cash', amount: 30 }).error || ''), 'cannot collect more than the event rate at the entrance');

// ---- garages that charge on exit refuse online prepay; lots still take it
T = ct(10, 12);
assert.ok(/charges you when you leave/.test(R.PORTAL.prepay({ plate: 'PRE1', facilityId: 'g3', hours: 2 }).error || ''), 'no prepay at Garage 3');
r = R.PORTAL.prepay({ plate: 'PRE2', facilityId: 'l7', untilEndOfDay: true }); assert.ok(!r.error, r.error); assert.strictEqual(r.charge.amount, 15, 'Lot 7 all day'); apply(r.ops);
assert.strictEqual(R.quote('l15', 0, true), 40, 'Lot 15 rest of the day: $40 until 3 AM');
assert.strictEqual(R.charge(l15, ct(10, 9), ct(11, 2)), 40, 'Lot 15: 9 AM to 2 AM next day is one parking day');
assert.deepStrictEqual(R.rateSummary(l7).slice(0, 2), ['$15.00 all day', 'First 15 min free'], 'flat lot reads as one all-day price');

// ---- occupancy counts monthly parkers
apply([{ type: 'set', coll: 'permits', id: 'p1', data: { permitTypeId: 'm7', status: 'active', plates: ['M1'] } },
  { type: 'set', coll: 'permits', id: 'p2', data: { permitTypeId: 'm7', status: 'active', plates: ['M2'] } },
  { type: 'set', coll: 'permits', id: 'p3', data: { permitTypeId: 'm7', status: 'suspended', plates: ['M3'] } },
  { type: 'set', coll: 'permits', id: 'p4', data: { permitTypeId: 'm3', status: 'active', plates: ['M4'] } },
  { type: 'set', coll: 'permits', id: 'p5', data: { permitTypeId: 'm4', status: 'active', plates: ['M5'] } }]);
let u = R.spaceUse(l7);
assert.deepStrictEqual([u.visitors, u.monthly, u.available], [1, 2, 47], 'lot: 1 paid visitor + 2 active monthly parkers held (suspended not counted)');
S.sessions = S.sessions.filter(s => s.facilityId !== 'g3');
apply([{ type: 'set', coll: 'sessions', id: 'in1', data: { plate: 'M4', facilityId: 'g3', mode: 'lpr', kind: 'permit', permitId: 'p4', startAt: T - H, endAt: null } },
  { type: 'set', coll: 'sessions', id: 'in2', data: { plate: 'M5', facilityId: 'g3', mode: 'lpr', kind: 'permit', permitId: 'p5', startAt: T - H, endAt: null } },
  { type: 'set', coll: 'sessions', id: 'in3', data: { plate: 'VIS', facilityId: 'g3', mode: 'lpr', kind: 'visitor', startAt: T - H, endAt: null } }]);
u = R.spaceUse(g3);
assert.deepStrictEqual([u.visitors, u.monthly, u.monthlyInside, u.used, u.available], [2, 1, 1, 3, 97], 'garage: own monthly parker inside counted once; another location\'s monthly parker counts as a visitor');
assert.strictEqual(R.spaceUse(g4).monthly, 1, 'a plan covering several locations holds its space at the first one');

// ---- repeat use of one code by the same car
S.sessions = [];
const vis = (id, d) => ({ type: 'set', coll: 'sessions', id, data: { plate: 'REP1', facilityId: 'g4', mode: 'lpr', kind: 'visitor', startAt: ct(d, 12), endAt: ct(d, 14), validation: { code: 'BURGER', tenantName: 'Burger place' } } });
T = ct(10, 20);
apply([vis('r1', 5), vis('r2', 7)]);
assert.strictEqual(R.repeatValidations().length, 0, 'two visits: no flag');
apply([vis('r3', 9)]);
let rep = R.repeatValidations(); assert.strictEqual(rep.length, 1); assert.strictEqual(rep[0].count, 3); assert.strictEqual(rep[0].business, 'Burger place');
apply([vis('r0', 1)]); assert.strictEqual(R.repeatValidations()[0].count, 3, 'visits older than 7 days are left out');
S.config.repeatValidationCount = 4; assert.strictEqual(R.repeatValidations().length, 0, 'threshold comes from Settings');
S.config.repeatValidationDays = 30; assert.strictEqual(R.repeatValidations()[0].count, 4, 'window comes from Settings');

// ---- Axis License Plate Verifier push
const libPath = ['../lib/lpr-parse.js', '../lpr-parse.js'].map(p => path.join(__dirname, p)).find(p => fs.existsSync(p));
if (libPath) {
  const { parseRead } = require(libPath);
  const axis = { packetCounter: '1043', datetime: '20261009 181502123', plateText: 'abc 123', plateUnicode: 'ABC123', plateUTF8: 'ABC123', plateCountry: 'USA', plateConfidence: '0.91', carState: 'new', roiID: '1', camera_info: { SerialNumber: 'B8A44F000001', ProdShortName: 'AXIS P1465-LE-3' } };
  const got = parseRead({}, 'application/json', Buffer.from(JSON.stringify(axis)));
  assert.strictEqual(got.plate, 'ABC123'); assert.strictEqual(got.confidence, 91);
  assert.ok(parseRead({}, 'application/json', Buffer.from(JSON.stringify(Object.assign({}, axis, { carState: 'update' })))).ignore, 'Axis update/lost messages are not new cars');
}
// ---- patrol log: what a plate check found, violator or not, and why
{
  T = ct(10, 13); S.sessions = []; S.citations = []; S.vips = [];
  S.permits = [{ id: 'pm1', number: 'M1', holder: 'Pat', permitTypeId: 'm7', plates: ['MON7'], status: 'active', startAt: T - 864e5 }];
  apply([{ type: 'set', coll: 'sessions', id: 'pp1', data: { plate: 'PAID7', facilityId: 'l7', mode: 'prepaid', kind: 'visitor', startAt: T - H, paidUntil: T + H, endAt: null, payments: [{ amount: 15, at: T - H }] } },
    { type: 'set', coll: 'sessions', id: 'pp2', data: { plate: 'LATE7', facilityId: 'l7', mode: 'prepaid', kind: 'visitor', startAt: T - 3 * H, paidUntil: T - H, endAt: null, payments: [{ amount: 15, at: T - 3 * H }] } },
    { type: 'set', coll: 'sessions', id: 'pp3', data: { plate: 'GRACE7', facilityId: 'l7', mode: 'prepaid', kind: 'visitor', startAt: T - 2 * H, paidUntil: T - 5 * M, endAt: null, payments: [{ amount: 15, at: T - 2 * H }] } },
    { type: 'set', coll: 'sessions', id: 'pg1', data: { plate: 'VAL4', facilityId: 'g4', mode: 'lpr', kind: 'visitor', startAt: T - H, endAt: null, validation: { code: 'BURGER', tenantName: 'Burger place' } } },
    { type: 'set', coll: 'sessions', id: 'pg2', data: { plate: 'EXIT4', facilityId: 'g4', mode: 'lpr', kind: 'visitor', startAt: T - H, endAt: null } }]);
  const k = (pl, f) => R.checkKind(R.checkPlate(pl, f));
  assert.deepStrictEqual(k('MON7', 'l7'), { violator: false, kind: 'monthly', label: 'Monthly parker' });
  assert.strictEqual(k('PAID7', 'l7').kind, 'paid');
  assert.strictEqual(k('GRACE7', 'l7').kind, 'grace', 'expired inside the grace period is not a violation');
  assert.ok(k('LATE7', 'l7').violator && k('LATE7', 'l7').kind === 'expired', 'paid time expired is a violation');
  assert.ok(k('NOBODY', 'l7').violator && k('NOBODY', 'l7').kind === 'nopermit', 'no payment or monthly is a violation');
  assert.ok(k('MON7', 'l15').violator && k('MON7', 'l15').kind === 'wrongzone', 'monthly at another lot is a violation');
  assert.strictEqual(k('VAL4', 'g4').kind, 'validated');
  assert.strictEqual(k('EXIT4', 'g4').kind, 'exit');
  S.permits = []; S.sessions = [];
}
// ---- the server's plate index gives the same answers as reading every ticket
{
  T = ct(10, 13); S.citations = []; S.permits = [];
  S.sessions = [];
  for (let i = 0; i < 60; i++) S.sessions.push({ id: 'ix' + i, plate: i % 3 ? 'ab-' + (i % 7) : 'AB' + (i % 7), facilityId: i % 2 ? 'g4' : 'l7', mode: i % 2 ? 'lpr' : 'prepaid', kind: 'visitor', startAt: T - (i + 1) * H, paidUntil: T - (i % 4) * H + H, endAt: i % 5 === 0 ? null : T - i * 6e4, payments: [], fee: i % 4 ? 10 : 0 });
  const snap = () => ['AB1', 'AB3', 'AB5', 'ZZ9'].map(pl => JSON.stringify([R.liveForPlate(pl), R.liveForPlate(pl, 'g4'), R.checkPlate(pl, 'l7').title, R.checkPlate(pl, 'g4').lines, R.lookup(pl), R.plateDebt(pl)]));
  const plain = snap();
  const ix = new Map(); S.sessions.forEach(d => { const k = Rules.normPlate(d.plate); (ix.get(k) || ix.set(k, []).get(k)).push(d); });
  S.__byPlate = ix; S.__byPlateArr = S.sessions;
  assert.deepStrictEqual(snap(), plain, 'indexed lookups match full scans');
  S.sessions = S.sessions.slice(); // a new list without a new index: the rules stop trusting the old one
  assert.deepStrictEqual(snap(), plain);
  delete S.__byPlate; delete S.__byPlateArr; S.sessions = [];
}
console.log('rules5 ok');
