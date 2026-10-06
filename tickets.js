/* Self-parking screens shared by both builds: exit desk, tickets, ticket detail, vehicles, VIP list,
   autopay accounts, plate review and the valet board. Loaded after app.js. */
(function () {
  Object.assign(UI, { spView: UI.spView || 'desk', tkStatus: UI.tkStatus || 'all', tkRange: UI.tkRange || 'today', tkFac: UI.tkFac || '', tkType: UI.tkType || 'all', tkQ: UI.tkQ || '', tkPage: 0, deskQ: '', deskFac: store.get('deskFac') || '', vipQ: '' });
  const PAGE = 50;
  const fname = id => (facById(id) || {}).name || '—';
  const tk = s => R.ticketOf(s);
  const tzS = s => tzF(facById(s.facilityId));
  const statusPill = s => { const st = R.exitStatus(s); const [c, l] = STATUS[st] || ['', st]; return `<span class="pill ${c}">${l}</span>`; };
  const typeTag = s => s.valet ? '<span class="tag">Valet</span>' : s.kind === 'permit' ? '<span class="tag">Monthly</span>' : s.kind === 'vip' ? '<span class="tag">VIP</span>' : s.kind === 'member' ? '<span class="tag">Autopay</span>' : s.mode === 'prepaid' ? '<span class="tag">Prepaid</span>' : s.manual ? '<span class="tag">Manual</span>' : '<span class="tag">Camera</span>';
  const dtLocal = t => { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const ticketLink = s => `<button class="btn sm" data-act="openTicket" data-id="${esc(s.id)}">Details</button>`;

  /* ---------- printing (shared) ---------- */
  let printArea = document.getElementById('printArea');
  if (!printArea) { printArea = document.createElement('div'); printArea.id = 'printArea'; document.body.appendChild(printArea); }
  const pageStyle = document.createElement('style'); document.head.appendChild(pageStyle);
  window.printNow = (html, page) => { printArea.innerHTML = html; pageStyle.textContent = page ? `@page{size:${page};margin:0.35in}` : ''; window.print(); setTimeout(() => { pageStyle.textContent = ''; }, 1000); };
  function receiptHtml(s) {
    const b = R.ticketBill(s), f = facById(s.facilityId), tz = tzS(s), cfg = S.config || {};
    const t = x => x ? new Date(x).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '—';
    const rows = [];
    b.detail.days.forEach(d => rows.push([`Parking ${new Date(d.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })} (${d.minutes} min)${d.capped ? ', daily max' : ''}`, money(d.amount)]));
    if (b.detail.special) rows.push([`${b.detail.special.name} rate`, money(b.detail.special.price)]);
    if (b.detail.freeMinutes) rows.push([`Validation ${s.validation.code}: ${b.detail.freeMinutes} min free`, '']);
    if (b.detail.discount && !b.detail.freeMinutes) rows.push([`Validation ${s.validation ? s.validation.code : ''}`, '-' + money(b.detail.discount)]);
    if (b.adjusted) rows.push(['Fee adjusted', money(b.parking)]);
    if (b.extras) rows.push(['Valet', money(b.extras)]);
    if (b.late) rows.push(['Late fee', money(b.late)]);
    const pays = (s.payments || []).map(p => `<tr><td>Paid ${esc((ParkRules.METHODS[p.method] || p.method || '').toLowerCase())}${p.tendered != null ? ` (tendered ${money(p.tendered)}, change ${money(p.tendered - p.amount)})` : ''}</td><td class="r">${money(p.amount)}</td></tr>`).join('');
    return `<div class="rc"><div class="c">${esc(campusName())}</div><div class="c">${esc(f ? f.name : '')}${f && f.address ? '<br>' + esc(f.address) : ''}</div><h1>PARKING RECEIPT</h1><hr>
      <table><tr><td>Ticket</td><td class="r">${esc(tk(s))}</td></tr><tr><td>Plate</td><td class="r big">${esc(s.plate)}</td></tr><tr><td>In</td><td class="r">${esc(t(s.startAt))}</td></tr><tr><td>Out</td><td class="r">${esc(t(b.end))}</td></tr><tr><td>Time</td><td class="r">${esc(dur(b.minutes * M))}</td></tr></table><hr>
      <table>${rows.map(r => `<tr><td>${esc(r[0])}</td><td class="r">${esc(r[1])}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="r big">${money(b.total)}</td></tr>${b.tax.tax ? `<tr><td colspan="2">${cfg.taxIncluded === false ? `Includes ${money(b.tax.tax)} sales tax (${b.tax.rate}%)` : `Price includes ${money(b.tax.tax)} sales tax (${b.tax.rate}%)`}</td></tr>` : ''}${pays}${b.due > 0 ? `<tr><td><b>Balance due</b></td><td class="r"><b>${money(b.due)}</b></td></tr>` : ''}</table><hr>
      <div class="c">${esc(new Date().toLocaleString('en-US', { timeZone: tz }))}<br>Thank you</div></div>`;
  }
  window.printReceipt = id => { const s = byId('sessions', id); if (!s) return; printArea.style.setProperty('--pw', ((S.config || {}).printerWidth || 3) + 'in'); window.printNow(receiptHtml(s)); };

  /* ---------- date ranges (shared with reports) ---------- */
  window.dateRange = function (range, from, to) {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t0 = d0.getTime();
    if (range === 'today') return [t0, t0 + D];
    if (range === 'yesterday') return [t0 - D, t0];
    if (range === 'week') return [t0 - 6 * D, t0 + D];
    if (range === 'month') return [t0 - 29 * D, t0 + D];
    if (range === 'mtd') { const m = new Date(d0.getFullYear(), d0.getMonth(), 1); return [m.getTime(), t0 + D]; }
    if (range === 'lastmonth') { const m = new Date(d0.getFullYear(), d0.getMonth() - 1, 1), e = new Date(d0.getFullYear(), d0.getMonth(), 1); return [m.getTime(), e.getTime()]; }
    if (range === 'custom') { const a = from ? new Date(from + 'T00:00:00').getTime() : t0 - 29 * D, b = to ? new Date(to + 'T00:00:00').getTime() + D : t0 + D; return [Math.min(a, b), Math.max(a, b)]; }
    return [t0 - 29 * D, t0 + D];
  };
  window.rangeControls = function (prefix, range, from, to) {
    return `<select id="${prefix}Range" data-fresh="1" style="width:auto"><option value="today" ${range === 'today' ? 'selected' : ''}>Today</option><option value="yesterday" ${range === 'yesterday' ? 'selected' : ''}>Yesterday</option><option value="week" ${range === 'week' ? 'selected' : ''}>Last 7 days</option><option value="month" ${range === 'month' ? 'selected' : ''}>Last 30 days</option><option value="mtd" ${range === 'mtd' ? 'selected' : ''}>Month to date</option><option value="lastmonth" ${range === 'lastmonth' ? 'selected' : ''}>Last month</option><option value="custom" ${range === 'custom' ? 'selected' : ''}>Custom…</option></select>
      ${range === 'custom' ? `<input id="${prefix}From" type="date" value="${esc(from || '')}" data-fresh="1" style="width:auto"><input id="${prefix}To" type="date" value="${esc(to || '')}" data-fresh="1" style="width:auto">` : ''}`;
  };

  /* ---------- dialogs ---------- */
  const dlgErrorOrOk = r => r && r.error ? r.error : true;
  /* Email a ticket's receipt to the driver (hosted only: the server sends it). */
  async function emailReceipt(id, email) {
    try {
      const r = await HOSTED.api('POST', '/api/tickets/' + encodeURIComponent(id) + '/emailReceipt', { email });
      toast(r.sent ? `Receipt emailed to ${r.to}` : r.emailConfigured ? `Receipt for ${r.to} is queued` : 'Email isn’t set up yet, so the receipt was saved in Settings → Recent emails instead of sent.', !r.sent && !r.emailConfigured);
      return r;
    } catch (e) { toast(e.message, true); return { error: e.message }; }
  }
  window.emailReceiptDialog = function (id) {
    const s = byId('sessions', id); if (!s) return;
    openForm({ title: 'Email receipt · ' + s.plate, submit: 'Send receipt', fields: [{ id: 'email', label: 'Driver’s email', type: 'email', value: s.receiptEmail || '', required: true, help: 'The receipt shows the ticket, times, charges, tax and every payment.' }],
      onSubmit: async v => { const em = String(v.email || '').trim(); if (!ParkRules.emailOk(em)) return 'Check the email address.'; const r = await emailReceipt(id, em); return r.error || true; } });
  };
  window.payTicketDialog = function (id, opts) {
    const s = byId('sessions', id); if (!s) return; opts = opts || {};
    // Event nights: opts.entry collects the flat event rate at the entrance and leaves the ticket open.
    if (opts.entry) opts.close = false;
    const b = R.ticketBill(s), due = opts.entry ? R.entryDue(s) : b.due; if (!(due > 0)) { toast('Nothing is owed on this ticket.'); return; }
    const methods = [['cash', 'Cash'], ['card', 'Card (external terminal or reader)'], ['check', 'Check']].concat(can('tickets.adjust') ? [['comp', 'Complimentary (no money, reason required)']] : []);
    openForm({ title: opts.entry ? `Event rate ${money(due)} · ${s.plate}` : `Collect ${money(due)} · ${s.plate}`, submit: opts.close && !s.endAt ? 'Collect and close ticket' : opts.entry ? 'Record payment · car stays' : 'Record payment', fields: [
      { id: 'method', label: 'Paid with', type: 'select', options: methods, value: 'cash' },
      { id: 'amount', label: 'Amount ($) · leave as is for full payment', type: 'number', step: '0.01', value: due.toFixed(2), required: true, help: `${money(due)} due${b.tax.tax ? ` (includes ${money(b.tax.tax)} tax)` : ''}. A partial payment leaves the rest owed on the ticket${opts.close && !s.endAt && !can('tickets.adjust') ? ', and only a manager can close a ticket with money still owed, so collect the full amount' : ''}.` },
      { id: 'tendered', label: 'Cash tendered ($)', type: 'number', step: '0.01', value: '', help: 'Type what the driver hands you; change due appears below. Leave blank for exact change.' },
      { id: 'note', label: 'Note (reason, for complimentary)', value: '' },
      ...(HOSTED ? [{ id: 'email', label: 'Email a receipt to (optional)', type: 'email', value: s.receiptEmail || '', help: 'The driver’s email. Leave blank for no email receipt.' }] : []),
    ], extra: `<button type="button" class="btn" id="payExact">Exactly ${money(due)}</button> <span id="changeDue" class="note"></span>`,
    onSubmit: async v => {
      if (v.method === 'comp' && !v.note.trim()) return 'Give a reason for complimentary parking.';
      const em = String(v.email || '').trim(); if (em && !ParkRules.emailOk(em)) return 'Check the email address, or leave it blank.';
      const r = await ticketAction(id, 'pay', { method: v.method, amount: v.method === 'comp' ? due : +v.amount, tendered: v.method === 'cash' && v.tendered !== '' ? +v.tendered : null, note: v.note, close: !!opts.close, quoted: due });
      if (r.error) return r.error;
      UI.deskDone = { id, change: r.change, amount: r.amount }; toast(`${money(r.amount)} recorded${r.change > 0 ? ' · change ' + money(r.change) : ''}${r.closed ? ' · ticket closed' : ''}`);
      if (em) await emailReceipt(id, em);
      if (opts.after) opts.after(r); return true;
    } });
    const upd = () => { const t = +($('#f_tendered', dlgForm) || {}).value, a = +($('#f_amount', dlgForm) || {}).value, el = $('#changeDue', dlgForm); if (el) el.textContent = t > 0 && a > 0 ? (t >= a ? 'Change due ' + money(t - a) : 'Short by ' + money(a - t)) : ''; };
    $('#payExact', dlgForm).onclick = () => { $('#f_tendered', dlgForm).value = due.toFixed(2); $('#f_amount', dlgForm).value = due.toFixed(2); upd(); };
    dlgForm.addEventListener('input', upd);
    setTimeout(() => { const el = $('#f_tendered', dlgForm); if (el) el.focus(); }, 0);
  };
  window.validateTicketDialog = function (id) {
    const s = byId('sessions', id); if (!s) return;
    // On an event night only codes marked for event nights can be applied, so only those are offered.
    const ev = R.eventAt(R.facFor(s), s.startAt);
    const codes = S.validations.filter(v => v.active && !R.findValidation(v.code, s.facilityId).error && (!ev || v.eventNights)).sort((a, b) => a.code.localeCompare(b.code));
    const opts = codes.map(v => [v.code, `${v.code} · ${(v.tenantId && (byId('tenants', v.tenantId) || {}).name) || v.department || v.name || ''} · ${R.validationText(v)}`]);
    if (!opts.length) { toast(ev ? `No event-night codes work at ${fname(s.facilityId)}. Mark a code “Works on event nights” under Validations.` : 'No validation code is valid at ' + fname(s.facilityId) + ' right now.', true); return; }
    openForm({ title: (s.validation ? 'Replace validation on ' : 'Validate ') + s.plate, submit: 'Apply code', fields: [
      { id: 'code', label: 'Validation code', type: 'select', options: opts, value: opts[0][0], help: ev ? `${ev.name || 'Event'} night: only codes that work on event nights are listed.` : 'Only codes valid at ' + fname(s.facilityId) + ' are listed.' },
      ...(s.validation ? [{ id: 'reason', label: `Reason for replacing ${s.validation.code}`, required: true }] : []),
    ], onSubmit: async v => { if (!v.code) return 'Create a validation code first.'; const r = await ticketAction(id, 'validate', { code: v.code, replace: !!s.validation, reason: v.reason }, 'Validation applied'); return dlgErrorOrOk(r); } });
  };
  window.waiveTicketDialog = function (id) {
    const s = byId('sessions', id); if (!s) return;
    openForm({ title: `Waive ${money(s.endAt ? R.balanceOf(s) : R.sessionFee(s) + R.extrasOf(s) - R.paidOf(s))} for ${s.plate}`, submit: 'Waive balance', danger: true, fields: [{ id: 'reason', label: 'Reason (kept in the audit trail)', required: true, help: 'e.g. equipment failure, tenant request, staff error' }],
      onSubmit: async v => dlgErrorOrOk(await ticketAction(id, 'waive', { reason: v.reason }, 'Balance waived')) });
  };
  window.closeTicketDialog = function (id) {
    const s = byId('sessions', id); if (!s || s.endAt) return;
    const due = R.balanceOf(s);
    openForm({ title: due > 0 ? `Let out unpaid · ${tk(s)} · ${s.plate}` : `Close ticket ${tk(s)} · ${s.plate}`, submit: due > 0 ? 'Let out unpaid' : 'Confirm departure', danger: due > 0, fields: [
      { id: 'at', label: 'Departure time', type: 'datetime-local', value: dtLocal(now()), help: can('tickets.adjust') ? '' : 'Up to 15 minutes ago; earlier times need a manager.' },
      { id: 'reason', label: due > 0 ? 'Reason for letting this car out unpaid' : 'Note', value: '', required: due > 0, help: due > 0 ? `${money(due)} is owed. The balance stays on the books and goes to collections, and your name and this reason are kept on the ticket. To take payment instead, close this and use Collect.` : 'Nothing is owed.' },
    ], onSubmit: async v => { const at = v.at ? new Date(v.at).getTime() : now(); const r = await ticketAction(id, 'close', { at, reason: v.reason }, r => r.balance > 0 ? `Closed · ${money(r.balance)} left unpaid` : 'Ticket closed'); return dlgErrorOrOk(r); } });
  };
  window.adjustTicketDialog = function (id) {
    const s = byId('sessions', id); if (!s) return;
    openForm({ title: `Adjust fee · ${tk(s)}`, submit: 'Save adjustment', fields: [{ id: 'fee', label: 'Parking fee ($)', type: 'number', step: '0.01', value: (+s.fee || 0).toFixed(2), required: true }, { id: 'reason', label: 'Reason', required: true }],
      onSubmit: async v => dlgErrorOrOk(await ticketAction(id, 'adjust', { fee: +v.fee, reason: v.reason }, 'Fee adjusted')) });
  };
  const reasonDialog = (id, action, title, submit, ok, extra) => openForm({ title, submit, danger: !!(extra && extra.danger), fields: [...(extra && extra.fields || []), { id: 'reason', label: 'Reason', required: true }],
    onSubmit: async v => dlgErrorOrOk(await ticketAction(id, action, Object.assign({ reason: v.reason }, extra && extra.args ? extra.args(v) : {}), ok)) });
  window.newTicketDialog = function (plate, facilityId, valet) {
    if (!S.facilities.length) { toast('Add a location first.', true); return; }
    const codes = S.validations.filter(v => v.active).sort((a, b) => a.code.localeCompare(b.code));
    openForm({ title: valet ? 'New valet ticket' : 'New ticket (manual entry)', submit: 'Open ticket', fields: [
      { id: 'plate', label: 'License plate', value: plate || '', required: true },
      { id: 'facilityId', label: 'Location', type: 'select', options: S.facilities.filter(f => f.active !== false).map(f => [f.id, f.name]), value: facilityId || UI.deskFac || S.facilities[0].id },
      { id: 'startAt', label: 'Arrival time', type: 'datetime-local', value: dtLocal(now()), help: 'Lost ticket or a car the cameras missed: set when it actually arrived.' },
      { id: 'code', label: 'Validation code (optional)', type: 'select', options: [['', 'None']].concat(codes.map(v => [v.code, `${v.code} · ${R.validationText(v)}`])), value: '' },
      ...(valet ? [{ id: 'vehicle', label: 'Vehicle (make, color)', value: '' }, { id: 'tag', label: 'Key tag #', value: '' }, { id: 'space', label: 'Parked in (row / space)', value: '' }, { id: 'phone', label: 'Guest mobile', type: 'tel', value: '' }] : []),
      { id: 'notes', label: 'Notes', value: '' },
    ], onSubmit: async v => {
      const r = await ticketAction(null, 'create', { plate: v.plate, facilityId: v.facilityId, startAt: v.startAt ? new Date(v.startAt).getTime() : now(), notes: v.notes, code: v.code || null, valet: !!valet, vehicle: v.vehicle, tag: v.tag, space: v.space, phone: v.phone }, r => `Ticket ${r.ticket} opened`);
      if (r.error) return r.error;
      if (!valet) { UI.spView = 'desk'; UI.deskQ = normPlate(v.plate); UI.deskTicket = r.sessionId; UI.deskDone = null; }
      return true;
    } });
  };
  window.vipForm = function (v) {
    v = v || {}; const isNew = !v.id;
    openForm({ title: isNew ? 'Add VIP vehicle' : 'Edit ' + (v.name || 'VIP'), submit: isNew ? 'Add to VIP list' : 'Save', fields: [
      { id: 'name', label: 'Name', value: v.name || '', required: true }, { id: 'company', label: 'Company or reason', value: v.company || '' },
      { id: 'plates', label: 'License plates', value: (v.plates || []).join(', '), required: true, help: 'Separated by commas' },
      { id: 'freeParking', label: 'Parking', type: 'select', options: [['1', 'Free: never charged'], ['0', 'Charged normally, but flagged so staff recognise the car']], value: v.freeParking === false ? '0' : '1' },
      { id: 'facilities', label: 'Applies at', type: 'checks', options: S.facilities.map(f => [f.id, f.name]), value: v.facilities || [], help: 'Select none for every location.' },
      { id: 'note', label: 'Note for staff', value: v.note || '', help: 'Shown on the camera feed and to officers, e.g. “Building owner, greet by name”.' },
      ...(isNew ? [] : [{ id: 'active', label: 'Status', type: 'select', options: [['1', 'On'], ['0', 'Off']], value: v.active === false ? '0' : '1' }]),
    ], extra: isNew ? '' : '<button type="button" class="btn danger" data-dlg="delete">Remove</button>', onExtra: () => write(db => col(db, 'vips').doc(v.id).delete(), 'Removed from the VIP list'),
    onSubmit: x => { const plates = x.plates.split(',').map(normPlate).filter(Boolean); if (!plates.length) return 'Add at least one plate.';
      const data = { name: x.name.trim(), company: x.company.trim(), plates, freeParking: x.freeParking === '1', facilities: x.facilities, note: x.note.trim() };
      if (!isNew) { data.active = x.active === '1'; return write(db => col(db, 'vips').doc(v.id).update(data), 'Saved'); }
      return addDoc('vips', Object.assign(data, { active: true, createdAt: now() }), R.uid('vip')).then(ok => { if (ok) toast(data.name + ' added to the VIP list'); return ok; }); } });
  };

  /* ---------- exit desk ---------- */
  function openTickets(facId) { return S.sessions.filter(s => !s.endAt && !s.noPlate && (!facId || s.facilityId === facId) && (s.mode === 'lpr' || (s.paidUntil || 0) > now() - 12 * H)).sort((a, b) => a.startAt - b.startAt); }
  function deskHits(q) {
    if (!q) return [];
    const pl = normPlate(q), digits = q.replace(/\D/g, '');
    return S.sessions.filter(s => !s.endAt && !s.noPlate && (normPlate(s.plate).includes(pl) || normPlate(tk(s)) === pl || (s.valet && normPlate(s.valet.tag) === pl && pl) || (digits.length >= 4 && s.phone && String(s.phone).replace(/\D/g, '').includes(digits)) || (s.valet && s.valet.phone && digits.length >= 4 && s.valet.phone.replace(/\D/g, '').includes(digits)))).sort((a, b) => a.startAt - b.startAt);
  }
  function checkoutPanel(s) {
    const b = R.ticketBill(s), f = facById(s.facilityId), tz = tzS(s), due = b.due, hosted = !!HOSTED;
    const member = s.memberId ? byId('members', s.memberId) : R.memberForPlate(normPlate(s.plate));
    const terminal = hosted && f && window.terminalCheckout && (f.terminalDeviceId || (HOSTED.terminal && (HOSTED.terminal.defaultDevice || HOSTED.terminal.simulated)));
    const done = UI.deskDone && UI.deskDone.id === s.id ? UI.deskDone : null;
    const pill = s.kind === 'permit' ? '<span class="pill ok">Monthly parker</span>' : s.vipFree ? '<span class="pill ok">VIP · no charge</span>' : s.validation ? `<span class="pill info">Validated · ${esc(s.validation.code)}</span>` : R.needsReview(s) ? '<span class="pill warn">Held for review</span>' : '';
    const hot = R.isHot(normPlate(s.plate));
    const entry = !s.endAt ? R.entryDue(s) : 0, ev = entry > 0 ? R.eventAt(R.facFor(s), s.startAt) : null;
    return `<section class="panel"><div class="panel-h"><h2>${esc(tk(s))}</h2>${pill}${ev ? `<span class="pill info">${esc(ev.name || 'Event')} night</span>` : ''}${hot ? `<span class="pill bad">Hot list · ${money(hot.total)} owed</span>` : ''}<span class="muted" style="font-size:.84rem">${esc(f ? f.name : '')}</span></div>
    <div class="panel-b" style="display:grid;gap:14px">
      <div class="row" style="align-items:center;gap:12px">${plateChip(s.plate)}${typeTag(s)}${s.valet ? `<span class="tag">Key ${esc(s.valet.tag || '—')} · ${esc(s.valet.space || '')}</span>` : ''}</div>
      <div class="due ${due > 0 || entry > 0 ? '' : 'zero'}"><div><small class="muted" style="text-transform:uppercase;letter-spacing:.07em;font-weight:600">${entry > 0 && entry >= due ? 'Event rate due now' : due > 0 ? 'Amount due' : 'Nothing due'}</small><b>${money(entry > 0 && entry >= due ? entry : due)}</b>${b.tax.tax && (due > 0 || entry > 0) ? `<div class="note">Includes ${money(R.taxOf(entry > 0 && entry >= due ? entry : due).tax)} sales tax</div>` : ''}</div>
        <div class="facts" style="flex:1"><div><small>Arrived</small><b>${fmtTime(s.startAt, tz)}</b></div><div><small>Time parked</small><b>${dur(now() - s.startAt)}</b></div><div><small>Rate</small><b>${esc(R.rateSummary(R.facFor(s))[0] || '')}</b>${(() => { const rr = (R.facFor(s) || {}).rates || {}; return +rr.dailyMax > 0 ? `<span class="note">Daily max ${money(rr.dailyMax)}${rr.rolling ? ' per 24 h from arrival' : ' · day resets ' + esc(String(rr.resetTime || '00:00'))}</span>` : ''; })()}</div>${s.mode === 'prepaid' ? `<div><small>Prepaid until</small><b>${fmtTime(s.paidUntil, tz)}</b></div>` : ''}</div></div>
      ${billTable(b, s)}
      ${done ? `<div class="receipt" role="status"><b>Paid ${money(done.amount)}${done.change > 0 ? ' · change due ' + money(done.change) : ''}</b><br>${s.endAt ? 'Ticket closed. ' : ''}<button class="btn sm" data-act="printReceipt" data-id="${esc(s.id)}">Print receipt</button> ${HOSTED ? `<button class="btn sm" data-act="emailReceipt" data-id="${esc(s.id)}" data-perm="tickets">Email receipt</button> ` : ''}<button class="btn sm" data-act="deskClear">Next car <span class="kbd">F2</span></button></div>` : ''}
      ${entry > 0 ? `<div class="receipt" role="status"><b>${esc(ev.name || 'Event')} night: collect ${money(entry)} at the entrance.</b><br>The ticket stays open and the exit is already paid. A car still inside after the ${esc(String(((R.facFor(s) || {}).rates || {}).resetTime || '03:00'))} reset owes the new day when it leaves.</div>
      <div class="row" style="gap:8px"><button class="btn pri lg" data-act="deskPayEntry" data-id="${esc(s.id)}" data-perm="tickets">Collect ${money(entry)} event rate</button>${terminal ? `<button class="btn lg" data-act="deskTerminalEntry" data-id="${esc(s.id)}" data-perm="tickets">Square Terminal</button>` : ''}${S.validations.some(v => v.active && v.eventNights) ? `<button class="btn lg" data-act="validateSession" data-id="${esc(s.id)}" data-perm="tickets">Event-night code</button>` : ''}<button class="btn lg" data-act="openTicket" data-id="${esc(s.id)}">Details</button></div>` : !s.endAt ? `<div class="row" style="gap:8px">
        ${due > 0 ? `<button class="btn pri lg" data-act="deskPay" data-id="${esc(s.id)}" data-perm="tickets">Collect ${money(due)}</button>` : `<button class="btn pri lg" data-act="deskClose" data-id="${esc(s.id)}" data-perm="tickets">Close · nothing due</button>`}
        ${due > 0 && terminal ? `<button class="btn lg" data-act="deskTerminal" data-id="${esc(s.id)}" data-perm="tickets">Square Terminal</button>` : ''}
        ${due > 0 && hosted && member && window.chargeCardOnFile ? `<button class="btn lg" data-act="deskCardOnFile" data-id="${esc(s.id)}" data-perm="tickets">Card on file</button>` : ''}
        ${!s.validation && due > 0 ? `<button class="btn lg" data-act="validateSession" data-id="${esc(s.id)}" data-perm="tickets">Validation code</button>` : ''}
        ${due > 0 ? `<button class="btn lg" data-act="deskClose" data-id="${esc(s.id)}" data-perm="tickets.adjust">Let out unpaid${can('tickets.adjust') ? '' : ' · manager'}</button>` : ''}
        <button class="btn lg" data-act="openTicket" data-id="${esc(s.id)}">Details</button></div>
        <p class="note" style="margin:0">${due > 0 && !can('tickets.adjust') ? 'Only a manager or owner can let a car out with money owed. ' : ''}Cash and external card payments are recorded here and go on the shift report. ${terminal ? 'Square Terminal sends the amount to the booth device for the driver to tap.' : hosted ? 'Add a Square Terminal device ID to this location to charge cards on a terminal.' : ''}</p>` : `<div class="row"><button class="btn" data-act="printReceipt" data-id="${esc(s.id)}">Print receipt</button>${HOSTED ? `<button class="btn" data-act="emailReceipt" data-id="${esc(s.id)}" data-perm="tickets">Email receipt</button>` : ''}<button class="btn" data-act="openTicket" data-id="${esc(s.id)}">Details</button><button class="btn" data-act="deskClear">Next car</button></div>`}
    </div></section>`;
  }
  function billTable(b, s) {
    const tz = tzS(s), d = b.detail, rows = [];
    const win = x => `${new Date(x.start).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz })} – ${new Date(x.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`;
    if (b.prepaidOpen) rows.push([`Prepaid until ${new Date(b.end).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz })}${b.end < now() ? ' · expired' : ''}`, money(b.parking)]);
    else if (d.rule === 'grace') rows.push(['Within the grace period', money(0)]);
    else if (d.rule === 'monthly') rows.push(['Monthly parker', money(0)]);
    else if (d.rule === 'vip') rows.push(['VIP', money(0)]);
    else if (d.rule === 'validated') rows.push([`Validation ${s.validation ? s.validation.code : ''} covers the full stay${d.standard ? ' (' + money(d.standard) + ')' : ''}`, money(0)]);
    else {
      if (d.freeMinutes) rows.push([`First ${d.freeMinutes} min free · validation ${s.validation.code}`, money(0)]);
      d.days.forEach(x => rows.push([`Parking day ${win(x)} · ${x.minutes} min${x.capped ? ' · daily max' : ''}`, money(x.amount), d.special ? 'sup' : '']));
      if (d.special) rows.push([`${d.special.name} rate instead of ${money(d.standard)}`, money(d.special.price)]);
      if (s.validation && d.discount && !d.freeMinutes) rows.push([`Validation ${s.validation.code} (${R.validationText(s.validation)})`, '−' + money(d.discount)]);
    }
    if (b.adjusted) rows.push([`Fee adjusted from ${money(s.feeOriginal)}${s.adjustReason ? ' · ' + s.adjustReason : ''}`, money(b.parking)]);
    if (b.extras) rows.push(['Valet', money(b.extras)]);
    if (b.late) rows.push(['Late fee', money(b.late)]);
    if (b.paid) rows.push(['Paid', '−' + money(b.paid)]);
    if (s.waived) rows.push([`Waived${s.waiveReason ? ' · ' + s.waiveReason : ''}`, '−' + money(Math.max(0, b.total - b.paid))]);
    return `<table class="bill"><tbody>${rows.map(r => `<tr class="${r[2] || ''}"><td>${esc(r[0])}</td><td class="r">${esc(r[1])}</td></tr>`).join('')}<tr class="total"><td>${b.due > 0 ? 'Due now' : 'Total'}${b.tax.tax ? ` <span class="note">(incl. ${money(R.taxOf(b.due > 0 ? b.due : b.total).tax)} tax)</span>` : ''}</td><td class="r">${money(b.due > 0 ? b.due : b.total)}</td></tr></tbody></table>`;
  }
  function vDesk() {
    const facs = S.facilities.filter(f => f.active !== false);
    const q = UI.deskQ, hits = deskHits(q);
    const sel = UI.deskTicket ? byId('sessions', UI.deskTicket) : (q && hits.length === 1 ? hits[0] : null);
    const open = openTickets(UI.deskFac);
    const tz = f => tzF(f);
    return `<div class="desk ${sel ? 'has-sel' : ''}">
    <div style="display:grid;gap:18px">
      <section class="panel"><form class="panel-b" data-form="deskSearch" style="display:grid;gap:12px">
        <div class="row"><div class="field"><label for="deskFac">Location</label><select id="deskFac" data-fresh="1"><option value="">All locations</option>${facs.map(f => `<option value="${f.id}" ${f.id === UI.deskFac ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div></div>
        <label for="deskQ" class="muted" style="font-size:.78rem;font-weight:600">Plate, ticket #, key tag or phone</label>
        <input id="deskQ" class="desk-in" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="PLATE OR TICKET" value="${esc(UI.deskQ)}" data-fresh="1">
        <div class="row"><button class="btn pri lg">Find</button><button type="button" class="btn lg" data-act="newTicket" data-perm="tickets">New ticket</button></div>
        ${q && !hits.length && !sel ? `<div class="callout warn"><b>No open ticket for ${esc(q)}.</b> ${R.validPermitFor(normPlate(q), UI.deskFac || (facs[0] || {}).id) ? 'This plate has monthly parking here.' : R.vipForPlate(normPlate(q)) ? 'This plate is on the VIP list.' : ''} Open a ticket with the arrival time the driver gives you, or look the plate up under Vehicles.<div class="row" style="margin-top:8px"><button type="button" class="btn sm pri" data-act="newTicket" data-plate="${esc(normPlate(q))}" data-perm="tickets">New ticket for ${esc(normPlate(q))}</button><button type="button" class="btn sm" data-act="checkPlate" data-plate="${esc(normPlate(q))}">Vehicle history</button></div></div>` : ''}
        ${hits.length > 1 ? `<div class="list" style="border:1px solid var(--line);border-radius:var(--r)">${hits.slice(0, 8).map(s => `<div class="li"><span class="sev info"></span>${plateChip(s.plate)}<div class="grow"><b>${esc(tk(s))}</b> · ${esc(fname(s.facilityId))}<span class="muted" style="display:block;font-size:.82rem">Arrived ${fmtTime(s.startAt, tzS(s))} · ${money(R.balanceOf(s))} due</span></div><button class="btn sm pri" data-act="deskPick" data-id="${esc(s.id)}">Check out</button></div>`).join('')}</div>` : ''}
      </form></section>
      <section class="panel"><div class="panel-h"><h2>On site now</h2><span class="muted" style="font-size:.84rem">${open.length} open ticket${open.length === 1 ? '' : 's'}${UI.deskFac ? ' at ' + esc(fname(UI.deskFac)) : ''}</span></div>
      ${open.length ? `<div class="tbl-wrap"><table><thead><tr><th>Plate</th><th>Ticket</th><th>Arrived</th><th class="r">Time</th><th class="r">Due</th></tr></thead><tbody>${open.slice(0, 40).map(s => `<tr class="click ${sel && sel.id === s.id ? 'sel' : ''}" data-act="deskPick" data-id="${esc(s.id)}" title="Check out"><td>${plateChip(s.plate)}${typeTag(s)}</td><td class="mono">${esc(tk(s))}</td><td class="num">${fmtTime(s.startAt, tzS(s))}</td><td class="r num">${dur(now() - s.startAt)}</td><td class="r num">${R.balanceOf(s) > 0 ? '<b>' + money(R.balanceOf(s)) + '</b>' : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>${open.length > 40 ? `<div class="pager">Showing 40 of ${open.length}. Search for the rest.</div>` : ''}` : '<div class="empty">No cars on site.</div>'}</section>
    </div>
    <div>${sel ? checkoutPanel(sel) : `<section class="panel"><div class="empty"><h2 style="margin-bottom:6px">Exit desk</h2><p>Type the plate (or ticket number, key tag or phone) of the car leaving, press <span class="kbd">Enter</span>, and collect what’s due. Monthly parkers, VIPs and validated cars show nothing due.</p><p class="note"><span class="kbd">Enter</span> on a single match opens Collect · <span class="kbd">F2</span> next car · Working as <b>${esc(actorName())}</b> ${HOSTED ? '' : '<button class="btn sm" data-act="setStaffName">Change</button>'}</p></div></section>`}</div></div>`;
  }

  /* ---------- tickets list ---------- */
  const TYPE_F = { all: () => true, camera: s => s.mode === 'lpr' && !s.manual && !s.valet, prepaid: s => s.mode === 'prepaid', monthly: s => s.kind === 'permit', valet: s => !!s.valet, vip: s => s.kind === 'vip', manual: s => !!s.manual && !s.valet };
  const STATUS_F = { all: () => true, open: s => !s.endAt, unpaid: s => R.exitStatus(s) === 'unpaid', paid: s => !!s.endAt && ['paid', 'autopay', 'validated', 'free', 'permit', 'vip'].includes(R.exitStatus(s)), held: s => ['review', 'missed', 'noentry', 'noplate'].includes(R.exitStatus(s)), waived: s => !!s.waived, cited: s => !!s.cited, closed: s => !!s.endAt };
  function ticketRows() {
    const [from, to] = window.dateRange(UI.tkRange, UI.tkFrom, UI.tkTo), q = UI.tkQ.trim(), pl = normPlate(q), digits = q.replace(/\D/g, '');
    return S.sessions.filter(s => {
      if (s.noPlate && UI.tkStatus !== 'held') return false;
      const at = s.startAt || s.endAt || s.createdAt || 0;
      if (!(at >= from && at < to) && !(!s.endAt && (UI.tkStatus === 'all' || UI.tkStatus === 'open'))) return false;
      if (UI.tkFac && s.facilityId !== UI.tkFac) return false;
      if (!(TYPE_F[UI.tkType] || TYPE_F.all)(s) || !(STATUS_F[UI.tkStatus] || STATUS_F.all)(s)) return false;
      if (q) { const hay = [normPlate(s.plate), tk(s), s.valet && s.valet.tag ? normPlate(s.valet.tag) : '', s.validation ? s.validation.code : ''].join(' '); if (!hay.includes(pl) && !(digits.length >= 4 && s.phone && String(s.phone).replace(/\D/g, '').includes(digits))) return false; }
      return true;
    }).sort((a, b) => (b.startAt || b.endAt || 0) - (a.startAt || a.endAt || 0));
  }
  function vTickets() {
    const rows = ticketRows(), pages = Math.max(1, Math.ceil(rows.length / PAGE)); UI.tkPage = Math.min(UI.tkPage, pages - 1);
    const page = rows.slice(UI.tkPage * PAGE, (UI.tkPage + 1) * PAGE);
    const sel = (id, opts, val) => `<select id="${id}" data-fresh="1" style="width:auto">${opts.map(([k, l]) => `<option value="${k}" ${String(k) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const owed = sum(rows, R.balanceOf), paid = sum(rows, R.paidOf);
    return `<section class="panel"><div class="panel-h"><div class="filters" style="margin-right:auto"><input id="tkQ" type="search" placeholder="Plate, ticket #, key tag, phone or code" value="${esc(UI.tkQ)}" data-fresh="1">
      ${sel('tkFac', [['', 'All locations']].concat(S.facilities.map(f => [f.id, f.name])), UI.tkFac)}
      ${sel('tkType', [['all', 'All types'], ['camera', 'Camera'], ['prepaid', 'Prepaid (QR)'], ['manual', 'Manual entry'], ['valet', 'Valet'], ['monthly', 'Monthly'], ['vip', 'VIP']], UI.tkType)}
      ${sel('tkStatus', [['all', 'Any status'], ['open', 'Open'], ['unpaid', 'Unpaid'], ['paid', 'Paid / no charge'], ['held', 'Held for review'], ['waived', 'Waived'], ['cited', 'Cited'], ['closed', 'Closed']], UI.tkStatus)}
      ${window.rangeControls('tk', UI.tkRange, UI.tkFrom, UI.tkTo)}</div><button class="btn sm" data-act="exportTickets" data-perm="export">Export CSV</button></div>
    <div class="panel-b" style="padding-bottom:0"><div class="split"><span><b>${rows.length}</b> ticket${rows.length === 1 ? '' : 's'}</span><span><b>${money(paid)}</b> paid</span><span><b>${money(owed)}</b> owed</span><span class="muted">Arrival date is used for the date range; open tickets are always listed under “Any status” and “Open”.</span></div></div>
    ${page.length ? `<div class="tbl-wrap"><table><thead><tr><th>Ticket</th><th>Plate</th><th>Location</th><th>Arrived</th><th>Departed</th><th class="r">Time</th><th class="r">Fee</th><th class="r">Paid</th><th class="r">Due</th><th>Validation</th><th>Status</th><th></th></tr></thead><tbody>${page.map(s => { const tz = tzS(s); return `<tr class="click" data-act="openTicket" data-id="${esc(s.id)}"><td class="mono">${esc(tk(s))}</td><td>${s.noPlate ? '<span class="pill warn">No plate</span>' : plateChip(s.plate)}${typeTag(s)}</td><td>${esc(fname(s.facilityId))}</td><td class="num">${s.startAt ? fmtTime(s.startAt, tz) : '—'}</td><td class="num">${s.endAt ? fmtTime(s.endAt, tz) : '<span class="pill info">On site</span>'}</td><td class="r num">${s.startAt ? dur((s.endAt || now()) - s.startAt) : '—'}</td><td class="r num">${money(R.sessionFee(s) + R.extrasOf(s))}</td><td class="r num">${money(R.paidOf(s))}</td><td class="r num">${R.balanceOf(s) > 0 ? '<b>' + money(R.balanceOf(s)) + '</b>' : '—'}</td><td>${s.validation ? `<span class="tag">${esc(s.validation.code)}</span>` : '—'}</td><td>${statusPill(s)}</td><td>${ticketLink(s)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No tickets match these filters.</div>'}
    ${pages > 1 ? `<div class="pager"><button class="btn sm" data-act="tkPage" data-v="-1" ${UI.tkPage === 0 ? 'disabled' : ''}>‹</button><span>Page ${UI.tkPage + 1} of ${pages}</span><button class="btn sm" data-act="tkPage" data-v="1" ${UI.tkPage >= pages - 1 ? 'disabled' : ''}>›</button></div>` : ''}</section>`;
  }

  /* ---------- ticket detail ---------- */
  function timeline(s) {
    const tz = tzS(s), items = [];
    if (s.startAt) items.push({ at: s.startAt, text: s.manual ? 'Ticket opened' + (s.valet ? ' (valet)' : ' by staff') : s.mode === 'prepaid' ? 'Paid by plate' + (s.prepaidAt ? '' : '') : 'Entered' + (s.entryCameraId ? ' · ' + ((byId('cameras', s.entryCameraId) || {}).name || 'camera') : ''), by: '' });
    if (s.prepaidAt && s.startLpr) items.push({ at: s.prepaidAt, text: 'Prepaid before arrival', by: '' });
    (s.payments || []).forEach(p => items.push({ at: p.at, text: `Payment ${money(p.amount)} · ${(ParkRules.METHODS[p.method] || p.method || '').toLowerCase()}${p.tendered != null ? ` (tendered ${money(p.tendered)})` : ''}${p.note ? ' · ' + p.note : ''}`, by: p.by || '' }));
    (s.history || []).forEach(h => { if (h.action === 'payment' || h.action === 'created') return; items.push({ at: h.at, text: `${({ receipt_emailed: 'Receipt emailed', validation_applied: 'Validation applied', validation_replaced: 'Validation replaced', validation_removed: 'Validation removed', departed: 'Departed', reopened: 'Reopened', waived: 'Balance waived', waive_removed: 'Waiver removed', fee_adjusted: 'Fee adjusted', note: 'Note', plate_corrected: 'Plate corrected', valet: 'Valet', match_confirmed: 'Plate match confirmed', match_rejected: 'Plate match rejected', missed_exit_resolved: 'Missed exit resolved', sent_to_review: 'Sent to plate review', entry_added: 'Arrival added', dismissed: 'Dismissed', cited: 'Notice issued' })[h.action] || h.action}${h.detail ? ' · ' + h.detail : ''}`, by: h.by || '' }); });
    if (s.endAt && !s.closedManually) items.push({ at: s.endAt, text: s.noEntry ? 'Exit read with no matching entry' : s.missedExit ? 'Closed: exit never read (a new entry was seen)' : 'Exited' + (s.exitCameraId ? ' · ' + ((byId('cameras', s.exitCameraId) || {}).name || 'camera') : '') + (s.matchedBy ? ` · read as ${s.exitPlate} (${s.matchedBy === 'fuzzy' ? 'one character off' : s.matchedBy === 'lookalike' ? 'look-alike characters' : s.matchedBy})` : ''), by: '' });
    S.feed.filter(r => r.sessionId === s.id && r.level !== 'ok' && r.level !== 'info').forEach(r => items.push({ at: r.at, text: 'Camera: ' + r.text, by: '' }));
    // Server audit rows: ticket actions already appear above (they write history), so only show direct edits and payment-device events.
    const audit = HOSTED && window.ticketAudit ? window.ticketAudit(s.id) : null;
    const AUD = { terminal_start: a => `Sent ${money(a.detail && a.detail.amount)} to the Square Terminal`, terminal_paid: a => `Paid ${money(a.detail && a.detail.amount)} on the Square Terminal`, terminal_cancel: () => 'Terminal payment cancelled', card_on_file: a => `Charged ${money(a.detail && a.detail.amount)} to the card on file` };
    (audit || []).forEach(a => {
      const ch = a.detail && a.detail.change;
      if (AUD[a.action]) { items.push({ at: a.at, text: AUD[a.action](a), by: a.actor || '' }); return; }
      if (a.action === 'set' && (s.history || []).some(h => h.action === 'created')) return;
      if (ch && (ch.history || ch.payments)) return;
      const keys = ch ? Object.keys(ch) : [];
      items.push({ at: a.at, text: a.action === 'delete' ? 'Record deleted' : `Edited directly${keys.length ? ': ' + keys.join(', ') : ''}`, by: a.actor || '' });
    });
    items.sort((a, b) => a.at - b.at);
    return items.length ? `<div class="timeline">${items.map(i => `<div class="tl"><time>${fmtTime(i.at, tz)}</time><div>${esc(i.text)}${i.by ? `<div class="who">${esc(i.by)}</div>` : ''}</div></div>`).join('')}</div>` : '<div class="empty">No activity yet.</div>';
  }
  function vTicket(id) {
    const s = byId('sessions', id); if (!s) return `<section class="panel"><div class="empty">That ticket isn’t loaded. <button class="btn sm" data-act="spView" data-v="tickets">Back to tickets</button></div></section>`;
    const b = R.ticketBill(s), f = facById(s.facilityId), tz = tzS(s), hosted = !!HOSTED, open = !s.endAt;
    const member = s.memberId ? byId('members', s.memberId) : R.memberForPlate(normPlate(s.plate)), permit = s.permitId ? byId('permits', s.permitId) : null, vip = s.vipId ? byId('vips', s.vipId) : null;
    const resv = s.reservationId ? byId('reservations', s.reservationId) : null, cit = s.citationId ? byId('citations', s.citationId) : null;
    const terminal = hosted && f && window.terminalCheckout && (f.terminalDeviceId || (HOSTED.terminal && (HOSTED.terminal.defaultDevice || HOSTED.terminal.simulated)));
    const act = (a, label, perm, cls) => `<button class="btn ${cls || ''}" data-act="${a}" data-id="${esc(s.id)}" ${perm ? `data-perm="${perm}"` : ''}>${label}</button>`;
    return `<div class="pagehead"><div><button class="btn sm" data-act="spView" data-v="tickets">‹ Tickets</button><h1 style="margin-top:8px">Ticket ${esc(tk(s))} ${statusPill(s)}</h1><p>${esc(f ? f.name : '')} · ${typeTag(s)}${s.rating ? ` · rated ${'★'.repeat(s.rating.stars)}` : ''}</p></div><div class="row" style="align-items:center">${plateChip(s.plate)}${s.plateOriginal ? `<span class="note">was ${esc(s.plateOriginal)}</span>` : ''}</div></div>
    <div class="grid g2">
      <div style="display:grid;gap:18px">
        <section class="panel"><div class="panel-h"><h2>Visit</h2></div><div class="panel-b" style="display:grid;gap:14px">
          <div class="facts">
            <div><small>Arrived</small><b>${s.startAt ? fmtTime(s.startAt, tz) : '—'}</b>${s.startAt ? `<span class="note">${s.manual ? 'Manual entry' : s.mode === 'prepaid' ? 'Paid by plate' : (byId('cameras', s.entryCameraId) || {}).name || 'Camera'}</span>` : ''}</div>
            <div><small>Departed</small><b>${s.endAt ? fmtTime(s.endAt, tz) : 'On site'}</b>${s.endAt ? `<span class="note">${s.closedManually ? 'Closed by staff' : (byId('cameras', s.exitCameraId) || {}).name || (s.noEntry ? 'Camera' : '')}</span>` : ''}</div>
            <div><small>Duration</small><b>${s.startAt ? dur((s.endAt || now()) - s.startAt) : '—'}</b></div>
            <div><small>Rate at arrival</small><b>${esc(R.rateSummary(R.facFor(s))[0] || '—')}</b>${s.rates && f && JSON.stringify(s.rates) !== JSON.stringify(f.rates) ? '<span class="note">Rates changed since; this ticket keeps its own.</span>' : ''}</div>
            <div><small>Validation</small><b>${s.validation ? esc(s.validation.code) : 'None'}</b>${s.validation ? `<span class="note">${esc(R.validationText(s.validation))}${s.validation.tenantName ? ' · ' + esc(s.validation.tenantName) : ''}${s.validation.by ? ' · by ' + esc(s.validation.by) : ''}</span>` : ''}</div>
            <div><small>Eligibility</small><b>${permit ? 'Monthly #' + esc(permit.number) : vip ? 'VIP' + (s.vipFree ? ' (free)' : '') : member ? 'Autopay account' : R.validPermitFor(normPlate(s.plate), s.facilityId) ? 'Has monthly parking now' : 'Visitor'}</b>${resv ? `<span class="note">Reservation ${esc(resv.code)}</span>` : ''}</div>
            <div><small>Paid</small><b>${money(b.paid)}</b></div>
            <div><small>${b.due > 0 ? 'Balance due' : 'Balance'}</small><b style="${b.due > 0 ? 'color:var(--bad)' : ''}">${money(b.due)}</b>${s.waived ? '<span class="note">Waived</span>' : ''}${cit ? `<span class="note">Notice ${esc(cit.number)} (${esc(cit.status)})</span>` : ''}</div>
            ${s.valet ? `<div><small>Valet</small><b>${esc(s.valet.status || 'parked')}</b><span class="note">Key ${esc(s.valet.tag || '—')} · ${esc(s.valet.space || '')} · ${esc(s.valet.vehicle || '')}${s.valet.runner ? ' · ' + esc(s.valet.runner) : ''}</span></div>` : ''}
            ${s.phone ? `<div><small>Mobile</small><b>${esc(s.phone)}</b>${s.smsOptIn ? '<span class="note">Texts on</span>' : ''}</div>` : ''}
            ${s.notes ? `<div><small>Notes</small><b>${esc(s.notes)}</b></div>` : ''}
          </div>
          ${hosted && (s.entryPhotoId || s.exitPhotoId) ? `<div class="thumbs">${[s.entryPhotoId, s.exitPhotoId].filter(Boolean).map(p => `<a href="/photos/${esc(p)}" target="_blank" rel="noopener"><img src="/photos/${esc(p)}" alt="Plate photo" loading="lazy"></a>`).join('')}</div>` : ''}
          <div class="row" style="gap:8px">
            ${open && R.entryDue(s) > 0 ? act('deskPayEntry', `Collect ${money(R.entryDue(s))} event rate`, 'tickets', 'pri') : ''}
            ${b.due > 0 && !R.needsReview(s) && !(s.missedExit && !s.missedResolved) ? act('deskPay', open ? `Collect ${money(b.due)} and close` : `Collect ${money(b.due)}`, 'tickets', R.entryDue(s) > 0 ? '' : 'pri') : ''}
            ${b.due > 0 && terminal ? act('deskTerminal', 'Square Terminal', 'tickets') : ''}
            ${b.due > 0 && hosted && member && window.chargeCardOnFile ? act('deskCardOnFile', 'Charge card on file', 'tickets') : ''}
            ${open ? act('deskClose', b.due > 0 ? 'Let out unpaid' : 'Close ticket', b.due > 0 ? 'tickets.adjust' : 'tickets') : act('reopenTicket', 'Reopen', 'tickets.adjust')}
            ${!s.validation ? act('validateSession', 'Apply validation', 'tickets') : act('validateSession', 'Replace validation', 'tickets.adjust') + act('removeValidation', 'Remove validation', 'tickets.adjust')}
            ${!open ? act('adjustFee', 'Adjust fee', 'tickets.adjust') : ''}
            ${s.waived ? act('unwaive', 'Remove waiver', 'tickets.adjust') : (b.due > 0 || open) ? act('waiveSession', 'Waive', 'tickets.adjust') : ''}
            ${act('correctPlate', 'Correct plate', 'tickets.adjust')}${act('addNote', 'Add note', 'tickets')}
            ${b.paid > 0 || !open ? act('printReceipt', 'Print receipt') : ''}${HOSTED && (b.paid > 0 || !open) ? act('emailReceipt', 'Email receipt', 'tickets') : ''}
            ${!open && b.due > 0 && !s.cited && !R.needsReview(s) && !(s.missedExit && !s.missedResolved) ? act('citeSession', 'Issue parking charge notice', 'citations', 'danger') : ''}
            ${open && !s.valet ? act('closeMissed', 'Send to plate review', 'tickets.adjust') : ''}
          </div>
        </div></section>
        <section class="panel"><div class="panel-h"><h2>Bill</h2><span class="muted" style="font-size:.84rem">${b.tax.tax ? `Prices ${(S.config || {}).taxIncluded === false ? 'plus' : 'include'} ${b.tax.rate}% sales tax` : ''}</span></div><div class="panel-b">${billTable(b, s)}</div></section>
        ${(s.payments || []).length ? `<section class="panel"><div class="panel-h"><h2>Payments</h2></div><div class="tbl-wrap"><table><thead><tr><th>When</th><th>Method</th><th class="r">Amount</th><th>By</th><th>Note</th><th></th></tr></thead><tbody>${s.payments.map((p, i) => `<tr><td class="num">${fmtTime(p.at, tz)}</td><td>${esc(ParkRules.METHODS[p.method] || p.method)}${p.tendered != null ? `<span class="sub">Tendered ${money(p.tendered)} · change ${money(p.tendered - p.amount)}</span>` : ''}</td><td class="r num">${money(p.amount)}</td><td>${esc(p.by || '')}</td><td>${esc(p.note || '')}${p.pid && !String(p.pid).startsWith('sim_') && hosted ? `<span class="sub mono">${esc(p.pid)}</span>` : ''}</td><td>${hosted && p.pid && window.refundByPid ? `<button class="btn sm" data-act="refundPid" data-pid="${esc(p.pid)}" data-max="${p.amount}" data-perm="refunds">Refund</button>` : ''}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      </div>
      <section class="panel"><div class="panel-h"><h2>History</h2></div><div class="panel-b">${timeline(s)}</div></section>
    </div>`;
  }

  /* ---------- vehicles ---------- */
  function vVehicles() {
    const q = normPlate(UI.vehicle || '');
    if (q) return vVehicle(q);
    const recent = new Map();
    S.sessions.filter(s => !s.noPlate && (s.startAt || s.endAt) > now() - 30 * D).forEach(s => { const p = normPlate(s.plate); const r = recent.get(p) || { plate: p, visits: 0, paid: 0, last: 0 }; r.visits++; r.paid += R.paidOf(s); r.last = Math.max(r.last, s.endAt || s.startAt || 0); recent.set(p, r); });
    const rows = [...recent.values()].sort((a, b) => b.visits - a.visits).slice(0, 25);
    return `<div class="grid g2e">
      <section class="panel"><div class="panel-h"><h2>Find a vehicle</h2></div><form class="panel-b" data-form="vehicleFind" class="row"><div class="row"><div class="field"><label for="vhQ">License plate</label><input id="vhQ" autocomplete="off" style="text-transform:uppercase" placeholder="ABC1234"></div><button class="btn pri">Open</button></div><p class="note" style="margin:8px 0 0">Every visit, payment, notice, monthly plan and VIP flag for a plate. Click any plate anywhere in the console to get here.</p></form></section>
      <section class="panel"><div class="panel-h"><h2>Most frequent, last 30 days</h2></div>${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Plate</th><th class="r">Visits</th><th class="r">Paid</th><th>Last seen</th></tr></thead><tbody>${rows.map(r => `<tr><td>${plateChip(r.plate)}${R.validPermitFor(r.plate) ? ' <span class="tag">Monthly</span>' : ''}${R.vipForPlate(r.plate) ? ' <span class="tag">VIP</span>' : ''}</td><td class="r num">${r.visits}</td><td class="r num">${money(r.paid)}</td><td class="num">${fmtTime(r.last)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No visits in the last 30 days.</div>'}</section></div>`;
  }
  function vVehicle(pl) {
    const v = R.vehicleProfile(pl);
    const permit = v.permits.find(R.permitValid);
    return `<div class="pagehead"><div><button class="btn sm" data-act="vehicleBack">‹ Vehicles</button><h1 style="margin-top:8px">${esc(pl)}</h1><p>${v.visits} visit${v.visits === 1 ? '' : 's'}${v.firstSeen ? ' since ' + fmtDate(v.firstSeen) : ''}${v.hot ? ' · <span class="pill bad">Hot list</span>' : ''}</p></div>
      <div class="row"><button class="btn" data-act="newTicket" data-plate="${esc(pl)}" data-perm="tickets">New ticket</button>${v.vip ? `<button class="btn" data-act="editVip" data-id="${esc(v.vip.id)}" data-perm="vips">Edit VIP</button>` : `<button class="btn" data-act="addVip" data-plate="${esc(pl)}" data-perm="vips">Add to VIP list</button>`}${S.roles.includes('enf') ? `<button class="btn" data-act="enfCheck" data-plate="${esc(pl)}">Officer check</button>` : ''}</div></div>
    <div class="kpis"><div class="kpi"><small>Visits</small><b>${v.visits}</b><span>avg stay ${v.avgMinutes ? dur(v.avgMinutes * M) : '—'}</span></div><div class="kpi"><small>Paid</small><b>${money0(v.paid)}</b><span>all time</span></div><div class="kpi ${v.owed ? 'alert' : ''}"><small>Owed</small><b>${money(v.owed)}</b><span>${v.citations.filter(c => c.status === 'open').length} open notices</span></div><div class="kpi"><small>Status</small><b style="font-size:1.2rem">${permit ? 'Monthly' : v.vip ? 'VIP' : v.member ? 'Autopay' : v.live ? 'On site' : 'Visitor'}</b><span>${permit ? '#' + esc(permit.number) + ' · ' + esc((typeById(permit.permitTypeId) || {}).name || '') : v.vip ? esc(v.vip.name) : v.member ? esc(v.member.name) : v.lastSeen ? 'last seen ' + fmtTime(v.lastSeen) : ''}</span></div></div>
    ${v.ratings.length ? `<section class="panel"><div class="panel-h"><h2>Ratings</h2></div><div class="list">${v.ratings.map(r => `<div class="li"><span class="sev ${r.stars >= 4 ? 'ok' : r.stars <= 2 ? 'bad' : 'warn'}"></span><div class="grow"><b>${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</b> ${esc(r.comment || '')}<span class="muted" style="display:block;font-size:.82rem">${fmtTime(r.at)} · ${esc(fname(r.facilityId))}</span></div></div>`).join('')}</div></section>` : ''}
    <section class="panel"><div class="panel-h"><h2>Visits</h2></div>${v.sessions.length ? `<div class="tbl-wrap"><table><thead><tr><th>Ticket</th><th>Location</th><th>Arrived</th><th>Departed</th><th class="r">Time</th><th class="r">Fee</th><th class="r">Paid</th><th>Status</th><th></th></tr></thead><tbody>${v.sessions.slice(0, 60).map(s => { const tz = tzS(s); return `<tr class="click" data-act="openTicket" data-id="${esc(s.id)}"><td class="mono">${esc(tk(s))}${typeTag(s)}</td><td>${esc(fname(s.facilityId))}</td><td class="num">${s.startAt ? fmtTime(s.startAt, tz) : '—'}</td><td class="num">${s.endAt ? fmtTime(s.endAt, tz) : 'On site'}</td><td class="r num">${s.startAt ? dur((s.endAt || now()) - s.startAt) : '—'}</td><td class="r num">${money(R.sessionFee(s) + R.extrasOf(s))}</td><td class="r num">${money(R.paidOf(s))}</td><td>${statusPill(s)}</td><td>${ticketLink(s)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No visits on record.</div>'}</section>
    ${v.citations.length ? `<section class="panel"><div class="panel-h"><h2>Parking charge notices</h2></div><div class="tbl-wrap"><table><thead><tr><th>Notice</th><th>Location</th><th>Violation</th><th class="r">Amount</th><th>Issued</th><th>Status</th></tr></thead><tbody>${v.citations.map(c => `<tr><td class="mono">${esc(c.number)}</td><td>${esc(fname(c.facilityId))}</td><td>${esc(c.violationName)}</td><td class="r num">${money(c.fine)}</td><td class="num">${fmtTime(c.issuedAt)}</td><td>${citePill(c)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    ${v.permits.length ? `<section class="panel"><div class="panel-h"><h2>Monthly parking</h2></div><div class="list">${v.permits.map(p => `<div class="li"><span class="sev ${R.permitValid(p) ? 'ok' : ''}"></span><div class="grow"><b>${esc((typeById(p.permitTypeId) || {}).name || 'Plan')} · #${esc(p.number)}</b><span class="muted" style="display:block;font-size:.82rem">${esc(p.holder)}${p.companyName ? ' · ' + esc(p.companyName) : ''}${p.paidThrough ? ' · paid through ' + fmtDate(p.paidThrough - 1) : ''}</span></div>${permitPill(p)}</div>`).join('')}</div></section>` : ''}`;
  }

  /* ---------- VIP list ---------- */
  function vVips() {
    const q = normPlate(UI.vipQ);
    const rows = S.vips.filter(v => !q || (v.plates || []).some(p => normPlate(p).includes(q)) || (v.name || '').toUpperCase().includes(q)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return `<section class="panel"><div class="panel-h"><h2>VIP list</h2><div class="filters" style="margin-left:auto"><input id="vipQ" type="search" placeholder="Name or plate" value="${esc(UI.vipQ)}" data-fresh="1"></div><button class="btn sm pri" data-act="addVip" data-perm="vips">Add VIP</button></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Plates</th><th>Parking</th><th>Applies at</th><th>Note</th><th class="r">Visits, 30d</th><th></th></tr></thead><tbody>${rows.map(v => { const n = S.sessions.filter(s => (v.plates || []).map(normPlate).includes(normPlate(s.plate)) && (s.startAt || 0) > now() - 30 * D).length; return `<tr><td><b>${esc(v.name)}</b>${v.active === false ? ' <span class="pill">Off</span>' : ''}<span class="sub">${esc(v.company || '')}</span></td><td><div class="plates">${(v.plates || []).map(plateChip).join('')}</div></td><td>${v.freeParking ? '<span class="pill ok">Free</span>' : '<span class="pill info">Flag only</span>'}</td><td>${(v.facilities || []).length ? esc(v.facilities.map(fname).join(', ')) : 'Everywhere'}</td><td>${esc(v.note || '')}</td><td class="r num">${n}</td><td><div class="acts"><button class="btn sm" data-act="editVip" data-id="${esc(v.id)}" data-perm="vips">Edit</button></div></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No VIP vehicles yet. VIPs are recognised at the camera and by officers; “free” VIPs are never charged.</div>'}</section>`;
  }
  function vMembers() {
    return `<section class="panel"><div class="panel-h"><h2>Autopay accounts</h2><span class="muted" style="font-size:.84rem">Drivers with a card on file, charged automatically on exit at camera garages</span></div>
    ${S.members.length ? `<div class="tbl-wrap"><table><thead><tr><th>Driver</th><th>Plates</th><th>Card</th><th></th></tr></thead><tbody>${S.members.map(m => `<tr><td><b>${esc(m.name)}</b><span class="sub">${esc(m.email || '')}</span></td><td><div class="plates">${(m.plates || []).map(plateChip).join('')}</div></td><td class="mono">•••• ${esc(m.card || '')}</td><td><div class="acts"><button class="btn sm danger" data-act="removeMember" data-id="${m.id}">Remove</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No autopay accounts yet. Drivers create them in the driver portal.</div>'}</section>`;
  }

  window.vSelfParking = function () {
    const tabs = [['desk', 'Exit desk'], ['tickets', 'Tickets'], ['vehicles', 'Vehicles'], ['vips', 'VIP list'], ['members', 'Autopay']];
    const view = UI.spView === 'ticket' ? vTicket(UI.ticketId) : UI.spView === 'vehicle' ? vVehicle(normPlate(UI.vehicle || '')) : ({ desk: vDesk, tickets: vTickets, vehicles: vVehicles, vips: vVips, members: vMembers }[UI.spView] || vDesk)();
    const cur = UI.spView === 'ticket' ? 'tickets' : UI.spView === 'vehicle' ? 'vehicles' : UI.spView;
    return `<div class="pagehead"><div><h1>Self-parking</h1><p>Check cars out, open any ticket, and see everything on a plate.</p></div><nav class="subnav" aria-label="Self-parking">${tabs.map(([k, l]) => `<button data-act="spView" data-v="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</nav></div>${view}`;
  };

  /* ---------- plate review ---------- */
  window.vReview = function () {
    const held = S.sessions.filter(s => s.endAt && R.needsReview(s)).sort((a, b) => b.endAt - a.endAt);
    const missed = S.sessions.filter(s => s.missedExit && !s.missedResolved).sort((a, b) => b.endAt - a.endAt);
    const noEntry = S.sessions.filter(s => s.noEntry && !s.noPlate && !s.reviewed && now() - s.endAt < 7 * D).sort((a, b) => b.endAt - a.endAt);
    const noPlate = S.sessions.filter(s => s.noPlate && now() - (s.endAt || s.startAt) < 2 * D).sort((a, b) => (b.startAt || b.endAt) - (a.startAt || a.endAt));
    const stale = S.sessions.filter(s => !s.endAt && s.mode === 'lpr' && now() - s.startAt > R.staleHours() * H && s.kind !== 'permit' && !s.valet).sort((a, b) => a.startAt - b.startAt);
    const lowConf = S.feed.filter(r => r.confidence != null && r.confidence < 85 && now() - r.at < D);
    const cams = [...S.cameras].sort((a, b) => fname(a.facilityId).localeCompare(fname(b.facilityId)));
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const sec = (title, sub, n, html, empty) => `<section class="panel"><div class="panel-h"><h2>${title}</h2>${n ? `<span class="pill warn">${n}</span>` : ''}<span class="muted" style="font-size:.84rem">${sub}</span></div>${n ? html : `<div class="empty">${empty}</div>`}</section>`;
    return `<div class="pagehead"><div><h1>Plate review</h1><p>Camera reads that need a person: look-alike matches, missed exits, exits with no entry, unreadable plates and cars on site too long. Nothing here is billed until someone decides.</p></div></div>
    ${sec('Held plate matches', 'An exit read one character off from a car on site', held.length, `<div class="tbl-wrap"><table><thead><tr><th>On site as</th><th>Exit read</th><th>Location</th><th>Entered</th><th>Exited</th><th class="r">Would owe</th><th></th></tr></thead><tbody>${held.map(s => `<tr><td>${plateChip(s.plate)}</td><td>${plateChip(s.exitPlate || '')}<span class="sub">${esc(s.matchedBy)} match</span></td><td>${esc(fname(s.facilityId))}</td><td class="num">${fmtTime(s.startAt, tzS(s))}</td><td class="num">${fmtTime(s.endAt, tzS(s))}</td><td class="r num">${money(R.sessionFee(s) - R.paidOf(s))}</td><td><div class="acts"><button class="btn sm ok" data-act="confirmMatch" data-id="${esc(s.id)}">Same car</button><button class="btn sm" data-act="rejectMatch" data-id="${esc(s.id)}">Different car</button>${ticketLink(s)}</div></td></tr>`).join('')}</tbody></table></div>`, 'No held matches.')}
    ${sec('Missed exits', 'The car came back in before its previous exit was read', missed.length, `<div class="tbl-wrap"><table><thead><tr><th>Plate</th><th>Location</th><th>Entered</th><th>Closed</th><th></th></tr></thead><tbody>${missed.map(s => `<tr><td>${plateChip(s.plate)}</td><td>${esc(fname(s.facilityId))}</td><td class="num">${fmtTime(s.startAt, tzS(s))}</td><td class="num">${fmtTime(s.endAt, tzS(s))}</td><td><div class="acts"><button class="btn sm" data-act="missedBill" data-id="${esc(s.id)}">Bill 1 day (${money(((R.facFor(s) || {}).rates || {}).dailyMax || 0)})</button><button class="btn sm" data-act="missedFree" data-id="${esc(s.id)}">No charge</button>${ticketLink(s)}</div></td></tr>`).join('')}</tbody></table></div>`, 'No missed exits.')}
    ${sec('Exits with no entry', 'Last 7 days. Add the arrival time to bill the stay, or dismiss', noEntry.length, `<div class="tbl-wrap"><table><thead><tr><th>Plate</th><th>Location</th><th>Exited</th><th>Possible entry</th><th></th></tr></thead><tbody>${noEntry.map(s => { const cand = S.sessions.filter(x => x.id !== s.id && !x.endAt && x.facilityId === s.facilityId && ParkRules.normPlate(x.plate).length && (x.plate.slice(0, 3) === s.plate.slice(0, 3) || x.plate.slice(-3) === s.plate.slice(-3))).slice(0, 2); return `<tr><td>${plateChip(s.plate)}</td><td>${esc(fname(s.facilityId))}</td><td class="num">${fmtTime(s.endAt, tzS(s))}</td><td>${cand.length ? cand.map(x => `${plateChip(x.plate)} <span class="sub">in ${fmtTime(x.startAt, tzS(x))}</span>`).join(' ') : '<span class="muted">—</span>'}</td><td><div class="acts"><button class="btn sm" data-act="addEntry" data-id="${esc(s.id)}" data-perm="tickets.adjust">Set arrival</button><button class="btn sm" data-act="dismissReview" data-id="${esc(s.id)}" data-perm="tickets.adjust">Dismiss</button>${ticketLink(s)}</div></td></tr>`; }).join('')}</tbody></table></div>`, 'Every exit matched an entry.')}
    ${sec('On site too long', `More than ${R.staleHours()} hours without an exit read`, stale.length, `<div class="tbl-wrap"><table><thead><tr><th>Plate</th><th>Location</th><th>Entered</th><th class="r">Time</th><th class="r">Accrued</th><th></th></tr></thead><tbody>${stale.map(s => `<tr><td>${plateChip(s.plate)}</td><td>${esc(fname(s.facilityId))}</td><td class="num">${fmtTime(s.startAt, tzS(s))}</td><td class="r num">${dur(now() - s.startAt)}</td><td class="r num">${money(R.sessionFee(s))}</td><td><div class="acts"><button class="btn sm" data-act="closeMissed" data-id="${esc(s.id)}">Exit never read</button><button class="btn sm" data-act="deskGo" data-id="${esc(s.id)}">Check out</button>${ticketLink(s)}</div></td></tr>`).join('')}</tbody></table></div>`, 'Nothing has been on site unusually long.')}
    ${sec('Unreadable plates', 'Last 48 hours', noPlate.length, `<div class="tbl-wrap"><table><thead><tr><th>Location</th><th>Entered</th><th>Exited</th><th></th></tr></thead><tbody>${noPlate.map(s => `<tr><td>${esc(fname(s.facilityId))}</td><td class="num">${s.startAt ? fmtTime(s.startAt, tzS(s)) : '—'}</td><td class="num">${s.endAt ? fmtTime(s.endAt, tzS(s)) : 'On site'}</td><td>${HOSTED && s.entryPhotoId ? `<a class="btn sm" href="/photos/${esc(s.entryPhotoId)}" target="_blank" rel="noopener">Photo</a>` : ''}${!s.endAt ? `<button class="btn sm" data-act="correctPlate" data-id="${esc(s.id)}" data-perm="tickets.adjust">Set plate</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`, 'No unreadable plates.')}
    <div class="grid g2e">
    <section class="panel"><div class="panel-h"><h2>Camera health</h2></div>${cams.length ? `<div class="tbl-wrap"><table><thead><tr><th>Camera</th><th>Lane</th><th class="r">Reads today</th><th>Last read</th></tr></thead><tbody>${cams.map(c => { const n = S.feed.filter(r => r.cameraId === c.id && r.at >= d0.getTime()).length, quiet = !c.lastReadAt || now() - c.lastReadAt > 2 * H; return `<tr><td><b>${esc(c.name)}</b><span class="sub">${esc(fname(c.facilityId))}</span></td><td>${c.direction === 'in' ? 'Entry' : 'Exit'}</td><td class="r num">${n}</td><td class="num">${c.lastReadAt ? ago(c.lastReadAt) : 'Never'} ${quiet ? '<span class="pill warn">Quiet</span>' : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No cameras.</div>'}</section>
    <section class="panel"><div class="panel-h"><h2>Low-confidence reads</h2><span class="muted" style="font-size:.84rem">Under 85%, last 24 hours</span></div>${lowConf.length ? `<div class="list">${lowConf.slice(0, 20).map(r => `<div class="li"><span class="sev warn"></span>${plateChip(r.plate)}<div class="grow">${esc(r.text)}<span class="muted" style="display:block;font-size:.82rem">${fmtTime(r.at)} · ${Math.round(r.confidence)}%</span></div></div>`).join('')}</div>` : '<div class="empty">None.</div>'}</section></div>`;
  };

  /* ---------- valet board ---------- */
  window.vValet = function () {
    const facs = S.facilities.filter(f => f.active !== false);
    const live = S.sessions.filter(s => s.valet && !s.endAt && (!UI.valetFac || s.facilityId === UI.valetFac));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const delivered = S.sessions.filter(s => s.valet && s.valet.status === 'delivered' && (!UI.valetFac || s.facilityId === UI.valetFac) && ((s.valet.deliveredAt || s.endAt || 0) >= today.getTime())).sort((a, b) => (b.valet.deliveredAt || 0) - (a.valet.deliveredAt || 0));
    const cols = [['parked', 'Parked'], ['requested', 'Requested'], ['retrieving', 'Retrieving'], ['ready', 'Ready at curb']];
    const card = s => { const v = s.valet, due = R.balanceOf(s), waiting = v.requestedAt && ['requested', 'retrieving', 'ready'].includes(v.status) ? dur(now() - v.requestedAt) : ''; return `<div class="card">${plateChip(s.plate)}<div><b>${esc(v.vehicle || 'Vehicle')}</b> · key ${esc(v.tag || '—')}${v.space ? ' · ' + esc(v.space) : ''}</div><div class="muted">${esc(fname(s.facilityId))} · in ${fmtTime(s.startAt, tzS(s))}${waiting ? ' · waiting ' + waiting : ''}${v.runner ? ' · ' + esc(v.runner) : ''}</div><div class="row" style="gap:6px">${v.status === 'parked' ? `<button class="btn sm pri" data-act="valetStatus" data-id="${esc(s.id)}" data-v="requested" data-perm="valet">Requested</button>` : v.status === 'requested' ? `<button class="btn sm pri" data-act="valetStatus" data-id="${esc(s.id)}" data-v="retrieving" data-perm="valet">I’ll get it</button>` : v.status === 'retrieving' ? `<button class="btn sm pri" data-act="valetStatus" data-id="${esc(s.id)}" data-v="ready" data-perm="valet">At curb</button>` : `<button class="btn sm pri" data-act="valetDeliver" data-id="${esc(s.id)}" data-perm="valet">${due > 0 ? 'Collect ' + money(due) : 'Hand over'}</button>`}<button class="btn sm" data-act="openTicket" data-id="${esc(s.id)}">Ticket</button>${due > 0 ? `<span class="pill warn">${money(due)} due</span>` : R.paidOf(s) > 0 ? '<span class="pill ok">Paid</span>' : '<span class="pill">Nothing due yet</span>'}</div></div>`; };
    return `<div class="pagehead"><div><h1>Valet</h1><p>Cars parked by your valet team: keys, spaces, retrieval requests and handoff. Tenant valet companies that validate self-parked cars are under Validations & tenants.</p></div>
      <select id="valetFac" data-fresh="1" style="width:auto"><option value="">All locations</option>${facs.map(f => `<option value="${f.id}" ${f.id === UI.valetFac ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select><button class="btn pri" data-act="newValet" data-perm="valet">Park a car</button></div>
    <div class="kpis"><div class="kpi"><small>In valet now</small><b>${live.length}</b></div><div class="kpi ${live.some(s => s.valet.status === 'requested') ? 'alert' : ''}"><small>Waiting for a runner</small><b>${live.filter(s => s.valet.status === 'requested').length}</b></div><div class="kpi"><small>Ready at curb</small><b>${live.filter(s => s.valet.status === 'ready').length}</b></div><div class="kpi"><small>Delivered today</small><b>${delivered.length}</b><span>${money0(sum(delivered, R.paidOf))} collected</span></div></div>
    <div class="board">${cols.map(([k, l]) => { const list = live.filter(s => (s.valet.status || 'parked') === k).sort((a, b) => (a.valet[k + 'At'] || a.startAt) - (b.valet[k + 'At'] || b.startAt)); return `<div class="col"><h3><span>${l}</span><span>${list.length}</span></h3>${list.map(card).join('') || '<div class="note" style="text-align:center;padding:12px">Empty</div>'}</div>`; }).join('')}</div>
    ${delivered.length ? `<section class="panel"><div class="panel-h"><h2>Delivered today</h2></div><div class="tbl-wrap"><table><thead><tr><th>Plate</th><th>Vehicle</th><th>In</th><th>Out</th><th class="r">Paid</th><th></th></tr></thead><tbody>${delivered.map(s => `<tr><td>${plateChip(s.plate)}</td><td>${esc(s.valet.vehicle || '')}</td><td class="num">${fmtTime(s.startAt, tzS(s))}</td><td class="num">${fmtTime(s.endAt || s.valet.deliveredAt, tzS(s))}</td><td class="r num">${money(R.paidOf(s))}</td><td>${ticketLink(s)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  };

  /* ---------- monthly parkers from a spreadsheet ----------
     Columns (any order, header names are flexible): name, email, phone, plates, plan, company, paid through, number, notes.
     The preview shows what would be created and why rows are skipped; nothing is charged. */
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === ',' || c === '\t') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }
  const HEAD_MAP = { name: 'name', holder: 'name', parker: 'name', 'full name': 'name', email: 'email', 'e-mail': 'email', phone: 'phone', mobile: 'phone', cell: 'phone', plates: 'plates', plate: 'plates', 'license plate': 'plates', 'license plates': 'plates', tag: 'plates', plan: 'plan', type: 'plan', 'plan name': 'plan', rate: 'plan', company: 'company', employer: 'company', 'paid through': 'paidThrough', paidthrough: 'paidThrough', 'paid thru': 'paidThrough', number: 'number', '#': 'number', 'permit #': 'number', 'account #': 'number', notes: 'notes', note: 'notes', start: 'startAt', 'start date': 'startAt' };
  const rowsToObjects = rows => { const head = rows[0].map(h => HEAD_MAP[String(h).trim().toLowerCase()] || String(h).trim()); return rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = r[i] != null ? String(r[i]).trim() : ''; }); return o; }); };
  /* Same checks the hosted server makes, for the pilot page. */
  function importLocal(rows, dry) {
    const norm = s => String(s || '').trim().toLowerCase(), created = [], skipped = [], ops = [];
    const planOf = x => S.permitTypes.find(t => t.id === x || norm(t.name) === norm(x)), coOf = x => x && S.companies.find(c => c.id === x || norm(c.name) === norm(x));
    const usedNums = new Set(S.permits.map(pm => String(pm.number))), taken = new Map(); S.permits.forEach(pm => { if (['active', 'approved', 'pending', 'suspended'].includes(pm.status) && (!pm.endAt || pm.endAt > now())) (pm.plates || []).forEach(pl => taken.set(normPlate(pl), pm.number)); });
    rows.forEach((r, i) => {
      const line = i + 1, holder = String(r.name || '').trim().slice(0, 80), plates = [...new Set(String(r.plates || '').split(/[,;|\s]+/).map(normPlate).filter(Boolean))], plan = planOf(r.plan), co = coOf(r.company);
      if (!holder) return skipped.push({ line, reason: 'No name' });
      if (!plates.length) return skipped.push({ line, reason: 'No license plate' });
      if (!plan) return skipped.push({ line, reason: `Unknown plan "${r.plan || ''}"` });
      if (r.company && !co) return skipped.push({ line, reason: `Unknown company "${r.company}"` });
      const dup = plates.find(pl => taken.has(pl)); if (dup) return skipped.push({ line, reason: `${dup} is already on monthly #${taken.get(dup)}` });
      const f = facById((plan.facilities || [])[0]), mb = R.monthBounds(now(), f); let paidThrough = mb.end; if (r.paidThrough) { const pt = R.endOfDate(r.paidThrough, f) || Date.parse(r.paidThrough); if (pt > 0) paidThrough = pt; }
      let number = String(r.number || '').trim().slice(0, 12); if (!number || usedNums.has(number)) number = R.newMonthlyNumber(usedNums); usedNums.add(number); const email = norm(r.email);
      plates.forEach(pl => taken.set(pl, number)); created.push({ line, holder, plates, plan: plan.name, company: co ? co.name : '', paidThrough });
      ops.push({ type: 'set', coll: 'permits', id: R.uid('p'), data: { holder, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '', phone: String(r.phone || '').slice(0, 30), permitTypeId: plan.id, plates: plates.slice(0, plan.maxVehicles || 3), companyId: co ? co.id : null, companyName: co ? co.name : '', number, status: 'active', billing: co ? 'company' : 'office', createdAt: now(), startAt: r.startAt && Date.parse(r.startAt) > 0 ? Date.parse(r.startAt) : now(), endAt: null, paidThrough, source: 'import', importedAt: now(), notes: String(r.notes || '').slice(0, 300) } });
    });
    return { created, skipped, ops };
  }
  window.importMonthlyDialog = function () {
    let parsed = null;
    dlgCfg = null;
    dlgForm.innerHTML = `<div class="dlg-h"><h2>Import monthly parkers</h2><button type="button" class="btn sm" data-dlg="close">Close</button></div>
      <div class="dlg-b" style="display:grid;gap:12px">
        <p class="note" style="margin:0">A CSV from Excel or Google Sheets with a header row. Columns: <b>name, plates, plan</b> (required), email, phone, company, paid through, number, notes. Plans and companies are matched by name; plates already on an active monthly are skipped. Nothing is charged: imported parkers are billed at the office unless a company is named.</p>
        <div class="field"><label for="impFile">CSV file</label><input id="impFile" type="file" accept=".csv,.txt,text/csv,text/tab-separated-values"></div>
        <div class="field"><label for="impText">…or paste rows</label><textarea id="impText" rows="5" placeholder="name,email,plates,plan,company,paid through&#10;Ana Reyes,ana@example.com,ABC1234;XYZ987,Congress unreserved,,2026-10-31"></textarea></div>
        <div id="impPrev"></div><p id="impErr" class="pill bad" hidden></p></div>
      <div class="dlg-f"><button type="button" class="btn" data-dlg="close">Cancel</button><button type="button" class="btn" id="impCheck">Preview</button><button type="button" class="btn pri" id="impGo" disabled>Import</button></div>`;
    dlg.showModal();
    const err = m => { const e = $('#impErr', dlgForm); e.textContent = m || ''; e.hidden = !m; };
    const readInput = async () => { const f = $('#impFile', dlgForm).files[0]; const text = f ? await f.text() : $('#impText', dlgForm).value; const rows = parseCsv(text || ''); if (rows.length < 2) throw new Error('Add a header row and at least one parker.'); return rowsToObjects(rows); };
    const show = (r, dry) => {
      const tz = (S.config || {}).timeZone;
      $('#impPrev', dlgForm).innerHTML = `<div class="split"><span><b>${r.created.length}</b> ${dry ? 'ready to import' : 'imported'}</span><span><b>${r.skipped.length}</b> skipped</span></div>
        <div class="imp-prev"><table><thead><tr><th>Row</th><th>Parker</th><th>Plates</th><th>Plan</th><th>Company</th><th>Paid through</th></tr></thead><tbody>${r.created.slice(0, 200).map(c => `<tr><td class="num">${c.line}</td><td>${esc(c.holder)}</td><td>${esc(c.plates.join(', '))}</td><td>${esc(c.plan)}</td><td>${esc(c.company || '')}</td><td class="num">${fmtDate(c.paidThrough - 1, tz)}</td></tr>`).join('')}${r.skipped.slice(0, 200).map(s => `<tr style="color:var(--bad)"><td class="num">${s.line}</td><td colspan="5">Skipped: ${esc(s.reason)}</td></tr>`).join('')}</tbody></table></div>`;
    };
    $('#impCheck', dlgForm).onclick = async () => {
      err(''); try { parsed = await readInput(); const r = HOSTED ? await window.hostedMonthlyImport(parsed, true) : importLocal(parsed, true); show(r, true); $('#impGo', dlgForm).disabled = !r.created.length; $('#impGo', dlgForm).textContent = `Import ${r.created.length} parker${r.created.length === 1 ? '' : 's'}`; }
      catch (e) { err(e.message); }
    };
    $('#impGo', dlgForm).onclick = async () => {
      if (!parsed) return; err(''); const go = $('#impGo', dlgForm); go.disabled = true;
      try {
        let r;
        if (HOSTED) r = await window.hostedMonthlyImport(parsed, false);
        else { r = importLocal(parsed, false); applyLocal(r.ops); const ok = await write(db => execOps(db, r.ops)); if (!ok) throw new Error('Couldn’t save.'); }
        show(r, false); toast(`${r.created.length} monthly parker${r.created.length === 1 ? '' : 's'} imported`); go.textContent = 'Done'; go.onclick = () => dlg.close(); go.disabled = false; render();
      } catch (e) { err(e.message); go.disabled = false; }
    };
  };

  /* A pasted list of people for one account: name, email, plates, phone (a header row is optional). Shared with the account link. */
  window.parseParkerList = function (text) {
    const rows = parseCsv(String(text || '')); if (!rows.length) return [];
    const known = c => HEAD_MAP[String(c).trim().toLowerCase()];
    if (rows[0].some(c => ['name', 'plates'].includes(known(c)))) return rowsToObjects(rows);
    /* No header: name, email, plates, phone. A row of just two cells is a name and either an email or the plates. */
    return rows.map(r => { const c = r.map(x => String(x || '').trim()); if (c.length >= 3) return { name: c[0], email: c[1], plates: c[2], phone: c[3] || '' }; const emailSecond = /@/.test(c[1] || ''); return { name: c[0], email: emailSecond ? c[1] : '', plates: emailSecond ? '' : (c[1] || ''), phone: '' }; });
  };
  window.accountBulkDialog = function (companyId) {
    const co = byId('companies', companyId); if (!co) return;
    const plans = S.permitTypes.filter(t => !R.accountRoom(co.id, t.id, { adding: 0 }).error), room = R.accountRoom(co.id, null, { adding: 0 });
    if (!plans.length) { toast('No plan fits this account. Check the plans and locations on the account.', true); return; }
    let parsed = null;
    dlgCfg = null;
    dlgForm.innerHTML = `<div class="dlg-h"><h2>Add many to ${esc(co.name)}</h2><button type="button" class="btn sm" data-dlg="close">Close</button></div>
      <div class="dlg-b" style="display:grid;gap:12px">
        <p class="note" style="margin:0">Paste one person per line, or choose a spreadsheet saved as CSV. Columns: <b>name, email, plates, phone</b> (a header row is fine; add a <b>plan</b> column if people are on different plans). Several plates: separate with a semicolon. ${room.max ? `<b>${room.used.toLocaleString()} of ${room.max.toLocaleString()}</b> spaces are used, so up to <b>${room.left.toLocaleString()}</b> more can be added.` : 'This account has no parker limit.'}</p>
        <div class="form-grid"><div class="field"><label for="abPlan">Plan for everyone (unless a row names one)</label><select id="abPlan">${plans.map(t => `<option value="${esc(t.id)}">${esc(t.name)} · ${moneyP(t.price)}/mo</option>`).join('')}</select></div>
        <div class="field"><label for="abMonth">This month</label><select id="abMonth"><option value="no">Already paid for this month</option><option value="bill">New: bill the rest of this month</option></select></div></div>
        <div class="field"><label for="abFile">Spreadsheet (CSV)</label><input id="abFile" type="file" accept=".csv,.txt,text/csv,text/tab-separated-values"></div>
        <div class="field"><label for="abText">…or paste the list</label><textarea id="abText" rows="6" placeholder="Ana Reyes, ana@example.com, ABC1234, 817-555-0100&#10;Ben Ortiz, ben@example.com, XYZ987;QRS456"></textarea></div>
        <div id="abPrev"></div><p id="abErr" class="pill bad" hidden></p></div>
      <div class="dlg-f"><button type="button" class="btn" data-dlg="close">Cancel</button><button type="button" class="btn" id="abCheck">Preview</button><button type="button" class="btn pri" id="abGo" disabled>Add</button></div>`;
    dlg.showModal();
    const err = m => { const e = $('#abErr', dlgForm); e.textContent = m || ''; e.hidden = !m; };
    const read = async () => { const f = $('#abFile', dlgForm).files[0]; const text = f ? await f.text() : $('#abText', dlgForm).value; const rows = window.parseParkerList(text); if (!rows.length) throw new Error('Paste at least one person.'); if (rows.length > 1000) throw new Error('Up to 1,000 people at a time. Split the list in two.'); return rows; };
    const run = async (dry) => {
      const body = { planId: $('#abPlan', dlgForm).value, prorate: $('#abMonth', dlgForm).value === 'bill', rows: parsed, dryRun: dry };
      if (HOSTED) return HOSTED.api('POST', '/api/admin/companies/' + encodeURIComponent(co.id) + '/parkers', body);
      const r = R.planAccountParkers({ companyId: co.id, planId: body.planId, rows: body.rows, prorate: body.prorate, staff: true, source: 'account' });
      if (r.error) throw new Error(r.error);
      if (!dry && r.ops.length) { applyLocal(r.ops); const ok = await write(db => execOps(db, r.ops)); if (!ok) throw new Error('Couldn’t save.'); }
      return r;
    };
    const show = (r, dry) => {
      $('#abPrev', dlgForm).innerHTML = `<div class="split"><span><b>${r.created.length.toLocaleString()}</b> ${dry ? 'ready to add' : 'added'}${r.created.some(c => c.status === 'waitlist') ? ` (${r.created.filter(c => c.status === 'waitlist').length} on the waitlist: the plan is full)` : ''}</span><span><b>${r.skipped.length.toLocaleString()}</b> skipped</span></div>
        ${r.skipped.length ? `<div class="imp-prev"><table><thead><tr><th>Row</th><th>Why it was skipped</th></tr></thead><tbody>${r.skipped.slice(0, 200).map(x => `<tr><td class="num">${x.line}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${r.created.length ? `<div class="imp-prev"><table><thead><tr><th>Row</th><th>Parker</th><th>Plates</th><th>Plan</th></tr></thead><tbody>${r.created.slice(0, 200).map(c => `<tr><td class="num">${c.line}</td><td>${esc(c.holder)}${c.status === 'waitlist' ? ' <span class="pill warn">Waitlist</span>' : ''}${c.email ? '' : '<span class="sub">No email: they won’t get reminders</span>'}</td><td>${esc(c.plates.join(', '))}</td><td>${esc(c.plan)}</td></tr>`).join('')}${r.created.length > 200 ? `<tr><td colspan="4" class="muted">…and ${(r.created.length - 200).toLocaleString()} more</td></tr>` : ''}</tbody></table></div>` : ''}`;
    };
    $('#abCheck', dlgForm).onclick = async () => {
      err(''); try { parsed = await read(); const r = await run(true); show(r, true); const go = $('#abGo', dlgForm); go.disabled = !r.created.length; go.textContent = r.created.length ? `Add ${r.created.length.toLocaleString()} parker${r.created.length === 1 ? '' : 's'}` : 'Add'; }
      catch (e) { err(e.message); }
    };
    $('#abGo', dlgForm).onclick = async () => {
      if (!parsed) return; err(''); const go = $('#abGo', dlgForm); go.disabled = true;
      try { const r = await run(false); show(r, false); toast(`${r.created.length.toLocaleString()} parker${r.created.length === 1 ? '' : 's'} added to ${co.name}`); go.textContent = 'Done'; go.onclick = () => dlg.close(); go.disabled = false; $('#abCheck', dlgForm).hidden = true; render(); }
      catch (e) { err(e.message); go.disabled = false; }
    };
  };

  /* ---------- actions ---------- */
  Object.assign(ACT, {
    importMonthly() { window.importMonthlyDialog(); },
    setStaffName() { openForm({ title: 'Who is working the desk?', submit: 'Save', fields: [{ id: 'name', label: 'Your name (goes on every payment and ticket note)', value: store.get('officer') || '', required: true }], onSubmit: v => { store.set('officer', v.name.trim()); toast('Working as ' + v.name.trim()); return true; } }); },
    spView(b) { UI.spView = b.dataset.v; if (b.dataset.v === 'vehicles') UI.vehicle = ''; render(); window.scrollTo(0, 0); },
    deskPick(b, e) { if (e && e.target.closest('.plate')) return; UI.deskTicket = b.dataset.id; UI.deskDone = null; render(); },
    deskClear() { UI.deskTicket = null; UI.deskQ = ''; UI.deskDone = null; render(); const i = $('#deskQ'); if (i) i.focus(); },
    deskGo(b) { UI.spView = 'desk'; UI.deskTicket = b.dataset.id; UI.deskDone = null; UI.tab = 'selfparking'; store.set('tab', UI.tab); render(); },
    deskPay(b) { const s = byId('sessions', b.dataset.id); window.payTicketDialog(b.dataset.id, { close: !s.endAt, after: () => { UI.deskTicket = b.dataset.id; } }); },
    deskClose(b) { window.closeTicketDialog(b.dataset.id); },
    deskTerminal(b) { if (window.terminalCheckout) window.terminalCheckout(b.dataset.id); },
    deskPayEntry(b) { window.payTicketDialog(b.dataset.id, { entry: true, after: () => { UI.deskTicket = b.dataset.id; } }); },
    deskTerminalEntry(b) { if (window.terminalCheckout) window.terminalCheckout(b.dataset.id, { entry: true }); },
    deskCardOnFile(b) { if (window.chargeCardOnFile) window.chargeCardOnFile(b.dataset.id); },
    newTicket(b) { window.newTicketDialog(b.dataset.plate || normPlate(UI.deskQ || ''), UI.deskFac); },
    newValet() { window.newTicketDialog('', UI.valetFac, true); },
    tkPage(b) { UI.tkPage = Math.max(0, UI.tkPage + (+b.dataset.v)); render(); },
    exportTickets() { const rows = ticketRows(); saveFile(`tickets-${UI.tkRange}.csv`, csv([['Ticket', 'Plate', 'Location', 'Type', 'Arrived', 'Departed', 'Minutes', 'Fee', 'Valet fee', 'Late fee', 'Paid', 'Due', 'Validation', 'Status', 'Waived', 'Reason'], ...rows.map(s => { const tz = tzS(s), t = x => x ? new Date(x).toLocaleString('en-US', { timeZone: tz }) : ''; return [tk(s), s.plate, fname(s.facilityId), s.valet ? 'Valet' : s.manual ? 'Manual' : s.mode === 'prepaid' ? 'Prepaid' : s.kind === 'permit' ? 'Monthly' : s.kind === 'vip' ? 'VIP' : 'Camera', t(s.startAt), t(s.endAt), s.startAt ? Math.round(((s.endAt || now()) - s.startAt) / M) : '', R.sessionFee(s).toFixed(2), R.extrasOf(s).toFixed(2), (+s.lateFee || 0).toFixed(2), R.paidOf(s).toFixed(2), R.balanceOf(s).toFixed(2), s.validation ? s.validation.code : '', (STATUS[R.exitStatus(s)] || [0, R.exitStatus(s)])[1], s.waived ? 'yes' : '', s.waiveReason || s.adjustReason || '']; })])); },
    vehicleBack() { UI.vehicle = ''; UI.spView = 'vehicles'; render(); },
    enfCheck(b) { if (!S.roles.includes('enf')) return; UI.role = 'enf'; store.set('role', 'enf'); const pl = b.dataset.plate; const cur = S.sessions.find(s => normPlate(s.plate) === pl && R.isLive(s)); if (cur) UI.enfFac = cur.facilityId; UI.check = { plate: pl, facId: UI.enfFac }; render(); window.scrollTo(0, 0); },
    addVip(b) { window.vipForm(b.dataset.plate ? { plates: [b.dataset.plate] } : null); },
    editVip(b) { window.vipForm(byId('vips', b.dataset.id)); },
    adjustFee(b) { window.adjustTicketDialog(b.dataset.id); },
    reopenTicket(b) { const s = byId('sessions', b.dataset.id); reasonDialog(b.dataset.id, 'reopen', `Reopen ${tk(s)}`, 'Reopen ticket', 'Ticket reopened', { fields: [{ id: 'note', type: 'note', label: 'The car is treated as still on site: parking accrues from the original arrival until you close the ticket again. Payments already taken stay on it.' }] }); },
    removeValidation(b) { const s = byId('sessions', b.dataset.id); reasonDialog(b.dataset.id, 'removeValidation', `Remove validation ${s.validation ? s.validation.code : ''}`, 'Remove', 'Validation removed', { danger: true }); },
    unwaive(b) { reasonDialog(b.dataset.id, 'unwaive', 'Remove waiver', 'Remove waiver', 'Waiver removed'); },
    correctPlate(b) { const s = byId('sessions', b.dataset.id); reasonDialog(b.dataset.id, 'setPlate', `Correct plate ${s.plate}`, 'Save plate', 'Plate corrected', { fields: [{ id: 'plate', label: 'Correct plate', required: true }], args: v => ({ plate: v.plate }) }); },
    addNote(b) { openForm({ title: 'Add note', submit: 'Add note', fields: [{ id: 'text', label: 'Note', type: 'textarea', required: true }], onSubmit: async v => dlgErrorOrOk(await ticketAction(b.dataset.id, 'note', { text: v.text }, 'Note added')) }); },
    printReceipt(b) { window.printReceipt(b.dataset.id); },
    emailReceipt(b) { window.emailReceiptDialog(b.dataset.id); },
    addEntry(b) { const s = byId('sessions', b.dataset.id); openForm({ title: `Arrival for ${s.plate}`, submit: 'Bill the stay', fields: [{ id: 'startAt', label: 'Arrived at', type: 'datetime-local', value: dtLocal(s.endAt - 2 * H), help: 'Use the entry camera photos or the driver’s word. The exit stays as read.' }], onSubmit: async v => dlgErrorOrOk(await ticketAction(s.id, 'review', { decision: 'createEntry', startAt: new Date(v.startAt).getTime() }, r => `Billed ${money(r.fee)}`)) }); },
    dismissReview(b) { reasonDialog(b.dataset.id, 'review', 'Dismiss this exit', 'Dismiss', 'Dismissed', { args: () => ({ decision: 'dismiss' }) }); },
    valetStatus(b) { ticketAction(b.dataset.id, 'valet', { status: b.dataset.v }, `Marked ${b.dataset.v}`); },
    async valetDeliver(b) { const s = byId('sessions', b.dataset.id); if (R.balanceOf(s) > 0) { window.payTicketDialog(s.id, { close: true, after: async () => { await ticketAction(s.id, 'valet', { status: 'delivered' }); render(); } }); return; } const r = await ticketAction(s.id, 'valet', { status: 'delivered' }); if (!r.error) await ticketAction(s.id, 'close', {}, 'Handed over'); },
  });
  Object.assign(FORMS, {
    deskSearch() { UI.deskQ = ($('#deskQ') || {}).value || ''; UI.deskFac = ($('#deskFac') || {}).value || ''; store.set('deskFac', UI.deskFac); UI.deskDone = null;
      // Enter on the car already on screen goes straight to Collect; Enter on a fresh search finds it.
      const cur = UI.deskTicket && byId('sessions', UI.deskTicket), hits = deskHits(UI.deskQ);
      if (cur && !cur.endAt && hits.length === 1 && hits[0].id === cur.id && R.balanceOf(cur) > 0 && can('tickets')) { window.payTicketDialog(cur.id, { close: true, after: () => { UI.deskTicket = cur.id; } }); return; }
      UI.deskTicket = null; render(); },
    vehicleFind() { UI.vehicle = normPlate($('#vhQ').value); UI.spView = 'vehicle'; render(); },
  });
  document.addEventListener('change', e => {
    const id = e.target.id, v = e.target.value;
    if (id === 'tkFac') { UI.tkFac = v; UI.tkPage = 0; render(); } if (id === 'tkType') { UI.tkType = v; UI.tkPage = 0; render(); } if (id === 'tkStatus') { UI.tkStatus = v; UI.tkPage = 0; render(); }
    if (id === 'tkRange') { UI.tkRange = v; UI.tkPage = 0; render(); } if (id === 'tkFrom') { UI.tkFrom = v; render(); } if (id === 'tkTo') { UI.tkTo = v; render(); }
    if (id === 'deskFac') { UI.deskFac = v; store.set('deskFac', v); render(); }
    if (id === 'valetFac') { UI.valetFac = v; render(); }
  });
  let qT; document.addEventListener('input', e => { const id = e.target.id; if (id === 'tkQ' || id === 'vipQ') { clearTimeout(qT); qT = setTimeout(() => { UI[id] = e.target.value; UI.tkPage = 0; render(); }, 220); } });
  const baseAfter2 = afterRender;
  afterRender = function () { baseAfter2(); if (UI.role === 'ops' && UI.tab === 'selfparking' && UI.spView === 'desk' && !dlg.open && !UI.deskTicket) { const i = $('#deskQ'); const ae = document.activeElement || document.body; if (i && ae !== i && !ae.matches('input,select,textarea')) i.focus(); } };
  document.addEventListener('keydown', e => { if (e.key === 'F2' && UI.role === 'ops') { e.preventDefault(); UI.tab = 'selfparking'; UI.spView = 'desk'; UI.deskTicket = null; render(); const i = $('#deskQ'); if (i) { i.focus(); i.select(); } } });
})();
