/* Downtown Fort Worth demo data for the shared pilot page and the hosted starter. Every record is marked sample: true.
   Fees, tickets and validations come from the real rules engine, so what the screens show is what the system would do.
   Usage: node gen_seed4.mjs  → seed4/<collection>/<id>.json and seed4/all.json (timestamps are anchored to now). */
import fs from 'fs'; import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const Rules = require('./src/rules.js');
let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1)), pick = a => a[Math.floor(rnd() * a.length)];
const NOW = Date.now(), M = 6e4, H = 36e5, D = 864e5;
const out = {}; const put = (c, id, d) => { (out[c] = out[c] || {})[id] = Object.assign(d, { sample: true }); return id; };
const S = { config: { timeZone: 'America/Chicago', taxRate: 8.25, taxIncluded: true, holidays: [] } };
const B36 = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; let tkSeq = 0;
const ticketNo = () => 'T' + (Date.now() + tkSeq++ * 977).toString(36).toUpperCase().slice(-5) + B36[ri(0, 33)] + B36[ri(0, 33)];
const STAFF = ['Pat Booth', 'Rosa Delgado', 'Jamal Carter'];

/* ---------- locations: two camera garages and two QR lots around Sundance Square ---------- */
const F = [
  ['f-houston', { name: 'Houston Street Garage', type: 'garage', payMode: 'lpr', capacity: 620, baseline: 296, address: '401 Houston St, Fort Worth, TX 76102', reservedSpaces: 25, reservationPremium: 5, reservationGraceMin: 60, cancelHours: 2, valetRate: 15, terminalDeviceId: '',
    rates: { mode: 'increment', incrementMin: 30, incrementPrice: 3, dailyMax: 22, graceMin: 10, resetTime: '03:00', rolling: false, specials: [
      { id: 'sp-eb', name: 'Early bird', days: [1, 2, 3, 4, 5], enterFrom: '05:00', enterUntil: '09:00', exitBy: '19:00', price: 12 },
      { id: 'sp-ev', name: 'Evening', days: [0, 1, 2, 3, 4, 5, 6], enterFrom: '16:00', enterUntil: '02:00', exitBy: '06:00', exitNextDay: true, price: 8 }] } }],
  ['f-commerce', { name: 'Commerce Street Garage', type: 'garage', payMode: 'lpr', capacity: 900, baseline: 402, address: '300 Commerce St, Fort Worth, TX 76102', reservedSpaces: 0, valetRate: 0,
    rates: { mode: 'table', table: [{ upTo: 30, price: 4 }, { upTo: 60, price: 6 }, { upTo: 120, price: 10 }, { upTo: 180, price: 14 }, { upTo: 240, price: 18 }], dailyMax: 24, graceMin: 10, resetTime: '03:00', rolling: false, specials: [
      { id: 'sp-eb2', name: 'Early bird', days: [1, 2, 3, 4, 5], enterFrom: '05:30', enterUntil: '09:00', exitBy: '18:30', price: 15 },
      { id: 'sp-wk', name: 'Weekend day', days: [0, 6], enterFrom: '00:00', enterUntil: '23:59', price: 10 }] } }],
  ['f-main', { name: 'Main Street Lot', type: 'lot', payMode: 'qr', lotCode: '4201', capacity: 80, baseline: 31, address: '512 Main St, Fort Worth, TX 76102', reservedSpaces: 0,
    rates: { mode: 'increment', incrementMin: 60, incrementPrice: 2, dailyMax: 12, graceMin: 5, resetTime: '00:00', rolling: true, specials: [] } }],
  ['f-third', { name: '3rd & Throckmorton Lot', type: 'lot', payMode: 'qr', lotCode: '4202', capacity: 120, baseline: 44, address: '3rd St & Throckmorton St, Fort Worth, TX 76102', reservedSpaces: 0,
    rates: { mode: 'increment', incrementMin: 20, incrementPrice: 1, dailyMax: 15, graceMin: 5, resetTime: '00:00', rolling: false, specials: [{ id: 'sp-ev3', name: 'Evening', days: [0, 1, 2, 3, 4, 5, 6], enterFrom: '17:00', enterUntil: '23:59', exitBy: '03:00', exitNextDay: true, price: 6 }] } }],
];
F.forEach(([id, d]) => put('facilities', id, Object.assign(d, { timeZone: 'America/Chicago', active: true, createdAt: NOW - 200 * D })));
S.facilities = F.map(([id, d]) => Object.assign({ id }, d));
const R = Rules(S);
const fac = id => S.facilities.find(f => f.id === id);
const snap = f => JSON.parse(JSON.stringify(fac(f).rates));
const cams = [['cam-hou-in1', 'Houston Entry 1', 'f-houston', 'in'], ['cam-hou-in2', 'Houston Entry 2', 'f-houston', 'in'], ['cam-hou-out1', 'Houston Exit 1', 'f-houston', 'out'], ['cam-hou-out2', 'Houston Exit 2', 'f-houston', 'out'],
  ['cam-com-in1', 'Commerce Entry 1', 'f-commerce', 'in'], ['cam-com-in2', 'Commerce Entry 2', 'f-commerce', 'in'], ['cam-com-out1', 'Commerce Exit 1', 'f-commerce', 'out']];
