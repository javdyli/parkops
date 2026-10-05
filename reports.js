/* Reports tab: every report is a small function that returns columns and rows, filtered by date range,
   location and (where it matters) validation code, with a CSV export. Shared by both builds. */
(function () {
  Object.assign(UI, { report: UI.report || 'revenue', rRange: UI.rRange || 'month', rFac: UI.rFac || '', rCode: UI.rCode || '', rPage: 0 });
  const SHOW = 300;
  const fname = id => (facById(id) || {}).name || '';
  const tk = s => R.ticketOf(s);
  const facOk = id => !UI.rFac || id === UI.rFac || !id;
  const dstr = (t, tz) => t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz }) : '';
  const tstr = (t, tz) => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
  const dayKey = (t, tz) => new Date(t).toLocaleDateString('en-CA', { timeZone: tz || (S.config || {}).timeZone || 'America/Chicago' });
  const fx = n => (Math.round((+n || 0) * 100) / 100).toFixed(2);
  const st = s => (STATUS[R.exitStatus(s)] || [0, R.exitStatus(s)])[1];
  const kindName = { prepay: 'Parking (prepaid)', extend: 'Added time', balance: 'Parking balance', citation: 'Notice', reservation: 'Reservation fee', monthly: 'Monthly parking', autopay: 'Parking (autopay)', pay_all: 'Balances', parking: 'Parking', ticket: 'Parking (booth)', valet: 'Valet' };

  /* One list of every payment. Hosted: the server ledger (cards, cash, monthly, refunds). Pilot page: built from records. */
  function ledger() {
    if (HOSTED && window.hostedLedger) { const l = window.hostedLedger(); if (l) return l; }
    const out = [];
    S.sessions.forEach(s => (s.payments || []).forEach(p => { const t = R.taxOf(p.amount); out.push({ at: p.at, kind: p.method === 'autopay' ? 'autopay' : s.mode === 'prepaid' ? 'prepay' : 'parking', ref: tk(s), ticket: tk(s), plate: s.plate, facilityId: s.facilityId, method: p.method || 'online', amount: +p.amount || 0, tax: t.tax, net: t.net, refunded: 0, by: p.by || '', pid: p.pid || '', sessionId: s.id }); }));
    S.citations.forEach(c => { if (c.status === 'paid' && c.paidAt) { const t = R.taxOf(c.fine); out.push({ at: c.paidAt, kind: 'citation', ref: c.number, plate: c.plate, facilityId: c.facilityId, method: c.paidVia === 'office' ? 'office' : 'online', amount: +c.fine || 0, tax: t.tax, net: t.net, refunded: 0, by: '' }); } });
    S.permits.forEach(p => { if (p.paidAt && +p.amountPaid) { const pl = typeById(p.permitTypeId); const t = R.taxOf(p.amountPaid); out.push({ at: p.paidAt, kind: 'monthly', ref: '#' + p.number, plate: (p.plates || [])[0] || '', facilityId: (pl && (pl.facilities || [])[0]) || '', method: p.billing === 'office' ? 'office' : 'card', amount: +p.amountPaid, tax: t.tax, net: t.net, refunded: 0, by: '' }); } });
    S.reservations.forEach(r => { if (r.paymentId && +r.premium) { const t = R.taxOf(r.premium); out.push({ at: r.createdAt, kind: 'reservation', ref: r.code, plate: r.plate, facilityId: r.facilityId, method: 'online', amount: +r.premium, tax: t.tax, net: t.net, refunded: r.refunded ? +r.premium : 0, by: '' }); } });
    return out.sort((a, b) => b.at - a.at);
  }
  const inRange = (t, from, to) => t >= from && t < to;

  const REPORTS = [
    { id: 'revenue', group: 'Money', name: 'Revenue summary', desc: 'Payments collected by day and type', filters: ['range', 'fac'], run(from, to) {
      const days = new Map();
      ledger().filter(p => inRange(p.at, from, to) && facOk(p.facilityId)).forEach(p => { const k = dayKey(p.at); const d = days.get(k) || { k, parking: 0, monthly: 0, notices: 0, reservations: 0, other: 0, refunds: 0, tax: 0, n: 0 }; const g = ['prepay', 'extend', 'balance', 'autopay', 'pay_all', 'parking', 'ticket', 'valet'].includes(p.kind) ? 'parking' : p.kind === 'monthly' ? 'monthly' : p.kind === 'citation' ? 'notices' : p.kind === 'reservation' ? 'reservations' : 'other'; d[g] += p.amount; d.refunds += p.refunded || 0; d.tax += p.tax || 0; d.n++; days.set(k, d); });
      const rows = [...days.values()].sort((a, b) => b.k.localeCompare(a.k)).map(d => [d.k, d.n, fx(d.parking), fx(d.monthly), fx(d.notices), fx(d.reservations), fx(d.other), fx(d.refunds), fx(d.parking + d.monthly + d.notices + d.reservations + d.other - d.refunds), fx(d.tax)]);
      const tot = [...days.values()].reduce((a, d) => ({ n: a.n + d.n, p: a.p + d.parking, m: a.m + d.monthly, c: a.c + d.notices, r: a.r + d.reservations, o: a.o + d.other, rf: a.rf + d.refunds, t: a.t + d.tax }), { n: 0, p: 0, m: 0, c: 0, r: 0, o: 0, rf: 0, t: 0 });
      return { cols: ['Day', 'Payments', 'Parking', 'Monthly', 'Notices', 'Reservations', 'Other', 'Refunds', 'Net', 'Sales tax'], rows, totals: ['Total', tot.n, fx(tot.p), fx(tot.m), fx(tot.c), fx(tot.r), fx(tot.o), fx(tot.rf), fx(tot.p + tot.m + tot.c + tot.r + tot.o - tot.rf), fx(tot.t)], note: 'Money collected on the payment date, not the parking date. Net = payments minus refunds. Tax is the sales tax included in those payments' + (HOSTED ? '; card payments come from Square, cash and checks from the exit desk.' : '.') };
    } },
    { id: 'payments', group: 'Money', name: 'Payments', desc: 'Every payment with method, tax and who took it', filters: ['range', 'fac'], run(from, to) {
      const rows = ledger().filter(p => inRange(p.at, from, to) && facOk(p.facilityId)).map(p => [tstr(p.at), kindName[p.kind] || p.kind, p.ref || '', p.plate || '', fname(p.facilityId), ParkRules.METHODS[p.method] || p.method || '', fx(p.amount), fx(p.tax), fx(p.refunded), p.by || '', p.pid && !String(p.pid).startsWith('sim_') ? p.pid : (String(p.pid || '').startsWith('sim_') ? 'simulated' : '')]);
      const tot = rows.reduce((a, r) => a + (+r[6]), 0), rf = rows.reduce((a, r) => a + (+r[8]), 0);
      return { cols: ['When', 'Type', 'Reference', 'Plate', 'Location', 'Method', 'Amount', 'Tax', 'Refunded', 'Taken by', 'Processor id'], rows, totals: ['Total', rows.length + ' payments', '', '', '', '', fx(tot), '', fx(rf), '', ''], note: 'Amounts include sales tax. Refunds are shown on the payment they reverse.' };
    } },
    { id: 'shift', group: 'Money', name: 'Shift close-out', desc: 'Cash, card and checks by attendant and day', filters: ['range', 'fac'], run(from, to) {
      const m = new Map();
      ledger().filter(p => inRange(p.at, from, to) && facOk(p.facilityId) && ['cash', 'card', 'check', 'terminal', 'office', 'comp'].includes(p.method)).forEach(p => { const k = dayKey(p.at) + '|' + (p.by || 'unknown'); const r = m.get(k) || { day: dayKey(p.at), by: p.by || 'unknown', cash: 0, card: 0, check: 0, comp: 0, n: 0 }; r[p.method === 'terminal' || p.method === 'office' ? 'card' : p.method] += p.amount; r.n++; m.set(k, r); });
      const rows = [...m.values()].sort((a, b) => b.day.localeCompare(a.day) || a.by.localeCompare(b.by)).map(r => [r.day, r.by, r.n, fx(r.cash), fx(r.card), fx(r.check), fx(r.comp), fx(r.cash + r.card + r.check)]);
      const t = [...m.values()].reduce((a, r) => ({ n: a.n + r.n, cash: a.cash + r.cash, card: a.card + r.card, check: a.check + r.check, comp: a.comp + r.comp }), { n: 0, cash: 0, card: 0, check: 0, comp: 0 });
      return { cols: ['Day', 'Attendant', 'Payments', 'Cash', 'Card', 'Check', 'Complimentary', 'Total'], rows, totals: ['Total', '', t.n, fx(t.cash), fx(t.card), fx(t.check), fx(t.comp), fx(t.cash + t.card + t.check)], note: 'Payments recorded at the exit desk or valet stand, by the staff account that took them. Compare cash with the drawer count. Online and autopay payments are not shift cash.' };
    } },
    { id: 'waived', group: 'Money', name: 'Waived & adjusted', desc: 'Balances waived, fees changed, notices voided, with reasons', filters: ['range', 'fac'], run(from, to) {
      const rows = [];
      S.sessions.forEach(s => {
        if (s.waived && inRange(s.waivedAt || 0, from, to) && facOk(s.facilityId)) rows.push([tstr(s.waivedAt), 'Balance waived', tk(s), s.plate, fname(s.facilityId), fx(s.waivedAmount != null ? s.waivedAmount : R.sessionFee(s)), fx(0), fx(s.waivedAmount != null ? s.waivedAmount : R.sessionFee(s)), s.waiveReason || '', s.waivedBy || '']);
        if (s.feeOriginal != null && inRange(s.adjustedAt || 0, from, to) && facOk(s.facilityId)) rows.push([tstr(s.adjustedAt), 'Fee adjusted', tk(s), s.plate, fname(s.facilityId), fx(s.feeOriginal), fx(s.fee), fx(s.feeOriginal - s.fee), s.adjustReason || '', s.adjustedBy || '']);
        if (s.missedResolved && s.missedResolution === 'no_charge' && facOk(s.facilityId)) { const h = (s.history || []).find(x => x.action === 'missed_exit_resolved'); if (h && inRange(h.at, from, to)) rows.push([tstr(h.at), 'Missed exit, no charge', tk(s), s.plate, fname(s.facilityId), '', fx(0), '', h.detail || '', h.by || '']); }
        (s.history || []).filter(h => h.action === 'validation_replaced' || h.action === 'validation_removed').forEach(h => { if (inRange(h.at, from, to) && facOk(s.facilityId)) rows.push([tstr(h.at), h.action === 'validation_removed' ? 'Validation removed' : 'Validation replaced', tk(s), s.plate, fname(s.facilityId), '', '', '', h.detail || '', h.by || '']); });
      });
      S.citations.forEach(c => { if (c.status === 'voided' && inRange(c.voidedAt || c.issuedAt, from, to) && facOk(c.facilityId)) rows.push([tstr(c.voidedAt || c.issuedAt), c.appeal && c.appeal.decision === 'approved' ? 'Appeal approved (notice voided)' : 'Notice voided', c.number, c.plate, fname(c.facilityId), fx(c.fine), fx(0), fx(c.fine), c.appeal && c.appeal.reason ? c.appeal.reason : (c.notes || ''), c.officer || '']); });
      S.permits.forEach(p => { (p.history || []).forEach(h => { if (h.action === 'late_fee_waived' && inRange(h.at, from, to)) rows.push([tstr(h.at), 'Monthly late fee waived', '#' + p.number, (p.plates || [])[0] || '', '', '', '', '', h.detail || '', h.by || '']); }); });
      rows.sort((a, b) => Date.parse(b[0]) - Date.parse(a[0]));
      return { cols: ['When', 'Type', 'Ticket / notice', 'Plate', 'Location', 'Before', 'After', 'Given up', 'Reason', 'By'], rows, totals: ['Total', rows.length + ' items', '', '', '', '', '', fx(rows.reduce((a, r) => a + (+r[7] || 0), 0)), '', ''], note: 'Every waiver, adjustment and void needs a reason; it is kept with the ticket. “Given up” is money not collected.' };
    } },
    { id: 'ar', group: 'Money', name: 'Who owes what (A/R aging)', desc: 'Every open balance by age: current, 1–30, 31–60, 61–90, 91+ days', filters: ['fac'], run() {
      const rows = R.arAging().map(r => { const items = UI.rFac ? r.items.filter(i => !i.facilityId || i.facilityId === UI.rFac) : r.items; if (!items.length) return null; const b = [0, 0, 0, 0, 0]; items.forEach(i => { const d = i.days, k = d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4; b[k] += i.amount; }); return [r.label, r.debtorKind, items.length, fx(b[0]), fx(b[1]), fx(b[2]), fx(b[3]), fx(b[4]), fx(b.reduce((a, x) => a + x, 0)), Math.max(...items.map(i => i.days)), items.map(i => `${i.kind} ${i.ref} ${money(i.amount)}`).join('; ')]; }).filter(Boolean);
      const t = rows.reduce((a, r) => a.map((x, i) => x + (+r[i + 3] || 0)), [0, 0, 0, 0, 0, 0]);
      return { cols: ['Debtor', 'Type', 'Items', 'Current', '1–30', '31–60', '61–90', '91+', 'Total', 'Oldest (days)', 'Items'], rows, totals: ['Total', '', rows.reduce((a, r) => a + r[2], 0), fx(t[0]), fx(t[1]), fx(t[2]), fx(t[3]), fx(t[4]), fx(t[5]), '', ''], note: 'Aged from the day each amount became due: the exit for unpaid parking, the issue date for notices, the 1st for monthly parking, the due date for company invoices. Includes late fees.' };
    } },
    { id: 'tax', group: 'Money', name: 'Sales tax', desc: 'Tax collected by month for filing', filters: ['range', 'fac'], run(from, to) {
      const m = new Map();
      ledger().filter(p => inRange(p.at, from, to) && facOk(p.facilityId)).forEach(p => { const k = dayKey(p.at).slice(0, 7); const r = m.get(k) || { k, n: 0, gross: 0, refunds: 0, tax: 0 }; const keep = p.amount ? (p.amount - (p.refunded || 0)) / p.amount : 1; r.n++; r.gross += p.amount; r.refunds += p.refunded || 0; r.tax += (p.tax || 0) * keep; m.set(k, r); });
      const rows = [...m.values()].sort((a, b) => b.k.localeCompare(a.k)).map(r => [r.k, r.n, fx(r.gross), fx(r.refunds), fx(r.gross - r.refunds), fx(r.gross - r.refunds - r.tax), fx(r.tax)]);
      return { cols: ['Month', 'Payments', 'Collected', 'Refunded', 'Net', 'Taxable sales', 'Sales tax'], rows, totals: ['Total', rows.reduce((a, r) => a + r[1], 0), fx(rows.reduce((a, r) => a + +r[2], 0)), fx(rows.reduce((a, r) => a + +r[3], 0)), fx(rows.reduce((a, r) => a + +r[4], 0)), fx(rows.reduce((a, r) => a + +r[5], 0)), fx(rows.reduce((a, r) => a + +r[6], 0))], note: `Rate ${(S.config || {}).taxRate || 0}%, ${(S.config || {}).taxIncluded === false ? 'added at checkout' : 'included in posted prices'}. Texas taxes parking as a service. Add anything collected outside this system before filing, and check the figures with your accountant.` };
    } },
    { id: 'occupancy', group: 'Operations', name: 'Occupancy & length of stay', desc: 'Entries, exits, peak on site and revenue per space by day', filters: ['range', 'fac'], run(from, to) {
      const rows = [];
      S.facilities.filter(f => facOk(f.id)).forEach(f => {
        const tz = tzF(f), fs = S.sessions.filter(s => s.facilityId === f.id && !s.noEntry);
        for (let ds = R.dayStart(from + 12 * H, f); ds < to; ds = R.nextDayStart(ds, f)) {
          const de = R.nextDayStart(ds, f), ins = fs.filter(s => s.startAt >= ds && s.startAt < de), outs = fs.filter(s => s.endAt >= ds && s.endAt < de), c = R.concurrency(fs.filter(s => s.startAt), ds, de);
          const closed = outs.filter(s => s.startAt), avg = closed.length ? sum(closed, s => (s.endAt - s.startAt) / M) / closed.length : 0;
          const rev = sum(fs, s => (s.payments || []).filter(p => p.at >= ds && p.at < de).reduce((a, p) => a + p.amount, 0));
          if (ins.length || outs.length || c.peak) rows.push([dstr(ds + 12 * H, tz), f.name, ins.length, outs.length, c.peak + (+f.baseline || 0), c.peak ? tstr(c.peakAt, tz) : '', +f.capacity ? Math.round((c.peak + (+f.baseline || 0)) / f.capacity * 100) + '%' : '', avg ? Math.round(avg) : '', fx(rev), +f.capacity ? fx(rev / f.capacity) : '']);
        }
      });
      rows.sort((a, b) => Date.parse(b[0]) - Date.parse(a[0]) || a[1].localeCompare(b[1]));
      return { cols: ['Parking day', 'Location', 'Entries', 'Exits', 'Peak on site', 'Peak at', 'Peak %', 'Avg stay (min)', 'Parking revenue', 'Revenue per space'], rows, note: 'Parking days run from each location’s reset time. Peak counts cars the system saw plus the count adjustment. Revenue per space (RevPAS) = parking payments that day ÷ capacity.' };
    } },
    { id: 'exits', group: 'Operations', name: 'Exit audit', desc: 'Every exit: charged, validated, monthly, unpaid or held', filters: ['range', 'fac'], run(from, to) {
      const list = S.sessions.filter(s => s.endAt && inRange(s.endAt, from, to) && facOk(s.facilityId)).sort((a, b) => b.endAt - a.endAt);
      const rows = list.map(s => { const tz = tzF(facById(s.facilityId)); return [tstr(s.endAt, tz), tk(s), s.plate, fname(s.facilityId), tstr(s.startAt, tz), s.startAt ? Math.round((s.endAt - s.startAt) / M) : '', fx(R.sessionFee(s)), fx(R.paidOf(s)), fx(R.balanceOf(s)), s.validation ? s.validation.code : '', st(s), s.exitPlate && s.exitPlate !== s.plate ? `read as ${s.exitPlate}` : '']; });
      const n = k => list.filter(s => R.exitStatus(s) === k).length;
      return { cols: ['Exited', 'Ticket', 'Plate', 'Location', 'Entered', 'Minutes', 'Fee', 'Paid', 'Owed', 'Validation', 'Result', 'Note'], rows, totals: ['Total', list.length + ' exits', '', '', '', '', fx(sum(list, R.sessionFee)), fx(sum(list, R.paidOf)), fx(sum(list, R.balanceOf)), `${list.filter(s => s.validation).length} validated`, `${n('paid') + n('autopay')} paid · ${n('unpaid')} unpaid · ${n('permit')} monthly · ${n('review') + n('missed') + n('noentry')} held`, ''], note: 'One row per exit, whether a camera read it or staff closed the ticket.' };
    } },
    { id: 'open', group: 'Operations', name: 'Open tickets', desc: 'Everything on site right now, oldest first', filters: ['fac'], run() {
      const list = S.sessions.filter(s => !s.endAt && !s.noPlate && facOk(s.facilityId) && (s.mode === 'lpr' || (s.paidUntil || 0) > now() - 12 * H)).sort((a, b) => a.startAt - b.startAt);
      return { cols: ['Ticket', 'Plate', 'Location', 'Type', 'Arrived', 'Hours', 'Accrued', 'Paid', 'Validation', 'Flag'], rows: list.map(s => [tk(s), s.plate, fname(s.facilityId), s.valet ? 'Valet' : s.kind === 'permit' ? 'Monthly' : s.kind === 'vip' ? 'VIP' : s.mode === 'prepaid' ? 'Prepaid' : s.manual ? 'Manual' : 'Camera', tstr(s.startAt, tzF(facById(s.facilityId))), ((now() - s.startAt) / H).toFixed(1), fx(R.sessionFee(s)), fx(R.paidOf(s)), s.validation ? s.validation.code : '', now() - s.startAt > R.staleHours() * H && s.kind !== 'permit' ? 'over ' + R.staleHours() + ' h' : '']), note: `Tickets open longer than ${R.staleHours()} hours are flagged: check for a missed exit read before they distort occupancy.` };
    } },
    { id: 'cameras', group: 'Operations', name: 'Camera reads', desc: 'Reads per camera with problems', filters: ['range', 'fac'], run(from, to) {
      const rows = S.cameras.filter(c => facOk(c.facilityId)).map(c => { const rs = S.feed.filter(r => r.cameraId === c.id && inRange(r.at, from, to)); return [c.name, fname(c.facilityId), c.direction === 'in' ? 'Entry' : 'Exit', rs.length, rs.filter(r => r.plate === 'NOREAD').length, rs.filter(r => r.confidence != null && r.confidence < 85).length, rs.filter(r => r.level === 'bad').length, rs.filter(r => r.level === 'warn').length, c.lastReadAt ? tstr(c.lastReadAt) : 'never']; });
      return { cols: ['Camera', 'Location', 'Lane', 'Reads', 'No plate', 'Low confidence', 'Problems', 'Warnings', 'Last read'], rows, note: 'Counted from the recent read log kept in the console (the last 100 reads), so long ranges undercount. The hosted server keeps a full read history for 400 days.' };
    } },
    { id: 'customers', group: 'Customers', name: 'Customers & vehicles', desc: 'Every plate seen, with visits, spend and balance', filters: ['range', 'fac'], run(from, to) {
      const m = new Map();
      S.sessions.filter(s => !s.noPlate && inRange(s.startAt || s.endAt || 0, from, to) && facOk(s.facilityId)).forEach(s => { const p = normPlate(s.plate); const r = m.get(p) || { p, visits: 0, mins: 0, closed: 0, paid: 0, last: 0 }; r.visits++; if (s.startAt && s.endAt) { r.mins += (s.endAt - s.startAt) / M; r.closed++; } r.paid += R.paidOf(s); r.last = Math.max(r.last, s.endAt || s.startAt || 0); m.set(p, r); });
      const rows = [...m.values()].sort((a, b) => b.visits - a.visits).map(r => { const perm = R.validPermitFor(r.p), vip = R.vipForPlate(r.p), mem = R.memberForPlate(r.p), debt = R.plateDebt(r.p), acct = mem ? mem.name : perm ? perm.holder : ''; return [r.p, acct, perm ? 'Monthly' + (perm.companyName ? ' · ' + perm.companyName : '') : vip ? 'VIP' : mem ? 'Autopay' : 'Visitor', r.visits, r.closed ? Math.round(r.mins / r.closed) : '', fx(r.paid), fx(debt.total), debt.cits.length, tstr(r.last), R.isHot(r.p) ? 'hot list' : '']; });
      return { cols: ['Plate', 'Name', 'Type', 'Visits', 'Avg stay (min)', 'Paid', 'Owed', 'Open notices', 'Last seen', 'Flag'], rows, totals: ['Total', '', '', rows.reduce((a, r) => a + r[3], 0), '', fx(rows.reduce((a, r) => a + +r[5], 0)), fx(rows.reduce((a, r) => a + +r[6], 0)), '', '', ''], note: 'Visits in the date range; owed and notices are the plate’s current totals. Names come from monthly plans and autopay accounts; casual visitors have none.' };
    } },
    { id: 'monthly', group: 'Customers', name: 'Monthly parkers', desc: 'Roster with plan, plates, billing and paid-through', filters: ['fac'], run() {
      const rows = S.permits.filter(p => !['cancelled', 'revoked'].includes(p.status) || (p.endAt && p.endAt > now() - 30 * D)).filter(p => { const t = typeById(p.permitTypeId); return !UI.rFac || !t || !(t.facilities || []).length || t.facilities.includes(UI.rFac); }).sort((a, b) => a.holder.localeCompare(b.holder))
        .map(p => { const t = typeById(p.permitTypeId) || {}; const last = S.sessions.filter(s => (p.plates || []).map(normPlate).includes(normPlate(s.plate))).reduce((a, s) => Math.max(a, s.startAt || 0), 0); return ['#' + p.number, p.holder, p.email || '', p.phone || '', p.companyName || '', t.name || '', fx(t.price), (p.plates || []).join(' '), p.status, p.paidThrough ? dstr(p.paidThrough - 1) : '', p.pastDueSince ? 'past due since ' + dstr(p.pastDueSince) : '', p.billing || '', dstr(p.startAt), p.endAt ? dstr(p.endAt - 1) : '', last ? tstr(last) : '']; });
      const active = rows.filter(r => r[8] === 'active');
      return { cols: ['Number', 'Name', 'Email', 'Phone', 'Company', 'Plan', 'Price', 'Plates', 'Status', 'Paid through', 'Past due', 'Billing', 'Started', 'Ends', 'Last visit'], rows, totals: ['Total', rows.length + ' parkers', '', '', '', '', fx(active.reduce((a, r) => a + +r[6], 0)) + '/mo active', '', active.length + ' active', '', rows.filter(r => r[10]).length + ' past due', '', '', '', ''], note: 'Cancelled plans drop off 30 days after they end.' };
    } },
    { id: 'invoices', group: 'Customers', name: 'Company invoices', desc: 'Monthly invoices to companies and their status', filters: ['range'], run(from, to) {
      const rows = S.invoices.filter(i => inRange(i.createdAt || 0, from, to)).sort((a, b) => b.createdAt - a.createdAt).map(i => [i.companyName, i.period, fx(i.amount), fx(i.tax), i.dueDate || '', i.status, i.paidAt ? dstr(i.paidAt) : '', (i.permitIds || []).length, i.suspended ? 'parkers suspended' : '']);
      return { cols: ['Company', 'Month', 'Amount', 'Tax', 'Due', 'Status', 'Paid on', 'Parkers', 'Flag'], rows, totals: ['Total', rows.length + ' invoices', fx(rows.reduce((a, r) => a + +r[2], 0)), '', '', rows.filter(r => r[5] !== 'PAID').length + ' open', '', '', ''], note: 'Invoices are created on the 1st for companies billed by invoice.' + (HOSTED ? ' Status updates from Square automatically.' : ' The pilot page shows sample invoices only.') };
    } },
    { id: 'vip', group: 'Customers', name: 'VIP visits', desc: 'Visits by VIP vehicles and what the free parking was worth', filters: ['range', 'fac'], run(from, to) {
      const rows = [];
      S.vips.forEach(v => { const plates = (v.plates || []).map(normPlate); const vis = S.sessions.filter(s => plates.includes(normPlate(s.plate)) && inRange(s.startAt || 0, from, to) && facOk(s.facilityId)); const worth = sum(vis, s => s.vipFree && s.startAt ? R.charge(R.facFor(s), s.startAt, s.endAt || now(), null) : 0); rows.push([v.name, v.company || '', plates.join(' '), v.freeParking ? 'Free' : 'Flag only', v.active === false ? 'off' : 'on', vis.length, fx(worth), fx(sum(vis, R.paidOf)), vis.length ? tstr(Math.max(...vis.map(s => s.startAt))) : '']); });
      return { cols: ['VIP', 'Company', 'Plates', 'Parking', 'Status', 'Visits', 'Free parking value', 'Paid', 'Last visit'], rows, totals: ['Total', '', '', '', '', rows.reduce((a, r) => a + r[5], 0), fx(rows.reduce((a, r) => a + +r[6], 0)), fx(rows.reduce((a, r) => a + +r[7], 0)), ''], note: 'Free parking value is what those stays would have cost at the standard rate.' };
    } },
    { id: 'ratings', group: 'Customers', name: 'Ratings', desc: 'Driver ratings from receipts', filters: ['range', 'fac'], run(from, to) {
      const list = S.ratings.filter(r => inRange(r.at, from, to) && facOk(r.facilityId)).sort((a, b) => b.at - a.at);
      const avg = list.length ? sum(list, r => r.stars) / list.length : 0, five = list.filter(r => r.stars === 5).length;
      return { cols: ['When', 'Stars', 'Location', 'Plate', 'Ticket', 'Comment'], rows: list.map(r => [tstr(r.at), r.stars, fname(r.facilityId), r.plate, r.ticket || '', r.comment || '']), totals: ['Summary', list.length ? avg.toFixed(2) + ' average' : '', list.length ? Math.round(five / list.length * 100) + '% five stars' : '', list.length + ' ratings', '', ''], note: 'Drivers rate a visit once from their receipt (portal or text link).' };
    } },
    { id: 'validations', group: 'Validations', name: 'Validation redemptions', desc: 'Each code applied: who, when, gross vs net', filters: ['range', 'fac', 'code'], run(from, to) {
      const list = S.sessions.filter(s => s.validation && inRange(s.validation.at || s.startAt || 0, from, to) && facOk(s.facilityId) && (!UI.rCode || s.validation.code === UI.rCode.toUpperCase())).sort((a, b) => (b.validation.at || 0) - (a.validation.at || 0));
      const rows = list.map(s => { const v = s.validation, f = R.facFor(s), end = s.endAt || now(), gross = s.startAt ? R.charge(f, s.startAt, end, null) : 0, net = s.startAt ? R.charge(f, s.startAt, end, v) : 0; return [tstr(v.at), v.code, v.name || v.department || '', v.tenantName || '', tk(s), s.plate, fname(s.facilityId), R.validationText(v), s.startAt ? Math.round((end - s.startAt) / M) : '', fx(gross), fx(net), fx(gross - net), v.by || v.source || '', s.endAt ? '' : 'still parked']; });
      return { cols: ['Applied', 'Code', 'Name', 'Tenant', 'Ticket', 'Plate', 'Location', 'Covers', 'Minutes', 'Gross', 'Net', 'Discount', 'By', 'Note'], rows, totals: ['Total', rows.length + ' redemptions', '', '', '', '', '', '', '', fx(rows.reduce((a, r) => a + +r[9], 0)), fx(rows.reduce((a, r) => a + +r[10], 0)), fx(rows.reduce((a, r) => a + +r[11], 0)), '', ''], note: 'Gross is the standard price of the whole stay; net is what the driver paid after the code. Free time counts from arrival even when the code was entered later. Use this to bill tenants back for validations.' };
    } },
    { id: 'codes', group: 'Validations', name: 'Validation codes summary', desc: 'Uses and discount per code', filters: ['range', 'fac'], run(from, to) {
      const rows = S.validations.map(v => { const list = S.sessions.filter(s => s.validation && s.validation.code === v.code && inRange(s.validation.at || s.startAt || 0, from, to) && facOk(s.facilityId)); const disc = sum(list, s => { const f = R.facFor(s), end = s.endAt || now(); return s.startAt ? R.charge(f, s.startAt, end, null) - R.charge(f, s.startAt, end, s.validation) : 0; }); return [v.code, v.name || '', v.tenantId ? (byId('tenants', v.tenantId) || {}).name || '' : v.department || '', R.validationText(v), v.active ? 'on' : 'off', v.validFrom ? dstr(v.validFrom) : '', v.expiresAt ? dstr(v.expiresAt) : '', v.uses || 0, list.length, fx(disc), list.length ? fx(disc / list.length) : '']; }).sort((a, b) => b[8] - a[8]);
      return { cols: ['Code', 'Name', 'Tenant', 'Covers', 'Status', 'Valid from', 'Until', 'Uses (all time)', 'Uses in range', 'Discount in range', 'Avg discount'], rows, note: 'Discount is the difference between the standard price and what was paid.' };
    } },
    { id: 'codeocc', group: 'Validations', name: 'Validation-code occupancy', desc: 'How many cars with a code were parked at the same time', filters: ['range', 'fac', 'code'], run(from, to) {
      const codes = UI.rCode ? [UI.rCode.toUpperCase()] : [...new Set(S.sessions.filter(s => s.validation).map(s => s.validation.code))].sort();
      const rows = [];
      codes.forEach(code => { S.facilities.filter(f => facOk(f.id)).forEach(f => { const tz = tzF(f); for (let ds = R.dayStart(from + 12 * H, f); ds < to; ds = R.nextDayStart(ds, f)) { const de = R.nextDayStart(ds, f), o = R.codeOccupancy(code, f.id, ds, de); if (o.cars) { const t = S.validations.find(v => v.code === code), tn = t && t.tenantId ? byId('tenants', t.tenantId) : null; rows.push([dstr(ds + 12 * H, tz), code, tn ? tn.name : (t && (t.name || t.department)) || '', f.name, o.cars, o.peak, o.peak ? tstr(o.peakAt, tz) : '', tn && +tn.allotment ? tn.allotment : '', tn && +tn.allotment ? Math.max(0, o.peak - tn.allotment) : '', o.stale.length ? o.stale.length + ' open >' + R.staleHours() + 'h' : '']); } } }); });
      rows.sort((a, b) => Date.parse(b[0]) - Date.parse(a[0]) || a[1].localeCompare(b[1]));
      return { cols: ['Parking day', 'Code', 'Tenant', 'Location', 'Cars', 'Peak at once', 'Peak time', 'Allotment', 'Over', 'Flag'], rows, note: 'Each car counts once, from its arrival to its exit (or now), even if the code was applied later. Cars that arrived before the day but were still parked are included. Peak is the exact highest simultaneous count. Pick a code to see one code; open the Validations & tenants tab for the chart and the tickets behind a day.' };
    } },
    { id: 'tenants', group: 'Validations', name: 'Tenant allotments', desc: 'Peak validated cars per tenant per day, overage charges', filters: ['range', 'fac'], run(from, to) {
      const rows = [];
      S.tenants.filter(t => facOk(t.facilityId)).forEach(t => { const f = facById(t.facilityId) || S.facilities[0]; if (!f) return; const tz = tzF(f), list = R.sessionsForTenant(t); for (let ds = R.dayStart(from + 12 * H, f); ds < to; ds = R.nextDayStart(ds, f)) { const de = R.nextDayStart(ds, f), c = R.concurrency(list, ds, de), cars = list.filter(s => s.startAt >= ds && s.startAt < de).length; if (cars || c.peak) { const over = +t.allotment ? Math.max(0, c.peak - t.allotment) : 0; rows.push([dstr(ds + 12 * H, tz), t.name, f.name, cars, c.peak, c.peak ? tstr(c.peakAt, tz) : '', t.allotment || '', over, fx(over * (+t.overageRate || 0))]); } } });
      rows.sort((a, b) => Date.parse(b[0]) - Date.parse(a[0]));
      return { cols: ['Parking day', 'Tenant', 'Location', 'Validated cars', 'Peak at once', 'Peak time', 'Allotment', 'Over', 'Overage charge'], rows, totals: ['Total', '', '', rows.reduce((a, r) => a + r[3], 0), '', '', '', rows.reduce((a, r) => a + r[7], 0), fx(rows.reduce((a, r) => a + +r[8], 0))], note: 'Overage = cars over the allotment at the daily peak × the tenant’s overage rate.' };
    } },
    { id: 'citations', group: 'Compliance', name: 'Parking charge notices', desc: 'Notices issued, paid, appealed and voided', filters: ['range', 'fac'], run(from, to) {
      const list = S.citations.filter(c => inRange(c.issuedAt, from, to) && facOk(c.facilityId)).sort((a, b) => b.issuedAt - a.issuedAt);
      return { cols: ['Issued', 'Notice', 'Plate', 'State', 'Location', 'Violation', 'Amount', 'Status', 'Paid', 'Officer', 'Photos', 'Appeal'], rows: list.map(c => [tstr(c.issuedAt), c.number, c.plate, c.plateState || '', fname(c.facilityId), c.violationName || c.violation, fx(c.fine), c.status, c.paidAt ? tstr(c.paidAt) : '', c.officer || '', (c.photoIds || []).length, c.appeal ? (c.appeal.decision || 'pending') + (c.appeal.reason ? ': ' + c.appeal.reason : '') : '']), totals: ['Total', list.length + ' notices', '', '', '', '', fx(sum(list, c => c.fine)), `${list.filter(c => c.status === 'paid').length} paid · ${list.filter(c => c.status === 'open').length} open · ${list.filter(c => c.status === 'voided').length} voided`, '', '', '', ''], note: 'Notices are private parking charges under the terms posted at the entrance, not government citations.' };
    } },
    { id: 'reservations', group: 'Compliance', name: 'Reservations', desc: 'Bookings, arrivals, no-shows and refunds', filters: ['range', 'fac'], run(from, to) {
      const list = S.reservations.filter(r => inRange(r.start, from, to) && facOk(r.facilityId)).sort((a, b) => b.start - a.start);
      return { cols: ['Arrival', 'Code', 'Name', 'Email', 'Plate', 'Location', 'Hours', 'Fee', 'Status', 'Refunded'], rows: list.map(r => [tstr(r.start), r.code, r.name, r.email, r.plate, fname(r.facilityId), r.hours, fx(r.premium), r.status, r.refunded ? 'yes' : '']), totals: ['Total', list.length + ' bookings', '', '', '', '', '', fx(sum(list, r => r.status !== 'cancelled' || !r.refunded ? r.premium : 0)), `${list.filter(r => r.status === 'no_show').length} no-shows`, ''] };
    } },
    { id: 'users', group: 'Compliance', name: 'Staff & activity', desc: 'Staff accounts, roles and what they did', filters: ['range'], run(from, to) {
      if (!HOSTED || !window.hostedUsers) return { cols: ['Note'], rows: [['Staff accounts and the activity log live on the hosted server. The pilot page has a single owner login.']] };
      const u = window.hostedUsers(), a = window.hostedAudit();
      if (!u || !a) return { cols: ['Note'], rows: [['Loading…']] };
      const rows = u.map(x => { const mine = a.filter(e => e.actor && e.actor.includes(x.email) && inRange(e.at, from, to)); const by = {}; mine.forEach(e => { by[e.action] = (by[e.action] || 0) + 1; }); return [x.name, x.email, ParkRules.ROLE_NAMES[ParkRules.canonRole(x.role)] || x.role, x.active ? 'on' : 'off', x.last_login ? tstr(x.last_login) : 'never', mine.length, Object.entries(by).sort((p, q) => q[1] - p[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(', ')]; });
      return { cols: ['Name', 'Email', 'Role', 'Account', 'Last sign-in', 'Actions in range', 'Most common'], rows, note: 'Actions come from the activity log (last 5,000 entries).' };
    } },
  ];
  const groups = [...new Set(REPORTS.map(r => r.group))];

  window.vReports = function () {
    const rep = REPORTS.find(r => r.id === UI.report) || REPORTS[0]; UI.report = rep.id;
    const [from, to] = window.dateRange(UI.rRange, UI.rFrom, UI.rTo);
    let out; try { out = rep.run(from, to); } catch (e) { console.error(e); out = { cols: ['Error'], rows: [[e.message]] }; }
    UI.rOut = out; UI.rPage = Math.min(UI.rPage, Math.max(0, Math.ceil(out.rows.length / SHOW) - 1));
    const page = out.rows.slice(UI.rPage * SHOW, (UI.rPage + 1) * SHOW), pages = Math.max(1, Math.ceil(out.rows.length / SHOW));
    const codes = [...new Set(S.validations.map(v => v.code).concat(S.sessions.filter(s => s.validation).map(s => s.validation.code)))].sort();
    const num = v => typeof v === 'number' || /^-?\d+(\.\d+)?%?$/.test(String(v));
    return `<div class="pagehead"><div><h1>Reports</h1><p>Money, operations, customers, validations and compliance. Every report exports to CSV for Excel, your accountant or a tenant.</p></div></div>
    <div class="rep">
      <section class="panel"><div class="rlist" style="padding:6px">${groups.map(g => `<h4>${g}</h4>${REPORTS.filter(r => r.group === g).map(r => `<button data-act="pickReport" data-v="${r.id}" aria-pressed="${r.id === rep.id}"><b>${esc(r.name)}</b><small>${esc(r.desc)}</small></button>`).join('')}`).join('')}</div></section>
      <section class="panel"><div class="panel-h"><h2>${esc(rep.name)}</h2><div class="filters" style="margin-left:auto">
        ${rep.filters.includes('range') ? window.rangeControls('r', UI.rRange, UI.rFrom, UI.rTo) : ''}
        ${rep.filters.includes('fac') ? `<select id="rFac" data-fresh="1" style="width:auto"><option value="">All locations</option>${S.facilities.map(f => `<option value="${f.id}" ${f.id === UI.rFac ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>` : ''}
        ${rep.filters.includes('code') ? `<select id="rCode" data-fresh="1" style="width:auto"><option value="">All codes</option>${codes.map(c => `<option value="${esc(c)}" ${c === UI.rCode ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
        <button class="btn sm pri" data-act="exportReport" data-perm="export">Export CSV</button></div></div>
        ${HOSTED && window.hostedReportNote ? window.hostedReportNote(rep, from, to) : ''}
        ${out.rows.length ? `<div class="tbl-wrap"><table><thead><tr>${out.cols.map((c, i) => `<th ${page.length && num(page[0][i]) ? 'class="r"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${page.map(r => `<tr>${r.map((v, i) => `<td class="${num(v) ? 'r num' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}${out.totals ? `<tr style="font-weight:600;background:var(--surface-2)">${out.totals.map((v, i) => `<td class="${num(v) ? 'r num' : ''}">${esc(v)}</td>`).join('')}</tr>` : ''}</tbody></table></div>` : '<div class="empty">Nothing in this range.</div>'}
        ${pages > 1 ? `<div class="pager"><button class="btn sm" data-act="rPage" data-v="-1" ${UI.rPage === 0 ? 'disabled' : ''}>‹</button><span>Rows ${UI.rPage * SHOW + 1}–${Math.min(out.rows.length, (UI.rPage + 1) * SHOW)} of ${out.rows.length}</span><button class="btn sm" data-act="rPage" data-v="1" ${UI.rPage >= pages - 1 ? 'disabled' : ''}>›</button></div>` : ''}
        ${out.note ? `<div class="foot">${esc(out.note)}</div>` : ''}</section></div>`;
  };
  Object.assign(ACT, {
    pickReport(b) { UI.report = b.dataset.v; UI.rPage = 0; render(); },
    rPage(b) { UI.rPage = Math.max(0, UI.rPage + (+b.dataset.v)); render(); },
    exportReport() { const rep = REPORTS.find(r => r.id === UI.report), out = UI.rOut; if (!out) return; const [from, to] = window.dateRange(UI.rRange, UI.rFrom, UI.rTo); const rows = [out.cols, ...out.rows]; if (out.totals) rows.push(out.totals); if (out.note) rows.push([], ['Note', out.note]); rows.push([], ['Report', rep.name], ['Range', rep.filters.includes('range') ? `${new Date(from).toLocaleDateString('en-CA')} to ${new Date(to - 1).toLocaleDateString('en-CA')}` : 'as of ' + new Date().toLocaleString()], ['Location', UI.rFac ? fname(UI.rFac) : 'All'], ['Exported', new Date().toLocaleString()], ['Organization', campusName()]); saveFile(`${rep.id}-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows)); },
  });
  document.addEventListener('change', e => { const id = e.target.id, v = e.target.value; if (id === 'rRange') { UI.rRange = v; UI.rPage = 0; render(); } if (id === 'rFrom') { UI.rFrom = v; render(); } if (id === 'rTo') { UI.rTo = v; render(); } if (id === 'rFac') { UI.rFac = v; UI.rPage = 0; render(); } if (id === 'rCode') { UI.rCode = v; UI.rPage = 0; render(); } });

  /* Validation-code occupancy panel on the Validations & tenants tab: chart, peak and the tickets behind it. */
  Object.assign(UI, { coCode: UI.coCode || '', coDay: 0 });
  window.vCodeOccupancy = function () {
    const codes = [...new Set(S.sessions.filter(s => s.validation).map(s => s.validation.code))].sort(); if (!codes.length) return '';
    const f0 = S.facilities[0], d0 = f0 ? R.dayStart(now(), f0) : now() - D, busiest = codes.map(c => [c, S.sessions.filter(s => s.validation && s.validation.code === c && (s.endAt || now()) > d0).length]).sort((a, b) => b[1] - a[1])[0][0];
    const code = codes.includes(UI.coCode) ? UI.coCode : busiest, v = S.validations.find(x => x.code === code), tn = v && v.tenantId ? byId('tenants', v.tenantId) : null;
    const facIds = [...new Set(R.sessionsForCode(code).map(s => s.facilityId))], f = facById(UI.coFac) && facIds.includes(UI.coFac) ? facById(UI.coFac) : facById(facIds[0]) || S.facilities[0];
    if (!f) return '';
    const tz = tzF(f), ds = R.dayStart(now(), f) - UI.coDay * D, de = R.nextDayStart(ds, f), o = R.codeOccupancy(code, f.id, ds, de);
    return `<section class="panel"><div class="panel-h"><h2>Cars parked at once, by validation code</h2><div class="filters" style="margin-left:auto"><select id="coCode" data-fresh="1" style="width:auto">${codes.map(c => `<option value="${esc(c)}" ${c === code ? 'selected' : ''}>${esc(c)}${(() => { const x = S.validations.find(y => y.code === c); return x ? ' · ' + (x.name || x.department || '') : ''; })()}</option>`).join('')}</select><select id="coFac" data-fresh="1" style="width:auto">${facIds.map(id => `<option value="${id}" ${id === f.id ? 'selected' : ''}>${esc(fname(id))}</option>`).join('')}</select>
      <div class="daynav"><button class="btn sm" data-act="coDay" data-v="1" aria-label="Previous day">‹</button><b>${UI.coDay === 0 ? 'Today' : fmtDay(ds + 12 * H, tz)}</b><button class="btn sm" data-act="coDay" data-v="-1" ${UI.coDay === 0 ? 'disabled' : ''} aria-label="Next day">›</button></div></div></div>
      <div class="panel-b" style="display:grid;gap:14px">
        <div class="summary-row"><div><small>Cars with ${esc(code)}</small><b>${o.cars}</b></div><div><small>Peak at once</small><b>${o.peak}</b></div><div><small>Peak time</small><b style="font-size:1.1rem">${o.peak ? fmtTime(o.peakAt, tz) : '—'}</b></div>${tn && +tn.allotment ? `<div class="${o.peak > tn.allotment ? 'over' : ''}"><small>Over allotment (${tn.allotment})</small><b>${Math.max(0, o.peak - tn.allotment)}</b></div>` : ''}<div class="${o.stale.length ? 'over' : ''}"><small>Open > ${R.staleHours()} h</small><b>${o.stale.length}</b></div></div>
        <div class="chart">${stepChart({ pts: o.pts, from: ds, to: de, cap: tn && +tn.allotment ? +tn.allotment : 0, capLabel: 'Allotment', tz, label: 'Cars with code ' + code })}</div>
        ${o.list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Ticket</th><th>Plate</th><th>Arrived</th><th>Departed</th><th class="r">Minutes</th><th>Applied</th><th></th></tr></thead><tbody>${o.list.sort((a, b) => a.startAt - b.startAt).map(s => `<tr ${o.stale.includes(s) ? 'class="sel"' : ''}><td class="mono">${esc(tk(s))}</td><td>${plateChip(s.plate)}</td><td class="num">${fmtTime(s.startAt, tz)}</td><td class="num">${s.endAt ? fmtTime(s.endAt, tz) : '<span class="pill info">On site</span>'}</td><td class="r num">${Math.round(((s.endAt || now()) - s.startAt) / M)}</td><td class="num">${s.validation && s.validation.at ? fmtTime(s.validation.at, tz) : '—'}${s.validation && s.validation.by ? `<span class="sub">${esc(s.validation.by)}</span>` : ''}</td><td><button class="btn sm" data-act="openTicket" data-id="${esc(s.id)}">Details</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No cars with this code on this day.</div>'}
        <p class="note" style="margin:0">Counts every car with ${esc(code)} from its arrival to its exit, even if the code was entered later; cars still parked count until now. Rows highlighted have been open more than ${R.staleHours()} hours and may be missed exits. Export the full history from Reports → Validation-code occupancy.</p></div></section>`;
  };
  ACT.coDay = b => { UI.coDay = Math.max(0, Math.min(365, UI.coDay + (+b.dataset.v))); render(); };
  document.addEventListener('change', e => { if (e.target.id === 'coCode') { UI.coCode = e.target.value; UI.coDay = 0; render(); } if (e.target.id === 'coFac') { UI.coFac = e.target.value; render(); } });
})();
