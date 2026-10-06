/* ParkOps rules engine — shared by the browser console and the hosted server.
   Pure functions over a state object S = {facilities, permitTypes, permits, sessions, citations, validations,
   members, tenants, cameras, reservations, companies, invoices, vips, ratings, config}. Planners never write;
   they return {ops:[...], ...} that the caller applies to its own store. */
(function (root) {
  'use strict';
  const M = 6e4, H = 36e5, D = 864e5;
  /* Plates are compared thousands of times a second on a busy night (every lookup walks the day's tickets), so the cleaned-up
     form of each plate string is remembered. */
  /* An email address worth sending a receipt to: one @, a dot in the domain, nothing that could break a mail header. */
  const emailOk = e => { e = String(e || '').trim(); return e.length >= 6 && e.length <= 120 && /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+\.[A-Za-z]{2,}$/.test(e); };
  const plateMemo = new Map();
  const normPlate = p => { if (typeof p !== 'string') return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); let v = plateMemo.get(p); if (v === undefined) { v = p.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (plateMemo.size > 50000) plateMemo.clear(); plateMemo.set(p, v); } return v; };
  const CONF = { O: '0', Q: '0', D: '0', I: '1', L: '1', B: '8', S: '5', Z: '2', G: '6' };
  const canon = p => normPlate(p).replace(/[OQDILBSZG]/g, c => CONF[c]);
  const NOREAD = /^(|UNKNOWN|NOPLATE|NOREAD|NONE|0+)$/;
  function within1(a, b) {
    if (a === b) return true;
    const la = a.length, lb = b.length; if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, ed = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++ed > 1) return false;
      if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
    }
    return ed + (la - i) + (lb - j) <= 1;
  }
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const round2 = n => Math.round((+n || 0) * 100) / 100;
  const sum = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);
  const money = n => '$' + round2(n).toFixed(2);
  const B36 = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const ticketNo = () => 'T' + Date.now().toString(36).toUpperCase().slice(-5) + B36[Math.floor(Math.random() * 34)] + B36[Math.floor(Math.random() * 34)];

  /* ---------- roles ----------
     Staff roles and what each may do. The server enforces the same table on every request. */
  const ALL = ['users', 'settings', 'facilities', 'cameras', 'validations', 'vips', 'monthly', 'import', 'tickets', 'tickets.adjust', 'citations', 'citations.decide', 'reports', 'payments', 'refunds', 'valet', 'reservations', 'enforcement', 'export'];
  const ROLES = {
    owner: ALL,
    manager: ALL.filter(p => p !== 'users'),
    attendant: ['tickets', 'citations', 'valet', 'reservations', 'enforcement'],
    accountant: ['monthly', 'reports', 'payments', 'refunds', 'export'],
    viewer: [],
  };
  ROLES.admin = ROLES.owner; ROLES.officer = ROLES.attendant; // names used before v4
  const ROLE_NAMES = { owner: 'Owner', manager: 'Manager', attendant: 'Attendant', accountant: 'Accountant', viewer: 'Viewer' };
  const canonRole = r => ({ admin: 'owner', officer: 'attendant' })[r] || r;
  const can = (role, perm) => !!(ROLES[role] || []).includes(perm);
  const METHODS = { cash: 'Cash', card: 'Card', terminal: 'Card (terminal)', check: 'Check', online: 'Online', autopay: 'Card on file', office: 'Office', comp: 'Complimentary', square: 'Card (online)' };

  /* ---------- time zones and parking days ---------- */
  const fmtCache = {};
  function tzParts(t, tz) {
    let f = fmtCache[tz];
    if (!f) {
      try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
      catch (e) { f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
      fmtCache[tz] = f;
    }
    const o = {}; for (const p of f.formatToParts(new Date(t))) if (p.type !== 'literal') o[p.type] = +p.value;
    if (o.hour === 24) o.hour = 0;
    return o;
  }
  const tzOffset = (t, tz) => { const p = tzParts(t, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000; };
  /* Instant of a local wall-clock time. A time skipped by a DST jump resolves to the moment after the jump. */
  function zoned(y, mo, d, h, mi, tz) {
    const g = Date.UTC(y, mo - 1, d, h, mi);
    const a = g - tzOffset(g, tz), b = g - tzOffset(a, tz);
    const ok = t => { const p = tzParts(t, tz); return p.hour === h && p.minute === mi && p.day === d; };
    if (ok(b)) return b; if (ok(a)) return a;
    return Math.max(a, b);
  }
  function addDays(y, m, d, n) { const x = new Date(Date.UTC(y, m - 1, d + n)); return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]; }

  function Rules(S, clock, opts) {
    const now = clock || (() => Date.now());
    opts = opts || {};
    const cfg = () => S.config || {};
    const L = k => S[k] || [];
    /* One plate's tickets. The server keeps an index by plate (S.__byPlate, for the list it was built from); without one,
       every ticket is looked at. Either way the same tickets come back, oldest first. */
    const byStart = (a, b) => (a.startAt || a.endAt || 0) - (b.startAt || b.endAt || 0);
    const ofPlate = pl => { const ix = S.__byPlate; if (ix && S.__byPlateArr === S.sessions) return (ix.get(pl) || []).slice().sort(byStart); return L('sessions').filter(s => normPlate(s.plate) === pl).sort(byStart); };
    const fac = id => L('facilities').find(f => f.id === id);
    const ptype = id => L('permitTypes').find(t => t.id === id);
    const tenant = id => L('tenants').find(t => t.id === id);
    const camera = id => L('cameras').find(c => c.id === id);
    const tzOf = f => (f && f.timeZone) || (S.config && S.config.timeZone) || 'America/Chicago';
    const resetOf = f => { const r = String((f && f.rates && f.rates.resetTime) || '00:00').split(':'); return [+r[0] || 0, +r[1] || 0]; };
    /* Each visit keeps a copy of the rates it started under, so a rate change only affects new visits. */
    const snapRates = f => f && f.rates ? JSON.parse(JSON.stringify(f.rates)) : null;
    const facFor = s => { const f = fac(s.facilityId); return f && s.rates ? Object.assign({}, f, { rates: s.rates }) : f; };
    const ticketOf = s => (s && s.ticket) || ('T' + String((s && s.id) || '').slice(-6).toUpperCase());
    const fmtLocal = (t, f) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tzOf(f) });
    /* The instant a calendar date ends (the next local midnight), for “paid through” dates typed by staff or imported. */
    const endOfDate = (str, f) => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(str || '').trim()); if (!m) return null; const [y, mo, d] = addDays(+m[1], +m[2], +m[3], 1); return zoned(y, mo, d, 0, 0, tzOf(f)); };
    const histAdd = (s, e) => ((s && s.history) || []).concat([{ at: now(), by: e.by || '', action: e.action, detail: String(e.detail || '').slice(0, 400) }]).slice(-100);

    function dayStart(t, f) {
      const tz = tzOf(f), [h, m] = resetOf(f), p = tzParts(t, tz);
      let s = zoned(p.year, p.month, p.day, h, m, tz);
      if (s > t) { const [y, mo, d] = addDays(p.year, p.month, p.day, -1); s = zoned(y, mo, d, h, m, tz); }
      return s;
    }
    function nextDayStart(s, f) {
      const tz = tzOf(f), [h, m] = resetOf(f), p = tzParts(s, tz);
      const [y, mo, d] = addDays(p.year, p.month, p.day, 1);
      let n = zoned(y, mo, d, h, m, tz);
      if (n <= s + H) { const [y2, m2, d2] = addDays(y, mo, d, 1); n = zoned(y2, m2, d2, h, m, tz); }
      return n;
    }

    /* ---------- rates ----------
       rates = { mode: 'increment' | 'table', incrementMin, incrementPrice (or legacy hourly), table: [{upTo, price}],
                 afterMinutes, afterPrice, dailyMax, graceMin, resetTime, rolling, specials: [...] }
       A parking day runs from the reset time to the next reset time (or, with rolling on, 24 hours from arrival),
       and each parking day is capped at the daily maximum. In increment mode each started increment is billed to
       the day it starts in; in table mode each day's minutes are priced from the table. Specials (early bird,
       evening, weekend, event) are flat prices that apply when the whole stay qualifies; the driver pays the lower
       of the special and the regular rate. */
    const hm = x => { const [h, m] = String(x || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const pad2 = n => String(n).padStart(2, '0');
    function local(t, f) { const p = tzParts(t, tzOf(f)); return { mins: p.hour * 60 + p.minute, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(), date: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`, p }; }
    const incOf = r => ({ min: +r.incrementMin > 0 ? +r.incrementMin : 60, price: r.incrementPrice != null && r.incrementPrice !== '' ? +r.incrementPrice : +r.hourly || 0 });
    function tablePrice(r, mins) {
      const rows = (r.table || []).filter(x => +x.upTo > 0).sort((a, b) => a.upTo - b.upTo);
      if (!rows.length) return Math.ceil(mins / 60 - 1e-9) * (+r.hourly || 0);
      const row = rows.find(x => mins <= +x.upTo + 1e-9); if (row) return +row.price;
      const last = rows[rows.length - 1], inc = +r.afterMinutes > 0 ? +r.afterMinutes : 60;
      if (!(+r.afterPrice > 0)) return +r.dailyMax > 0 ? +r.dailyMax : +last.price; // past the last step: the daily max
      return +last.price + Math.ceil((mins - last.upTo) / inc - 1e-9) * (+r.afterPrice || 0);
    }
    /* Regular price of [eff, end). When `days` is given, one entry per parking day is pushed to it. */
    function standard(f, eff, end, days, anchor) {
      const r = (f && f.rates) || {}, max = +r.dailyMax > 0 ? +r.dailyMax : Infinity, rolling = !!r.rolling;
      if (end <= eff) return 0;
      // Rolling days run 24 hours from the original arrival (anchor), even when free validation time comes off the front.
      let total = 0, ds = rolling ? (anchor || eff) : dayStart(eff, f), de = rolling ? ds + D : nextDayStart(ds, f), guard = 0;
      while (rolling && de <= eff && guard++ < 800) { ds = de; de = ds + D; }
      const next = () => { ds = de; de = rolling ? ds + D : nextDayStart(ds, f); };
      const push = (a, b, raw) => { if (days) days.push({ start: a, end: b, minutes: Math.round((b - a) / M), raw: round2(raw), amount: round2(Math.min(raw, max)), capped: raw > max }); };
      if (r.mode === 'table') {
        let a = eff;
        while (a < end && guard++ < 800) { const b = Math.min(end, de), raw = tablePrice(r, (b - a) / M); total += Math.min(raw, max); push(a, b, raw); a = b; next(); }
        return total;
      }
      const inc = incOf(r), n = Math.ceil((end - eff) / (inc.min * M) - 1e-9);
      let amt = 0, segStart = eff;
      for (let i = 0; i < n && i < 40000; i++) {
        const t = eff + i * inc.min * M;
        while (t >= de && guard++ < 800) { total += Math.min(amt, max); push(segStart, de, amt); amt = 0; segStart = de; next(); }
        amt += inc.price;
      }
      total += Math.min(amt, max); push(segStart, end, amt);
      return total;
    }
    function specialQualifies(sp, f, start, end) {
      if (!sp || sp.active === false || !(+sp.price >= 0)) return false;
      const s = local(start, f), holidays = cfg().holidays || [];
      if (Array.isArray(sp.dates) && sp.dates.length) { if (!sp.dates.includes(s.date)) return false; }
      else if (Array.isArray(sp.days) && sp.days.length && !sp.days.map(Number).includes(s.dow)) return false;
      if (sp.noHolidays !== false && holidays.includes(s.date) && !(sp.dates && sp.dates.length)) return false;
      const from = hm(sp.enterFrom || '00:00'), until = hm(sp.enterUntil || '23:59');
      const inWin = from <= until ? (s.mins >= from && s.mins <= until) : (s.mins >= from || s.mins <= until);
      if (!inWin) return false;
      if (+sp.minStayMin > 0 && end - start < +sp.minStayMin * M) return false;
      const tz = tzOf(f), p = s.p;
      if (sp.exitBy) {
        let off = sp.exitNextDay ? 1 : 0;
        if (from > until && s.mins <= until) off = 0; // entered after midnight on an overnight window
        const [y, mo, d] = addDays(p.year, p.month, p.day, off), e = hm(sp.exitBy);
        if (end > zoned(y, mo, d, Math.floor(e / 60), e % 60, tz)) return false;
      }
      if (sp.exitAfter) { const e = hm(sp.exitAfter); if (end < zoned(p.year, p.month, p.day, Math.floor(e / 60), e % 60, tz)) return false; }
      return true;
    }
    /* Event nights are specials with event dates. A flat special ("charge exactly this price") wins even when the
       regular rate would be lower: that is how a $25 event rate is collected at the entrance. A stay belongs to an
       event night when the car entered inside the event's window, however long it then stays. A validated stay is
       priced without event specials: the code's free time comes off, then the regular rates apply. */
    const isEvent = sp => !!(sp && Array.isArray(sp.dates) && sp.dates.length);
    function eventAt(f, start) {
      if (!start) return null;
      return ((f && f.rates && f.rates.specials) || []).find(sp => sp.active !== false && isEvent(sp) && specialQualifies(Object.assign({}, sp, { exitBy: null, exitAfter: null, minStayMin: 0 }), f, start, start + M)) || null;
    }
    function bestSpecial(f, start, end, skipEvents) {
      const list = ((f && f.rates && f.rates.specials) || []).filter(sp => !(skipEvents && isEvent(sp)) && specialQualifies(sp, f, start, end));
      const flat = list.filter(sp => sp.flat).sort((a, b) => a.price - b.price)[0];
      return flat || list.sort((a, b) => a.price - b.price)[0] || null;
    }
    /* Price of a stay with the full breakdown: parking days, special applied, validation effect.
       Validation types: hours (free time from the original arrival), percent, dollar (amount off), fixed (pay at
       most this), full (nothing to pay). Free time never restarts the clock: it comes off the front of the stay. */
    function priceDetail(f, start, end, val) {
      const r = (f && f.rates) || {}, grace = +r.graceMin || 0;
      const out = { amount: 0, rule: 'none', standard: 0, special: null, days: [], validation: val ? { code: val.code, type: val.type, value: val.value } : null, discount: 0, freeMinutes: 0 };
      if (!start || !end || end <= start) return out;
      if ((end - start) / M <= grace) { out.rule = 'grace'; return out; }
      if (val && val.type === 'full') { out.rule = 'validated'; out.standard = round2(standard(f, start, end, out.days)); out.discount = out.standard; return out; }
      const free = val && val.type === 'hours' ? (+val.value || 0) * H : 0, eff = start + free;
      out.freeMinutes = Math.round(Math.min(free, end - start) / M);
      const days = [];
      const std = standard(f, eff, end, days, start);
      let amount = std, rule = 'standard';
      const sp = bestSpecial(f, start, end, !!val);
      if (sp && (sp.flat || +sp.price < amount)) { amount = +sp.price; rule = sp.name || 'special'; out.special = { name: sp.name || 'special', price: +sp.price, flat: !!sp.flat }; }
      const before = amount;
      if (val) {
        if (val.type === 'percent') amount *= 1 - (+val.value || 0) / 100;
        else if (val.type === 'dollar') amount -= (+val.value || 0);
        else if (val.type === 'fixed') amount = Math.min(amount, +val.value || 0);
      }
      amount = Math.max(0, amount);
      out.days = days; out.standard = round2(std); out.amount = round2(amount); out.rule = rule;
      out.discount = round2((free ? standard(f, start, end) - std : 0) + (before - amount));
      return out;
    }
    const charge = (f, start, end, val) => priceDetail(f, start, end, val).amount;
    /* A ticket's price: charge() for its stay, except that a car which already paid the flat event rate at the
       entrance keeps that price even if it leaves inside the grace period. A car turned away without paying still
       leaves free. */
    function stayDetail(s, end, val) {
      const f = facFor(s), pd = priceDetail(f, s.startAt, end, val);
      if (pd.rule === 'grace' && !val && paidOf(s) > 0) {
        const ev = eventAt(f, s.startAt);
        if (ev && ev.flat) return Object.assign(pd, { amount: round2(+ev.price), rule: ev.name || 'event', special: { name: ev.name || 'event', price: +ev.price, flat: true } });
      }
      return pd;
    }
    const stayCharge = (s, end, val) => stayDetail(s, end, val).amount;
    function rateSummary(f) {
      const r = (f && f.rates) || {}, out = [], dn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const t12 = x => { const m = hm(x), h = Math.floor(m / 60), mm = m % 60; return (h % 12 || 12) + (mm ? ':' + pad2(mm) : '') + (h < 12 ? 'am' : 'pm'); };
      // A flat daily rate (one table step covering the whole day, capped at that same price) reads as "$10.00 all day".
      const tbl = (r.table || []).filter(x => +x.upTo > 0), flatDay = r.mode === 'table' && tbl.length === 1 && +tbl[0].upTo >= 1440 && (!(+r.dailyMax > 0) || +r.dailyMax === +tbl[0].price);
      if (flatDay) out.push(`${money(tbl[0].price)} all day`);
      else if (r.mode === 'table') (r.table || []).forEach(x => out.push(`Up to ${+x.upTo >= 60 ? (x.upTo / 60) + ' hr' + (x.upTo > 60 ? 's' : '') : x.upTo + ' min'}: ${money(x.price)}`));
      else { const inc = incOf(r); out.push(`${money(inc.price)} per ${inc.min === 60 ? 'hour' : inc.min + ' min'}`); }
      if (+r.dailyMax > 0 && !flatDay) out.push(`Daily max ${money(r.dailyMax)}${r.rolling ? ' per 24 hours' : ''}`);
      (r.specials || []).filter(sp => sp.active !== false).forEach(sp => {
        const dd = (sp.days || []).map(Number), has = a => a.length === dd.length && a.every(d => dd.includes(d));
        const days = sp.dates && sp.dates.length ? sp.dates.join(', ') : has([0, 1, 2, 3, 4, 5, 6]) ? 'Every day' : has([1, 2, 3, 4, 5]) ? 'Mon–Fri' : has([0, 6]) ? 'Sat–Sun' : dd.map(d => dn[d]).join(', ');
        out.push(`${sp.name}: ${money(sp.price)}${sp.flat ? ' flat' : ''} · in ${t12(sp.enterFrom || '00:00')}–${t12(sp.enterUntil || '23:59')}${sp.exitBy ? ', out by ' + t12(sp.exitBy) + (sp.exitNextDay ? ' next day' : '') : ''}${days ? ' · ' + days : ''}`);
      });
      if (+r.graceMin > 0) out.push(`First ${r.graceMin} min free`);
      return out;
    }
    /* Sales tax. Texas: 6.25% state + local (8.25% in Fort Worth, Dallas, Austin). Posted prices usually include it. */
    function taxOf(amount) {
      const rate = +cfg().taxRate || 0, a = round2(amount);
      if (!rate) return { net: a, tax: 0, total: a, rate: 0 };
      if (cfg().taxIncluded !== false) { const net = round2(a / (1 + rate / 100)); return { net, tax: round2(a - net), total: a, rate }; }
      const tax = round2(a * rate / 100); return { net: a, tax, total: round2(a + tax), rate };
    }

    /* ---------- sessions (tickets) ---------- */
    const paidOf = s => round2(sum(s.payments || [], p => p.amount));
    const extrasOf = s => round2(+s.valetFee || 0);
    const freeKind = s => s.kind === 'permit' || !!s.vipFree;
    function sessionFee(s, end) {
      if (freeKind(s) || s.noEntry || s.noPlate) return 0;
      if (s.mode === 'prepaid' && !s.endAt) return paidOf(s);
      if (s.endAt && s.fee != null && !end) return +s.fee;
      return stayCharge(s, end || s.endAt || now(), s.validation);
    }
    const needsReview = s => !!(s.matchedBy && !s.matchConfirmed);
    /* What an open ticket can be paid at the entrance on an event night: the flat event price less anything already
       paid, even inside the grace period, so attendants collect it as the car comes in. 0 when no flat event applies
       (validated stays pay regular rates after their free time, so they are left to pay on exit). */
    function entryDue(s) {
      if (!s || s.endAt || s.mode === 'prepaid' || freeKind(s) || s.validation) return 0;
      const ev = eventAt(facFor(s), s.startAt);
      if (!ev || !ev.flat) return 0;
      return Math.max(0, round2(+ev.price + extrasOf(s) + (+s.lateFee || 0) - paidOf(s)));
    }
    const balanceOf = s => (s.waived || s.cited || (s.missedExit && !s.missedResolved) || needsReview(s)) ? 0 : Math.max(0, round2(sessionFee(s) + (+s.lateFee || 0) + extrasOf(s) - paidOf(s)));
    /* Full bill for a ticket: parking breakdown, extras, late fee, payments, balance, tax. */
    function ticketBill(s, end) {
      const f = facFor(s), prepaidOpen = s.mode === 'prepaid' && !s.endAt && !end, at = end || s.endAt || (prepaidOpen ? Math.max(s.paidUntil || 0, s.startAt || 0) : now());
      const pd = (freeKind(s) || s.noEntry || s.noPlate) ? { amount: 0, rule: s.kind === 'permit' ? 'monthly' : s.vipFree ? 'vip' : 'none', days: [], standard: 0, special: null, discount: 0, freeMinutes: 0 } : stayDetail(s, at, s.validation);
      const parking = s.endAt && s.fee != null && !end ? +s.fee : prepaidOpen ? paidOf(s) : pd.amount;
      const adjusted = s.endAt && s.fee != null && s.feeOriginal != null && Math.abs(+s.fee - +s.feeOriginal) > 0.004;
      const extras = extrasOf(s), late = +s.lateFee || 0, paid = paidOf(s);
      const total = round2(parking + extras + late), due = balanceOf(s);
      return { facility: f, detail: pd, parking: round2(parking), adjusted, extras, late, paid, total, due, tax: taxOf(total), start: s.startAt, end: at, minutes: s.startAt ? Math.round(((end || s.endAt || now()) - s.startAt) / M) : 0, prepaidOpen };
    }
    /* A ticket's receipt as plain text for email: the same lines as the printed receipt. o = { org, receiptUrls, addTimeUrl }. */
    function receiptText(s, o) {
      o = o || {}; const b = ticketBill(s), f = b.facility, tz = tzOf(f), c = cfg(), org = o.org || c.campusName || 'Parking';
      const t = x => x ? new Date(x).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '—';
      const dur = m => m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
      const L = [org + ' parking receipt', f ? f.name + (f.address ? ', ' + f.address : '') : '', '', 'Ticket: ' + ticketOf(s), 'Plate: ' + s.plate, 'In: ' + t(s.startAt)];
      if (b.prepaidOpen) L.push('Paid until: ' + t(b.end));
      else { L.push(s.endAt ? 'Out: ' + t(s.endAt) : 'Still parked as of ' + t(b.end)); L.push('Time: ' + dur(b.minutes)); }
      L.push('');
      if (!b.prepaidOpen) {
        b.detail.days.forEach(d => L.push(`Parking ${new Date(d.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })} (${dur(d.minutes)})${d.capped ? ', daily max' : ''}: ${money(d.amount)}`));
        if (b.detail.special) L.push(`${b.detail.special.name} rate: ${money(b.detail.special.price)}`);
        if (b.detail.freeMinutes && s.validation) L.push(`Validation ${s.validation.code}: ${dur(b.detail.freeMinutes)} free`);
        if (b.detail.discount && !b.detail.freeMinutes) L.push(`Validation ${s.validation ? s.validation.code : ''}: -${money(b.detail.discount)}`);
        if (b.adjusted) L.push('Fee adjusted: ' + money(b.parking));
      }
      if (b.extras) L.push('Valet: ' + money(b.extras));
      if (b.late) L.push('Late fee: ' + money(b.late));
      L.push('Total: ' + money(b.total));
      if (b.tax.tax) L.push((c.taxIncluded === false ? 'Includes ' : 'Price includes ') + money(b.tax.tax) + ' sales tax (' + b.tax.rate + '%)');
      (s.payments || []).forEach(p => L.push(`Paid ${String(METHODS[p.method] || p.method || '').toLowerCase()} ${t(p.at)}: ${money(p.amount)}${p.tendered != null && p.tendered > p.amount ? ` (tendered ${money(p.tendered)}, change ${money(p.tendered - p.amount)})` : ''}`));
      L.push(b.due > 0 ? 'Balance due: ' + money(b.due) : b.paid > 0 ? 'Paid in full' : '');
      (o.receiptUrls || []).filter(Boolean).forEach(u => L.push('Card receipt: ' + u));
      if (o.addTimeUrl) L.push('', 'Add time: ' + o.addTimeUrl);
      L.push('', 'Thank you for parking with ' + org + '.');
      return { subject: `Your ${org} parking receipt: ${b.paid > 0 ? money(b.paid) + ' · ' : ''}${s.plate}`, text: L.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim() };
    }
    const isLive = s => !s.endAt && (s.mode === 'lpr' || (s.paidUntil || 0) > now() - 12 * H);
    const onSiteSessions = f => L('sessions').filter(s => s.facilityId === f.id && !s.endAt && (s.mode === 'lpr' || (s.paidUntil || 0) > now()));
    const occupancy = f => Math.max(0, Math.min(+f.capacity || Infinity, (+f.baseline || 0) + onSiteSessions(f).length));
    const permitValid = p => p.status === 'active' && (!p.endAt || p.endAt > now());
    const permitCovers = (p, facId) => { const t = ptype(p.permitTypeId); if (!t) return false; const fs = t.facilities || []; return !fs.length || fs.includes(facId); };
    /* Spaces at a location right now, counting monthly parkers. Every active monthly parker holds a space at their
       plan's location (its first location when a plan covers several), parked or not. A monthly car the cameras see
       inside its own location is part of that hold, so it is not counted twice; any other car inside is a visitor.
       available = capacity − visitors − monthly − count adjustment. */
    const homeOf = p => { const t = ptype(p.permitTypeId); return (t && (t.facilities || [])[0]) || null; };
    function spaceUse(f) {
      const cap = +f.capacity || 0, adj = +f.baseline || 0, on = onSiteSessions(f);
      const mine = new Set(L('permits').filter(p => permitValid(p) && homeOf(p) === f.id).map(p => p.id));
      const monthlyInside = on.filter(s => s.kind === 'permit' && mine.has(s.permitId)).length;
      const visitors = on.length - monthlyInside, monthly = mine.size, used = Math.max(0, visitors + monthly + adj);
      return { capacity: cap, visitors, monthly, monthlyInside, adjustment: adj, used, available: Math.max(0, cap - used), pct: cap ? used / cap : 0 };
    }
    /* Cars that use the same validation code again and again: visits per code and plate over the last N days
       (Settings; default 3 or more visits in 7 days). A flag for someone to review, never a refusal. */
    function repeatValidations() {
      const c = cfg(), min = Math.max(2, Math.round(+c.repeatValidationCount || 3)), days = Math.max(1, Math.round(+c.repeatValidationDays || 7)), since = now() - days * D;
      const by = new Map();
      L('sessions').forEach(s => {
        const v = s.validation; if (!v || !v.code || !(s.startAt >= since) || !s.plate || s.noPlate) return;
        const pl = normPlate(s.plate), k = v.code + '|' + pl;
        const e = by.get(k) || { code: v.code, plate: pl, business: v.tenantName || v.department || v.name || '', sessions: [], last: 0 };
        e.sessions.push(s.id); e.last = Math.max(e.last, s.startAt); by.set(k, e);
      });
      return [...by.values()].filter(e => e.sessions.length >= min).map(e => Object.assign(e, { count: e.sessions.length, days, min })).sort((a, b) => b.count - a.count || b.last - a.last);
    }
    const permitsForPlate = pl => L('permits').filter(p => (p.plates || []).map(normPlate).includes(pl));
    const validPermitFor = (pl, facId) => L('permits').filter(permitValid).find(p => (p.plates || []).map(normPlate).includes(pl) && permitCovers(p, facId));
    const memberForPlate = pl => L('members').find(m => (m.plates || []).map(normPlate).includes(pl));
    const vipForPlate = (pl, facId) => L('vips').find(v => v.active !== false && (v.plates || []).map(normPlate).includes(pl) && (!(v.facilities || []).length || !facId || v.facilities.includes(facId)));
    const soldOf = t => L('permits').filter(p => p.permitTypeId === t.id && ['active', 'pending', 'approved', 'suspended'].includes(p.status) && (!p.endAt || p.endAt > now())).length;
    const unpaidSessions = () => L('sessions').filter(s => s.endAt && balanceOf(s) > 0);
    const graceH = () => +cfg().unpaidGraceHours || 48;
    const code6 = p => p + Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    const staleHours = () => +cfg().openVisitFlagHours || 24;

    /* ---------- collections ---------- */
    function plateDebt(pl) {
      const owed = ofPlate(pl).filter(s => s.endAt && balanceOf(s) > 0);
      const cits = L('citations').filter(c => normPlate(c.plate) === pl && c.status === 'open');
      return { owed, cits, total: round2(sum(owed, balanceOf) + sum(cits, c => c.fine)), count: owed.length + cits.length };
    }
    function isHot(pl) {
      const d = plateDebt(pl), amt = +cfg().hotListAmount || 100, n = +cfg().hotListCount || 3;
      return d.count && (d.total >= amt || d.cits.length >= n) ? d : null;
    }
    function hotList() {
      const plates = new Set();
      L('sessions').forEach(s => { if (s.endAt && balanceOf(s) > 0) plates.add(normPlate(s.plate)); });
      L('citations').forEach(c => { if (c.status === 'open') plates.add(normPlate(c.plate)); });
      return [...plates].map(p => ({ plate: p, debt: isHot(p) })).filter(x => x.debt).sort((a, b) => b.debt.total - a.debt.total);
    }
    /* One step per unpaid exit per run: notice, reminder, late fee at the end of grace, then an automatic citation. */
    function planCollections() {
      const c = cfg(), t = now(), ops = [], notices = [];
      const lateFee = +c.lateFee || 0, citeH = +c.autoCiteHours || 0, g = graceH() * H;
      L('sessions').forEach(s => {
        if (!s.endAt || s.noEntry || s.noPlate || s.waived || s.cited || s.missedExit) return;
        const bal = balanceOf(s); if (bal <= 0) return;
        const age = t - s.endAt, stage = s.noticeStage || 0;
        const up = d => ops.push({ type: 'update', coll: 'sessions', id: s.id, data: d });
        if (stage < 1) { up({ noticeStage: 1, noticeAt: t }); notices.push({ type: 'unpaid', session: s, balance: bal }); }
        else if (stage < 2 && age > g / 2) { up({ noticeStage: 2, reminderAt: t }); notices.push({ type: 'reminder', session: s, balance: bal }); }
        else if (stage < 3 && age > g) { const d = { noticeStage: 3, pastDueAt: t }; if (lateFee > 0) d.lateFee = lateFee; up(d); notices.push({ type: 'pastdue', session: s, balance: round2(bal + (lateFee > 0 ? lateFee : 0)) }); }
        else if (stage < 4 && citeH && age > citeH * H) {
          const v = (c.violations || []).find(x => x.code === 'UNPAID') || { code: 'UNPAID', name: 'Unpaid parking balance', fine: 25 };
          const id = uid('c');
          ops.push({ type: 'set', coll: 'citations', id, data: { number: 'C' + Date.now().toString(36).toUpperCase().slice(-6) + Math.floor(Math.random() * 10), plate: normPlate(s.plate), facilityId: s.facilityId, violation: v.code, violationName: v.name, fine: round2(bal + (+v.fine || 0)), officer: 'Automatic (unpaid exit)', notes: 'Unpaid balance ' + money(bal) + ' plus ' + money(v.fine) + ' penalty · ticket ' + ticketOf(s), issuedAt: t, status: 'open', sessionId: s.id, photoIds: [s.exitPhotoId, s.entryPhotoId].filter(Boolean) } });
          up({ noticeStage: 4, cited: true, citationId: id });
          notices.push({ type: 'cited', session: s, balance: bal, citationId: id });
        }
      });
      return { ops, notices };
    }
    /* Accounts receivable, aged from the day each amount became due. Buckets: current, 1-30, 31-60, 61-90, 91+. */
    function arAging(asOf) {
      asOf = asOf || now(); const rows = new Map();
      const add = (key, label, debtorKind, kind, ref, amount, dueAt, facilityId) => {
        if (!(amount > 0)) return;
        const r = rows.get(key) || { key, label, debtorKind, items: [], buckets: [0, 0, 0, 0, 0], total: 0, oldest: 0 };
        const days = Math.floor((asOf - dueAt) / D), b = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
        r.buckets[b] = round2(r.buckets[b] + amount); r.total = round2(r.total + amount); r.oldest = Math.max(r.oldest, days);
        r.items.push({ kind, ref, amount: round2(amount), dueAt, days: Math.max(0, days), facilityId }); rows.set(key, r);
      };
      L('sessions').forEach(s => { if (s.endAt && balanceOf(s) > 0) add('plate:' + normPlate(s.plate), normPlate(s.plate), 'Vehicle', 'Unpaid parking', ticketOf(s), balanceOf(s), s.endAt, s.facilityId); });
      L('citations').forEach(c => { if (c.status === 'open') add('plate:' + normPlate(c.plate), normPlate(c.plate), 'Vehicle', 'Citation', c.number, +c.fine || 0, c.issuedAt, c.facilityId); });
      L('permits').forEach(p => { if (['active', 'suspended'].includes(p.status) && p.pastDueSince && !p.companyId) { const t = ptype(p.permitTypeId); add('permit:' + p.id, p.holder + ' · #' + p.number, 'Monthly parker', 'Monthly parking', p.number, round2((+(t && t.price) || 0) + (+p.lateFeeDue || 0)), p.pastDueSince, (t && (t.facilities || [])[0]) || null); } });
      L('invoices').forEach(i => { if (!['PAID', 'CANCELED', 'FAILED'].includes(i.status)) add('co:' + i.companyId, i.companyName, 'Company', 'Invoice', i.period, +i.amount || 0, Date.parse(i.dueDate) || i.createdAt, null); });
      return [...rows.values()].sort((a, b) => b.total - a.total);
    }

    /* ---------- reservations ---------- */
    const resPlates = r => (r.plates || [r.plate]).map(normPlate);
    const resActive = r => r.status === 'booked' || r.status === 'arrived';
    const resIntervals = (facId, exceptId) => L('reservations').filter(r => r.facilityId === facId && resActive(r) && r.id !== exceptId)
      .map(r => ({ startAt: r.start - 30 * M, endAt: r.status === 'arrived' ? Math.max(r.end, now() + 15 * M) : r.end }));
    function resAvailability(facId, start, end) {
      const f = fac(facId), cap = +(f && f.reservedSpaces) || 0;
      const c = concurrency(resIntervals(facId), start - 30 * M, end);
      return { cap, peak: c.peak, left: Math.max(0, cap - c.peak) };
    }
    const reservationFor = (pl, facId, at) => L('reservations').filter(r => r.facilityId === facId && r.status === 'booked' && resPlates(r).includes(pl) && at >= r.start - 60 * M && at <= r.end).sort((a, b) => a.start - b.start)[0];
    const activeReservation = (pl, facId) => { const t = now(); return L('reservations').find(r => r.facilityId === facId && resPlates(r).includes(pl) && (r.status === 'arrived' || (r.status === 'booked' && t >= r.start - 60 * M && t <= r.end))); };
    function planNoShows() {
      const t = now(), ops = [];
      L('reservations').forEach(r => {
        const f = fac(r.facilityId); const g = (+(f && f.reservationGraceMin) || 60) * M;
        if (r.status === 'booked' && t > r.start + g) ops.push({ type: 'update', coll: 'reservations', id: r.id, data: { status: 'no_show', noShowAt: t } });
        else if (r.status === 'arrived' && t > r.end + 6 * H) { const sess = L('sessions').find(x => x.id === r.sessionId); if (!sess || sess.endAt || t - sess.startAt > 24 * H) ops.push({ type: 'update', coll: 'reservations', id: r.id, data: { status: 'completed', completedAt: t } }); }
      });
      return ops;
    }

    function exitStatus(s) {
      if (!s.endAt) return 'onsite';
      if (s.noPlate) return 'noplate';
      if (s.noEntry) return 'noentry';
      if (s.missedExit && !s.missedResolved) return 'missed';
      if (needsReview(s)) return 'review';
      if (s.kind === 'permit') return 'permit';
      if (s.vipFree) return 'vip';
      if (s.waived) return 'waived';
      if (s.cited) return 'cited';
      const fee = sessionFee(s), bal = balanceOf(s);
      if (bal > 0) return 'unpaid';
      if (fee === 0 && !extrasOf(s)) return s.validation ? 'validated' : 'free';
      const methods = (s.payments || []).map(p => p.method);
      return methods.includes('autopay') ? 'autopay' : 'paid';
    }

    /* Exact plate first. Look-alike and one-character matches only against cars that entered in the last 24 hours,
       and those matches are held for staff review instead of being billed. */
    function findLive(pl, facId, at) {
      const cands = L('sessions').filter(s => s.facilityId === facId && !s.endAt && !s.noPlate && (s.mode === 'lpr' || (s.paidUntil || 0) > at - 12 * H));
      let hit = cands.filter(s => normPlate(s.plate) === pl);
      if (hit.length) return { s: hit.sort((a, b) => b.startAt - a.startAt)[0], how: 'exact' };
      const c = canon(pl), recent = cands.filter(s => s.startAt && at - s.startAt < 24 * H);
      hit = recent.filter(s => canon(s.plate) === c);
      if (hit.length === 1) return { s: hit[0], how: 'lookalike' };
      hit = recent.filter(s => within1(canon(s.plate), c));
      if (hit.length === 1) return { s: hit[0], how: 'fuzzy' };
      return null;
    }

    /* ---------- camera reads ---------- */
    function planRead(inp) {
      const at = inp.at || now();
      const cam = inp.cameraId ? camera(inp.cameraId) : null;
      const facilityId = inp.facilityId || (cam && cam.facilityId);
      const dir = inp.dir || (cam && cam.direction);
      const f = fac(facilityId);
      if (!f || (dir !== 'in' && dir !== 'out')) return { error: 'Unknown camera, facility or lane direction' };
      const pl = normPlate(inp.plate);
      const unread = NOREAD.test(pl);
      const ops = [];
      let res;
      const base = { facilityId, cameraId: cam ? cam.id : null, createdAt: at };
      if (dir === 'in') {
        if (unread) {
          const id = uid('s');
          ops.push({ type: 'set', coll: 'sessions', id, data: Object.assign({ plate: 'NOREAD', noPlate: true, mode: 'lpr', kind: 'unknown', ticket: ticketNo(), startAt: at, endAt: null, payments: [] }, base) });
          res = { level: 'warn', text: 'Vehicle entered without a readable plate, counted as unknown', sessionId: id };
        } else {
          const live = ofPlate(pl).filter(s => s.facilityId === facilityId && !s.endAt).sort((a, b) => b.startAt - a.startAt)[0];
          if (live && live.mode === 'lpr' && at - live.startAt < 3 * M) {
            res = { level: 'info', text: 'Duplicate entry read ignored', sessionId: live.id, duplicate: true };
          } else {
            const permit = validPermitFor(pl, facilityId);
            const vip = permit ? null : vipForPlate(pl, facilityId);
            const member = memberForPlate(pl);
            const kind = permit ? 'permit' : vip ? 'vip' : member ? 'member' : 'visitor';
            const resv = reservationFor(pl, facilityId, at);
            let note = '';
            if (live && live.mode === 'lpr') {
              ops.push({ type: 'update', coll: 'sessions', id: live.id, data: { endAt: at, missedExit: true, fee: null } });
              if (live.reservationId) ops.push({ type: 'update', coll: 'reservations', id: live.reservationId, data: { status: 'completed', completedAt: at } });
              note = ' (earlier visit sent to review: its exit was never read)';
            }
            if (live && live.mode === 'prepaid') {
              ops.push({ type: 'update', coll: 'sessions', id: live.id, data: { mode: 'lpr', startLpr: true, prepaidAt: live.startAt, startAt: at, kind, entryCameraId: base.cameraId, entryPhotoId: inp.photoId || null } });
              res = { level: 'ok', text: 'Prepaid visitor entered', sessionId: live.id };
            } else {
              const id = uid('s');
              ops.push({ type: 'set', coll: 'sessions', id, data: Object.assign({ plate: pl, mode: 'lpr', kind, ticket: ticketNo(), rates: snapRates(f), startAt: at, endAt: null, payments: [], permitId: permit ? permit.id : null, memberId: member ? member.id : null, vipId: vip ? vip.id : null, vipFree: !!(vip && vip.freeParking), entryCameraId: base.cameraId, entryPhotoId: inp.photoId || null, validation: null, reservationId: resv ? resv.id : null }, base) });
              res = { level: kind === 'visitor' ? 'info' : 'ok', text: (resv ? 'Reservation ' + resv.code + ' arrived' : kind === 'permit' ? 'Monthly parker entered' : kind === 'vip' ? 'VIP entered: ' + (vip.name || '') + (vip.note ? ' (' + vip.note + ')' : '') : kind === 'member' ? 'Autopay member entered' : 'Visitor entered') + note, sessionId: id };
              if (resv) ops.push({ type: 'update', coll: 'reservations', id: resv.id, data: { status: 'arrived', arrivedAt: at, sessionId: id } });
            }
            const hot = isHot(pl);
            if (hot) { res.level = 'bad'; res.text += ' · HOT LIST: ' + money(hot.total) + ' owed'; res.hot = { plate: pl, total: hot.total }; }
          }
        }
      } else {
        if (unread) {
          const np = L('sessions').filter(s => s.facilityId === facilityId && !s.endAt && s.noPlate).sort((a, b) => a.startAt - b.startAt)[0];
          if (np) { ops.push({ type: 'update', coll: 'sessions', id: np.id, data: { endAt: at, fee: 0, exitCameraId: base.cameraId } }); res = { level: 'warn', text: 'Unreadable plate exited, matched to an unknown entry', sessionId: np.id }; }
          else { const id = uid('s'); ops.push({ type: 'set', coll: 'sessions', id, data: Object.assign({ plate: 'NOREAD', noPlate: true, noEntry: true, mode: 'lpr', kind: 'unknown', ticket: ticketNo(), startAt: null, endAt: at, fee: 0, payments: [] }, base) }); res = { level: 'bad', text: 'Unreadable plate exited with no matching entry. Count may be off, consider a recount.', sessionId: id }; }
        } else {
          const recent = L('sessions').find(s => s.facilityId === facilityId && s.endAt && at - s.endAt < 3 * M && at >= s.endAt && normPlate(s.exitPlate || s.plate) === pl);
          const m = recent ? null : findLive(pl, facilityId, at);
          if (recent) res = { level: 'info', text: 'Duplicate exit read ignored', sessionId: recent.id, duplicate: true };
          else if (!m) {
            const id = uid('s');
            ops.push({ type: 'set', coll: 'sessions', id, data: Object.assign({ plate: pl, noEntry: true, mode: 'lpr', kind: 'visitor', ticket: ticketNo(), startAt: null, endAt: at, fee: 0, payments: [], exitCameraId: base.cameraId }, base) });
            res = { level: 'bad', text: 'Exit with no matching entry. Not charged. Review entry camera.', sessionId: id };
          } else {
            const s = m.s;
            const fee = freeKind(s) ? 0 : stayCharge(s, at, s.validation);
            const paid = paidOf(s); let bal = Math.max(0, round2(fee + extrasOf(s) - paid));
            const payments = (s.payments || []).slice();
            const member = s.memberId ? L('members').find(x => x.id === s.memberId) : memberForPlate(normPlate(s.plate));
            if (s.waived) { res = { level: 'ok', text: 'Exited, balance waived' }; bal = 0; }
            else if (bal > 0 && m.how !== 'exact') res = { level: 'warn', text: 'Exit read as ' + pl + ' matched ' + s.plate + ' (' + m.how + '). ' + money(bal) + ' held for staff review, not charged' };
            else if (bal > 0 && member && opts.deferAutopay) {
              const past = cfg().collectPastDue === false ? [] : ofPlate(normPlate(s.plate)).filter(x => x.id !== s.id && x.endAt && balanceOf(x) > 0);
              res = { level: 'ok', text: 'Charging ' + money(bal + sum(past, balanceOf)) + ' to card on file' + (past.length ? ' (includes ' + past.length + ' past-due)' : ''), charge: { memberId: member.id, items: [{ sessionId: s.id, amount: bal }].concat(past.map(x => ({ sessionId: x.id, amount: balanceOf(x) }))) } };
            }
            else if (bal > 0 && member) { payments.push({ amount: bal, at, method: 'autopay' }); res = { level: 'ok', text: 'Charged ' + money(bal) + ' to card on file' }; bal = 0; }
            else if (bal > 0) res = { level: 'bad', text: 'Exited owing ' + money(bal) + ' (not charged)' };
            else if (s.kind === 'permit') res = { level: 'ok', text: 'Monthly parker exited, no charge' };
            else if (s.vipFree) res = { level: 'ok', text: 'VIP exited, no charge' };
            else if (fee === 0) res = { level: 'ok', text: s.validation ? 'Exited, fully validated (' + s.validation.code + ')' : 'Exited within grace period, no charge' };
            else res = { level: 'ok', text: 'Exited, ' + money(fee) + ' already paid' };
            if (m.how !== 'exact' && !(bal > 0)) res.text += ' · matched ' + s.plate + ' (' + m.how + ' read)';
            res.sessionId = s.id;
            const upd = { endAt: at, fee, payments, exitCameraId: base.cameraId, exitPhotoId: inp.photoId || null };
            if (s.reservationId) ops.push({ type: 'update', coll: 'reservations', id: s.reservationId, data: { status: 'completed', completedAt: at } });
            if (m.how !== 'exact') { upd.exitPlate = pl; upd.matchedBy = m.how; }
            ops.push({ type: 'update', coll: 'sessions', id: s.id, data: upd });
          }
        }
      }
      const log = { at, plate: unread ? 'NOREAD' : pl, facilityId, dir, cameraId: base.cameraId, level: res.level, text: res.text, sessionId: res.sessionId || null, confidence: inp.confidence != null ? +inp.confidence : null, photoId: inp.photoId || null };
      if (!res.duplicate) ops.push({ type: 'log', data: log });
      if (cam) ops.push({ type: 'update', coll: 'cameras', id: cam.id, data: { lastReadAt: at, lastPlate: log.plate } });
      return { ops, result: res, log };
    }

    /* ---------- enforcement ---------- */
    function checkPlate(plate, facId, zone) {
      const pl = normPlate(plate), f = fac(facId);
      const permits = permitsForPlate(pl), valid = permits.filter(permitValid);
      const here = valid.find(p => permitCovers(p, facId));
      const vip = vipForPlate(pl, facId);
      const sess = ofPlate(pl).filter(s => s.facilityId === facId && isLive(s)).sort((a, b) => b.startAt - a.startAt)[0];
      const member = memberForPlate(pl);
      const openC = L('citations').filter(c => normPlate(c.plate) === pl && (c.status === 'open' || c.status === 'appeal'));
      const owed = ofPlate(pl).filter(s => s.endAt && balanceOf(s) > 0);
      const r = { plate: pl, facId, level: 'bad', title: 'No permit or payment', lines: [], suggest: 'NOPERMIT', permits, member, openC, owed, sess, vip };
      const dstr = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tzOf(f) });
      if (here) { const t = ptype(here.permitTypeId); r.level = 'ok'; r.title = 'Monthly parker'; r.suggest = null; r.lines.push((t ? t.name : 'Monthly') + ' · #' + here.number + ' · ' + here.holder + (here.companyName ? ' (' + here.companyName + ')' : ''), here.endAt ? 'Ends ' + dstr(here.endAt) : here.paidThrough ? 'Paid through ' + dstr(here.paidThrough - 1) : 'Active'); }
      else if (vip) { r.level = 'ok'; r.title = vip.freeParking ? 'VIP · no charge' : 'VIP'; r.suggest = null; r.lines.push([vip.name, vip.company, vip.note].filter(Boolean).join(' · ')); if (sess && !vip.freeParking) r.lines.push(sess.mode === 'prepaid' ? 'Paid until ' + new Date(sess.paidUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tzOf(f) }) : 'On site since ' + fmtLocal(sess.startAt, f) + ' · ' + money(sessionFee(sess)) + ' accrued'); }
      else if (sess) {
        if (sess.mode === 'prepaid') {
          if (sess.paidUntil > now()) { r.level = 'ok'; r.title = 'Paid session'; r.suggest = null; r.lines.push('Paid until ' + new Date(sess.paidUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tzOf(f) })); }
          else {
            const late = Math.round((now() - sess.paidUntil) / M), g = cfg().enforcementGraceMin != null ? +cfg().enforcementGraceMin : 10;
            if (late <= g) { r.level = 'warn'; r.title = 'Expired, within grace'; r.suggest = null; r.lines.push('Expired ' + late + ' min ago. Grace is ' + g + ' min, so no citation yet.'); }
            else { r.title = 'Paid time expired'; r.suggest = 'EXPIRED'; r.lines.push('Expired ' + late + ' min ago · paid ' + money(paidOf(sess))); }
          }
        } else {
          r.level = 'ok'; r.suggest = null; r.title = member ? 'Autopay member session' : sess.manual ? 'Ticket open, pays on exit' : 'Active session, pays on exit';
          r.lines.push((sess.manual ? 'Ticket ' + ticketOf(sess) + ' opened ' : 'Entered by camera ') + Math.round((now() - sess.startAt) / M) + ' min ago · ' + money(sessionFee(sess)) + ' accrued');
          if (sess.validation) r.lines.push('Validation ' + sess.validation.code + (sess.validation.tenantName ? ' (' + sess.validation.tenantName + ')' : '') + ' applied');
        }
      } else if (valid.length) { const t = ptype(valid[0].permitTypeId); r.level = 'warn'; r.title = 'Monthly not valid here'; r.suggest = 'WRONGZONE'; r.lines.push('Has ' + (t ? t.name : 'a monthly plan') + ' (#' + valid[0].number + '), which does not cover ' + (f ? f.name : 'this facility')); }
      else if (permits.length) r.lines.push('Monthly #' + permits[0].number + ' is ' + (permits[0].status === 'active' ? 'ended' : permits[0].status === 'suspended' ? 'suspended for non-payment' : permits[0].status));
      if (openC.length) r.lines.push(openC.length + ' open citation' + (openC.length > 1 ? 's' : '') + ' · ' + money(sum(openC, c => c.fine)) + ' outstanding');
      if (owed.length) r.lines.push(owed.length + ' unpaid parking balance' + (owed.length > 1 ? 's' : '') + ' · ' + money(sum(owed, balanceOf)));
      if (zone === 'reserved') {
        const rv = activeReservation(pl, facId);
        if (rv) { r.level = 'ok'; r.title = 'Reservation holder'; r.suggest = null; r.lines.unshift('Reservation ' + rv.code + ' · ' + rv.name + ' · until ' + new Date(rv.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tzOf(f) })); }
        else { r.level = 'bad'; r.title = 'No reservation for the reserved section'; r.suggest = 'RESERVEDZONE'; }
      }
      const hot = isHot(pl); if (hot) { r.hot = hot; r.lines.push('Hot list: ' + money(hot.total) + ' owed across ' + hot.count + ' item' + (hot.count > 1 ? 's' : '')); }
      r.towEligible = openC.length >= 3 || !!hot;
      return r;
    }
    /* What a plate check found, for the patrol log: a violator (the check suggests a notice) or not, and why in a word or two. */
    function checkKind(r) {
      if (!r) return { violator: false, kind: 'other', label: 'Checked' };
      if (r.suggest) return { violator: true, kind: String(r.suggest).toLowerCase(), label: r.title };
      const t = r.title || '';
      if (/^Monthly parker/.test(t)) return { violator: false, kind: 'monthly', label: 'Monthly parker' };
      if (/^VIP/.test(t)) return { violator: false, kind: 'vip', label: 'VIP' };
      if (/^Reservation/.test(t)) return { violator: false, kind: 'reservation', label: 'Reservation' };
      if (/within grace/.test(t)) return { violator: false, kind: 'grace', label: 'In grace period' };
      if (/^Paid session/.test(t)) return { violator: false, kind: 'paid', label: 'Paid' };
      if (r.sess && r.sess.validation) return { violator: false, kind: 'validated', label: 'Validated' };
      if (r.sess) return { violator: false, kind: 'exit', label: 'Pays on exit' };
      return { violator: false, kind: 'other', label: t || 'OK' };
    }

    /* ---------- validations & tenants ---------- */
    /* A code can be redeemed only inside its validity window and at its locations. What it pays for is separate. */
    function findValidation(code, facilityId, at) {
      const c = String(code || '').trim().toUpperCase(); at = at || now();
      const v = L('validations').find(x => x.code === c);
      if (!v) return { error: 'That validation code does not exist.' };
      if (!v.active) return { error: 'That validation code is turned off.' };
      if (v.validFrom && v.validFrom > at) return { error: 'That validation code can’t be used before ' + new Date(v.validFrom).toLocaleDateString('en-US') + '.' };
      if (v.expiresAt && v.expiresAt < at) return { error: 'That validation code has expired.' };
      if (+v.maxUses && (v.uses || 0) >= v.maxUses) return { error: 'That validation code has reached its limit.' };
      const t = v.tenantId ? tenant(v.tenantId) : null;
      const facs = Array.isArray(v.facilityIds) && v.facilityIds.length ? v.facilityIds : (t && t.facilityId ? [t.facilityId] : []);
      if (facilityId && facs.length && !facs.includes(facilityId)) return { error: 'This code is only valid at ' + facs.map(id => (fac(id) || {}).name || 'another location').join(', ') + '.' };
      return { v, t };
    }
    const validationText = v => v.type === 'hours' ? v.value + ' free hour' + (+v.value === 1 ? '' : 's') : v.type === 'percent' ? v.value + '% off' : v.type === 'dollar' ? money(v.value) + ' off' : v.type === 'fixed' ? 'pay ' + money(v.value) + ' flat' : 'full stay covered';
    function planApplyValidation(s, code, source, o) {
      o = o || {};
      if (!s) return { error: 'No current stay found for that plate.' };
      if (s.validation && !o.replace) return { error: 'This stay already has validation ' + s.validation.code + ' applied. Staff can replace it with a reason.' };
      if (s.validation && o.replace && !String(o.reason || '').trim()) return { error: 'Give a reason for replacing the validation.' };
      if (s.endAt && s.fee != null && balanceOf(s) <= 0 && paidOf(s) > 0) return { error: 'This ticket is already paid in full. Refund it instead of validating it.' };
      const fv = findValidation(code, s.facilityId); if (fv.error) return fv;
      const v = fv.v, t = fv.t;
      // On event nights only codes marked for event nights work; the rest are refused for that stay.
      const ev = eventAt(facFor(s), s.startAt);
      if (ev && !v.eventNights) return { error: 'This code doesn’t work on event nights (' + (ev.name || 'event') + ').' };
      const val = { code: v.code, name: v.name || '', type: v.type, value: v.value, department: v.department || (t ? t.name : ''), tenantId: t ? t.id : null, tenantName: t ? t.name : null, at: now(), source: source || 'portal', by: o.by || '' };
      const data = { validation: val, validationHistory: (s.validationHistory || []).concat([Object.assign({}, val, s.validation ? { replaced: s.validation.code, reason: String(o.reason || '') } : {})]).slice(-20),
        history: histAdd(s, { action: s.validation ? 'validation_replaced' : 'validation_applied', by: o.by, detail: (s.validation ? s.validation.code + ' → ' : '') + v.code + ' (' + validationText(v) + ')' + (o.reason ? ' · ' + o.reason : '') }) };
      if (s.endAt && s.fee != null && s.feeOriginal == null) data.fee = freeKind(s) ? 0 : charge(facFor(s), s.startAt, s.endAt, val);
      const ops = [{ type: 'update', coll: 'sessions', id: s.id, data }, { type: 'update', coll: 'validations', id: v.id, data: { uses: (v.uses || 0) + 1 } }];
      return { ops, validation: val };
    }
    const sessionsForTenant = t => {
      const codes = new Set(L('validations').filter(v => v.tenantId === t.id).map(v => v.code));
      return L('sessions').filter(s => s.validation && (s.validation.tenantId === t.id || codes.has(s.validation.code)) && s.startAt && (!t.facilityId || s.facilityId === t.facilityId));
    };
    const sessionsForCode = (code, facilityId) => { const c = String(code || '').toUpperCase(); return L('sessions').filter(s => s.validation && s.validation.code === c && s.startAt && (!facilityId || s.facilityId === facilityId)); };
    /* Cars on site at once for a set of sessions within [from, to). Returns step points. */
    function concurrency(list, from, to) {
      const ev = [];
      let count = 0;
      list.forEach(s => {
        const a = s.startAt, b = s.endAt || now();
        if (b <= from || a >= to) return;
        if (a <= from) count++; else ev.push([a, 1]);
        if (b < to) ev.push([b, -1]);
      });
      ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      const pts = [[from, count]]; let peak = count, peakAt = from;
      ev.forEach(([t, d]) => { count += d; pts.push([t, count]); if (count > peak) { peak = count; peakAt = t; } });
      pts.push([Math.min(to, now()), count]);
      return { pts, peak, peakAt, from, to };
    }
    /* How many cars using one validation code were parked at the same time in [from, to). A car counts from its
       original arrival even if the code was applied later; open visits count until now. Each car counts once. */
    function codeOccupancy(code, facilityId, from, to) {
      const list = sessionsForCode(code, facilityId).filter(s => s.startAt < to && (s.endAt || now()) > from);
      const c = concurrency(list, from, to);
      const stale = list.filter(s => !s.endAt && now() - s.startAt > staleHours() * H);
      return { code: String(code || '').toUpperCase(), list, pts: c.pts, peak: c.peak, peakAt: c.peakAt, from, to, stale, cars: list.length };
    }
    function tenantDays(t, days) {
      const f = fac(t.facilityId) || L('facilities')[0];
      const list = sessionsForTenant(t);
      const out = []; let ds = dayStart(now(), f);
      const starts = [ds];
      for (let i = 1; i < days; i++) { ds = dayStart(ds - H, f); starts.unshift(ds); }
      starts.forEach(s => {
        const e = nextDayStart(s, f), c = concurrency(list, s, e);
        const over = +t.allotment > 0 ? Math.max(0, c.peak - +t.allotment) : 0;
        const cars = list.filter(x => x.startAt >= s && x.startAt < e).length;
        out.push({ start: s, end: e, peak: c.peak, peakAt: c.peakAt, over, charge: round2(over * (+t.overageRate || 0)), cars });
      });
      return out;
    }

    /* ---------- vehicle profile ---------- */
    function vehicleProfile(plate) {
      const pl = normPlate(plate); if (!pl) return null;
      const sessions = ofPlate(pl).sort((a, b) => (b.startAt || b.endAt || 0) - (a.startAt || a.endAt || 0));
      const closed = sessions.filter(s => s.startAt && s.endAt);
      const paid = round2(sum(sessions, paidOf)), debt = plateDebt(pl);
      return { plate: pl, sessions, citations: L('citations').filter(c => normPlate(c.plate) === pl).sort((a, b) => b.issuedAt - a.issuedAt), permits: permitsForPlate(pl), member: memberForPlate(pl), vip: vipForPlate(pl), reservations: L('reservations').filter(r => resPlates(r).includes(pl)).sort((a, b) => b.start - a.start),
        visits: sessions.filter(s => !s.noEntry).length, paid, owed: debt.total, lastSeen: sessions.length ? Math.max(...sessions.map(s => s.endAt || s.startAt || 0)) : null, firstSeen: sessions.length ? Math.min(...sessions.map(s => s.startAt || s.endAt || Infinity)) : null,
        avgMinutes: closed.length ? Math.round(sum(closed, s => (s.endAt - s.startAt) / M) / closed.length) : 0, live: sessions.find(isLive) || null, hot: isHot(pl), ratings: L('ratings').filter(r => normPlate(r.plate) === pl) };
    }

    /* ---------- staff ticket actions ----------
       Every action returns ops and writes a line into the ticket's history. Roles are checked by the caller. */
    const closeData = (s, at) => ({ endAt: at, fee: freeKind(s) ? 0 : stayCharge(s, at, s.validation), exitCameraId: null, exitPhotoId: null, closedManually: true });
    const TICKET = {
      create(a) {
        const pl = normPlate(a.plate), f = fac(a.facilityId), t = now(), startAt = +a.startAt || t;
        if (!pl) return { error: 'Enter the license plate.' };
        if (!f) return { error: 'Choose the location.' };
        if (startAt > t + 5 * M) return { error: 'The arrival time can’t be in the future.' };
        if (t - startAt > 30 * D) return { error: 'The arrival time is more than 30 days ago.' };
        const live = liveForPlate(pl, f.id); if (live) return { error: pl + ' already has an open ticket here (' + ticketOf(live) + ').', sessionId: live.id };
        const permit = validPermitFor(pl, f.id), vip = permit ? null : vipForPlate(pl, f.id), member = memberForPlate(pl);
        const kind = permit ? 'permit' : vip ? 'vip' : member ? 'member' : 'visitor';
        const id = uid('s');
        const data = { plate: pl, facilityId: f.id, mode: 'lpr', kind, manual: true, ticket: ticketNo(), rates: snapRates(f), startAt, endAt: null, payments: [], permitId: permit ? permit.id : null, memberId: member ? member.id : null, vipId: vip ? vip.id : null, vipFree: !!(vip && vip.freeParking), validation: null, notes: String(a.notes || '').slice(0, 500), createdAt: t,
          history: [{ at: t, by: a.by || '', action: 'created', detail: (a.valet ? 'Valet ticket' : 'Manual entry') + (Math.abs(startAt - t) > M ? ', arrival set to ' + fmtLocal(startAt, f) : '') }] };
        if (a.valet) {
          data.valet = { status: 'parked', tag: String(a.tag || '').slice(0, 24), space: String(a.space || '').slice(0, 24), vehicle: String(a.vehicle || '').slice(0, 80), phone: String(a.phone || '').replace(/[^\d+]/g, '').slice(0, 16), parkedAt: t, by: a.by || '' };
          if (+f.valetRate > 0 && !a.noValetFee && !freeKind(data)) data.valetFee = round2(+f.valetRate);
        }
        if (a.code) { const av = planApplyValidation(Object.assign({ id }, data), a.code, 'office', { by: a.by }); if (av.error) return { error: av.error }; Object.assign(data, av.ops[0].data); return { ops: [{ type: 'set', coll: 'sessions', id, data }, av.ops[1]], sessionId: id, ticket: data.ticket, kind }; }
        return { ops: [{ type: 'set', coll: 'sessions', id, data }], sessionId: id, ticket: data.ticket, kind };
      },
      pay(s, a) {
        if (!s) return { error: 'Ticket not found.' };
        if (s.endAt && s.missedExit && !s.missedResolved) return { error: 'Resolve the missed exit first (bill a day or close with no charge).' };
        if (needsReview(s)) return { error: 'Confirm the plate match first.' };
        const due = Math.max(balanceOf(s), entryDue(s)), amt = a.amount != null && a.amount !== '' ? round2(a.amount) : due;
        if (!(amt > 0)) return { error: 'Nothing is owed on this ticket.' };
        if (amt > due + 0.005) return { error: 'That is more than the ' + money(due) + ' owed.' };
        const t = now(), method = METHODS[a.method] ? a.method : 'cash';
        const tendered = a.tendered != null && a.tendered !== '' ? round2(a.tendered) : null;
        if (tendered != null && tendered < amt - 0.005) return { error: 'The cash tendered is less than the amount due.' };
        if (method === 'comp' && !String(a.note || '').trim()) return { error: 'Give a reason for complimentary parking (it goes in the audit trail).' };
        const payment = { amount: amt, at: t, method, by: a.by || '', note: String(a.note || '').slice(0, 200), pid: a.pid || null };
        if (tendered != null) payment.tendered = tendered;
        const data = { payments: (s.payments || []).concat([payment]) };
        let detail = money(amt) + ' ' + (METHODS[method] || method).toLowerCase() + (a.note ? ' · ' + a.note : '');
        if (a.close && !s.endAt) {
          const cd = closeData(s, t), quoted = a.quoted != null && a.quoted !== '' ? round2(a.quoted) : null;
          // The driver paid what the desk quoted; if a rate increment ticked over while they were paying, the quote stands.
          // Only a quote that was correct within the last 10 minutes counts, so nobody can close a ticket cheaply by sending a low "quote".
          if (quoted != null && amt >= quoted - 0.005 && !freeKind(s)) {
            const cap = round2(paidOf(s) + amt - (+s.lateFee || 0) - extrasOf(s)), recent = charge(facFor(s), s.startAt, Math.max(s.startAt, t - 10 * M), s.validation);
            if (cd.fee > cap && cap >= recent - 0.005) { cd.feeQuoted = cd.fee; cd.fee = cap; }
          }
          /* A staff member without manager rights can close a ticket only by collecting everything owed, so a token $1 can't be used to wave a car out. */
          if (a.requireFull && !s.waived && round2((+cd.fee || 0) + extrasOf(s) + (+s.lateFee || 0) - paidOf(s) - amt) > 0.004) return { error: 'Only a manager or owner can close a ticket with money still owed. Collect the full amount, or ask a manager.' };
          Object.assign(data, cd); detail += ' · departed';
        }
        data.history = histAdd(s, { action: 'payment', by: a.by, detail });
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data }], amount: amt, change: tendered != null ? round2(tendered - amt) : null, closed: !!(a.close && !s.endAt) };
      },
      close(s, a) {
        if (!s) return { error: 'Ticket not found.' };
        if (s.endAt) return { error: 'This ticket is already closed.' };
        const at = +a.at || now();
        if (at > now() + M) return { error: 'The departure time can’t be in the future.' };
        if (s.startAt && at < s.startAt) return { error: 'The departure time is before the arrival time.' };
        if (now() - at > 15 * M && !a.allowBackdate) return { error: 'A departure more than 15 minutes ago needs a manager (it changes the fee).' };
        const data = closeData(s, at);
        const bal = Math.max(0, round2(data.fee + extrasOf(s) + (+s.lateFee || 0) - paidOf(s)));
        /* Letting a car out with money still owed is a manager or owner decision, and it always needs a reason. */
        if (bal > 0 && !s.waived) {
          if (!a.allowUnpaid) return { error: 'Only a manager or owner can let a car out with money owed. Collect the payment, apply a validation code, or ask a manager.' };
          if (!String(a.reason || '').trim()) return { error: 'Give a reason for letting this car out unpaid (it is kept in the audit trail).' };
        }
        data.history = histAdd(s, { action: 'departed', by: a.by, detail: (a.reason ? a.reason + ' · ' : '') + (bal > 0 && !s.waived ? money(bal) + ' left unpaid' : 'nothing owed') + (Math.abs(at - now()) > M ? ' · time set to ' + fmtLocal(at, fac(s.facilityId)) : '') });
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data }], balance: s.waived ? 0 : bal };
      },
      reopen(s, a) {
        if (!s || !s.endAt) return { error: 'Only a closed ticket can be reopened.' };
        if (!String(a.reason || '').trim()) return { error: 'Give a reason for reopening.' };
        if (!s.startAt) return { error: 'This exit has no arrival to reopen. Create a ticket instead.' };
        const data = { endAt: null, fee: null, feeOriginal: null, exitCameraId: null, exitPhotoId: null, closedManually: null, missedExit: null, missedResolved: null, matchedBy: null, matchConfirmed: null, exitPlate: null, history: histAdd(s, { action: 'reopened', by: a.by, detail: a.reason }) };
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data }] };
      },
      waive(s, a) {
        if (!s) return { error: 'Ticket not found.' };
        if (!String(a.reason || '').trim()) return { error: 'Give a reason for waiving the balance.' };
        if (s.waived) return { error: 'This balance is already waived.' };
        const bal = s.endAt ? balanceOf(s) : round2(sessionFee(s) + extrasOf(s) - paidOf(s));
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { waived: true, waivedAt: now(), waivedBy: a.by || '', waiveReason: String(a.reason).slice(0, 300), waivedAmount: Math.max(0, bal), history: histAdd(s, { action: 'waived', by: a.by, detail: money(Math.max(0, bal)) + ' · ' + a.reason }) } }], amount: Math.max(0, bal) };
      },
      unwaive(s, a) {
        if (!s || !s.waived) return { error: 'This ticket isn’t waived.' };
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { waived: false, waivedAt: null, waivedBy: null, waiveReason: null, waivedAmount: null, history: histAdd(s, { action: 'waive_removed', by: a.by, detail: a.reason || '' }) } }] };
      },
      adjust(s, a) {
        if (!s) return { error: 'Ticket not found.' };
        if (!s.endAt) return { error: 'Fees are adjusted on closed tickets. For an open ticket, apply a validation or waive it.' };
        if (!String(a.reason || '').trim()) return { error: 'Give a reason for the adjustment.' };
        const fee = round2(a.fee); if (!(fee >= 0)) return { error: 'Enter the new parking fee.' };
        const orig = s.feeOriginal != null ? s.feeOriginal : (+s.fee || 0);
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { fee, feeOriginal: orig, adjustedAt: now(), adjustedBy: a.by || '', adjustReason: String(a.reason).slice(0, 300), history: histAdd(s, { action: 'fee_adjusted', by: a.by, detail: money(+s.fee || 0) + ' → ' + money(fee) + ' · ' + a.reason }) } }], fee };
      },
      markCited(s, a) {
        if (!s) return { error: 'Ticket not found.' };
        const c = L('citations').find(x => x.id === a.citationId);
        if (!c || c.sessionId !== s.id || c.status === 'voided') return { error: 'Issue the parking charge notice for this ticket first.' };
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { cited: true, citationId: c.id, history: histAdd(s, { action: 'cited', by: a.by, detail: 'Unpaid balance turned into parking charge notice ' + c.number }) } }] };
      },
      note(s, a) {
        const text = String(a.text || '').trim(); if (!s || !text) return { error: 'Type a note.' };
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { history: histAdd(s, { action: 'note', by: a.by, detail: text }) } }] };
      },
      setPlate(s, a) {
        const pl = normPlate(a.plate); if (!s || !pl) return { error: 'Enter the corrected plate.' };
        if (pl === normPlate(s.plate)) return { error: 'That is the same plate.' };
        if (!String(a.reason || '').trim()) return { error: 'Give a reason for the correction.' };
        if (!s.endAt && liveForPlate(pl, s.facilityId)) return { error: pl + ' already has an open ticket here.' };
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { plate: pl, plateOriginal: s.plateOriginal || s.plate, history: histAdd(s, { action: 'plate_corrected', by: a.by, detail: s.plate + ' → ' + pl + ' · ' + a.reason }) } }] };
      },
      validate(s, a) { return planApplyValidation(s, a.code, a.source || 'office', { by: a.by, reason: a.reason, replace: !!a.replace }); },
      removeValidation(s, a) {
        if (!s || !s.validation) return { error: 'No validation is applied.' };
        if (!String(a.reason || '').trim()) return { error: 'Give a reason for removing the validation.' };
        const data = { validation: null, validationHistory: (s.validationHistory || []).map((h, i, arr) => i === arr.length - 1 ? Object.assign({}, h, { removedAt: now(), removedBy: a.by || '', removeReason: a.reason }) : h), history: histAdd(s, { action: 'validation_removed', by: a.by, detail: s.validation.code + ' · ' + a.reason }) };
        if (s.endAt && s.fee != null && s.feeOriginal == null) data.fee = freeKind(s) ? 0 : charge(facFor(s), s.startAt, s.endAt, null);
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data }] };
      },
      /* Plate review decisions: held matches, missed exits, exits with no entry, stale open visits. */
      review(s, a) {
        if (!s) return { error: 'Ticket not found.' };
        const d = a.decision, by = a.by;
        if (d === 'confirm') { if (!needsReview(s)) return { error: 'Nothing to confirm.' }; return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { matchConfirmed: true, matchConfirmedAt: now(), history: histAdd(s, { action: 'match_confirmed', by, detail: (s.exitPlate || '') + ' confirmed as ' + s.plate + ' · ' + money(balanceOf(Object.assign({}, s, { matchConfirmed: true }))) + ' owed' }) } }] }; }
        if (d === 'reject') { if (!needsReview(s)) return { error: 'Nothing to reject.' }; return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { endAt: null, fee: null, exitPlate: null, matchedBy: null, exitCameraId: null, exitPhotoId: null, history: histAdd(s, { action: 'match_rejected', by, detail: (s.exitPlate || '') + ' was a different car; ' + s.plate + ' is still on site' }) } }] }; }
        if (d === 'billDay' || d === 'noCharge') {
          if (!(s.missedExit && !s.missedResolved)) return { error: 'This ticket isn’t a missed exit.' };
          const f = facFor(s), fee = d === 'noCharge' ? 0 : (+(f && f.rates && f.rates.dailyMax) > 0 ? +f.rates.dailyMax : charge(f, s.startAt, s.startAt + D, s.validation));
          return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { fee: round2(fee), missedResolved: true, missedResolution: d === 'noCharge' ? 'no_charge' : 'bill_day', history: histAdd(s, { action: 'missed_exit_resolved', by, detail: d === 'noCharge' ? 'closed with no charge' : 'billed one day, ' + money(fee) }) } }], fee: round2(fee) };
        }
        if (d === 'sendToReview') { if (s.endAt) return { error: 'This ticket is already closed.' }; return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { endAt: now(), missedExit: true, fee: null, history: histAdd(s, { action: 'sent_to_review', by, detail: 'Exit never read' }) } }] }; }
        if (d === 'createEntry') {
          if (!s.noEntry) return { error: 'This ticket has an entry.' };
          const startAt = +a.startAt; if (!(startAt > 0) || startAt >= s.endAt) return { error: 'Choose an arrival time before the exit.' };
          if (s.endAt - startAt > 30 * D) return { error: 'That arrival is more than 30 days before the exit.' };
          const f = facFor(s), fee = freeKind(s) ? 0 : charge(f, startAt, s.endAt, s.validation);
          return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { noEntry: false, startAt, fee, rates: s.rates || snapRates(fac(s.facilityId)), history: histAdd(s, { action: 'entry_added', by, detail: 'Arrival set to ' + fmtLocal(startAt, fac(s.facilityId)) + ' · ' + money(fee) }) } }], fee };
        }
        if (d === 'dismiss') return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { reviewed: true, history: histAdd(s, { action: 'dismissed', by, detail: a.reason || '' }) } }] };
        return { error: 'Unknown review decision.' };
      },
      valet(s, a) {
        if (!s || !s.valet) return { error: 'This ticket isn’t a valet ticket.' };
        const flow = { parked: ['requested', 'retrieving'], requested: ['retrieving', 'parked'], retrieving: ['ready', 'parked'], ready: ['delivered', 'retrieving'], delivered: [] };
        const cur = s.valet.status || 'parked', v = Object.assign({}, s.valet);
        if (a.status) {
          if (a.status !== cur && !(flow[cur] || []).includes(a.status)) return { error: 'A ' + cur + ' car can’t go straight to ' + a.status + '.' };
          v.status = a.status; v[a.status + 'At'] = now();
          if (a.status === 'retrieving' && a.by) v.runner = a.by;
        }
        ['tag', 'space', 'vehicle', 'runner', 'phone'].forEach(k => { if (a[k] != null) v[k] = String(a[k]).slice(0, 80); });
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { valet: v, history: histAdd(s, { action: 'valet', by: a.by, detail: a.status && a.status !== cur ? 'Status: ' + a.status : 'Details updated' }) } }] };
      },
    };

    /* ---------- driver portal planners ---------- */
    function liveForPlate(pl, facId) { return ofPlate(pl).filter(s => (!facId || s.facilityId === facId) && isLive(s)).sort((a, b) => b.startAt - a.startAt)[0]; }
    function quote(facilityId, hours, untilEndOfDay, plate) {
      const f = fac(facilityId); if (!f) return 0;
      const t = now(), live = plate ? liveForPlate(normPlate(plate), f.id) : null, from = live && live.paidUntil > t ? live.paidUntil : t;
      const fx = live ? facFor(live) : f;
      const until = untilEndOfDay ? nextDayStart(dayStart(from, fx), fx) : from + hours * H;
      return Math.max(0, round2(charge(Object.assign({}, fx, { rates: Object.assign({}, fx.rates, { graceMin: 0 }) }), live ? live.startAt : t, until, null) - (live ? paidOf(live) : 0)));
    }
    const PORTAL = {
      prepay(a) {
        const pl = normPlate(a.plate), f = fac(a.facilityId), t = now();
        if (!pl) return { error: 'Enter your license plate.' };
        if (!f || f.active === false) return { error: 'Choose where you are parked.' };
        if (f.onlinePrepay === false) return { error: f.name + ' charges you when you leave, so there’s nothing to pay ahead.' };
        const live = liveForPlate(pl, f.id), from = live && live.paidUntil > t ? live.paidUntil : t, fx = live ? facFor(live) : f;
        let until;
        if (a.untilEndOfDay) until = nextDayStart(dayStart(from, fx), fx);
        else { const h = +a.hours; if (!(h > 0 && h <= 72)) return { error: 'Choose how long you are staying.' }; until = from + h * H; }
        // Price the whole stay so far plus the new time, minus what was already paid, so daily maximums still apply.
        const startAt = live ? live.startAt : t, already = live ? paidOf(live) : 0;
        const amt = Math.max(0, round2(charge(Object.assign({}, fx, { rates: Object.assign({}, fx.rates, { graceMin: 0 }) }), startAt, until, null) - already));
        if (!(amt > 0)) return { error: 'Your stay is already covered by the daily maximum until ' + new Date(until).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tzOf(f) }) + '.' };
        const phone = String(a.phone || '').replace(/[^\d+]/g, '').slice(0, 16), sms = !!(a.smsOptIn && phone.length >= 10);
        const pay = { amount: amt, at: t, method: 'online', pid: '__PAY__' };
        let ops, id, ticket;
        if (live) { id = live.id; ticket = ticketOf(live); ops = [{ type: 'update', coll: 'sessions', id, data: Object.assign({ paidUntil: until, payments: (live.payments || []).concat([pay]), reminded: false }, sms ? { phone, smsOptIn: true } : {}) }]; }
        else { id = uid('s'); ticket = ticketNo(); ops = [{ type: 'set', coll: 'sessions', id, data: { plate: pl, facilityId: f.id, mode: 'prepaid', kind: memberForPlate(pl) ? 'member' : 'visitor', ticket, rates: snapRates(f), startAt: t, endAt: null, paidUntil: until, payments: [pay], createdAt: t, extendToken: code6('X') + code6(''), phone: sms ? phone : null, smsOptIn: sms, accountId: a.accountId || null } }]; }
        const when = new Date(until).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tzOf(f) });
        return { ops, sessionId: id, ticket, charge: { amount: amt, kind: live ? 'extend' : 'prepay', ref: pl, plate: pl }, receipt: { title: 'Paid ' + money(amt) + ' for ' + pl, body: f.name + ', paid until ' + when + '. Ticket ' + ticket + '.' + (sms ? ' We’ll text you 15 minutes before it ends.' : ''), sessionId: id } };
      },
      monthlySignup(a) {
        const plan = ptype(a.planId); if (!plan || plan.active === false) return { error: 'Choose a monthly plan.' };
        const name = String(a.name || '').trim(), email = String(a.email || '').trim().toLowerCase();
        const plates = String(a.plates || '').split(',').map(normPlate).filter(Boolean).slice(0, +plan.maxVehicles || 3);
        if (!name || !/.+@.+\..+/.test(email) || !plates.length) return { error: 'Add your name, email and at least one plate.' };
        if (L('permits').some(p => p.permitTypeId === plan.id && String(p.email || '').toLowerCase() === email && ['active', 'pending', 'waitlist', 'suspended'].includes(p.status) && !p.endAt)) return { error: 'You already have this monthly plan or are on its waitlist.' };
        const full = +plan.quota && soldOf(plan) >= +plan.quota, number = newMonthlyNumber();
        if (a.companyId) { const rm = accountRoom(a.companyId, plan.id, { adding: full ? 0 : 1 }); if (rm.error) return { error: rm.error }; const dup = plates.find(pl => permitsForPlate(pl).some(p => ['active', 'approved', 'pending', 'suspended'].includes(p.status) && (!p.endAt || p.endAt > now()))); if (dup) return { error: dup + ' is already on a monthly plan.' }; }
        const f = fac((plan.facilities || [])[0]) || L('facilities')[0], mb = monthBounds(now(), f);
        const first = full ? 0 : round2(+plan.price * (mb.end - now()) / (mb.end - mb.start));
        const data = { number, holder: name, email, phone: String(a.phone || ''), permitTypeId: plan.id, plates, status: full ? 'waitlist' : 'active', billing: a.companyId ? 'company' : 'card', companyId: a.companyId || null, companyName: a.companyName || '', accountId: a.accountId || null, createdAt: now(), startAt: full ? null : now(), endAt: null, paidThrough: full ? null : mb.end, source: a.source || 'portal', firstPaymentId: first > 0 && !a.companyId ? '__PAY__' : null };
        return { ops: [{ type: 'set', coll: 'permits', id: uid('p'), data }], charge: !full && first > 0 && !a.companyId ? { amount: first, kind: 'monthly', ref: number, plate: plates[0] } : null,
          receipt: { title: full ? 'You’re on the waitlist' : 'Monthly parking started', body: full ? plan.name + ' is full. We’ll email you when a spot opens.' : plan.name + ' for ' + plates.join(', ') + '. ' + (first > 0 && !a.companyId ? 'Charged ' + money(first) + ' for the rest of this month. ' : '') + 'After that, ' + money(plan.price) + ' is charged on the 1st of each month.' } };
      },
      cancelMonthly(a) {
        const p = L('permits').find(x => x.id === a.permitId && (a.accountId ? x.accountId === a.accountId : a.companyId ? x.companyId === a.companyId : false));
        if (!p || !['active', 'suspended', 'waitlist', 'pending'].includes(p.status)) return { error: 'That monthly plan can’t be cancelled here.' };
        if (p.status === 'waitlist' || p.status === 'pending') return { ops: [{ type: 'update', coll: 'permits', id: p.id, data: { status: 'cancelled', endAt: now(), cancelledAt: now() } }], receipt: { title: 'Removed from the waitlist', body: 'Monthly #' + p.number + ' is cancelled.' } };
        const plan = ptype(p.permitTypeId), f = fac(plan && (plan.facilities || [])[0]), end = p.paidThrough && p.paidThrough > now() ? p.paidThrough : monthBounds(now(), f).end;
        return { ops: [{ type: 'update', coll: 'permits', id: p.id, data: { endAt: end, cancelledAt: now() } }], receipt: { title: 'Monthly parking cancelled', body: 'Monthly #' + p.number + ' stays active through ' + new Date(end - 1).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) + '. You won’t be charged again.' } };
      },
      validate(a) {
        const pl = normPlate(a.plate); const r = planApplyValidation(liveForPlate(pl), a.code, 'portal');
        if (r.error) return r;
        return { ops: r.ops, receipt: { title: 'Validation applied', body: 'Code ' + r.validation.code + ' covers ' + validationText(r.validation) + ' for ' + pl + '.' } };
      },
      payBalance(a) {
        const s = L('sessions').find(x => x.id === a.sessionId); if (!s) return { error: 'Balance not found.' };
        const bal = balanceOf(s); if (!(bal > 0)) return { error: 'Nothing is owed on this stay.' };
        return { ops: [{ type: 'update', coll: 'sessions', id: s.id, data: { payments: (s.payments || []).concat([{ amount: bal, at: now(), method: 'online', pid: '__PAY__' }]) } }], charge: { amount: bal, kind: 'balance', ref: s.id, plate: normPlate(s.plate) }, receipt: { title: 'Paid ' + money(bal), body: 'Parking balance for ' + s.plate + ' (ticket ' + ticketOf(s) + ') is settled.', sessionId: s.id } };
      },
      payCitation(a) {
        const c = L('citations').find(x => x.id === a.citationId); if (!c || c.status !== 'open') return { error: 'That citation cannot be paid online.' };
        return { ops: [{ type: 'update', coll: 'citations', id: c.id, data: { status: 'paid', paidAt: now(), paidVia: 'online', paymentId: '__PAY__' } }], charge: { amount: c.fine, kind: 'citation', ref: c.number, plate: normPlate(c.plate) }, receipt: { title: 'Paid ' + money(c.fine), body: 'Parking charge notice ' + c.number + ' is paid.' } };
      },
      reserve(a) {
        const f = fac(a.facilityId), pl = normPlate(a.plate), start = +a.start, hours = +a.hours;
        if (!f || !(+f.reservedSpaces > 0)) return { error: 'That garage does not take reservations.' };
        if (!pl) return { error: 'Enter the plate you will arrive in.' };
        if (!(start > now() - 15 * M)) return { error: 'Choose an arrival time in the future.' };
        if (start > now() + 60 * D) return { error: 'Reservations open up to 60 days ahead.' };
        if (!(hours >= 1 && hours <= 24)) return { error: 'Choose a stay between 1 and 24 hours.' };
        const name = String(a.name || '').trim(), email = String(a.email || '').trim().toLowerCase();
        if (!name || !/.+@.+\..+/.test(email)) return { error: 'Add your name and email for the confirmation.' };
        const end = start + hours * H, av = resAvailability(f.id, start, end);
        if (L('reservations').some(r => resActive(r) && resPlates(r).includes(pl) && r.start < end && r.end > start)) return { error: pl + ' already has a reservation that overlaps this time.' };
        if (av.left <= 0) return { error: 'The reserved section is full for that time. Try another time or garage.' };
        const premium = round2(+f.reservationPremium || 0), code = code6('R'), est = charge(f, start, end, null);
        const when = new Date(start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tzOf(f) });
        return {
          ops: [{ type: 'set', coll: 'reservations', id: uid('r'), data: { code, facilityId: f.id, plate: pl, plates: [pl], name, email, accountId: a.accountId || null, start, end, hours, premium, estParking: est, status: 'booked', paymentId: premium > 0 ? '__PAY__' : null, createdAt: now() } }],
          charge: premium > 0 ? { amount: premium, kind: 'reservation', ref: code, plate: pl } : null, code,
          receipt: { title: 'Spot reserved · ' + code, body: f.name + ', ' + when + ' for ' + hours + ' hour' + (hours > 1 ? 's' : '') + '. Park in the reserved section. Your reservation fee' + (premium > 0 ? ' of ' + money(premium) : '') + ' is paid; parking is billed at the normal rate when you leave (about ' + money(est) + ' for this stay). Free cancellation until ' + (+f.cancelHours || 2) + ' hours before arrival.' },
        };
      },
      cancelReservation(a) {
        const r = L('reservations').find(x => x.code === String(a.code || '').trim().toUpperCase() && (a.accountId ? x.accountId === a.accountId : String(x.email).toLowerCase() === String(a.email || '').trim().toLowerCase()));
        if (!r) return { error: 'No reservation matches that code and email.' };
        if (r.status !== 'booked') return { error: 'This reservation is ' + r.status.replace('_', ' ') + ' and can’t be cancelled.' };
        const f = fac(r.facilityId), hrs = +(f && f.cancelHours) || 2, refundable = r.start - now() >= hrs * H;
        return { ops: [{ type: 'update', coll: 'reservations', id: r.id, data: { status: 'cancelled', cancelledAt: now(), refunded: refundable && r.premium > 0 } }], refund: refundable && r.premium > 0 && r.paymentId ? { paymentId: r.paymentId, amount: r.premium, ref: r.code } : null,
          receipt: { title: 'Reservation ' + r.code + ' cancelled', body: refundable ? (r.premium > 0 ? 'Your ' + money(r.premium) + ' reservation fee will be refunded to your card.' : 'Nothing was charged.') : 'Cancelled less than ' + hrs + ' hours before arrival, so the reservation fee is not refunded.' } };
      },
      payPermit(a) {
        const p = L('permits').find(x => x.id === a.permitId); if (!p || p.status !== 'approved') return { error: 'That monthly plan is not waiting for payment.' };
        const t = ptype(p.permitTypeId); if (!t) return { error: 'Monthly plan not found.' };
        const f = fac((t.facilities || [])[0]), mb = monthBounds(now(), f), first = round2(+t.price * (mb.end - now()) / (mb.end - mb.start));
        return { ops: [{ type: 'update', coll: 'permits', id: p.id, data: { status: 'active', startAt: now(), paidThrough: mb.end, paidAt: now(), amountPaid: first, firstPaymentId: '__PAY__' } }], charge: first > 0 ? { amount: first, kind: 'monthly', ref: p.number, plate: (p.plates || [])[0] || '' } : null, receipt: { title: 'Monthly #' + p.number + ' is active', body: t.name + '. ' + (first > 0 ? 'Charged ' + money(first) + ' for the rest of this month. ' : '') + money(t.price) + ' is billed on the 1st of each month.' } };
      },
      appeal(a) {
        const c = L('citations').find(x => x.id === a.citationId); const reason = String(a.reason || '').trim();
        if (!c || c.status !== 'open' || c.appeal) return { error: 'That citation cannot be appealed.' };
        if (normPlate(a.plate) !== normPlate(c.plate)) return { error: 'Enter the plate on the citation to appeal it.' };
        if (reason.length < 10) return { error: 'Please explain in a sentence or two.' };
        return { ops: [{ type: 'update', coll: 'citations', id: c.id, data: { status: 'appeal', appeal: { reason: reason.slice(0, 2000), at: now() } } }], receipt: { title: 'Appeal submitted', body: 'Notice ' + c.number + ' is on hold while staff review your appeal.' } };
      },
      /* Drivers rate a visit from the receipt (1 to 5 stars). One rating per ticket; the plate must match. */
      rate(a) {
        const s = L('sessions').find(x => x.id === a.sessionId || (a.token && x.extendToken === a.token)); const stars = Math.round(+a.stars);
        if (!s) return { error: 'We couldn’t find that visit.' };
        if (a.plate && normPlate(a.plate) !== normPlate(s.plate)) return { error: 'That plate doesn’t match the visit.' };
        if (!(stars >= 1 && stars <= 5)) return { error: 'Choose 1 to 5 stars.' };
        if (s.rating || L('ratings').some(r => r.sessionId === s.id)) return { error: 'This visit is already rated. Thanks!' };
        const id = uid('rt'), comment = String(a.comment || '').trim().slice(0, 500);
        return { ops: [{ type: 'set', coll: 'ratings', id, data: { sessionId: s.id, ticket: ticketOf(s), plate: normPlate(s.plate), facilityId: s.facilityId, stars, comment, at: now() } }, { type: 'update', coll: 'sessions', id: s.id, data: { rating: { stars, at: now() } } }],
          receipt: { title: 'Thanks for the feedback', body: stars >= 4 ? 'Glad it went well.' : 'Sorry it wasn’t a great visit. The parking office reads every comment.' } };
      },
    };
    /* ---------- monthly billing ---------- */
    function monthBounds(t, f) {
      const tz = tzOf(f), p = tzParts(t, tz);
      const start = zoned(p.year, p.month, 1, 0, 0, tz), [ny, nm] = p.month === 12 ? [p.year + 1, 1] : [p.year, p.month + 1];
      return { start, end: zoned(ny, nm, 1, 0, 0, tz), period: `${p.year}-${pad2(p.month)}` };
    }
    /* Everything due for the current month: active monthly parkers whose paid-through date is at or before this month's start. */
    function planMonthlyDue() {
      const t = now(), out = [];
      L('permits').forEach(p => {
        if (!['active', 'suspended'].includes(p.status) || !p.paidThrough || p.billing === 'office') return;
        const plan = ptype(p.permitTypeId); if (!plan) return;
        const f = fac((plan.facilities || [])[0]), mb = monthBounds(t, f);
        if (p.paidThrough > mb.start) return;
        if (p.endAt && p.endAt <= mb.start) return;
        out.push({ permit: p, plan, amount: round2(+plan.price + (+p.lateFeeDue || 0)), period: mb.period, periodEnd: mb.end });
      });
      return out;
    }
    /* First, partial month: the plan price times the share of the month left. */
    const prorate = plan => { const mb = monthBounds(now(), fac((plan.facilities || [])[0]) || L('facilities')[0]); return round2(+plan.price * (mb.end - now()) / (mb.end - mb.start)); };

    /* ---------- accounts: a company, building or garage that manages its own block of monthly parkers ----------
       An account can be tied to locations, limited to certain plans and capped at a number of parkers. These checks run on the
       server for the console, spreadsheet imports, the account link and the driver portal, and again in the pilot page. */
    const HOLDS_SPACE = ['active', 'suspended', 'approved', 'pending'];
    const holdsSpace = p => HOLDS_SPACE.includes(p.status) && (!p.endAt || p.endAt > now());
    /* A monthly number nobody else has. extra: numbers already handed out in the same batch (not saved yet). */
    function newMonthlyNumber(extra) { const have = new Set(L('permits').map(p => String(p.number))); let n, k = 0; do { n = String(k++ < 40 ? 10000 + Math.floor(Math.random() * 89999) : 1000000 + Math.floor(Math.random() * 8999999)); } while (have.has(n) || (extra && extra.has(n))); if (extra) extra.add(n); return n; }
    function accountUsed(companyId, excludeId) { let n = 0; for (const p of L('permits')) if (p.companyId === companyId && p.id !== excludeId && holdsSpace(p)) n++; return n; }
    /* Can this account take `adding` more parkers on this plan? o.used lets a caller that is adding many keep its own running count. */
    function accountRoom(companyId, planId, o) {
      o = o || {}; const co = L('companies').find(c => c.id === companyId); if (!co) return {};
      const plan = ptype(planId), max = +co.maxParkers || 0, used = o.used != null ? o.used : accountUsed(companyId, o.exclude), adding = o.adding == null ? 1 : o.adding;
      const ids = Array.isArray(co.planIds) ? co.planIds : [], locs = Array.isArray(co.facilityIds) ? co.facilityIds : [], names = list => list.map(i => (ptype(i) || fac(i) || {}).name).filter(Boolean).join(', ');
      if (plan && ids.length && !ids.includes(plan.id)) return { error: co.name + ' isn’t set up for the ' + plan.name + ' plan. Its plans: ' + (names(ids) || 'none') + '.', used, max };
      if (plan && locs.length && (plan.facilities || []).length && !(plan.facilities || []).some(f => locs.includes(f))) return { error: 'The ' + plan.name + ' plan isn’t at ' + co.name + '’s location (' + names(locs) + ').', used, max };
      if (max && adding > 0 && used + adding > max) return { error: co.name + ' is at its limit of ' + max + ' parker' + (max === 1 ? '' : 's') + ' (' + used + ' in use). Raise the limit on the account to add more.', used, max };
      return { used, max, left: max ? Math.max(0, max - used) : null };
    }
    /* Add many parkers to one account at once (a pasted list or spreadsheet). Pure: returns what would be saved, row by row.
       rows: [{ name, email, phone, plates, plan? }]; a.planId is the plan for rows that don't name one. a.prorate puts the rest of this
       month on the account's next bill. a.staff lets the office use plans that aren't sold online. */
    function planAccountParkers(a) {
      const co = L('companies').find(c => c.id === a.companyId); if (!co) return { error: 'Account not found.' };
      const rows = Array.isArray(a.rows) ? a.rows.slice(0, 1000) : [], norm = x => String(x || '').trim().toLowerCase(), created = [], skipped = [], ops = [];
      const defPlan = a.planId ? ptype(a.planId) : null, taken = new Map(), numbers = new Set(), sold = {}; let used = accountUsed(co.id);
      for (const p of L('permits')) { numbers.add(String(p.number)); if (['active', 'approved', 'pending', 'suspended'].includes(p.status) && (!p.endAt || p.endAt > now())) (p.plates || []).forEach(pl => taken.set(normPlate(pl), p.number)); }
      const nextNumber = () => { let n, k = 0; do { n = String(k++ < 40 ? 10000 + Math.floor(Math.random() * 89999) : 1000000 + Math.floor(Math.random() * 8999999)); } while (numbers.has(n)); numbers.add(n); return n; };
      rows.forEach((r, i) => {
        const line = i + 1, holder = String(r.name || r.holder || '').trim().slice(0, 80), plates = [...new Set(String(r.plates || r.plate || '').split(/[,;|\s]+/).map(normPlate).filter(Boolean))];
        const key = r.plan || r.planId || r.type, plan = key ? L('permitTypes').find(t => t.id === key || norm(t.name) === norm(key)) : defPlan;
        if (!holder) return skipped.push({ line, reason: 'No name' });
        if (!plates.length) return skipped.push({ line, reason: 'No license plate' });
        if (!plan) return skipped.push({ line, reason: key ? 'Unknown plan “' + key + '”' : 'No plan chosen' });
        if (!a.staff && plan.active === false) return skipped.push({ line, reason: plan.name + ' isn’t open for sign-up' });
        const dup = plates.find(pl => taken.has(pl)); if (dup) return skipped.push({ line, reason: dup + ' is already on monthly #' + taken.get(dup) });
        if (sold[plan.id] == null) sold[plan.id] = +plan.quota ? soldOf(plan) : 0;
        const full = +plan.quota && sold[plan.id] >= +plan.quota, room = accountRoom(co.id, plan.id, { used, adding: full ? 0 : 1 });
        if (room.error) return skipped.push({ line, reason: room.error });
        const f = fac((plan.facilities || [])[0]) || L('facilities')[0], mb = monthBounds(now(), f), email = norm(r.email).slice(0, 200), number = nextNumber();
        const data = { number, holder, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '', phone: String(r.phone || '').trim().slice(0, 30), permitTypeId: plan.id, plates: plates.slice(0, +plan.maxVehicles || 3), companyId: co.id, companyName: co.name, billing: 'company', accountId: null,
          status: full ? 'waitlist' : 'active', createdAt: now(), startAt: full ? null : now(), endAt: null, paidThrough: full ? null : mb.end, source: a.source || 'account', notes: String(r.notes || '').slice(0, 300) };
        if (!full && a.prorate) data.prorateDue = round2(+plan.price * (mb.end - now()) / (mb.end - mb.start));
        plates.forEach(pl => taken.set(pl, number)); if (full) sold[plan.id]++; else { sold[plan.id]++; used++; }
        created.push({ line, holder, plates: data.plates, plan: plan.name, status: data.status, email: data.email });
        ops.push({ type: 'set', coll: 'permits', id: uid('p'), data });
      });
      return { created, skipped, ops };
    }
    const sessionByToken = tok => L('sessions').find(s => tok && s.extendToken === tok && !s.endAt);

    function lookup(plate) {
      const pl = normPlate(plate); if (!pl) return null;
      const fname = id => (fac(id) || {}).name || '';
      const vip = vipForPlate(pl);
      return {
        plate: pl,
        permits: permitsForPlate(pl).map(p => { const t = ptype(p.permitTypeId); return { id: p.id, number: p.number, typeName: t ? t.name : 'Permit', price: t ? +t.price || 0 : 0, status: p.status === 'active' && p.endAt && p.endAt < now() ? 'expired' : p.status, endAt: p.endAt || null, paidThrough: p.paidThrough || null, valid: permitValid(p), due: p.status === 'approved' && t ? prorate(t) : null }; }),
        reservations: L('reservations').filter(r => resPlates(r).includes(pl) && resActive(r)).map(r => ({ start: r.start, end: r.end, status: r.status })),
        member: memberForPlate(pl) ? { autopay: true } : null,
        vip: vip ? { freeParking: !!vip.freeParking } : null,
        live: ofPlate(pl).filter(s => isLive(s) && !s.noPlate).map(s => ({ id: s.id, ticket: ticketOf(s), mode: s.mode, paidUntil: s.paidUntil || null, startAt: s.startAt, fee: sessionFee(s), validation: s.validation ? s.validation.code : null })),
        owed: ofPlate(pl).filter(s => s.endAt && balanceOf(s) > 0).map(s => ({ id: s.id, ticket: ticketOf(s), facilityName: fname(s.facilityId), endAt: s.endAt, balance: balanceOf(s), lateFee: +s.lateFee || 0 })),
        citations: L('citations').filter(c => normPlate(c.plate) === pl && c.status !== 'voided').sort((a, b) => b.issuedAt - a.issuedAt).map(c => ({ id: c.id, photoIds: c.photoIds || [], number: c.number, violationName: c.violationName, fine: c.fine, facilityName: fname(c.facilityId), issuedAt: c.issuedAt, status: c.status, hasAppeal: !!c.appeal, appealDecision: c.appeal && c.appeal.decision || null })),
      };
    }

    return { newMonthlyNumber, accountRoom, accountUsed, planAccountParkers, ROLES, ROLE_NAMES, METHODS, can, canonRole, ticketOf, ticketNo, snapRates, facFor, histAdd, endOfDate, ticketBill, receiptText, extrasOf, freeKind, validPermitFor, vipForPlate, sessionsForCode, codeOccupancy, arAging, vehicleProfile, validationText, staleHours, TICKET, prorate, priceDetail, rateSummary, taxOf, specialQualifies, monthBounds, planMonthlyDue, sessionByToken, needsReview, cfg, plateDebt, isHot, hotList, planCollections, resAvailability, reservationFor, activeReservation, planNoShows, resActive, resPlates, M, H, D, normPlate, canon, uid, round2, money, sum, now, fac, ptype, tenant, camera, tzOf, dayStart, nextDayStart, charge, paidOf, sessionFee, balanceOf, isLive, onSiteSessions, occupancy, spaceUse, homeOf, repeatValidations, isEvent, eventAt, entryDue, permitValid, permitCovers, permitsForPlate, memberForPlate, soldOf, unpaidSessions, exitStatus, findLive, planRead, checkPlate, checkKind, findValidation, planApplyValidation, sessionsForTenant, concurrency, tenantDays, PORTAL, lookup, quote, liveForPlate };
  }
  Rules.emailOk = emailOk; Rules.normPlate = normPlate; Rules.ROLES = ROLES; Rules.ROLE_NAMES = ROLE_NAMES; Rules.can = can; Rules.canonRole = canonRole; Rules.METHODS = METHODS;
  if (typeof module !== 'undefined' && module.exports) module.exports = Rules; else root.ParkRules = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