cams.forEach(([id, n, f, d]) => put('cameras', id, { name: n, facilityId: f, direction: d, model: pick(['Hikvision iDS-TCM403-GIR', 'Axis P1465-LE-3 LPV']), token: [...Array(24)].map(() => '0123456789abcdef'[ri(0, 15)]).join(''), createdAt: NOW - 30 * D }));
const camFor = (f, d) => pick(cams.filter(c => c[2] === f && c[3] === d))[0];

/* ---------- monthly plans, companies, parkers, invoices ---------- */
[['t-hou', 'Houston Street unreserved', 'unreserved', 165, 300, 3, ['f-houston']], ['t-houres', 'Houston Street reserved', 'reserved', 245, 40, 2, ['f-houston']],
 ['t-com', 'Commerce Street unreserved', 'unreserved', 185, 450, 3, ['f-commerce']], ['t-main', 'Main Street Lot monthly', 'unreserved', 95, 8, 2, ['f-main']]]
  .forEach(([id, n, k, p, q, mv, fs]) => put('permitTypes', id, { name: n, kind: k, price: p, quota: q, maxVehicles: mv, facilities: fs, active: true }));
const hex = n => [...Array(n)].map(() => '0123456789abcdef'[ri(0, 15)]).join('');
put('companies', 'co-bluebonnet', { name: 'Bluebonnet Law', contactName: 'Priya Shah', email: 'priya@bluebonnetlaw.example', phone: '817-555-0142', billing: 'invoice', portalToken: hex(40), createdAt: NOW - 120 * D });
put('companies', 'co-lonestar', { name: 'Lone Star Title', contactName: 'Marcus Webb', email: 'facilities@lonestartitle.example', phone: '817-555-0177', billing: 'invoice', portalToken: hex(40), createdAt: NOW - 90 * D });
put('companies', 'co-pecan', { name: 'Pecan Coffee Roasters', contactName: 'Dana Ruiz', email: 'dana@pecanroasters.example', billing: 'card', card: { brand: 'VISA', last4: '4412' }, portalToken: hex(40), createdAt: NOW - 60 * D });
const mb = R.monthBounds(NOW, S.facilities[0]), prev = R.monthBounds(mb.start - D, S.facilities[0]);
const first = ['Maya', 'Jordan', 'Priya', 'Daniel', 'Lena', 'Marcus', 'Sofia', 'Ethan', 'Aisha', 'Noah', 'Grace', 'Omar', 'Hannah', 'Luis', 'Chloe', 'Ben', 'Nia', 'Ryan', 'Zoe', 'Kofi', 'Iris', 'Theo', 'Amara', 'Sam', 'Elena', 'Victor', 'Rosa', 'Kevin', 'Tamsin', 'Diego', 'Ada', 'Felix', 'Mei', 'Jonas', 'Leila', 'Owen', 'Sara', 'Tariq', 'Wren', 'Yusuf'];
const last = ['Okafor', 'Reyes', 'Patel', 'Kim', 'Novak', 'Brooks', 'Alvarez', 'Chen', 'Rahman', 'Fischer', 'Walsh', 'Haddad', 'Lund', 'Ortiz', 'Dubois', 'Sato', 'Mensah', 'Kowalski', 'Park', 'Asante', 'Moreau', 'Grant', 'Nwosu', 'Ibarra', 'Petrova', 'Hale', 'Quinn', 'Sandoval', 'Bell', 'Vance'];
const used = new Set(); const plate = () => { const L = 'ABCDEFGHJKLMNPRSTVWXYZ'; for (;;) { const p = pick([() => [0, 0, 0].map(() => pick(L)).join('') + ri(1000, 9999), () => ri(1, 9) + [0, 0, 0].map(() => pick(L)).join('') + ri(100, 999)])(); if (!used.has(p)) { used.add(p); return p; } } };
const coMap = { 'co-bluebonnet': 'Bluebonnet Law', 'co-lonestar': 'Lone Star Title', 'co-pecan': 'Pecan Coffee Roasters' };
const MP = [
  ...Array(8).fill(['t-hou', 'co-bluebonnet']), ...Array(3).fill(['t-houres', 'co-bluebonnet']), ...Array(9).fill(['t-com', 'co-lonestar']), ...Array(3).fill(['t-main', 'co-pecan']),
  ['t-hou', null], ['t-hou', null], ['t-com', null], ['t-houres', null], ['t-main', null], ['t-main', null], ['t-com', null, 'office'], ['t-hou', null, 'office'], ['t-com', null],
  ['t-hou', null, 'suspended'], ['t-main', null, 'waitlist'], ['t-main', null, 'waitlist'], ['t-hou', null, 'cancelling'], ['t-com', null, 'approved']];
const permits = [];
MP.forEach(([tid, co, x], i) => {
  const fn = first[i % first.length], ln = last[(i * 7) % last.length], t = out.permitTypes[tid];
  const d = { number: String(30100 + i * 37), holder: `${fn} ${ln}`, email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${co ? co.slice(3) + '.example' : 'example.com'}`, phone: i % 3 ? '' : `817-555-01${String(10 + i).slice(-2)}`,
    permitTypeId: tid, plates: [plate()].concat(i % 6 === 0 ? [plate()] : []), status: 'active', billing: co ? 'company' : x === 'office' ? 'office' : 'card', companyId: co, companyName: co ? coMap[co] : '',
    accountId: co || x === 'office' ? null : 'a_demo' + i, createdAt: NOW - ri(40, 300) * D, startAt: NOW - ri(35, 280) * D, endAt: null, paidThrough: mb.end, source: co ? 'company' : 'portal' };
  if (x === 'suspended') Object.assign(d, { status: 'suspended', paidThrough: mb.start, pastDueSince: mb.start + 2 * H, suspendedAt: mb.start + 6 * D, lateFeeDue: 25, billAttempts: 3 });
  if (x === 'waitlist') Object.assign(d, { status: 'waitlist', startAt: null, paidThrough: null, createdAt: NOW - ri(2, 20) * D });
  if (x === 'approved') Object.assign(d, { status: 'approved', startAt: null, paidThrough: null, approvedAt: NOW - 2 * D, createdAt: NOW - 9 * D });
  if (x === 'cancelling') Object.assign(d, { endAt: mb.end, cancelledAt: NOW - 5 * D });
  if (x === 'office') Object.assign(d, { paidAt: mb.start + 3 * D, amountPaid: t.price });
  permits.push([put('permits', 'p-' + String(i).padStart(2, '0'), d), d]);
});
const coTotal = co => permits.filter(([, p]) => p.companyId === co && p.status === 'active').reduce((a, [, p]) => a + out.permitTypes[p.permitTypeId].price, 0);
[['co-bluebonnet', prev, 'PAID'], ['co-lonestar', prev, 'PAID'], ['co-bluebonnet', mb, 'PAID'], ['co-lonestar', mb, 'UNPAID']].forEach(([co, b, st], i) => {
  const amt = coTotal(co), tx = R.taxOf(amt);
  put('invoices', 'inv-' + i, { companyId: co, companyName: coMap[co], period: b.period, periodEnd: b.end, amount: tx.total, tax: tx.tax, sqInvoiceId: 'sim_inv_demo' + i, status: st, publicUrl: null, dueDate: new Date(b.start + 5 * D).toISOString().slice(0, 10), permitIds: permits.filter(([, p]) => p.companyId === co).map(([id]) => id), createdAt: b.start + H, paidAt: st === 'PAID' ? b.start + ri(1, 4) * D : null });
});
/* ---------- autopay accounts, VIP list ---------- */
const members = [['m-0', 'Rosa Delgado', 'rosa.d@example.com'], ['m-1', 'Kevin Tran', 'ktran@example.com'], ['m-2', 'Ada Mwangi', 'ada.mwangi@example.com'], ['m-3', 'Felix Hale', 'felix.hale@example.com']].map(([id, n, e]) => { const p = plate(); put('members', id, { name: n, email: e, plates: [p], card: '4242', accountId: 'a_' + id, createdAt: NOW - ri(30, 200) * D }); return [id, p]; });
const vips = [['vip-0', 'Council liaison', 'City of Fort Worth', true, 'Greet by name; parks on level 1'], ['vip-1', 'Building owner', 'Houston Street Partners', true, ''], ['vip-2', 'Hotel general manager', 'Downtown hotel next door', false, 'Charged normally; flag for the manager'], ['vip-3', 'Bank executive', 'Lone Star Title', false, '']]
  .map(([id, n, co, free, note]) => { const p = plate(); put('vips', id, { name: n, company: co, plates: [p], freeParking: free, facilities: [], note, active: true, createdAt: NOW - ri(10, 120) * D }); return [id, p, free]; });
/* ---------- tenants and validation codes ---------- */
put('tenants', 'tn-harbor', { name: 'Harbor Grill (valet)', facilityId: 'f-houston', allotment: 30, overageRate: 15, contact: 'billing@harborgrill.example', createdAt: NOW - 90 * D });
put('tenants', 'tn-dental', { name: 'Trinity Dental', facilityId: 'f-commerce', allotment: 0, overageRate: 0, contact: 'office@trinitydental.example', createdAt: NOW - 90 * D });
const VAL = { 'tn-harbor': 'HARBOR25', 'tn-dental': 'DENTAL2H' };
put('validations', 'v-1', { code: 'HARBOR25', name: 'Harbor Grill dinner', tenantId: 'tn-harbor', department: 'Harbor Grill (valet)', type: 'hours', value: 2.5, maxUses: 0, uses: 0, active: true, expiresAt: null, validFrom: null, facilityIds: ['f-houston'], createdAt: NOW - 90 * D });
put('validations', 'v-2', { code: 'DENTAL2H', name: 'Trinity Dental patients', tenantId: 'tn-dental', department: 'Trinity Dental', type: 'hours', value: 2, maxUses: 0, uses: 0, active: true, expiresAt: null, validFrom: null, facilityIds: ['f-commerce'], createdAt: NOW - 90 * D });
put('validations', 'v-3', { code: 'SYMPHONY26', name: 'Symphony season · flat $5', tenantId: null, department: 'Concert hall box office', type: 'fixed', value: 5, maxUses: 800, uses: 231, active: true, expiresAt: NOW + 45 * D, validFrom: NOW - 30 * D, facilityIds: ['f-houston', 'f-commerce'], createdAt: NOW - 40 * D });
put('validations', 'v-4', { code: 'LUNCH50', name: 'Lunch: 50% off', tenantId: null, department: 'Main Street merchants', type: 'percent', value: 50, maxUses: 0, uses: 84, active: true, expiresAt: null, validFrom: null, facilityIds: [], createdAt: NOW - 60 * D });
put('validations', 'v-5', { code: 'HOTEL10', name: 'Hotel guests: $10 off', tenantId: null, department: 'Hotel front desk', type: 'dollar', value: 10, maxUses: 0, uses: 156, active: true, expiresAt: null, validFrom: null, facilityIds: ['f-houston'], createdAt: NOW - 60 * D });
put('validations', 'v-6', { code: 'RODEO25', name: 'Stock show weekend (ended)', tenantId: null, department: 'Event', type: 'full', value: 0, maxUses: 500, uses: 500, active: false, expiresAt: NOW - 200 * D, validFrom: NOW - 220 * D, facilityIds: [], createdAt: NOW - 230 * D });

/* ---------- visits ---------- */
let sn = 0; const feed = []; const uses = {}; const ratings = [];
const sess = d => { sn++; d.ticket = d.ticket || ticketNo(); if (d.facilityId && !d.rates && !d.noEntry) d.rates = snap(d.facilityId); return put('sessions', 's-' + String(sn).padStart(3, '0'), d); };
const log = (at, p, f, dir, cam, level, text, sid) => feed.push({ at, plate: p, facilityId: f, dir, cameraId: cam, level, text, confidence: ri(88, 99), sessionId: sid || null });
const closed = (f, p, st, en, extra) => { const val = extra && extra.validation; const fee = R.charge(fac(f), st, en, val); const d = Object.assign({ plate: p, facilityId: f, mode: 'lpr', kind: 'visitor', startAt: st, endAt: en, fee, payments: [], entryCameraId: camFor(f, 'in'), exitCameraId: camFor(f, 'out'), validation: null, createdAt: st }, extra || {}); return [d, fee]; };
/* How a visitor paid on the way out: the exit desk (cash/card), online by plate, or autopay. Desk payments carry the attendant’s name. */
const payFor = (d, fee, en, kind) => {
  if (!fee) return;
  const r = rnd();
  if (kind === 'member') d.payments = [{ amount: fee, at: en, method: 'autopay', pid: 'sim_pay_' + hex(8) }];
  else if (r < 0.45) { const by = pick(STAFF), cash = rnd() < 0.6; const tendered = cash ? Math.ceil(fee / 5) * 5 : null; d.payments = [Object.assign({ amount: fee, at: en, method: cash ? 'cash' : 'card', by }, tendered != null ? { tendered } : {})]; d.closedManually = true; d.exitCameraId = null; d.history = [{ at: en, by, action: 'payment', detail: `$${fee.toFixed(2)} ${cash ? 'cash' : 'card'} · departed` }]; }
  else if (r < 0.8) d.payments = [{ amount: fee, at: en - ri(1, 6) * M, method: 'online', pid: 'sim_pay_' + hex(8) }];
  else d.payments = [{ amount: fee, at: en, method: 'autopay', pid: 'sim_pay_' + hex(8) }];
};
const LPR = ['f-houston', 'f-commerce'];
const ds0 = R.dayStart(NOW, fac('f-houston'));
const nowMin = Math.round((NOW - ds0) / M); // minutes since 3 AM today
// 13 days of history plus today: commuters (long stays from the morning), shoppers/lunch (short midday stays), evenings
for (let day = 13; day >= 0; day--) {
  const dow = new Date(ds0 - day * D + 12 * H).getDay(), weekend = dow === 0 || dow === 6;
  const n = day === 0 ? ri(44, 52) : weekend ? ri(9, 14) : ri(20, 26); // today is denser so a morning demo still has traffic
  for (let k = 0; k < n; k++) {
    const f = pick(LPR); const kindR = rnd();
    const stMin = kindR < 0.45 ? ri(4 * 60, 6 * 60 + 30) : kindR < 0.85 ? ri(7 * 60, 15 * 60) : ri(14 * 60, 20 * 60); // arrival, minutes after 3 AM
    const stayMin = kindR < 0.45 ? ri(480, 600) : kindR < 0.85 ? ri(35, 200) : ri(120, 300);
    const st = ds0 - day * D + stMin * M; if (st > NOW - 8 * M) continue;
    const en = st + stayMin * M; const p = plate();
    if (en >= NOW - 3 * M) { // still on site
      const c = camFor(f, 'in'); const id = sess({ plate: p, facilityId: f, mode: 'lpr', kind: 'visitor', startAt: st, endAt: null, payments: [], entryCameraId: c, validation: null, createdAt: st });
      if (day === 0) log(st, p, f, 'in', c, 'info', 'Visitor entered', id); continue;
    }
    const val = rnd() < 0.08 ? { code: 'LUNCH50', name: 'Lunch: 50% off', type: 'percent', value: 50, department: 'Main Street merchants', tenantId: null, tenantName: null, at: st + ri(20, 60) * M, source: 'portal', by: '' } : rnd() < 0.05 && f === 'f-houston' ? { code: 'HOTEL10', name: 'Hotel guests: $10 off', type: 'dollar', value: 10, department: 'Hotel front desk', tenantId: null, tenantName: null, at: st + 3 * M, source: 'office', by: 'Front desk' } : null;
    const [d, fee] = closed(f, p, st, en, val ? { validation: val } : {}); payFor(d, fee, en, 'visitor');
    const id = sess(d); if (day === 0) { log(st, p, f, 'in', d.entryCameraId, 'info', 'Visitor entered', id); log(en, p, f, 'out', d.exitCameraId || camFor(f, 'out'), 'ok', fee ? (d.closedManually ? `Exited, $${fee.toFixed(2)} paid at the desk` : `Exited, $${fee.toFixed(2)} paid`) : 'Exited within grace period, no charge', id); }
    if (day < 12 && rnd() < 0.06 && fee > 0) ratings.push({ sessionId: id, ticket: d.ticket, plate: p, facilityId: f, stars: pick([5, 5, 4, 5, 4, 3, 5, 2]), at: en + ri(2, 30) * M });
  }
}
// autopay members: exits today and yesterday, one still on site
members.forEach(([mid, p], i) => { for (let day = 1; day >= 0; day--) { const f = LPR[(i + day) % 2], st = ds0 - day * D + ri(4 * 60, 7 * 60) * M, en = st + ri(7, 9) * H; if (day === 0 && i === 3) { const c = camFor(f, 'in'); sess({ plate: p, facilityId: f, mode: 'lpr', kind: 'member', memberId: mid, startAt: st, endAt: null, payments: [], entryCameraId: c, createdAt: st }); continue; } if (en > NOW - 30 * M) continue; const [d, fee] = closed(f, p, st, en, { kind: 'member', memberId: mid }); payFor(d, fee, en, 'member'); const id = sess(d); if (day === 0) log(en, p, f, 'out', d.exitCameraId, 'ok', fee ? `Charging $${fee.toFixed(2)} to card on file` : 'Exited, no charge', id); } });
// VIPs: one on site, one exit yesterday
vips.forEach(([vid, p, free], i) => { const f = 'f-houston'; if (i === 0) { const st = NOW - ri(40, 120) * M, c = camFor(f, 'in'); const id = sess({ plate: p, facilityId: f, mode: 'lpr', kind: 'vip', vipId: vid, vipFree: free, startAt: st, endAt: null, payments: [], entryCameraId: c, createdAt: st }); log(st, p, f, 'in', c, 'ok', 'VIP entered: Council liaison (Greet by name; parks on level 1)', id); } else if (i < 3) { const st = ds0 - D + ri(5 * 60, 9 * 60) * M, en = st + ri(3, 7) * H; const [d, fee] = closed(f, p, st, en, { kind: 'vip', vipId: vid, vipFree: free }); if (free) d.fee = 0; else payFor(d, fee, en, 'visitor'); sess(d); } });
// monthly parkers on site now
permits.filter(([, p]) => p.status === 'active').slice(0, 14).forEach(([pid, p]) => { const f = out.permitTypes[p.permitTypeId].facilities[0]; if (!LPR.includes(f)) return; const st = NOW - ri(60, 600) * M, c = camFor(f, 'in'); const id = sess({ plate: p.plates[0], facilityId: f, mode: 'lpr', kind: 'permit', permitId: pid, startAt: st, endAt: null, payments: [], entryCameraId: c, createdAt: st }); if (NOW - st < 3 * H) log(st, p.plates[0], f, 'in', c, 'ok', 'Monthly parker entered', id); });
// QR lots: prepaid visitors now, one expired, plus yesterday's paid history
[[3, 40, 'f-main'], [2, 70, 'f-main'], [8, 180, 'f-main'], [1, 95, 'f-main'], [2, 30, 'f-third'], [4, 100, 'f-third'], [1, 20, 'f-third'], [2, 150, 'f-third'], [10, 15, 'f-main'], [3, 55, 'f-third']].forEach(([h, a, f], i) => {
  const st = NOW - a * M, p = plate(), amt = R.charge(fac(f), st, st + h * H, null) || 2;
  sess({ plate: p, facilityId: f, mode: 'prepaid', kind: 'visitor', startAt: st, endAt: null, paidUntil: st + h * H, payments: [{ amount: amt, at: st, method: 'online', pid: 'sim_pay_' + hex(8) }], createdAt: st, phone: i % 2 ? '817-555-0' + ri(100, 999) : null, smsOptIn: !!(i % 2), extendToken: hex(20), prepaidAt: st });
});
for (let day = 1; day <= 6; day++) for (let k = 0; k < ri(4, 8); k++) { const f = pick(['f-main', 'f-third']), st = ds0 - day * D + ri(5 * 60, 16 * 60) * M, h = pick([1, 2, 2, 3, 4, 8]), p = plate(), amt = R.charge(fac(f), st, st + h * H, null) || 2; sess({ plate: p, facilityId: f, mode: 'prepaid', kind: 'visitor', startAt: st, endAt: st + h * H, fee: amt, paidUntil: st + h * H, payments: [{ amount: amt, at: st, method: 'online', pid: 'sim_pay_' + hex(8) }], createdAt: st, prepaidAt: st }); }
// exit problems: unpaid exits (one past due with a late fee), a held look-alike match, a missed exit, an exit with no entry
[[3, 'f-houston', 190], [20, 'f-commerce', 130], [70, 'f-houston', 260]].forEach(([ago, f, mins]) => { const en = NOW - ago * H, st = en - mins * M, p = plate(); const [d, fee] = closed(f, p, st, en); if (ago > 48) Object.assign(d, { noticeStage: 3, lateFee: 10, noticeAt: en + 5 * M, reminderAt: en + 24 * H, pastDueAt: en + 48 * H }); else if (ago > 2) Object.assign(d, { noticeStage: 1, noticeAt: en + 5 * M }); const id = sess(d); if (ago < 24) log(en, p, f, 'out', d.exitCameraId, 'warn', `Exited owing $${fee.toFixed(2)} (not charged)`, id); });
{ const en = NOW - 50 * M, st = en - 150 * M, p = plate(); const [d, fee] = closed('f-houston', p, st, en); d.exitPlate = p.slice(0, -1) + (p.slice(-1) === '8' ? '3' : '8'); d.matchedBy = 'fuzzy'; const id = sess(d); log(en, d.exitPlate, 'f-houston', 'out', d.exitCameraId, 'warn', `Exit read as ${d.exitPlate} matched ${p} (one character off). $${fee.toFixed(2)} held for staff review, not charged`, id); }
{ const st = NOW - 31 * H, p = plate(); sess({ plate: p, facilityId: 'f-commerce', mode: 'lpr', kind: 'visitor', startAt: st, endAt: NOW - 2 * H, missedExit: true, fee: null, payments: [], entryCameraId: camFor('f-commerce', 'in'), createdAt: st }); }
{ const en = NOW - 2 * H, p = plate(), c = camFor('f-houston', 'out'); const id = sess({ plate: p, facilityId: 'f-houston', noEntry: true, mode: 'lpr', kind: 'visitor', startAt: null, endAt: en, fee: 0, payments: [], exitCameraId: c, createdAt: en }); log(en, p, 'f-houston', 'out', c, 'bad', 'Exit with no matching entry. Not charged. Review entry camera.', id); }
// tenant validations: Harbor Grill valet dinner service (5–11 pm), Trinity Dental daytime; one Harbor car open since last night (stale)
const tenantSess = (tid, f, st, en, by) => {
  const v = out.validations[tid === 'tn-harbor' ? 'v-1' : 'v-2'];
  const val = { code: VAL[tid], name: v.name, type: 'hours', value: v.value, department: out.tenants[tid].name, tenantId: tid, tenantName: out.tenants[tid].name, at: st + ri(3, 40) * M, source: 'office', by: by || (tid === 'tn-harbor' ? 'Harbor host stand' : 'Trinity front desk') };
  const p = plate(); uses[tid] = (uses[tid] || 0) + 1;
  if (en > NOW) return sess({ plate: p, facilityId: f, mode: 'lpr', kind: 'visitor', startAt: st, endAt: null, payments: [], entryCameraId: camFor(f, 'in'), validation: val, validationHistory: [val], createdAt: st });
  const [d, fee] = closed(f, p, st, en, { validation: val, validationHistory: [val] }); payFor(d, fee, en, 'visitor'); return sess(d);
};
for (let day = 0; day < 7; day++) {
  const base = ds0 - day * D + 14 * H; // 5 pm local
  const n = [34, 29, 33, 41, 26, 37, 31][day];
  for (let k = 0; k < n; k++) { const st = base + ri(0, 150) * M + pick([0, 0, 30, 60]) * M, en = st + ri(90, 200) * M; if (st < NOW - 5 * M) tenantSess('tn-harbor', 'f-houston', st, en); }
  if (day) for (let k = 0; k < ri(3, 6); k++) { const st = ds0 - day * D + ri(5 * 60, 12 * 60) * M; tenantSess('tn-dental', 'f-commerce', st, st + ri(40, 120) * M); }
}
if (nowMin > 9 * 60) for (let k = 0; k < ri(2, 4); k++) { const st = ds0 + ri(5 * 60, Math.min(nowMin - 30, 12 * 60)) * M; tenantSess('tn-dental', 'f-commerce', st, st + ri(40, 110) * M); }
{ const st = ds0 - D + 16 * H + 20 * M; tenantSess('tn-harbor', 'f-houston', st, NOW + D); } // open since last night: flagged as stale
Object.entries(VAL).forEach(([tid], i) => { out.validations['v-' + (i + 1)].uses = (uses[tid] || 0) + ri(200, 400); });
// valet board at Houston Street: dinner guests
[['parked', 'Blue Tesla Model Y', '41', 'V-3', 95], ['parked', 'Black Suburban', '42', 'V-7', 70], ['parked', 'White BMW X5', '43', 'V-2', 40], ['requested', 'Silver Lexus ES', '44', 'V-5', 130], ['retrieving', 'Red Mustang', '45', 'V-1', 160], ['ready', 'Gray Honda Pilot', '46', 'V-4', 145]].forEach(([status, vehicle, tag, space, ago], i) => {
  const st = NOW - ago * M, p = plate(), v = { status, tag, space, vehicle, phone: '817-555-02' + String(10 + i), parkedAt: st, by: 'Luis (valet)' };
  if (status !== 'parked') v.requestedAt = NOW - ri(4, 12) * M; if (status === 'retrieving' || status === 'ready') { v.retrievingAt = NOW - ri(2, 4) * M; v.runner = 'Luis (valet)'; } if (status === 'ready') v.readyAt = NOW - M;
  const val = i % 2 ? { code: 'HARBOR25', name: 'Harbor Grill dinner', type: 'hours', value: 2.5, department: 'Harbor Grill (valet)', tenantId: 'tn-harbor', tenantName: 'Harbor Grill (valet)', at: st + 2 * M, source: 'office', by: 'Harbor host stand' } : null;
  sess({ plate: p, facilityId: 'f-houston', mode: 'lpr', kind: 'visitor', manual: true, startAt: st, endAt: null, payments: [], valet: v, valetFee: 15, validation: val, validationHistory: val ? [val] : [], createdAt: st, history: [{ at: st, by: 'Luis (valet)', action: 'created', detail: 'Valet ticket' }] });
});
// a manual (lost ticket) entry recorded by the desk this morning
{ const st = ds0 + ri(5 * 60, 7 * 60) * M; if (st < NOW - 30 * M) sess({ plate: plate(), facilityId: 'f-commerce', mode: 'lpr', kind: 'visitor', manual: true, startAt: st, endAt: null, payments: [], notes: 'Camera missed the entry; driver showed a receipt from the coffee shop', createdAt: st, history: [{ at: st + 20 * M, by: 'Rosa Delgado', action: 'created', detail: 'Manual entry, arrival set to ' + new Date(st).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) }] }); }
/* ---------- reservations ---------- */
const resv = (id, d) => put('reservations', id, d);
const rv = [['booked', NOW + 3 * H, 3, 'Grace Okafor', 'grace.okafor@example.com'], ['booked', NOW + 26 * H, 4, 'Noah Brooks', 'noah.b@example.com'], ['booked', NOW + 5 * H, 2, 'Aisha Rahman', 'aisha.r@example.com'], ['arrived', NOW - 70 * M, 3, 'Omar Haddad', 'omar.h@example.com'], ['completed', NOW - 26 * H, 3, 'Lena Novak', 'lena.novak@example.com'], ['completed', NOW - 50 * H, 2, 'Theo Lund', 'theo.l@example.com'], ['no_show', NOW - 30 * H, 2, 'Ben Walsh', 'ben.walsh@example.com'], ['cancelled', NOW - 20 * H, 3, 'Iris Sato', 'iris.sato@example.com']];
rv.forEach(([status, start, hours, name, email], i) => {
  const p = plate(), d = { code: 'R' + hex(3).toUpperCase() + String(i), facilityId: 'f-houston', plate: p, plates: [p], name, email, start, end: start + hours * H, hours, premium: 5, paymentId: 'sim_pay_' + hex(8), status, createdAt: start - ri(2, 40) * H, accountId: null };
  if (status === 'arrived') { const c = camFor('f-houston', 'in'); const sid = sess({ plate: p, facilityId: 'f-houston', mode: 'lpr', kind: 'visitor', startAt: start + 10 * M, endAt: null, payments: [], entryCameraId: c, reservationId: 'r-' + i, createdAt: start + 10 * M }); d.arrivedAt = start + 10 * M; d.sessionId = sid; log(start + 10 * M, p, 'f-houston', 'in', c, 'ok', 'Reservation ' + d.code + ' arrived', sid); }
  if (status === 'completed') { const [sd, fee] = closed('f-houston', p, start + 5 * M, start + hours * H - 15 * M, { reservationId: 'r-' + i }); payFor(sd, fee, sd.endAt, 'visitor'); d.sessionId = sess(sd); d.arrivedAt = start + 5 * M; d.completedAt = sd.endAt; }
  if (status === 'no_show') d.noShowAt = start + H; if (status === 'cancelled') { d.cancelledAt = start - 6 * H; d.refunded = true; }
  resv('r-' + i, d);
});
/* ---------- ratings ---------- */
const comments = { 5: ['Easy in and out.', 'Paid from my phone before I got to the car.', 'Cameras just work.', 'Great location for the concert.'], 4: ['Fine. A little slow leaving at 5.', 'Good.', ''], 3: ['Took a while to find the exit lane.', ''], 2: ['Was charged for time I did not park. Staff fixed it quickly.'] };
ratings.slice(0, 16).forEach((r, i) => put('ratings', 'rt-' + i, Object.assign(r, { comment: pick(comments[r.stars] || ['']) })));
ratings.slice(0, 16).forEach(r => { const s = Object.values(out.sessions).find(x => x.ticket === r.ticket); if (s) s.rating = { stars: r.stars, at: r.at }; });
/* ---------- parking charge notices ---------- */
const V = { NOPERMIT: ['No valid payment or monthly parking', 50], EXPIRED: ['Paid time expired', 35], WRONGZONE: ['Monthly parking not valid in this facility', 40], RESERVEDZONE: ['Parked in reservations-only section', 75], FIRELANE: ['Fire lane / no parking zone', 100], ADA: ['Accessible space without placard', 250], UNPAID: ['Unpaid parking balance', 25], RESERVED: ['Parked in reserved space', 75] };
const rep = plate(), officers = ['Ofc. D. Harper #214', 'Ofc. L. Mendez #230', 'Ofc. J. Ito #241'];
[[rep, 'f-main', 'EXPIRED', 'open', 9 * D, ''], [rep, 'f-third', 'NOPERMIT', 'open', 5 * D, ''], [rep, 'f-houston', 'FIRELANE', 'open', 2 * D, 'Blocking east stairwell'],
 [plate(), 'f-main', 'EXPIRED', 'open', 3 * H, 'Row C, silver Camry'], [plate(), 'f-houston', 'RESERVEDZONE', 'open', 6 * H, 'Level 1 reserved row'], [plate(), 'f-commerce', 'WRONGZONE', 'open', D, ''],
 [plate(), 'f-third', 'NOPERMIT', 'paid', 4 * D, ''], [plate(), 'f-main', 'EXPIRED', 'paid', 2 * D, ''], [plate(), 'f-houston', 'ADA', 'paid', 6 * D, 'No placard visible'],
 [plate(), 'f-third', 'NOPERMIT', 'appeal', 3 * D, ''], [plate(), 'f-commerce', 'WRONGZONE', 'appeal', D, ''], [plate(), 'f-main', 'FIRELANE', 'voided', 5 * D, 'Voided by supervisor']].forEach(([p, f, code, st, ago, notes], i) => {
  const iss = NOW - ago, d = { number: 'C' + Math.floor(iss / 1000).toString(16).toUpperCase().slice(-6), plate: p, plateState: 'TX', facilityId: f, violation: code, violationName: V[code][0], fine: V[code][1], officer: officers[i % 3], notes, issuedAt: iss, status: st, sessionId: null, photoIds: [] };
  if (st === 'paid') Object.assign(d, { paidAt: Math.min(NOW - H, iss + ri(1, 3) * D), paidVia: i % 2 ? 'online' : 'office' });
  if (st === 'appeal') d.appeal = { reason: ['I paid at the sign but the page timed out. My bank statement shows the charge.', 'My employer added me to monthly parking that morning.'][i % 2], at: iss + 6 * H };
  if (st === 'voided') Object.assign(d, { voidedAt: iss + 2 * H });
  put('citations', 'c-' + String(i).padStart(2, '0'), d);
});
out.settings = { config: { campusName: 'KOS KESH', timeZone: 'America/Chicago', taxRate: 8.25, taxIncluded: true, unpaidGraceHours: 48, lateFee: 10, autoCiteHours: 96, hotListAmount: 100, hotListCount: 3, printerWidth: 3, enforcementGraceMin: 10, monthlyLateFee: 25, monthlyGraceDays: 5, invoiceDueDays: 5, cameraQuietMinutes: 60, openVisitFlagHours: 24, citationDueDays: 14, holidays: [], alertEmail: '',
  violations: Object.entries(V).map(([code, [name, fine]]) => ({ code, name, fine })) } };
feed.sort((a, b) => b.at - a.at); out.feeds = { lpr: { reads: feed.slice(0, 80) } };
Object.entries(out.cameras).forEach(([cid, c]) => { const r = feed.find(x => x.cameraId === cid); c.lastReadAt = r ? r.at : NOW - ri(3, 40) * M; c.lastPlate = r ? r.plate : ''; c.lastEventAt = NOW - ri(1, 8) * M; });
fs.rmSync('seed4', { recursive: true, force: true });
for (const [c, docs] of Object.entries(out)) { fs.mkdirSync('seed4/' + c, { recursive: true }); for (const [id, d] of Object.entries(docs)) fs.writeFileSync(`seed4/${c}/${id}.json`, JSON.stringify(d)); }
fs.writeFileSync('seed4/all.json', JSON.stringify(out));
fs.writeFileSync('seed4/generatedAt.json', JSON.stringify({ at: NOW }));
console.log(Object.fromEntries(Object.entries(out).map(([c, v]) => [c, Object.keys(v).length])));
