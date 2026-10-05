/* Hosted-only screens: driver portal (pay by plate, QR lots, monthly parking, accounts), company portal,
   Square card / Apple Pay / Google Pay, reservations, photo evidence, Zebra printing, pay signs and staff admin.
   Loaded after app.js. */
(function () {
  const HX = window.PARKOPS_HOSTED;
  if (!HX) return;

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
  #sq-card{min-height:92px;margin-top:8px}
  .pnav{display:flex;gap:2px;background:var(--surface-2);border-radius:999px;padding:3px;flex-wrap:wrap;justify-self:start}
  .pnav button{border:0;background:none;padding:7px 14px;border-radius:999px;font-weight:600;color:var(--muted);cursor:pointer}
  .pnav button[aria-pressed="true"]{background:var(--surface);color:var(--fg);box-shadow:var(--shadow)}
  .thumbs{display:flex;gap:8px;flex-wrap:wrap}.thumbs figure{margin:0;position:relative}.thumbs img{width:84px;height:84px;object-fit:cover;border-radius:6px;border:1px solid var(--line);display:block}
  .thumbs button{position:absolute;top:2px;right:2px;padding:0 6px;font-size:.75rem}
  .paywith{display:grid;gap:6px;margin:10px 0}.paywith label{display:flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:6px;padding:8px 10px;cursor:pointer}.paywith input{width:auto}
  .owed{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border:1px solid var(--warn);background:var(--warn-soft);border-radius:var(--r);padding:12px 14px}
  .wallets{display:grid;gap:8px;margin:10px 0}.wallets:empty{display:none}
  #apBtn{-webkit-appearance:-apple-pay-button;-apple-pay-button-type:pay;-apple-pay-button-style:black;height:48px;width:100%;border-radius:8px;border:0;cursor:pointer}
  #gpBtn{min-height:48px}
  .durs{display:flex;gap:6px;flex-wrap:wrap}.durs button{flex:1 1 72px;min-height:48px;border:1px solid var(--line);background:var(--surface);border-radius:8px;font-weight:600;cursor:pointer;color:var(--fg)}
  .durs button[aria-pressed="true"]{border-color:var(--accent);background:var(--accent);color:#fff}
  .lothead{display:grid;gap:4px}.lothead .code{font-family:'IBM Plex Mono',monospace;font-size:.9rem;color:var(--muted)}
  .rates{margin:0;padding-left:18px;color:var(--muted);font-size:.9rem}
  .safe{font-size:.82rem;color:var(--muted);border-left:3px solid var(--ok);padding-left:10px}
  .plans{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
  .plan{border:1px solid var(--line);border-radius:var(--r);padding:14px;display:grid;gap:6px;background:var(--surface)}
  .plan b.p{font-size:1.4rem}
  .presets{display:flex;gap:2px;background:var(--surface-2);border-radius:999px;padding:3px;flex-wrap:wrap}
  .presets button{border:0;background:none;padding:6px 12px;border-radius:999px;font-weight:600;font-size:.86rem;color:var(--muted);cursor:pointer;white-space:nowrap}
  .presets button[aria-pressed="true"]{background:var(--surface);color:var(--fg);box-shadow:var(--shadow)}
  .daybar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .daybar .range{font-weight:600}
  .dim{opacity:.55;transition:opacity .15s;pointer-events:none}
  .ch{display:grid;grid-template-columns:auto 1fr;grid-template-rows:170px auto;column-gap:8px;font-size:.74rem;color:var(--muted);padding:6px 4px 0}
  .ch-y{position:relative;min-width:26px;text-align:right}
  .ch-y span{position:absolute;right:0;transform:translateY(50%);line-height:1;font-variant-numeric:tabular-nums}
  .ch-plot{position:relative;border-bottom:1px solid var(--line)}
  .ch-plot .gl{position:absolute;left:0;right:0;height:0;border-top:1px solid var(--line);opacity:.55}
  .ch-bars{position:absolute;inset:0;display:flex;align-items:flex-end}
  .ch-col{flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end;justify-content:center;padding:0 1px}
  .ch-col i{display:block;width:100%;max-width:24px;background:var(--accent);border-radius:4px 4px 0 0}
  .ch-col:hover i{filter:brightness(1.18)}
  .ch-col:hover{background:linear-gradient(var(--surface-2),var(--surface-2))}
  .ch-x{display:flex;grid-column:2}
  .ch-x span{flex:1 1 0;min-width:0;display:flex;justify-content:center;white-space:nowrap;padding-top:6px}
  #chTip{position:fixed;z-index:60;background:var(--fg);color:var(--bg,#fff);padding:6px 10px;border-radius:6px;font-size:.8rem;line-height:1.35;white-space:pre-line;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.25);max-width:260px}
  .daytbl tr[data-act] {cursor:pointer}.daytbl tr[data-act]:hover td{background:var(--surface-2)}
  .kpis.sm .kpi b{font-size:1.55rem}
  .skip-note{font-size:.84rem;color:var(--muted)}`;
  document.head.appendChild(css);
  /* The print area and printNow() are shared with the self-parking screens (tickets.js). */
  const printArea = document.getElementById('printArea') || (() => { const d = document.createElement('div'); d.id = 'printArea'; document.body.appendChild(d); return d; })();

  const api = HX.api;
  const params = new URLSearchParams(location.search);
  function lazy(key, url) {
    if (UI[key] === undefined) { UI[key] = null; api('GET', url).then(d => { UI[key] = d; schedule(); }).catch(e => { UI[key] = { error: e.message }; schedule(); }); }
    return UI[key];
  }
  const refreshAccount = () => api('GET', '/api/account/activity').then(d => { UI.acct = d; schedule(); }).catch(() => { UI.acct = null; });
  const fmtWhen = t => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const tzDefault = () => (S.config && S.config.timeZone) || 'America/Chicago';
  const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^\w-]/g, '');
  const taxNote = base => { const t = R.taxOf(base); return t.tax ? (S.config && S.config.taxIncluded === false ? `${money(t.net)} + ${money(t.tax)} sales tax` : `Includes ${money(t.tax)} sales tax`) : ''; };

  /* ---------- Square: card form, Apple Pay, Google Pay ---------- */
  let sqPayments = null, sqCard = null, wallets = [];
  const loadScript = src => new Promise((res, rej) => { if (window.Square) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Couldn’t load the card form. Check your connection and try again.')); document.head.appendChild(s); });
  async function sq() { const cfg = HX.payments; await loadScript(cfg.sdkUrl); if (!sqPayments) sqPayments = window.Square.payments(cfg.applicationId, cfg.locationId); return sqPayments; }
  async function mountCard(sel) { const p = await sq(); if (sqCard) { try { await sqCard.destroy(); } catch (e) {} } sqCard = await p.card(); await sqCard.attach(sel); }
  async function tokenize(intent, amount) {
    const a = HX.account, parts = (a ? a.name : '').split(' ');
    const vd = { intent, customerInitiated: true, sellerKeyedIn: false, billingContact: { givenName: parts[0] || undefined, familyName: parts.slice(1).join(' ') || undefined, email: a ? a.email : undefined } };
    if (intent !== 'STORE') { vd.amount = Number(amount).toFixed(2); vd.currencyCode = HX.payments.currency || 'USD'; }
    const r = await sqCard.tokenize(vd);
    if (r.status !== 'OK') throw new Error((r.errors && r.errors[0] && r.errors[0].message) || 'Check your card details and try again.');
    return { sourceId: r.token, postalCode: r.details && r.details.billing && r.details.billing.postalCode };
  }
  function clearWallets() { wallets.forEach(w => { try { w.destroy && w.destroy(); } catch (e) {} }); wallets = []; }
  dlg.addEventListener('close', () => { if (sqCard) { sqCard.destroy().catch(() => {}); sqCard = null; } clearWallets(); });

  /* One dialog for every payment. total is what the card is charged (tax included).
     onPay(payment, total) returns {error, amount, code}. When the server says the amount changed, the dialog shows
     the new amount and asks the driver to confirm. The idempotency key stays the same until a definite failure. */
  function payDialog({ title, base, total, summary, submit, store: storeOnly, onPay }) {
    const cfg = HX.payments || {}, saved = !storeOnly && HX.account && HX.account.card;
    if (total == null && base != null) total = R.taxOf(base).total;
    let key = newKey(), busy = false, payReq = null;
    dlgCfg = null;
    dlgForm.innerHTML = `<div class="dlg-h"><h2>${esc(title)}</h2><button type="button" class="btn sm" data-dlg="close">Close</button></div>
    <div class="dlg-b">${summary ? `<p style="margin:0 0 8px">${summary}</p>` : ''}${storeOnly ? '' : `<div class="quote" id="payAmt">${money(total)}</div><div class="note" id="payTax">${esc(base != null ? taxNote(base) : taxNote(total))}</div>`}
      ${!storeOnly && cfg.enabled ? '<div class="wallets" id="walletBox"></div>' : ''}
      ${saved ? `<div class="paywith"><label><input type="radio" name="payWith" value="saved" checked> ${esc(saved.brand || 'Card')} ending ${esc(saved.last4)}</label><label><input type="radio" name="payWith" value="new"> Use another card</label></div>` : ''}
      <div id="sqWrap" ${saved ? 'hidden' : ''}>${cfg.enabled ? '<div id="sq-card"></div>' : '<div class="callout warn">Test mode: Square isn’t connected yet, so no card is charged.</div>'}</div>
      <p id="payErr" class="pill bad" hidden style="margin-top:10px"></p></div>
    <div class="dlg-f"><button type="button" class="btn" data-dlg="close">Cancel</button><button class="btn pri" type="button" id="payGo">${esc(submit || 'Pay ' + money(total))}</button></div>`;
    dlg.showModal();
    const err = m => { const e = $('#payErr', dlgForm); if (!e) return; e.textContent = m; e.hidden = !m; };
    const setTotal = t => { total = t; const a = $('#payAmt', dlgForm); if (a) a.textContent = money(t); const g = $('#payGo', dlgForm); if (g && !submit) g.textContent = 'Pay ' + money(t); const tx = $('#payTax', dlgForm); if (tx) tx.textContent = taxNote(t); if (payReq) try { payReq.update({ total: { amount: t.toFixed(2), label: 'Total' } }); } catch (e) {} };
    let mounted = false;
    const mount = async () => { if (mounted || !cfg.enabled) return; mounted = true; try { await mountCard('#sq-card'); } catch (e) { err(e.message); mounted = false; } };
    if (!saved) mount();
    async function submitWith(getPayment) {
      if (busy) return; busy = true; const btn = $('#payGo', dlgForm); btn.disabled = true; err('');
      try {
        const payment = Object.assign(await getPayment(), { idempotencyKey: key });
        const r = await onPay(payment, total);
        if (r && r.error) {
          if (r.amount != null && Math.abs(r.amount - total) > 0.005) { setTotal(r.amount); err(`The price is now ${money(r.amount)}. Tap pay again to confirm.`); }
          else { err(r.error); if (!/^network$/i.test(r.code || '')) key = newKey(); }
          busy = false; btn.disabled = false; return;
        }
        dlg.close();
      } catch (e) { err(e.message); if (!/^network$/i.test(e.code || '')) key = newKey(); busy = false; btn.disabled = false; }
    }
    dlgForm.querySelectorAll('input[name=payWith]').forEach(r => r.addEventListener('change', () => { const nw = ($('input[name=payWith]:checked', dlgForm) || {}).value === 'new'; $('#sqWrap', dlgForm).hidden = !nw; if (nw) mount(); }));
    $('#payGo', dlgForm).addEventListener('click', () => submitWith(async () => {
      const useSaved = saved && ($('input[name=payWith]:checked', dlgForm) || {}).value === 'saved';
      return useSaved ? { savedCard: true } : cfg.enabled ? await tokenize(storeOnly ? 'STORE' : 'CHARGE', total) : { sourceId: 'sim-token-' + Date.now() };
    }));
    // Apple Pay and Google Pay appear only where the device supports them (Apple Pay also needs your domain registered with Square).
    if (!storeOnly && cfg.enabled) (async () => {
      try {
        const p = await sq(); payReq = p.paymentRequest({ countryCode: 'US', currencyCode: cfg.currency || 'USD', total: { amount: total.toFixed(2), label: 'Total' } });
        const box = $('#walletBox', dlgForm); if (!box) return;
        try { const ap = await p.applePay(payReq); wallets.push(ap); const b = document.createElement('button'); b.type = 'button'; b.id = 'apBtn'; b.setAttribute('aria-label', 'Pay with Apple Pay'); box.appendChild(b); b.onclick = () => submitWith(async () => { const r = await ap.tokenize(); if (r.status !== 'OK') throw new Error('Apple Pay was cancelled.'); return { sourceId: r.token }; }); } catch (e) { /* not available on this device */ }
        try { const gp = await p.googlePay(payReq); wallets.push(gp); const d = document.createElement('div'); d.id = 'gpBtn'; box.appendChild(d); await gp.attach('#gpBtn', { buttonColor: 'black', buttonSizeMode: 'fill', buttonType: 'pay' }); d.onclick = () => submitWith(async () => { const r = await gp.tokenize(); if (r.status !== 'OK') throw new Error('Google Pay was cancelled.'); return { sourceId: r.token }; }); } catch (e) { const d = $('#gpBtn', dlgForm); if (d) d.remove(); }
      } catch (e) { /* wallets unavailable; card form still works */ }
    })();
  }
  function done(r, after) { UI.receipt = r.receipt ? Object.assign({}, r.receipt, { url: r.receiptUrl }) : UI.receipt; if (after) after(); render(); window.scrollTo(0, 0); }
  async function payPortal(op, args, base, title, summary, after, opts) {
    payDialog({ title, base, summary, onPay: async (payment, total) => {
      const r = await HX.portal(op, args, payment, opts && opts.noExpect ? undefined : total); if (r.error) return r;
      await refreshLookup(); if (HX.account) refreshAccount(); done(r, after); return { ok: true };
    } });
  }

  /* ---------- URL entry points ---------- */
  if (params.get('account')) UI.pv = 'account';
  if (params.get('reservation')) { UI.pv = 'reserve'; UI.manageCode = params.get('reservation'); }
  if (params.get('reset')) { UI.pv = 'reset'; UI.resetToken = params.get('reset'); }
  if (params.get('plate')) { UI.lookup = normPlate(params.get('plate')); refreshLookup().then(schedule); }
  if (params.get('lot')) { UI.pv = 'lot'; UI.lotCode = String(params.get('lot')).toUpperCase().replace(/[^A-Z0-9-]/g, ''); }
  if (params.get('company')) { UI.companyToken = String(params.get('company')).replace(/[^A-Za-z0-9]/g, ''); UI.role = 'portal'; }
  if (params.get('extend')) {
    UI.pv = 'lot'; const tok = String(params.get('extend')).replace(/[^A-Za-z0-9]/g, '');
    api('GET', '/api/portal/extend?token=' + encodeURIComponent(tok)).then(d => { UI.extendInfo = d; UI.pp = Object.assign(UI.pp || {}, { plate: d.plate }); schedule(); setTimeout(updatePrepayQuote, 0); })
      .catch(e => { UI.extendInfo = { error: e.message }; schedule(); });
  }
  if (params.get('lot') || params.get('extend') || params.get('company') || params.get('plate')) { UI.role = 'portal'; }
  // Clean one-time links out of the address bar; a company's private link stays so it can be bookmarked.
  if (params.toString()) history.replaceState(null, '', location.pathname + (params.get('company') ? '?company=' + encodeURIComponent(UI.companyToken) : ''));
  UI.pv = UI.pv || 'home';
  let accountLoaded = false;
  const lastPlate = () => { try { return localStorage.getItem('parkops.plate') || ''; } catch (e) { return ''; } };
  const rememberPlate = p => { try { localStorage.setItem('parkops.plate', p); } catch (e) {} };
  const lastPhone = () => { try { return localStorage.getItem('parkops.phone') || ''; } catch (e) { return ''; } };

  function acctPlates() { return (HX.account && HX.account.plates) || []; }
  function plateField(id, label, value) {
    const ps = acctPlates(), v = value != null ? value : ps.length === 1 ? ps[0] : '';
    return `<div class="field"><label for="${id}">${label || 'License plate'}</label><input id="${id}" autocomplete="off" autocapitalize="characters" spellcheck="false" style="text-transform:uppercase" placeholder="ABC1234" list="${id}L" value="${esc(v)}"><datalist id="${id}L">${ps.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>`;
  }

  /* ---------- plate lookup ---------- */
  function lookupHosted(d) {
    if (!d || !d.permits) return '<p class="note" style="margin:0">Couldn’t look up that plate. Try again.</p>';
    let h = '<div class="list" style="border:1px solid var(--line);border-radius:var(--r)">';
    d.permits.forEach(p => {
      const line = p.status === 'approved' ? `A spot opened: pay ${money(R.taxOf(p.due || 0).total)} for the rest of this month to start` : p.status === 'waitlist' ? 'On the waitlist' : p.status === 'suspended' ? 'Suspended for non-payment. Sign in to your account to pay, or contact your employer.' : p.valid ? (p.endAt ? 'Ends ' + fmtDate(p.endAt - 1) : p.paidThrough ? 'Paid through ' + fmtDate(p.paidThrough - 1) : 'Active') : 'Not active';
      h += `<div class="li"><span class="sev ${p.valid ? 'ok' : p.status === 'approved' ? 'warn' : p.status === 'suspended' ? 'bad' : 'info'}"></span><div class="grow"><b>${esc(p.typeName)}</b> <span class="mono">#${esc(p.number)}</span><span class="muted" style="display:block;font-size:.82rem">${esc(line)}</span></div>${p.status === 'approved' ? `<button class="btn sm pri" data-act="payPermitH" data-id="${esc(p.id)}" data-amt="${esc(p.due || 0)}" data-num="${esc(p.number)}">Pay and start</button>` : permitPill({ status: p.status, endAt: p.endAt })}</div>`;
    });
    if (d.member) h += `<div class="li"><span class="sev ok"></span><div class="grow"><b>Autopay is on</b><span class="muted" style="display:block;font-size:.82rem">Garages with cameras charge the card on file when this car leaves</span></div></div>`;
    (d.reservations || []).forEach(r => { h += `<div class="li"><span class="sev info"></span><div class="grow"><b>Reservation</b><span class="muted" style="display:block;font-size:.82rem">${fmtWhen(r.start)} · ${esc(String(r.status).replace('_', ' '))}</span></div></div>`; });
    d.live.forEach(s => { h += `<div class="li"><span class="sev ${s.mode === 'prepaid' && s.paidUntil < now() ? 'warn' : 'info'}"></span><div class="grow"><b>Parked now</b><span class="muted" style="display:block;font-size:.82rem">${s.mode === 'prepaid' ? (s.paidUntil < now() ? 'Paid time ended ' : 'Paid until ') + fmtTime(s.paidUntil) : 'Since ' + fmtTime(s.startAt) + ' · ' + money(s.fee) + ' so far'}${s.validation ? ' · code ' + esc(s.validation) : ''}</span></div></div>`; });
    d.owed.forEach(s => { h += `<div class="li"><span class="sev warn"></span><div class="grow"><b>${money(R.taxOf(s.balance).total)} due</b><span class="muted" style="display:block;font-size:.82rem">${esc(s.facilityName)} · left ${fmtTime(s.endAt)}${s.lateFee ? ' · includes ' + money(s.lateFee) + ' late fee' : ''}</span></div><button class="btn sm pri" data-act="payBalance" data-id="${esc(s.id)}" data-amt="${esc(s.balance)}">Pay</button></div>`; });
    d.citations.forEach(c => { h += `<div class="li" style="flex-wrap:wrap"><span class="sev ${c.status === 'open' ? 'bad' : c.status === 'appeal' ? 'warn' : 'ok'}"></span><div class="grow"><b>${esc(c.violationName)} · ${money(c.fine)}</b><span class="muted" style="display:block;font-size:.82rem">${esc(c.number)} · ${esc(c.facilityName)} · ${fmtTime(c.issuedAt)}${c.appealDecision ? ' · appeal ' + esc(c.appealDecision) : ''}</span>${(c.photoIds || []).length ? `<div class="thumbs" style="margin-top:6px">${c.photoIds.map(id => `<a href="/photos/${esc(id)}" target="_blank" rel="noopener"><img src="/photos/${esc(id)}" alt="Notice photo" loading="lazy"></a>`).join('')}</div>` : ''}</div>
      ${c.status === 'open' ? `<button class="btn sm pri" data-act="payCitation" data-id="${esc(c.id)}" data-amt="${esc(c.fine)}" data-num="${esc(c.number)}">Pay</button>${c.hasAppeal ? '' : `<button class="btn sm" data-act="startAppeal" data-id="${esc(c.id)}">Appeal</button>`}` : citePill(c)}
      ${UI.appealFor === c.id ? `<form data-form="appeal" data-id="${esc(c.id)}" style="flex-basis:100%;display:grid;gap:8px;margin-top:6px"><label for="apText" class="muted" style="font-size:.78rem;font-weight:600">Why should this be dismissed?</label><textarea id="apText"></textarea><div class="row"><button class="btn pri sm">Submit appeal</button><button type="button" class="btn sm" data-act="cancelAppeal">Cancel</button></div></form>` : ''}</div>`; });
    if (!d.permits.length && !d.live.length && !d.owed.length && !d.citations.length && !d.member && !(d.reservations || []).length) h += `<div class="li"><span class="sev ok"></span><div class="grow">Nothing on file for <b>${esc(d.plate)}</b>. You’re all clear.</div></div>`;
    return h + '</div>';
  }

  /* ---------- pay to park (garages, QR lots, add time) ---------- */
  UI.pp = UI.pp || { hours: 2, eod: false };
  function durOptions(f) {
    const r = (f && f.rates) || {}, inc = r.mode !== 'table' && +r.incrementMin < 60 ? [0.5] : [];
    return inc.concat([1, 2, 3, 4, 6, 8]);
  }
  const hLabel = h => h < 1 ? Math.round(h * 60) + ' min' : h + ' hr' + (h > 1 ? 's' : '');
  /* Locations drivers can pay ahead for: open to drivers and not a pay-on-exit garage. */
  const prepayFacs = () => S.facilities.filter(f => f.active !== false && f.onlinePrepay !== false);
  /* The duration buttons a location shows (Locations → Pay buttons): 'standard' = hours, then All day;
     'cap' = hours until the price reaches the daily maximum, then one "N+ hrs" button that pays for the rest of the
     parking day; 'allday' = a single All day price (flat-rate lots). */
  function durButtons(f) {
    const mode = (f && f.payButtons) || 'standard';
    if (mode === 'allday') return [{ v: 'eod', label: 'All day' }];
    const hrs = durOptions(f).map(h => ({ v: h, label: hLabel(h) })), max = +((f && f.rates) || {}).dailyMax || 0;
    if (mode === 'cap' && max > 0) {
      const t = Date.now(), free = Object.assign({}, f, { rates: Object.assign({}, f.rates, { graceMin: 0 }) });
      const i = hrs.findIndex(x => R.charge(free, t, t + x.v * 3600e3) >= max - 0.004);
      if (i >= 0) return hrs.slice(0, i).concat([{ v: 'eod', label: hrs[i].label.replace(/ (hrs?|min)$/, '') + '+ ' + (hrs[i].v < 1 ? 'min' : 'hrs') }]);
    }
    return hrs.concat([{ v: 'eod', label: 'All day' }]);
  }
  /* The choice in effect for a location: the driver's pick when that button exists, else the nearest one. */
  function ppChoice(f) {
    const btns = durButtons(f), pp = UI.pp, nums = btns.filter(b => b.v !== 'eod');
    if (pp.eod && btns.some(b => b.v === 'eod')) return { eod: true, hours: 0 };
    if (!pp.eod && nums.some(b => b.v === pp.hours)) return { eod: false, hours: pp.hours };
    if (!nums.length || (pp.hours > nums[nums.length - 1].v && btns.some(b => b.v === 'eod'))) return { eod: true, hours: 0 };
    return { eod: false, hours: (nums.find(b => b.v === 2) || nums[0]).v };
  }
  function prepayForm(f, opts) {
    const o = opts || {}, pp = UI.pp, sms = HX.sms && HX.sms.enabled, locked = o.plate;
    const facs = o.fixed ? null : prepayFacs(), ch = ppChoice(f);
    return `<form class="panel-b" data-form="prepayH" style="display:grid;gap:14px">
      ${locked ? `<div class="field"><label>License plate</label><div class="plate" style="font-size:1.2rem;justify-self:start">${esc(locked)}</div></div>` : plateField('pPlate', 'License plate', pp.plate != null ? pp.plate : (acctPlates()[0] || lastPlate()))}
      ${facs ? `<div class="field"><label for="pFac">Where are you parked?</label><select id="pFac">${facs.map(x => `<option value="${x.id}" ${x.id === (f && f.id) ? 'selected' : ''}>${esc(x.name)}${x.lotCode ? ' · Lot ' + esc(x.lotCode) : ''}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label>${o.extend ? 'Add how much time?' : 'How long?'}</label><div class="durs">${durButtons(f).map(b => `<button type="button" data-act="ppDur" data-v="${b.v}" aria-pressed="${b.v === 'eod' ? ch.eod : !ch.eod && ch.hours === b.v}">${b.label}</button>`).join('')}</div></div>
      <div class="owed" style="border-color:var(--line);background:var(--surface-2)"><div><div class="quote" id="pQuote">—</div><div class="note" id="pUntil"></div></div><button class="btn pri lg" id="pGo">Continue to payment</button></div>
      ${sms ? `<div class="form-grid"><div class="field"><label for="pPhone">Mobile number (optional)</label><input id="pPhone" type="tel" autocomplete="tel" value="${esc(pp.phone != null ? pp.phone : ((HX.account && HX.account.phone) || lastPhone()))}"></div>
        <div class="field" style="align-self:end"><label class="checks" style="display:flex"><label><input type="checkbox" id="pSms" ${pp.sms === false ? '' : 'checked'}> Text me a receipt and a reminder 15 minutes before time runs out</label></label></div></div>
        <p class="note" style="margin:0">Message and data rates may apply. Reply STOP to opt out, HELP for help.</p>` : ''}
    </form>`;
  }
  let qT, qSeq = 0;
  function updatePrepayQuote() {
    const el = $('#pQuote'); if (!el) return;
    const facId = ($('#pFac') || {}).value || UI.ppFac, plate = normPlate((($('#pPlate') || {}).value) || (UI.extendInfo && UI.extendInfo.plate) || '');
    if (!facId) return;
    const ch = ppChoice(facById(facId)), seq = ++qSeq;
    clearTimeout(qT); qT = setTimeout(async () => {
      try {
        const q = await api('GET', `/api/portal/quote?facilityId=${encodeURIComponent(facId)}&hours=${ch.eod ? 0 : ch.hours}&untilEndOfDay=${ch.eod ? 1 : 0}&plate=${encodeURIComponent(plate)}`);
        if (seq !== qSeq) return; UI.ppQuote = q;
        const f = facById(facId), tz = R.tzOf(f);
        $('#pQuote').textContent = q.amount > 0 ? money(q.total) : 'Covered';
        $('#pUntil').textContent = q.amount > 0 ? `${q.extending ? 'Adds time: paid' : 'Paid'} until ${new Date(q.until).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz })}${q.tax ? ' · ' + taxNote(q.amount) : ''}` : 'Your stay is already covered by the daily maximum for that time.';
        const g = $('#pGo'); if (g) g.disabled = !(q.amount > 0);
      } catch (e) { if (seq === qSeq) $('#pQuote').textContent = '—'; }
    }, 200);
  }
  function startPrepay(fixedFac, extend) {
    const facId = fixedFac || ($('#pFac') || {}).value, f = facById(facId), pp = ppChoice(f);
    const plate = normPlate(extend ? UI.extendInfo.plate : ($('#pPlate') || {}).value);
    if (!plate) { toast('Enter your license plate.', true); return; }
    if (!f) { toast('Choose where you’re parked.', true); return; }
    const phone = ($('#pPhone') || {}).value || '', sms = !!(($('#pSms') || {}).checked && phone.replace(/\D/g, '').length >= 10);
    const q = UI.ppQuote; if (!q || !(q.amount > 0)) { toast('Choose how long you’re staying.', true); return; }
    rememberPlate(plate); if (phone) try { localStorage.setItem('parkops.phone', phone); } catch (e) {}
    const args = { plate, facilityId: f.id, hours: pp.eod ? 0 : pp.hours, untilEndOfDay: !!pp.eod, phone, smsOptIn: sms };
    const until = new Date(q.until).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: R.tzOf(f) });
    payPortal('prepay', args, q.amount, extend ? 'Add time' : 'Pay to park', `<b>${esc(plate)}</b> at ${esc(f.name)}, paid until ${esc(until)}.`, () => { UI.pp.plate = null; UI.extendInfo = extend ? Object.assign({}, UI.extendInfo, { paidUntil: q.until }) : UI.extendInfo; });
  }

  /* ---------- portal pages ---------- */
  function vHome() {
    const list = prepayFacs(), first = list[0], cur = facById(($('#pFac') || {}).value), exitOnly = S.facilities.filter(f => f.active !== false && f.onlinePrepay === false);
    return `<div class="grid g2e">
    <section class="panel"><div class="panel-h"><h2>Pay to park</h2></div>${first ? prepayForm(cur && list.includes(cur) ? cur : first) : '<div class="empty">No parking locations take payment ahead.</div>'}
      <p class="note" style="margin:0 16px 16px">${exitOnly.length ? `${esc(exitOnly.map(f => f.name).join(', '))} charge${exitOnly.length > 1 ? '' : 's'} you when you leave, so there’s nothing to pay ahead there. ` : 'Garages with cameras bill automatically when you leave, so prepaying is optional there. '}Lots with a pay sign need payment before you walk away.</p></section>
    <section class="panel"><div class="panel-h"><h2>Look up a plate</h2></div><div class="panel-b" style="display:grid;gap:12px">
      <form data-form="lookup" class="row"><div class="field"><label for="lkPlate">License plate</label><input id="lkPlate" autocomplete="off" style="text-transform:uppercase" placeholder="ABC1234" value="${esc(UI.lookup)}" data-fresh="1"></div><button class="btn">Look up</button></form>
      ${UI.lookupData ? lookupHosted(UI.lookupData) : '<p class="note" style="margin:0">See balances, citations, monthly parking and reservations for a plate.</p>'}</div></section>
    <section class="panel"><div class="panel-h"><h2>Have a validation code?</h2></div><form class="panel-b" data-form="validate" style="display:grid;gap:12px">
      <div class="form-grid">${plateField('vPlate')}<div class="field"><label for="vCode">Code</label><input id="vCode" style="text-transform:uppercase"></div></div>
      <button class="btn">Apply code</button><p class="note" style="margin:0">Codes come from the business you’re visiting and apply to your current stay.</p></form></section>
    ${HX.account ? '' : `<section class="panel"><div class="panel-h"><h2>Skip the pay station</h2></div><div class="panel-b" style="display:grid;gap:10px"><p class="muted" style="margin:0">Create an account, add your plates and a card, and camera garages charge you automatically on the way out. You also get receipts, monthly parking and reservations.</p><div><button class="btn pri" data-act="pv" data-v="account">Create an account</button></div></div></section>`}
    </div>`;
  }
  function vLot() {
    const ext = UI.extendInfo;
    if (ext && ext.error) return `<section class="panel"><div class="empty">${esc(ext.error)}</div><div class="panel-b"><button class="btn pri" data-act="pv" data-v="home">Pay for parking</button></div></section>`;
    if (UI.extendInfo === undefined && !UI.lotCode) return vHome();
    const f = ext ? facById(ext.facilityId) : S.facilities.find(x => String(x.lotCode || '').toUpperCase() === UI.lotCode);
    if (!f) return ext ? '<section class="panel"><div class="empty">Loading…</div></section>' : `<section class="panel"><div class="empty">We couldn’t find lot ${esc(UI.lotCode)}. Check the number on the sign.</div><div class="panel-b">${S.facilities.length ? `<button class="btn pri" data-act="pv" data-v="home">Choose your location</button>` : ''}</div></section>`;
    UI.ppFac = f.id;
    const tz = R.tzOf(f), host = location.host;
    return `<section class="panel"><div class="panel-b lothead"><span class="code">${f.lotCode ? 'LOT ' + esc(f.lotCode) : ''}</span><h2 style="margin:0">${esc(f.name)}</h2>${f.address && !f.sample ? `<span class="muted">${esc(f.address)}</span>` : ''}
      <ul class="rates">${R.rateSummary(f).map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>
      ${ext && ext.paidUntil ? `<div class="receipt" style="margin:0 16px" role="status"><b>${esc(ext.plate)}</b> is paid until ${esc(new Date(ext.paidUntil).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }))}.</div>` : ''}
      ${prepayForm(f, { fixed: true, plate: ext ? ext.plate : null, extend: !!ext })}
      <div class="panel-b" style="padding-top:0"><p class="safe" style="margin:0">Only pay on <b>${esc(host)}</b>. We never text you a payment link unless you asked for a receipt or reminder. If the code on the sign looks like a sticker or leads anywhere else, don’t pay there.</p></div></section>`;
  }
  function vReserve() {
    const facs = S.facilities.filter(f => +f.reservedSpaces > 0);
    if (!facs.length) return '<section class="panel"><div class="empty">Reservations aren’t available yet.</div></section>';
    const d = new Date(Date.now() + 2 * 3600e3); d.setMinutes(0, 0, 0);
    const a = HX.account;
    return `<div class="grid g2e">
    <section class="panel" style="grid-column:1/-1"><div class="panel-h"><h2>Reserve a spot</h2><span class="muted" style="font-size:.84rem">A guaranteed space in the reserved section</span></div>
    <form class="panel-b" data-form="reserveH" style="display:grid;gap:12px">
      <div class="form-grid">
        <div class="field"><label for="rFac">Garage</label><select id="rFac">${facs.map(f => `<option value="${f.id}">${esc(f.name)} · ${money(R.taxOf(f.reservationPremium || 0).total)} reservation fee</option>`).join('')}</select></div>
        ${plateField('rPlate', 'Plate you’ll arrive in')}
        <div class="field"><label for="rDate">Arrival date</label><input id="rDate" type="date" value="${d.toLocaleDateString('en-CA')}"></div>
        <div class="field"><label for="rTime">Arrival time</label><input id="rTime" type="time" step="900" value="${String(d.getHours()).padStart(2, '0')}:00"></div>
        <div class="field"><label for="rHours">How long?</label><select id="rHours">${[1, 2, 3, 4, 5, 6, 8, 10, 12, 24].map(h => `<option value="${h}" ${h === 3 ? 'selected' : ''}>${h} hour${h > 1 ? 's' : ''}</option>`).join('')}</select></div>
        ${a ? '' : `<div class="field"><label for="rName">Name</label><input id="rName" autocomplete="name"></div><div class="field"><label for="rEmail">Email for the confirmation</label><input id="rEmail" type="email" autocomplete="email"></div>`}
      </div>
      <div class="owed" id="rQuote" style="border-color:var(--line);background:var(--surface-2)">Choose a time to check availability.</div>
      <div class="row"><button class="btn pri lg" id="rGo">Reserve</button></div>
      <p class="note" style="margin:0">Arrive any time from 30 minutes before your arrival time. Your spot is held for ${esc((facs[0].reservationGraceMin || 60))} minutes after it. The reservation fee is paid now; parking is billed at the normal rate when you leave.</p>
    </form></section>
    <section class="panel"><div class="panel-h"><h2>Change or cancel</h2></div><form class="panel-b" data-form="manageRes" style="display:grid;gap:12px">
      <div class="form-grid"><div class="field"><label for="mrCode">Reservation code</label><input id="mrCode" style="text-transform:uppercase" value="${esc(UI.manageCode || '')}"></div><div class="field"><label for="mrEmail">Email</label><input id="mrEmail" type="email" value="${esc(a ? a.email : '')}"></div></div>
      <button class="btn danger">Cancel reservation</button><p class="note" style="margin:0">Free cancellation until ${esc(facs[0].cancelHours ?? 2)} hours before arrival. To change a reservation, cancel it and book again.</p></form></section></div>`;
  }
  let avT;
  function updateResQuote() {
    const el = $('#rQuote'); if (!el) return;
    const f = facById(($('#rFac') || {}).value), dt = $('#rDate').value, tm = $('#rTime').value, h = +$('#rHours').value;
    if (!f || !dt || !tm) return;
    const start = new Date(dt + 'T' + tm).getTime();
    clearTimeout(avT); avT = setTimeout(async () => {
      try {
        const a = await api('GET', `/api/portal/availability?facilityId=${encodeURIComponent(f.id)}&start=${start}&hours=${h}`);
        el.innerHTML = a.left > 0 ? `<span><b>${a.left} of ${a.cap}</b> reserved spots open · ${fmtWhen(start)}</span><span>Reservation fee <b>${money(a.premiumTotal)}</b> now · parking about ${money(R.taxOf(a.estParking).total)} on exit</span>` : `<span><b>Fully booked</b> for that time. Try another time or garage.</span>`;
        const go = $('#rGo'); if (go) go.disabled = a.left <= 0;
      } catch (e) { el.textContent = e.message; }
    }, 250);
  }
  function vMonthlyH() {
    const plans = S.permitTypes.filter(t => t.active !== false).sort((a, b) => a.price - b.price), a = HX.account;
    if (!plans.length) return '<section class="panel"><div class="empty">Monthly parking isn’t open for sign-up right now. Contact the parking office.</div></section>';
    const fnames = t => (t.facilities || []).map(facById).filter(Boolean).map(f => f.name).join(', ') || 'All locations';
    return `<section class="panel"><div class="panel-h"><h2>Monthly parking</h2><span class="muted" style="font-size:.84rem">Billed to your card on the 1st. First month prorated. Cancel any time before the 1st.</span></div>
    <div class="panel-b" style="display:grid;gap:14px"><div class="plans">${plans.map(t => { const left = +t.quota ? Math.max(0, t.quota - (t.sold || 0)) : null; return `<div class="plan"><span class="tag" style="justify-self:start">${t.kind === 'reserved' ? 'Reserved space' : 'Unreserved'}</span><b>${esc(t.name)}</b><b class="p num">${money(t.price)}<span class="muted" style="font-size:.85rem;font-weight:500">/month</span></b><span class="muted" style="font-size:.85rem">${esc(fnames(t))} · up to ${t.maxVehicles || 3} vehicles</span><span class="note">${left === 0 ? 'Full: join the waitlist' : left != null ? left + ' spots left' : 'Spots available'}</span></div>`; }).join('')}</div>
    ${!a ? `<div class="owed" style="border-color:var(--line);background:var(--surface-2)"><span>Sign in or create an account to start. Monthly parking is billed to the card on your account.</span><button class="btn pri" data-act="pv" data-v="account">Sign in or create account</button></div>`
      : !a.card ? `<div class="owed"><span>Add a card to your account first. It’s charged on the 1st of each month.</span><button class="btn pri" data-act="addCard">Add a card</button></div>`
      : `<form data-form="monthlyH" style="display:grid;gap:12px"><div class="form-grid"><div class="field"><label for="moPlan">Plan</label><select id="moPlan">${plans.map(t => `<option value="${t.id}">${esc(t.name)} · ${moneyP(t.price)}/mo</option>`).join('')}</select></div>
        <div class="field"><label for="moPlates">License plates</label><input id="moPlates" style="text-transform:uppercase" value="${esc(acctPlates().join(', '))}"><div class="help">One car parks at a time.</div></div>
        <div class="field"><label for="moPhone">Mobile (for billing alerts)</label><input id="moPhone" type="tel" value="${esc(a.phone || '')}"></div></div>
        <div class="row"><button class="btn pri lg">Start monthly parking</button><span class="note">Charged to ${esc(a.card.brand || 'card')} ending ${esc(a.card.last4)}.</span></div></form>`}
    <p class="note" style="margin:0">Does your employer pay for parking? Ask your company’s parking contact to add you from their company link. If your employer offers a pre-tax commuter benefit, monthly parking usually qualifies (IRS limit ${new Date().getFullYear() >= 2026 ? '$340' : '$325'} a month).</p></div></section>`;
  }
  function vAccount() {
    const a = HX.account;
    if (!a) return `<div class="grid g2e">
      <section class="panel"><div class="panel-h"><h2>Sign in</h2></div><form class="panel-b" data-form="acctLogin" style="display:grid;gap:12px">
        <div class="field"><label for="liEmail">Email</label><input id="liEmail" type="email" autocomplete="email"></div>
        <div class="field"><label for="liPw">Password</label><input id="liPw" type="password" autocomplete="current-password"></div>
        <div class="row"><button class="btn pri">Sign in</button><button type="button" class="btn" data-act="forgotPw">Forgot password?</button></div></form></section>
      <section class="panel"><div class="panel-h"><h2>Create an account</h2></div><form class="panel-b" data-form="acctSignup" style="display:grid;gap:12px">
        <div class="field"><label for="suName">Name</label><input id="suName" autocomplete="name"></div>
        <div class="field"><label for="suEmail">Email</label><input id="suEmail" type="email" autocomplete="email"></div>
        <div class="field"><label for="suPw">Password</label><input id="suPw" type="password" autocomplete="new-password"><div class="help">At least 10 characters.</div></div>
        <div class="field"><label for="suPlates">License plates</label><input id="suPlates" style="text-transform:uppercase" placeholder="ABC1234, XYZ987"></div>
        <div class="field"><label for="suPhone">Mobile (optional)</label><input id="suPhone" type="tel" autocomplete="tel"></div>
        <button class="btn pri">Create account</button></form></section></div>`;
    if (!accountLoaded) { accountLoaded = true; refreshAccount(); }
    const d = UI.acct;
    const owedTotal = d ? +d.owedTotal || 0 : 0;
    const upcoming = d ? d.reservations.filter(r => r.status === 'booked' || r.status === 'arrived') : [];
    const monthly = d ? d.monthly || [] : [];
    const KIND = { prepay: 'Parking', extend: 'Added time', balance: 'Parking balance', citation: 'Citation', reservation: 'Reservation fee', monthly: 'Monthly parking', autopay: 'Parking (autopay)', pay_all: 'Balances' };
    return `<div class="pagehead"><div><h1 style="font-size:1.7rem">Hi, ${esc(a.name.split(' ')[0])}</h1><p>${esc(a.email)}</p></div><button class="btn" data-act="acctLogout">Sign out</button></div>
    ${owedTotal > 0 ? `<div class="owed"><span><b>${money(owedTotal)}</b> is owed on your plates</span><button class="btn pri" data-act="payAll" data-amt="${esc(owedTotal)}">Pay all now</button></div>` : ''}
    <div class="grid g2e">
      <section class="panel"><div class="panel-h"><h2>Card and autopay</h2><span class="pill ${a.autopay && a.card ? 'ok' : ''}">${a.autopay && a.card ? 'Autopay on' : 'Autopay off'}</span></div><div class="panel-b" style="display:grid;gap:12px">
        ${a.card ? `<div class="row" style="justify-content:space-between;align-items:center"><span><b>${esc(a.card.brand || 'Card')}</b> ending ${esc(a.card.last4)} · exp ${esc(a.card.exp || '')}</span><span><button class="btn sm" data-act="addCard">Replace</button> <button class="btn sm danger" data-act="removeCard">Remove</button></span></div>` : `<p class="muted" style="margin:0">Add a card so camera garages can charge you automatically when you drive out, and for monthly parking.</p><div><button class="btn pri" data-act="addCard">Add a card</button></div>`}
        <label class="checks" style="display:flex"><label><input type="checkbox" id="apToggle" ${a.autopay ? 'checked' : ''} data-fresh="1"> Charge my card automatically when I leave a camera garage</label></label>
      </div></section>
      <section class="panel"><div class="panel-h"><h2>My vehicles</h2></div><form class="panel-b" data-form="acctPlates" style="display:grid;gap:12px">
        <div class="field"><label for="apPlates">License plates</label><input id="apPlates" style="text-transform:uppercase" value="${esc(a.plates.join(', '))}" data-fresh="1"><div class="help">Up to 5, separated by commas. A plate you add now only covers parking from now on.</div></div>
        <div class="field"><label for="apPhone">Mobile number (optional)</label><input id="apPhone" type="tel" value="${esc(a.phone || '')}" data-fresh="1"></div>
        <div><button class="btn">Save</button></div></form></section>
      <section class="panel" style="grid-column:1/-1"><div class="panel-h"><h2>Monthly parking</h2><button class="btn sm pri" data-act="pv" data-v="monthly">Add a monthly plan</button></div>
        ${monthly.length ? `<div class="list">${monthly.map(m => `<div class="li"><span class="sev ${m.pastDue ? 'bad' : m.status === 'active' ? 'ok' : 'info'}"></span><div class="grow"><b>${esc(m.plan || 'Monthly')} · #${esc(m.number)}</b><span class="muted" style="display:block;font-size:.82rem">${esc((m.plates || []).join(', '))} · ${m.status === 'waitlist' ? 'On the waitlist' : m.pastDue ? 'Payment failed' + (m.status === 'suspended' ? ', suspended' : '') : m.endAt ? 'Ends ' + fmtDate(m.endAt - 1) : 'Renews on the 1st at ' + money(m.price)}${m.paidThrough ? ' · paid through ' + fmtDate(m.paidThrough - 1) : ''}</span></div>
          ${m.pastDue ? `<button class="btn sm pri" data-act="payMonthly" data-id="${esc(m.id)}" data-amt="${esc(m.amountDue)}">Pay ${money(m.amountDue)}</button>` : ''}${!m.endAt && m.status !== 'cancelled' ? `<button class="btn sm" data-act="cancelMonthlyH" data-id="${esc(m.id)}" data-num="${esc(m.number)}">Cancel</button>` : ''}</div>`).join('')}</div>` : '<div class="empty">No monthly parking.</div>'}</section>
      <section class="panel" style="grid-column:1/-1"><div class="panel-h"><h2>Reservations</h2><button class="btn sm pri" data-act="pv" data-v="reserve">Reserve a spot</button></div>
        ${upcoming.length ? `<div class="list">${upcoming.map(r => `<div class="li"><span class="sev info"></span><div class="grow"><b>${esc(r.code)} · ${esc(r.facilityName)}</b><span class="muted" style="display:block;font-size:.82rem">${fmtWhen(r.start)} to ${new Date(r.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${esc(r.plate)} · ${esc(r.status)}</span></div>${r.status === 'booked' ? `<button class="btn sm danger" data-act="cancelResH" data-code="${esc(r.code)}">Cancel</button>` : ''}</div>`).join('')}</div>` : '<div class="empty">No upcoming reservations.</div>'}</section>
      <section class="panel" style="grid-column:1/-1"><div class="panel-h"><h2>Recent parking</h2></div>
        ${!d ? '<div class="empty">Loading…</div>' : d.sessions.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Location</th><th>Plate</th><th class="r">Time</th><th class="r">Fee</th><th>Status</th></tr></thead><tbody>${d.sessions.map(s => `<tr><td class="num">${fmtTime(s.startAt || s.endAt)}</td><td>${esc(s.facilityName)}</td><td>${plateChip(s.plate)}</td><td class="r num">${s.startAt && s.endAt ? dur(s.endAt - s.startAt) : s.startAt ? 'Parked now' : '—'}</td><td class="r num">${money(s.fee)}</td><td>${s.balance > 0 ? `<span class="pill bad">${money(s.balance)} owed</span>` : `<span class="pill ${s.status === 'onsite' ? 'info' : 'ok'}">${esc((STATUS[s.status] || [0, s.status])[1])}</span>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No parking on your plates in the last 90 days.</div>'}</section>
      ${d && d.payments.length ? `<section class="panel" style="grid-column:1/-1"><div class="panel-h"><h2>Payments and receipts</h2></div><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>For</th><th class="r">Amount</th><th class="r">Tax</th><th>Card</th><th></th></tr></thead><tbody>${d.payments.map(p => `<tr><td class="num">${fmtTime(p.created_at)}</td><td>${esc(KIND[p.kind] || p.kind)} <span class="sub">${esc(p.ref || '')}</span></td><td class="r num">${money(p.amount_cents / 100)}${p.refunded_cents ? `<span class="sub">${money(p.refunded_cents / 100)} refunded</span>` : ''}</td><td class="r num">${p.tax_cents ? money(p.tax_cents / 100) : '—'}</td><td class="mono">${p.card_last4 ? '•••• ' + esc(p.card_last4) : ''}</td><td>${p.receipt_url ? `<a href="${esc(p.receipt_url)}" target="_blank" rel="noopener">Receipt</a>` : ''}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    </div>`;
  }
  function vReset() {
    return `<section class="panel" style="max-width:480px"><div class="panel-h"><h2>Choose a new password</h2></div><form class="panel-b" data-form="resetPw" style="display:grid;gap:12px">
      <div class="field"><label for="rpPw">New password</label><input id="rpPw" type="password" autocomplete="new-password"><div class="help">At least 10 characters.</div></div><button class="btn pri">Save password</button></form></section>`;
  }

  /* ---------- company portal (private link) ---------- */
  function vCompany() {
    const d = lazy('companyData', '/api/company/' + UI.companyToken);
    if (!d) return '<section class="panel"><div class="empty">Loading…</div></section>';
    if (d.error) return `<section class="panel"><div class="empty">${esc(d.error)}</div></section>`;
    const c = d.company, all = d.employees || [], active = all.filter(e => ['active', 'suspended'].includes(e.status));
    const eq = (UI.coEq || '').trim().toLowerCase(), eqp = normPlate(eq), emp0 = eq ? all.filter(e => (e.holder || '').toLowerCase().includes(eq) || (e.email || '').toLowerCase().includes(eq) || String(e.number).includes(eq) || (eqp && (e.plates || []).some(x => normPlate(x).includes(eqp)))) : all;
    if (UI.coEqKey !== eq) { UI.coEqKey = eq; UI.coEPage = 0; }
    const EP = 50, epg = Math.min(UI.coEPage || 0, Math.max(0, Math.ceil(emp0.length / EP) - 1)), emp = emp0.slice(epg * EP, epg * EP + EP), full = c.max && c.left === 0;
    const ipill = st => `<span class="pill ${({ PAID: 'ok', UNPAID: 'warn', SCHEDULED: 'info' })[st] || ''}">${esc(String(st || '').replace('_', ' ').toLowerCase())}</span>`;
    return `<div class="pagehead"><div><h1 style="font-size:1.7rem">${esc(c.name)}</h1><p>Monthly parking for your employees · ${active.length.toLocaleString()} active${c.max ? ` of ${c.max.toLocaleString()} allowed` : ''}${(c.locations || []).length ? ' · ' + esc(c.locations.join(', ')) : ''} · billed ${c.billing === 'invoice' ? 'by Square invoice' : 'to the company card'} on the 1st</p></div></div>
    ${UI.receipt ? `<div class="receipt" role="status"><b>${esc(UI.receipt.title)}</b><br>${esc(UI.receipt.body)}</div>` : ''}
    ${c.billing === 'card' ? `<section class="panel"><div class="panel-h"><h2>Company card</h2></div><div class="panel-b row" style="justify-content:space-between;align-items:center">${c.card ? `<span><b>${esc(c.card.brand || 'Card')}</b> ending ${esc(c.card.last4)} · exp ${esc(c.card.exp || '')}</span>` : '<span class="pill warn">No card on file. Add one so employees’ parking stays active.</span>'}<button class="btn ${c.card ? '' : 'pri'}" data-act="companyCard">${c.card ? 'Replace card' : 'Add a card'}</button></div></section>` : ''}
    ${d.employeeTotal > all.length ? `<div class="callout warn">Showing the first ${all.length.toLocaleString()} of ${d.employeeTotal.toLocaleString()} employees. Ask the parking office for the full list.</div>` : ''}
    ${full ? `<div class="callout warn"><b>You’re at your limit of ${c.max.toLocaleString()} parkers.</b> Remove someone to make room, or ask the parking office to raise the limit.</div>` : ''}
    <section class="panel"><div class="panel-h"><h2>Employees</h2><div class="row">${all.length > 8 ? `<input id="coEq" type="search" placeholder="Find someone" value="${esc(UI.coEq || '')}" data-fresh="1" style="width:180px">` : ''}${full ? '' : '<button class="btn sm" data-act="companyBulk">Add several at once</button>'}</div></div>
      ${emp.length ? `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Plan</th><th>Plates</th><th>Status</th><th></th></tr></thead><tbody>${emp.map(e => `<tr><td><b>${esc(e.holder)}</b><span class="sub">${esc(e.email || '')} · #${esc(e.number)}</span></td><td>${esc(e.plan || '')}</td><td><div class="plates">${(e.plates || []).map(p => `<span class="plate">${esc(p)}</span>`).join('')}</div></td><td>${permitPill({ status: e.status, endAt: e.endAt })}</td><td>${!e.endAt ? `<button class="btn sm" data-act="companyCancel" data-id="${esc(e.id)}" data-name="${esc(e.holder)}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${pager('coEPage', epg, EP, emp0.length)}` : `<div class="empty">${eq ? 'Nobody matches.' : 'No employees yet.'}</div>`}</section>
    ${full ? '' : `<section class="panel"><div class="panel-h"><h2>Add an employee</h2></div><form class="panel-b" data-form="companyAdd" style="display:grid;gap:12px">
      <div class="form-grid"><div class="field"><label for="ceName">Name</label><input id="ceName"></div><div class="field"><label for="ceEmail">Email</label><input id="ceEmail" type="email"></div>
      <div class="field"><label for="cePhone">Mobile (optional)</label><input id="cePhone" type="tel"></div>
      <div class="field"><label for="cePlan">Plan</label><select id="cePlan">${d.plans.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${moneyP(p.price)}/mo${p.left === 0 ? ' · waitlist' : ''}</option>`).join('')}</select></div>
      <div class="field span"><label for="cePlates">License plates</label><input id="cePlates" style="text-transform:uppercase" placeholder="ABC1234, XYZ987"></div></div>
      <div><button class="btn pri">Add employee</button></div><p class="note" style="margin:0">The rest of this month is prorated onto your next bill. Removing someone ends their parking at the end of the paid month.${c.max ? ` You can add up to ${(c.left || 0).toLocaleString()} more.` : ''}</p></form></section>`}
    ${(d.invoices || []).length ? `<section class="panel"><div class="panel-h"><h2>Invoices</h2></div><div class="tbl-wrap"><table><thead><tr><th>Month</th><th class="r">Amount</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${d.invoices.map(i => `<tr><td class="num">${esc(i.period)}</td><td class="r num">${money(i.amount)}</td><td class="num">${esc(i.dueDate || '')}</td><td>${ipill(i.status)}</td><td>${i.publicUrl && i.status !== 'PAID' ? `<a class="btn sm pri" href="${esc(i.publicUrl)}" target="_blank" rel="noopener">Pay</a>` : i.publicUrl ? `<a class="btn sm" href="${esc(i.publicUrl)}" target="_blank" rel="noopener">View</a>` : ''}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <p class="note">This page is private to ${esc(c.name)}. Don’t share the link outside your company.</p>`;
  }

  window.vPortalHosted = function () {
    if (UI.companyToken) return `<div class="enf" style="max-width:980px">${vCompany()}</div>`;
    const a = HX.account, tabs = [['home', 'Pay & look up'], ['monthly', 'Monthly parking'], ['reserve', 'Reserve'], ['account', a ? 'My account' : 'Sign in']];
    const body = { home: vHome, lot: vLot, reserve: vReserve, monthly: vMonthlyH, permits: vMonthlyH, account: vAccount, reset: vReset }[UI.pv] || vHome;
    const lotMode = UI.pv === 'lot';
    return `<div class="enf" style="max-width:980px">
    ${lotMode ? '' : `<section class="portal-hero"><h1>Parking at ${esc(campusName())}</h1><p>Pay by plate, get monthly parking, reserve a guaranteed spot, or settle a parking notice. Garages read your plate at entry and exit, so there’s no ticket.</p></section>`}
    <nav class="pnav" aria-label="Driver portal">${tabs.map(([k, l]) => `<button data-act="pv" data-v="${k}" aria-pressed="${UI.pv === k}">${l}</button>`).join('')}</nav>
    ${UI.receipt ? `<div class="receipt" role="status"><b>${esc(UI.receipt.title)}</b><br>${esc(UI.receipt.body)}${UI.receipt.url ? ` <a href="${esc(UI.receipt.url)}" target="_blank" rel="noopener">View receipt</a>` : ''}${ratingWidget(UI.receipt)}</div>` : ''}
    ${body()}
    ${HX.payments && !HX.payments.enabled ? '<p class="note" style="text-align:center">Test mode: payments are simulated until Square is connected.</p>' : ''}</div>`;
  };

  /* ---------- portal actions ---------- */
  Object.assign(ACT, {
    pv(b) { UI.pv = b.dataset.v; UI.receipt = null; if (UI.pv !== 'lot') { UI.extendInfo = undefined; } render(); window.scrollTo(0, 0); if (UI.pv === 'reserve') setTimeout(updateResQuote, 0); if (UI.pv === 'account' && HX.account) refreshAccount(); },
    ppDur(b) { UI.pp.plate = ($('#pPlate') || {}).value; UI.pp.phone = ($('#pPhone') || {}).value; if ($('#pSms')) UI.pp.sms = $('#pSms').checked; if (b.dataset.v === 'eod') UI.pp.eod = true; else { UI.pp.eod = false; UI.pp.hours = +b.dataset.v; } render(); },
    payBalance(b) { payPortal('payBalance', { sessionId: b.dataset.id }, +b.dataset.amt, 'Pay parking balance'); },
    payCitation(b) { payPortal('payCitation', { citationId: b.dataset.id }, +b.dataset.amt, 'Pay notice ' + b.dataset.num); },
    payPermitH(b) { payPortal('payPermit', { permitId: b.dataset.id }, +b.dataset.amt, 'Start monthly #' + b.dataset.num, 'For the rest of this month. After that, the monthly price is charged on the 1st.', null, { noExpect: true }); },
    payAll(b) {
      payDialog({ title: 'Pay everything owed', total: +b.dataset.amt, summary: 'Covers every unpaid parking balance and open citation on your plates.', onPay: async (payment, total) => {
        try { const r = await api('POST', '/api/account/pay-all', { payment, expectedAmount: total }); await refreshAccount(); await refreshLookup(); done(r); return { ok: true }; } catch (e) { return { error: e.message, amount: e.amount, code: e.code }; }
      } });
    },
    payMonthly(b) {
      payDialog({ title: 'Pay monthly parking', total: +b.dataset.amt, summary: 'Pays this month and reactivates your monthly parking right away.', onPay: async payment => {
        try { const r = await api('POST', '/api/account/monthly/pay', { permitId: b.dataset.id, payment }); await refreshAccount(); done(r); return { ok: true }; } catch (e) { return { error: e.message, code: e.code }; }
      } });
    },
    cancelMonthlyH(b) { confirmBox('Cancel monthly parking', `Cancel monthly #${esc(b.dataset.num)}? It stays active through the time you’ve paid for, and you won’t be charged again.`, 'Cancel monthly parking', async () => { const r = await portalRun('cancelMonthly', { permitId: b.dataset.id }); if (r.error) return r.error; refreshAccount(); done(r); return true; }); },
    addCard() {
      payDialog({ title: 'Add a card', store: true, submit: 'Save card', summary: 'Your card is stored securely by Square. We never see the full number.', onPay: async payment => {
        try { const r = await api('POST', '/api/account/card', payment); HX.account = r.account; toast('Card saved.' + (r.account.autopay ? ' Autopay is on.' : '')); refreshAccount(); render(); return { ok: true }; } catch (e) { return { error: e.message }; }
      } });
    },
    removeCard() { confirmBox('Remove card', 'Remove your saved card? Autopay stops, and monthly parking can’t renew until you add another.', 'Remove card', async () => { try { const r = await api('DELETE', '/api/account/card'); HX.account = r.account; toast('Card removed'); render(); return true; } catch (e) { return e.message; } }); },
    async acctLogout() { await api('POST', '/api/account/logout').catch(() => {}); HX.account = null; UI.acct = null; accountLoaded = false; UI.pv = 'home'; render(); },
    forgotPw() { openForm({ title: 'Reset your password', submit: 'Send reset link', fields: [{ id: 'email', label: 'Account email', type: 'email', required: true }], onSubmit: async v => { await api('POST', '/api/account/reset', { email: v.email }).catch(() => {}); toast('If that email has an account, a reset link is on its way.'); return true; } }); },
    async cancelResH(b) { confirmBox('Cancel reservation', `Cancel reservation ${esc(b.dataset.code)}?`, 'Cancel reservation', async () => { const r = await portalRun('cancelReservation', { code: b.dataset.code, email: HX.account ? HX.account.email : '' }); if (r.error) return r.error; refreshAccount(); done(r); return true; }); },
    companyCard() {
      payDialog({ title: 'Company card', store: true, submit: 'Save card', summary: 'Monthly parking for your employees is charged to this card on the 1st. It’s stored securely by Square.', onPay: async payment => {
        try { await api('POST', '/api/company/' + UI.companyToken + '/card', payment); UI.companyData = undefined; toast('Card saved'); render(); return { ok: true }; } catch (e) { return { error: e.message }; }
      } });
    },
    companyBulk() {
      const d = UI.companyData; if (!d || d.error) return; const plans = d.plans || [], c = d.company; let parsed = null;
      if (!plans.length) { toast('No plan is open to your account yet. Ask the parking office.', true); return; }
      dlgCfg = null;
      dlgForm.innerHTML = `<div class="dlg-h"><h2>Add several employees</h2><button type="button" class="btn sm" data-dlg="close">Close</button></div>
        <div class="dlg-b" style="display:grid;gap:12px"><p class="note" style="margin:0">Paste one person per line: <b>name, email, plates, phone</b>. Several plates: separate with a semicolon. ${c.max ? `You can add up to <b>${(c.left || 0).toLocaleString()}</b> more.` : ''} The rest of this month is added to your next bill.</p>
          <div class="field"><label for="cbPlan">Plan</label><select id="cbPlan">${plans.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${moneyP(p.price)}/mo${p.left === 0 ? ' · waitlist' : ''}</option>`).join('')}</select></div>
          <div class="field"><label for="cbText">The list</label><textarea id="cbText" rows="7" placeholder="Ana Reyes, ana@example.com, ABC1234, 817-555-0100&#10;Ben Ortiz, ben@example.com, XYZ987;QRS456"></textarea></div>
          <div id="cbPrev"></div><p id="cbErr" class="pill bad" hidden></p></div>
        <div class="dlg-f"><button type="button" class="btn" data-dlg="close">Cancel</button><button type="button" class="btn" id="cbCheck">Preview</button><button type="button" class="btn pri" id="cbGo" disabled>Add</button></div>`;
      dlg.showModal();
      const err = m => { const e = $('#cbErr', dlgForm); e.textContent = m || ''; e.hidden = !m; };
      const show = (r, dry) => { $('#cbPrev', dlgForm).innerHTML = `<div class="split"><span><b>${r.created.length.toLocaleString()}</b> ${dry ? 'ready to add' : 'added'}</span><span><b>${r.skipped.length.toLocaleString()}</b> skipped</span></div>${r.skipped.length ? `<div class="imp-prev"><table><thead><tr><th>Line</th><th>Why it was skipped</th></tr></thead><tbody>${r.skipped.slice(0, 100).map(x => `<tr><td class="num">${x.line}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}`; };
      const call = dry => api('POST', '/api/company/' + UI.companyToken + '/parkers', { planId: $('#cbPlan', dlgForm).value, rows: parsed, dryRun: dry });
      $('#cbCheck', dlgForm).onclick = async () => { err(''); try { parsed = window.parseParkerList($('#cbText', dlgForm).value); if (!parsed.length) throw new Error('Paste at least one person.'); if (parsed.length > 300) throw new Error('Up to 300 people at a time. Split the list in two.'); const r = await call(true); show(r, true); const g = $('#cbGo', dlgForm); g.disabled = !r.created.length; g.textContent = r.created.length ? `Add ${r.created.length.toLocaleString()}` : 'Add'; } catch (e) { err(e.message); } };
      $('#cbGo', dlgForm).onclick = async () => { if (!parsed) return; err(''); const g = $('#cbGo', dlgForm); g.disabled = true; try { const r = await call(false); show(r, false); UI.companyData = undefined; toast(`${r.created.length.toLocaleString()} added`); g.textContent = 'Done'; g.onclick = () => dlg.close(); g.disabled = false; $('#cbCheck', dlgForm).hidden = true; render(); } catch (e) { err(e.message); g.disabled = false; } };
    },
    companyCancel(b) { confirmBox('Remove employee', `Remove ${esc(b.dataset.name)}? Their parking stays active through the end of the paid month and isn’t billed again.`, 'Remove', async () => { try { const r = await api('POST', `/api/company/${UI.companyToken}/employees/${b.dataset.id}/cancel`); UI.companyData = undefined; UI.receipt = r.receipt; render(); return true; } catch (e) { return e.message; } }); },
  });
  Object.assign(FORMS, {
    prepayH() { startPrepay(UI.pv === 'lot' ? UI.ppFac : null, UI.pv === 'lot' && UI.extendInfo && !UI.extendInfo.error); },
    reserveH() {
      const f = facById($('#rFac').value), start = new Date($('#rDate').value + 'T' + $('#rTime').value).getTime();
      const args = { facilityId: f.id, plate: $('#rPlate').value, start, hours: +$('#rHours').value, name: ($('#rName') || {}).value || '', email: ($('#rEmail') || {}).value || '' };
      const pre = R.PORTAL.reserve(Object.assign({}, args, { name: args.name || (HX.account || {}).name, email: args.email || (HX.account || {}).email }));
      if (pre.error && !/full/.test(pre.error)) { toast(pre.error, true); return; }
      const fee = +f.reservationPremium || 0;
      const summary = `${esc(f.name)} · ${fmtWhen(start)} for ${args.hours} hour${args.hours > 1 ? 's' : ''} · ${esc(normPlate(args.plate))}. Parking is billed at the normal rate when you leave.`;
      if (fee <= 0) { portalRun('reserve', args).then(r => { if (r.error) toast(r.error, true); else { if (HX.account) refreshAccount(); done(r); } }); return; }
      payPortal('reserve', args, fee, 'Reserve a spot', summary);
    },
    async manageRes() {
      const r = await portalRun('cancelReservation', { code: $('#mrCode').value, email: $('#mrEmail').value });
      if (r.error) { toast(r.error, true); return; } if (HX.account) refreshAccount(); done(r);
    },
    monthlyH() {
      const t = typeById($('#moPlan').value), a = HX.account; if (!t) return;
      const plates = $('#moPlates').value, phone = $('#moPhone').value, first = R.prorate(t), full = +t.quota && (t.sold || 0) >= +t.quota;
      confirmBox(full ? 'Join the waitlist' : 'Start monthly parking', full ? `${esc(t.name)} is full. Join the waitlist? You’re charged only when a spot opens and you accept it.` : `${esc(t.name)} for ${esc(plates.toUpperCase())}. We’ll charge about ${money(R.taxOf(first).total)} now for the rest of this month to your ${esc(a.card.brand || 'card')} ending ${esc(a.card.last4)}, then ${money(R.taxOf(t.price).total)} on the 1st of each month until you cancel.`, full ? 'Join waitlist' : 'Start and pay', async () => {
        const r = await HX.portal('monthlySignup', { planId: t.id, plates, phone }, { idempotencyKey: newKey() });
        if (r.error) return r.error; refreshAccount(); done(r); return true;
      });
    },
    async companyAdd() {
      try { const r = await api('POST', '/api/company/' + UI.companyToken + '/employees', { name: $('#ceName').value, email: $('#ceEmail').value, phone: $('#cePhone').value, planId: $('#cePlan').value, plates: $('#cePlates').value }); UI.companyData = undefined; UI.receipt = r.receipt; ['ceName', 'ceEmail', 'cePhone', 'cePlates'].forEach(i => { const el = $('#' + i); if (el) el.value = ''; }); render(); }
      catch (e) { toast(e.message, true); }
    },
    async acctLogin() {
      try { const r = await api('POST', '/api/account/login', { email: $('#liEmail').value, password: $('#liPw').value }); HX.account = r.account; accountLoaded = false; toast('Signed in'); render(); }
      catch (e) { toast(e.message, true); }
    },
    async acctSignup() {
      try { const r = await api('POST', '/api/account/signup', { name: $('#suName').value, email: $('#suEmail').value, password: $('#suPw').value, plates: $('#suPlates').value, phone: $('#suPhone').value }); HX.account = r.account; accountLoaded = false; UI.receipt = { title: 'Account created', body: 'Add a card below to turn on autopay and monthly parking.' }; render(); }
      catch (e) { toast(e.message, true); }
    },
    async acctPlates() {
      try { const r = await api('PATCH', '/api/account/me', { plates: $('#apPlates').value, phone: $('#apPhone').value }); HX.account = r.account; toast('Saved'); refreshAccount(); render(); }
      catch (e) { toast(e.message, true); }
    },
    async resetPw() {
      try { const r = await api('POST', '/api/account/reset/confirm', { token: UI.resetToken, password: $('#rpPw').value }); HX.account = r.account; UI.pv = 'account'; toast('Password saved. You’re signed in.'); render(); }
      catch (e) { toast(e.message, true); }
    },
  });
  document.addEventListener('change', async e => {
    if (e.target.id === 'apToggle') { try { const r = await api('PATCH', '/api/account/me', { autopay: e.target.checked }); HX.account = r.account; toast(r.account.autopay ? (r.account.card ? 'Autopay on' : 'Autopay will start when you add a card') : 'Autopay off'); render(); } catch (er) { toast(er.message, true); } }
    if (['rFac', 'rDate', 'rTime', 'rHours'].includes(e.target.id)) updateResQuote();
    if (e.target.id === 'pFac') { UI.pp.plate = ($('#pPlate') || {}).value; render(); }
  });
  let pqT; document.addEventListener('input', e => { if (e.target.id === 'pPlate') { clearTimeout(pqT); pqT = setTimeout(updatePrepayQuote, 400); } });
  const baseAfter = afterRender;
  afterRender = function () { baseAfter(); if (UI.role === 'portal') { if (UI.pv === 'reserve') updateResQuote(); if ($('#pQuote')) updatePrepayQuote(); } };

  /* ---------- officer photos ---------- */
  UI.citePhotos = [];
  async function shrink(file) {
    try {
      const bmp = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    } catch (e) { return /jpe?g|png/.test(file.type) ? file : null; }
  }
  window.addCitePhotos = async files => {
    for (const f of [...files].slice(0, 6)) {
      const blob = await shrink(f); if (!blob) { toast('That photo format isn’t supported. Take a JPEG or PNG photo.', true); continue; }
      try { const r = await api('POST', '/api/photos?plate=' + encodeURIComponent(UI.check ? UI.check.plate : ''), blob, blob.type || 'image/jpeg'); UI.citePhotos.push({ id: r.id, url: URL.createObjectURL(blob) }); }
      catch (e) { toast('Photo upload failed: ' + e.message, true); }
    }
    const strip = $('#photoStrip'); if (strip) strip.innerHTML = window.photoStrip();
  };
  window.photoStrip = () => {
    const lpr = lprPhotoFor(UI.check && UI.check.plate, UI.check && UI.check.facId);
    const items = (lpr ? [{ id: lpr, url: '/photos/' + lpr, lpr: true }] : []).concat(UI.citePhotos);
    return items.length ? `<div class="thumbs">${items.map((p, i) => `<figure><img src="${esc(p.url)}" alt="${p.lpr ? 'Camera photo' : 'Officer photo'}">${p.lpr ? '<figcaption class="note">Camera</figcaption>' : `<button type="button" class="btn sm" data-act="rmPhoto" data-i="${i - (lpr ? 1 : 0)}" aria-label="Remove photo">×</button>`}</figure>`).join('')}</div>` : '<span class="note">Camera plate photos are attached automatically when available. Take a photo of the plate and the dashboard.</span>';
  };
  function lprPhotoFor(plate, facId) {
    if (!plate) return null; const pl = normPlate(plate);
    const s = S.sessions.filter(x => normPlate(x.plate) === pl && x.facilityId === facId && x.entryPhotoId).sort((a, b) => b.startAt - a.startAt)[0];
    if (s) return s.entryPhotoId;
    const r = S.feed.find(x => x.plate === pl && x.photoId); return r ? r.photoId : null;
  }
  window.citePhotoIds = (plate, facId) => { const l = lprPhotoFor(plate, facId); return (l ? [l] : []).concat(UI.citePhotos.map(p => p.id)); };
  window.clearCitePhotos = () => { UI.citePhotos.forEach(p => URL.revokeObjectURL(p.url)); UI.citePhotos = []; };
  ACT.rmPhoto = b => { UI.citePhotos.splice(+b.dataset.i, 1); const strip = $('#photoStrip'); if (strip) strip.innerHTML = window.photoStrip(); };

  /* ---------- Zebra printing ---------- */
  const ZSVC = '38eb4a80-c570-11e3-9507-0002a5d5c51b', ZWRITE = '38eb4a82-c570-11e3-9507-0002a5d5c51b';
  const bt = { device: null, ch: null, chunk: 180 };
  const zsafe = s => String(s ?? '').replace(/[\^~\\]/g, ' ').replace(/[^\x20-\x7E -ɏ]/g, '');
  const siteBase = () => HX.webhookBase || location.origin;
  function citationZpl(c) {
    const cfg = S.config || {}, inch = +cfg.printerWidth || 3, W = Math.round(inch * 203) - 16, x = 8, w = W - 16;
    const f = facById(c.facilityId), due = new Date(c.issuedAt + (+cfg.citationDueDays || 14) * 864e5), tz = R.tzOf(f);
    const url = siteBase() + '/c/' + c.number;
    let y = 20, z = '';
    const line = (text, h, opts) => { const o = opts || {}, lines = o.lines || 1; z += `^FO${x},${y}^A0N,${h},${h}^FB${w},${lines},4,${o.align || 'L'},0^FD${zsafe(text)}^FS\n`; y += (h + 4) * lines + (o.gap ?? 8); };
    const rule = () => { z += `^FO${x},${y}^GB${w},3,3^FS\n`; y += 14; };
    line(campusName(), 30, { align: 'C', gap: 2 }); line('PARKING CHARGE NOTICE', inch >= 3 ? 40 : 30, { align: 'C' }); rule();
    line('Notice ' + c.number, 30); line(new Date(c.issuedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }), 24);
    line('Location: ' + (f ? f.name : '') + (f && f.address ? ', ' + f.address : ''), 24, { lines: 2 }); rule();
    line('Plate ' + c.plate + (c.plateState ? ' (' + c.plateState + ')' : ''), inch >= 3 ? 48 : 36);
    line(c.violationName, 28, { lines: 3 }); if (c.notes) line('Notes: ' + c.notes, 22, { lines: 3 });
    line('AMOUNT  ' + money(c.fine), inch >= 3 ? 52 : 40, { gap: 4 }); line('Pay by ' + due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz }), 26); rule();
    line('Pay or dispute online. Scan the code or visit:', 22, { lines: 2, align: 'C' });
    const mag = inch >= 3 ? 6 : 4, qrSize = mag * 33; z += `^FO${Math.max(x, Math.round((W - qrSize) / 2))},${y}^BQN,2,${mag}^FDMA,${url}^FS\n`; y += qrSize + 20;
    line(url, 22, { lines: 2, align: 'C' }); line('Issued by: ' + (c.officer || ''), 22); rule();
    line(noticeLegal(), 18, { lines: 6, gap: 4 }); y += 30;
    return `^XA^CI28^PW${W + 16}^LL${y}^LH0,0\n${z}^XZ`;
  }
  /* ---------- the Bluetooth printer (shared with the live scanner) ----------
     Chrome on Android and the free Bluefy browser on iPhone/iPad can talk to Bluetooth Low Energy printers. Safari on iPhone/iPad can't:
     it has no Bluetooth access at all. Pairing needs a tap; after that the printer reconnects by itself. */
  const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const btListeners = [];
  const btChanged = () => btListeners.forEach(fn => { try { fn(); } catch (e) {} });
  const noBluetooth = () => new Error(IOS ? 'Safari on iPhone and iPad can’t print to Bluetooth printers. Open ParkOps in the free Bluefy app instead.' : 'This browser can’t reach Bluetooth printers. Use Chrome on Android, or Bluefy on iPhone and iPad.');
  const btLive = () => !!(bt.device && bt.ch && bt.device.gatt && bt.device.gatt.connected);
  async function btConnect(opts) {
    if (!navigator.bluetooth) throw noBluetooth();
    if (!bt.device) { // choosing a printer has to start from a tap
      const all = opts && opts.all;
      bt.device = await navigator.bluetooth.requestDevice(all ? { acceptAllDevices: true, optionalServices: [ZSVC] }
        : { filters: [{ services: [ZSVC] }, { namePrefix: 'XX' }, { namePrefix: 'ZQ' }, { namePrefix: 'Zebra' }], optionalServices: [ZSVC] });
      bt.device.addEventListener('gattserverdisconnected', () => { bt.ch = null; btChanged(); });
    }
    if (!btLive()) {
      try { const server = await bt.device.gatt.connect(); bt.ch = await (await server.getPrimaryService(ZSVC)).getCharacteristic(ZWRITE); }
      catch (e) { bt.ch = null; if (e.name === 'NotFoundError') { bt.device = null; throw new Error('That device isn’t a Zebra printer ParkOps can print to. Pick the printer again.'); } throw e; }
    }
    bt.name = bt.device.name || 'Zebra printer'; btChanged();
  }
  async function btWrite(zpl, retried) {
    if (!btLive()) await btConnect();
    const data = new TextEncoder().encode(zpl);
    try {
      for (let i = 0; i < data.length; i += bt.chunk) {
        const part = data.slice(i, i + bt.chunk);
        try { if (bt.ch.writeValueWithoutResponse) await bt.ch.writeValueWithoutResponse(part); else await bt.ch.writeValue(part); }
        catch (e) { if (bt.chunk > 20) { bt.chunk = 20; i = -bt.chunk; continue; } throw e; }
        await new Promise(r => setTimeout(r, 12));
      }
    } catch (e) { bt.ch = null; if (!retried && bt.device) { await new Promise(r => setTimeout(r, 400)); return btWrite(zpl, true); } throw e; } // the printer slept or dropped: reconnect once and send the whole label again
  }
  function testZpl() {
    const inch = +((S.config || {}).printerWidth) || 3, W = Math.round(inch * 203) - 16;
    return `^XA^CI28^PW${W + 16}^LL260^LH0,0\n^FO8,20^A0N,36,36^FB${W - 16},1,4,C,0^FDParkOps printer test^FS\n^FO8,70^A0N,26,26^FB${W - 16},1,4,C,0^FD${zsafe(campusName())}^FS\n^FO8,110^GB${W - 16},3,3^FS\n^FO8,125^A0N,24,24^FB${W - 16},2,4,C,0^FD${zsafe(new Date().toLocaleString('en-US'))} · ${inch} inch paper^FS\n^XZ`;
  }
  window.printerKit = { supported: () => !!navigator.bluetooth, ios: IOS, connected: btLive, name: () => (btLive() ? bt.name : ''), remembered: () => !!bt.device, connect: btConnect, send: btWrite, test: () => btWrite(testZpl()), onChange: fn => { btListeners.push(fn); }, zpl: () => citationZpl };
  const printNow = (html, page) => window.printNow(html, page);
  function printHtml(c) {
    const cfg = S.config || {}, f = facById(c.facilityId), due = new Date(c.issuedAt + (+cfg.citationDueDays || 14) * 864e5), url = siteBase() + '/c/' + c.number;
    printArea.style.setProperty('--pw', (+cfg.printerWidth || 3) + 'in');
    printNow(`<div class="tk"><div class="c">${esc(campusName())}</div><h1>PARKING CHARGE NOTICE</h1><hr><div><b>${esc(c.number)}</b></div><div>${esc(new Date(c.issuedAt).toLocaleString())}</div><div>${esc(f ? f.name : '')}${f && f.address ? ', ' + esc(f.address) : ''}</div><hr>
      <div class="big">${esc(c.plate)}${c.plateState ? ' (' + esc(c.plateState) + ')' : ''}</div><div>${esc(c.violationName)}</div>${c.notes ? `<div>${esc(c.notes)}</div>` : ''}<div class="big">${money(c.fine)}</div><div>Pay by ${esc(due.toLocaleDateString())}</div><hr>
      <div class="c">${window.ParkQR ? `<div style="width:1.3in;margin:0 auto">${ParkQR.svg(url)}</div>` : ''}Pay or dispute online:<br><b>${esc(url)}</b></div><div>Issued by: ${esc(c.officer || '')}</div>
      <div class="legal">${esc(noticeLegal())}</div></div>`);
  }
  /* Private operators in Texas issue parking charges under the terms posted at the entrance, not government citations. */
  const noticeLegal = () => `This is a private parking charge notice issued by ${campusName()} under the terms posted at this facility. It is not a government citation and does not affect your driving record. Pay or dispute it online within ${(S.config || {}).citationDueDays || 14} days.`;
  /* What to do when this browser has no Bluetooth (Safari on iPhone and iPad). */
  window.printHelpDialog = () => {
    const url = location.origin + '/';
    openForm({ title: IOS ? 'Printing from iPhone or iPad' : 'Printing to a Zebra printer', body: `<div style="display:grid;gap:12px">
      <p style="margin:0">${IOS ? 'Safari on iPhone and iPad can’t connect to Bluetooth printers. Apple doesn’t let websites in Safari use Bluetooth.' : 'This browser can’t connect to Bluetooth printers.'} The fix takes a minute and is free:</p>
      <ol style="margin:0;padding-left:20px;display:grid;gap:6px"><li>${IOS ? 'Install <b>Bluefy</b> from the App Store (a free browser made for Bluetooth devices).' : 'Use <b>Chrome</b> on an Android phone or tablet.'}</li>
      <li>${IOS ? 'Open Bluefy, paste the ParkOps address below, and sign in.' : 'Open ParkOps there and sign in.'}</li><li>Turn the Zebra printer on, then tap <b>Connect printer</b> and pick it from the list. Do this once each shift.</li></ol>
      <div class="row"><input readonly value="${esc(url)}" style="flex:1;min-width:0" aria-label="ParkOps address"><button type="button" class="btn" data-hp="copy">Copy address</button></div>
      <p class="note" style="margin:0">Needs a Zebra mobile printer with Bluetooth Low Energy (ZQ220, ZQ320, ZQ510, ZQ520, ZQ610, ZQ620 and newer). The camera works in Bluefy too, so the officer can scan and print in the same app. In the meantime <b>Print dialog</b> sends the notice to any AirPrint printer.</p></div>`, submit: 'Done', fields: [], onSubmit: () => true });
    const cancel = dlgForm.querySelector('[data-dlg=close]:not(.sm)'); if (cancel) cancel.hidden = true;
  };
  dlgForm.addEventListener('click', async e => { const b = e.target.closest('[data-hp=copy]'); if (!b) return; try { await navigator.clipboard.writeText(location.origin + '/'); toast('Address copied'); } catch (x) { const i = b.previousElementSibling; if (i) { i.select(); toast('Select and copy the address'); } } });
  window.printPanel = c => `<section class="panel"><div class="panel-h"><h3>Notice ${esc(c.number)} issued</h3><span class="pill bad">${money(c.fine)}</span></div><div class="panel-b" style="display:grid;gap:10px">
    <div class="row">${navigator.bluetooth ? `<button class="btn pri lg" data-act="printBT" data-id="${c.id}">Print on Zebra (Bluetooth)</button>` : `<button class="btn pri lg" data-act="printHelp">Print on Zebra: how${IOS ? ' on iPhone/iPad' : ''}</button>`}<button class="btn lg" data-act="printSys" data-id="${c.id}">Print dialog</button><button class="btn" data-act="doneCite">Done</button></div>
    <p class="note" style="margin:0">${navigator.bluetooth ? 'The first time, pick your printer from the list; it’s remembered until you close the page.' : IOS ? 'Safari on iPhone and iPad can’t reach Bluetooth printers. Tap the button for the quick fix (a free app called Bluefy).' : 'This browser can’t reach Bluetooth printers.'} The notice has a QR code that opens the pay and dispute page, and says it is a private notice, not a government citation.</p>
    ${(c.photoIds || []).length ? `<div class="thumbs">${c.photoIds.map(id => `<img src="/photos/${esc(id)}" alt="Evidence photo">`).join('')}</div>` : ''}</div></section>`;
  Object.assign(ACT, {
    async printBT(b) { const c = byId('citations', b.dataset.id); b.disabled = true; try { await btWrite(citationZpl(c)); toast('Sent to printer'); } catch (e) { if (e.name !== 'NotFoundError' && e.name !== 'AbortError') toast(e.message, true); } b.disabled = false; },
    printHelp() { window.printHelpDialog(); },
    printSys(b) { printHtml(byId('citations', b.dataset.id)); },
    doneCite() { UI.lastCite = null; UI.check = null; render(); },
  });
  window.citationZpl = citationZpl;

  /* ---------- pay signs for QR lots ---------- */
  const SIGN_SIZES = { letter: ['8.5in 11in', 'Letter (8.5 × 11 in)', 1], s1218: ['12in 18in', '12 × 18 in', 1.45], s1824: ['18in 24in', '18 × 24 in', 2] };
  function signHtml(f, o) {
    const url = siteBase() + '/p/' + encodeURIComponent(f.lotCode), k = SIGN_SIZES[o.size][2], sms = HX.sms && HX.sms.number;
    const v = n => (n * k).toFixed(2) + 'in';
    return `<div class="sign" style="--s1:${v(.95)};--s2:${v(.42)};--s3:${v(.24)};--s4:${v(.16)};--qr:${v(3.6)}">
      <div class="pay">PAY HERE</div><div class="lot">${esc(f.name)}<br>LOT ${esc(f.lotCode)}</div>
      <div class="txt">Scan to pay by license plate. No app needed.</div>
      <div class="qr">${ParkQR.svg(url, { label: 'Pay for parking' })}</div>
      <div class="txt"><b>${esc(url.replace(/^https?:\/\//, ''))}</b></div>
      ${o.text && sms ? `<div class="txt">Or text <b>${esc(f.lotCode)}</b> to <b>${esc(sms)}</b></div>` : ''}
      <ul>${R.rateSummary(f).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="small">Only pay at ${esc(location.host)}. If this code is a sticker or sends you anywhere else, don’t use it.</div>
      ${o.tow ? `<div class="tow">UNAUTHORIZED VEHICLES WILL BE TOWED AT OWNER’S OR OPERATOR’S EXPENSE<br>${esc(o.towCo || '')} ${esc(o.towPhone || '')}${o.towLic ? '<br>TDLR towing license ' + esc(o.towLic) : ''}</div>` : ''}
      ${o.extra ? `<div class="small">${esc(o.extra)}</div>` : ''}</div>`;
  }
  window.signForm = f => {
    if (!f.lotCode) { toast('Give this lot a lot number first (Edit facility).', true); return; }
    const sms = HX.sms && HX.sms.number;
    openForm({ title: 'Pay sign: ' + f.name, submit: 'Print sign', fields: [
      { id: 'size', label: 'Sign size', type: 'select', options: Object.entries(SIGN_SIZES).map(([k, v]) => [k, v[1]]), value: 'letter', help: 'Prints to fit the page. For aluminum signs, save as PDF from the print dialog and send it to your sign shop.' },
      { id: 'text', label: 'Text-to-pay line', type: 'select', options: sms ? [['1', `Show “text ${f.lotCode} to ${sms}”`], ['0', 'Hide']] : [['0', 'Not set up (add a Twilio number first)']], value: sms ? '1' : '0' },
      { id: 'tow', label: 'Tow notice', type: 'select', options: [['0', 'No tow notice'], ['1', 'Add a tow notice block']], value: '0', help: 'Texas tow-away signs have their own size, wording and placement rules (Occupations Code ch. 2308 and TDLR). Use this sign for payment, and have your towing company confirm the separate tow sign.' },
      { id: 'towCo', label: 'Towing company', value: '' }, { id: 'towPhone', label: 'Towing company phone', type: 'tel', value: '' }, { id: 'towLic', label: 'TDLR license number', value: '' },
      { id: 'extra', label: 'Extra line (optional)', value: '', help: 'e.g. “Monthly parking available: call 214-555-0100”' },
    ], onSubmit: v => { printNow(signHtml(f, { size: v.size, text: v.text === '1', tow: v.tow === '1', towCo: v.towCo, towPhone: v.towPhone, towLic: v.towLic, extra: v.extra }), SIGN_SIZES[v.size][0]); return false; },
    extra: `<button type="button" class="btn" id="qrDl">Download QR code (SVG)</button>` });
    $('#qrDl', dlgForm).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ParkQR.svg(siteBase() + '/p/' + encodeURIComponent(f.lotCode), { size: 1024 })], { type: 'image/svg+xml' })); a.download = `lot-${f.lotCode}-qr.svg`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
  };

  /* ---------- staff: reservations ---------- */
  UI.resDay = 0;
  window.vReservations = function () {
    const facs = S.facilities.filter(f => +f.reservedSpaces > 0);
    if (!facs.length) return `<div class="pagehead"><div><h1>Reservations</h1><p>Turn on reservations by giving a facility a reserved section in Facilities & rates.</p></div></div>`;
    if (!facById(UI.resFac) || !(+facById(UI.resFac).reservedSpaces > 0)) UI.resFac = facs[0].id;
    const f = facById(UI.resFac), tz = R.tzOf(f), ds = R.dayStart(now(), f) + UI.resDay * 864e5, de = R.nextDayStart(ds, f);
    const list = S.reservations.filter(r => r.facilityId === f.id && r.end > ds && r.start < de).sort((a, b) => a.start - b.start);
    const holds = S.reservations.filter(r => r.facilityId === f.id && R.resActive(r)).map(r => ({ startAt: r.start - 30 * 60000, endAt: r.status === 'arrived' ? Math.max(r.end, now() + 15 * 60000) : r.end }));
    const conc = R.concurrency(holds, ds, de);
    const n = st => list.filter(r => r.status === st).length;
    const pill = st => `<span class="pill ${({ booked: 'info', arrived: 'ok', completed: '', no_show: 'bad', cancelled: '' })[st] || ''}">${esc(st.replace('_', '-'))}</span>`;
    return `<div class="pagehead"><div><h1>Reservations</h1><p>${esc(f.name)} reserved section: ${f.reservedSpaces} spaces · ${money(f.reservationPremium || 0)} fee · held ${f.reservationGraceMin || 60} min after arrival time.</p></div>
      <select id="resFac" data-fresh="1" style="width:auto">${facs.map(x => `<option value="${x.id}" ${x.id === f.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <div class="daynav"><button class="btn sm" data-act="resDay" data-v="-1" aria-label="Previous day">‹</button><b>${UI.resDay === 0 ? 'Today' : fmtDay(ds + 12 * 3600e3, tz)}</b><button class="btn sm" data-act="resDay" data-v="1" aria-label="Next day">›</button></div></div>
    <div class="kpis"><div class="kpi"><small>Booked</small><b>${n('booked')}</b></div><div class="kpi"><small>Arrived</small><b>${n('arrived') + n('completed')}</b></div><div class="kpi"><small>No-shows</small><b>${n('no_show')}</b></div><div class="kpi"><small>Peak held</small><b>${conc.peak} / ${f.reservedSpaces}</b></div><div class="kpi"><small>Fees collected</small><b>${money0(list.filter(r => r.status !== 'cancelled' || !r.refunded).reduce((s, r) => s + (+r.premium || 0), 0))}</b></div></div>
    <section class="panel"><div class="panel-h"><h2>Reserved spaces held</h2></div><div class="panel-b chart">${stepChart({ pts: conc.pts, from: ds, to: de, cap: +f.reservedSpaces, capLabel: 'Reserved section', tz, label: 'Reserved spaces held' })}</div></section>
    <section class="panel"><div class="panel-h"><h2>Bookings</h2></div>${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Driver</th><th>Plate</th><th>Arrival</th><th>Until</th><th class="r">Fee</th><th>Status</th><th></th></tr></thead><tbody>${list.map(r => `<tr><td class="mono"><b>${esc(r.code)}</b></td><td>${esc(r.name)}<span class="sub">${esc(r.email)}</span></td><td>${plateChip(r.plate)}</td><td class="num">${fmtTime(r.start, tz)}</td><td class="num">${fmtTime(r.end, tz)}</td><td class="r num">${money(r.premium)}${r.refunded ? '<span class="sub">Refunded</span>' : ''}</td><td>${pill(r.status)}</td>
      <td><div class="acts">${r.status === 'booked' ? `<button class="btn sm danger" data-act="staffCancelRes" data-id="${r.id}">Cancel & refund</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No reservations this day.</div>'}</section>`;
  };
  Object.assign(ACT, {
    resDay(b) { UI.resDay = Math.max(-30, Math.min(60, UI.resDay + (+b.dataset.v))); render(); },
    staffCancelRes(b) {
      const r = byId('reservations', b.dataset.id), refund = R.taxOf(+r.premium || 0).total;
      confirmBox('Cancel reservation', `Cancel ${esc(r.code)} for ${esc(r.name)}${r.premium > 0 && r.paymentId ? ` and refund the ${money(refund)} fee` : ''}?`, 'Cancel reservation', async () => {
        if (r.premium > 0 && r.paymentId) { try { await api('POST', '/api/admin/refund', { sqId: r.paymentId, amount: refund, reason: 'Reservation cancelled by staff' }); } catch (e) { return e.message; } }
        return write(db => col(db, 'reservations').doc(r.id).update({ status: 'cancelled', cancelledAt: now(), refunded: !!(r.premium > 0 && r.paymentId) }), 'Reservation cancelled');
      });
    },
  });
  document.addEventListener('change', e => { if (e.target.id === 'resFac') { UI.resFac = e.target.value; render(); } });

  /* ---------- staff: the payments ledger ----------
     Every payment the server knows about: cards through Square (portal, autopay, monthly, Terminal, card on file) and
     cash, checks and external card readers recorded at the exit desk. Reports and the shift close-out read this. */
  const PAYKIND = { prepay: 'Parking (prepaid)', extend: 'Added time', balance: 'Parking balance', citation: 'Notice', reservation: 'Reservation fee', monthly: 'Monthly parking', autopay: 'Parking (autopay)', pay_all: 'Balances (account)', ticket: 'Parking (booth)' };
  const ledgerRows = () => lazy('payList', '/api/admin/payments?limit=5000');
  window.hostedLedger = function () {
    if (!can('payments') && !can('reports')) return null;
    const pays = ledgerRows(); if (!Array.isArray(pays)) return null;
    const out = pays.map(p => ({ id: p.id, at: p.created_at, kind: p.kind, ref: p.ref || '', ticket: p.ticket || (p.kind === 'ticket' ? p.ref : ''), plate: p.plate || '', facilityId: p.facility_id || facilityOfPayment(p), method: p.method || (p.kind === 'autopay' ? 'autopay' : 'online'), amount: p.amount_cents / 100, tax: (p.tax_cents || 0) / 100, net: (p.net_cents != null ? p.net_cents : p.amount_cents) / 100, refunded: (p.refunded_cents || 0) / 100, by: p.staff || '', pid: p.sq_id || '', sessionId: p.session_id || '', note: p.note || '' }));
    // Money recorded before the ledger existed (older office payments on tickets, notices and monthly parkers).
    S.sessions.forEach(s => (s.payments || []).forEach(p => { if (!p.pid && !p.ledgerId && p.method === 'office') { const t = R.taxOf(p.amount); out.push({ at: p.at, kind: 'ticket', ref: R.ticketOf(s), ticket: R.ticketOf(s), plate: s.plate, facilityId: s.facilityId, method: 'office', amount: +p.amount || 0, tax: t.tax, net: t.net, refunded: 0, by: p.by || '', pid: '', sessionId: s.id }); } }));
    S.citations.forEach(c => { if (c.status === 'paid' && c.paidVia === 'office' && c.paidAt) { const t = R.taxOf(c.fine); out.push({ at: c.paidAt, kind: 'citation', ref: c.number, plate: c.plate, facilityId: c.facilityId, method: 'office', amount: +c.fine || 0, tax: t.tax, net: t.net, refunded: 0, by: '' }); } });
    S.permits.forEach(p => { if (p.paidAt && +p.amountPaid && p.billing === 'office') { const pl = typeById(p.permitTypeId); const t = R.taxOf(p.amountPaid); out.push({ at: p.paidAt, kind: 'monthly', ref: '#' + p.number, plate: (p.plates || [])[0] || '', facilityId: (pl && (pl.facilities || [])[0]) || '', method: 'office', amount: +p.amountPaid, tax: t.tax, net: t.net, refunded: 0, by: '' }); } });
    return out.sort((a, b) => b.at - a.at);
  };
  function facilityOfPayment(p) { if (p.session_id) { const s = byId('sessions', p.session_id); if (s) return s.facilityId; } if (p.kind === 'citation') { const c = S.citations.find(x => x.number === p.ref); if (c) return c.facilityId; } return ''; }
  window.hostedUsers = () => { const u = lazy('users', '/api/admin/users'); return Array.isArray(u) ? u : null; };
  window.hostedAudit = () => { const a = lazy('auditAll', '/api/admin/audit?limit=5000'); return Array.isArray(a) ? a : null; };
  /* The server’s change log for one ticket, shown on the ticket timeline. */
  window.ticketAudit = id => { const a = lazy('audit:' + id, '/api/admin/audit?coll=sessions&id=' + encodeURIComponent(id) + '&limit=200'); return Array.isArray(a) ? a : null; };
  /* Overview revenue comes from the server's day totals, so it stays right however many payments a day there are. */
  window.hostedRevenue = function (days) {
    if (!can('payments') && !can('reports')) return null;
    const key = d => dayStr(d.s + 12 * 36e5), e = actGet(key(days[0]), key(days[days.length - 1]), '');
    if (!e.data) return null;
    const by = new Map(e.data.days.map(d => [d.date, d]));
    return days.map(d => { const r = by.get(key(d)); return r ? Object.assign({}, d, { parking: r.parking, citations: r.notices, permits: r.monthly }) : d; });
  };
  /* Reports read what the screen holds (recent tickets and the latest payments); say so when the range reaches further back. */
  window.hostedReportNote = function (rep, from) {
    const parts = [], l = Array.isArray(UI.payList) ? UI.payList : null;
    if (HX.screenSince && from < HX.screenSince) parts.push(`finished tickets from ${fmtFull(HX.screenSince, tzDefault()).replace(/,[^,]*$/, '')} on`);
    if (l && l.length >= 5000 && from < l[l.length - 1].created_at) parts.push(`the latest ${l.length.toLocaleString()} payments (from ${fmtFull(l[l.length - 1].created_at, tzDefault()).replace(/,[^,]*$/, '')})`);
    if (!parts.length) return '';
    return `<div class="callout warn" style="margin:12px 16px 0"><b>This report is incomplete for the days you picked.</b> It reads ${parts.join(' and ')}. For any earlier day, use <b>By day</b> for totals, <b>History</b> for tickets, or <b>By day → Every payment (CSV)</b> for the full list of payments.</div>`;
  };

  /* ---------- exit desk: Square Terminal and card on file ---------- */
  let termTimer = null;
  function terminalBox(state) {
    const el = $('#termBox', dlgForm); if (!el) return;
    el.innerHTML = `<div class="termbox"><div class="amt">${money(state.amount)}</div>${state.busy ? '<div class="spin" aria-hidden="true"></div>' : ''}<div class="st">${esc(state.text)}</div>${state.sub ? `<div class="note">${esc(state.sub)}</div>` : ''}</div>`;
    const c = $('#termCancel', dlgForm); if (c) c.hidden = !state.cancel;
    const d = $('#termDone', dlgForm); if (d) d.hidden = !state.done;
  }
  window.terminalCheckout = async function (id, opts) {
    const s = byId('sessions', id); if (!s) return; opts = opts || {};
    // opts.entry: event night, the flat event rate is charged at the entrance and the ticket stays open.
    const f = facById(s.facilityId), due = opts.entry ? R.entryDue(s) : R.balanceOf(s); if (!(due > 0)) { toast('Nothing is owed on this ticket.'); return; }
    const closeAfter = !s.endAt && !opts.entry;
    dlgCfg = null; clearTimeout(termTimer);
    dlgForm.innerHTML = `<div class="dlg-h"><h2>Square Terminal · ${esc(s.plate)}</h2><button type="button" class="btn sm" data-dlg="close">Close</button></div>
      <div class="dlg-b"><div id="termBox"></div><p class="note" style="margin:0">The amount is sent to the Terminal at ${esc(f ? f.name : 'the booth')}${HX.terminal && HX.terminal.simulated ? ' (simulated until Square is connected)' : ''}. The driver taps or inserts their card on the device. ${closeAfter ? 'The ticket closes when the payment goes through.' : ''}</p></div>
      <div class="dlg-f"><button type="button" class="btn" id="termCancel">Cancel on the device</button><button type="button" class="btn pri" id="termDone" hidden data-dlg="close">Done</button></div>`;
    dlg.showModal();
    terminalBox({ amount: R.taxOf(due).total, text: 'Sending to the Terminal…', busy: true });
    let ck;
    try { ck = await api('POST', '/api/tickets/' + encodeURIComponent(id) + '/terminal', { close: closeAfter, amount: opts.entry ? due : undefined }); }
    catch (e) { terminalBox({ amount: R.taxOf(due).total, text: 'Couldn’t start the Terminal payment', sub: e.message, done: true }); return; }
    const amount = ck.amount;
    $('#termCancel', dlgForm).onclick = async () => { try { await api('POST', '/api/terminal/' + encodeURIComponent(ck.checkoutId) + '/cancel', {}); } catch (e) { toast(e.message, true); } };
    const poll = async () => {
      if (!dlg.open) return;
      let r; try { r = await api('GET', '/api/terminal/' + encodeURIComponent(ck.checkoutId)); } catch (e) { terminalBox({ amount, text: 'Waiting for Square…', sub: e.message, busy: true, cancel: true }); termTimer = setTimeout(poll, 3000); return; }
      if (r.status === 'COMPLETED') {
        terminalBox({ amount, text: 'Paid on the Terminal', sub: (r.closed ? 'Ticket closed. ' : '') + (r.overpaid ? `The card was charged ${money(r.overpaid)} more than is owed now; refund it from the ticket. ` : '') + (r.receiptUrl ? 'Square emailed or printed the receipt.' : ''), done: true });
        UI.deskDone = { id, change: null, amount }; UI['audit:' + id] = undefined; UI.payList = undefined; actReset(); render(); return;
      }
      if (r.status === 'CANCELED' || r.status === 'CANCEL_REQUESTED') { terminalBox({ amount, text: r.status === 'CANCELED' ? 'Cancelled' : 'Cancelling…', sub: r.cancelReason ? String(r.cancelReason).replace(/_/g, ' ').toLowerCase() : 'No payment was taken.', done: r.status === 'CANCELED', busy: r.status !== 'CANCELED' }); if (r.status !== 'CANCELED') termTimer = setTimeout(poll, 2000); return; }
      terminalBox({ amount, text: r.status === 'IN_PROGRESS' ? 'Driver is paying on the device…' : 'Waiting for the driver to tap…', busy: true, cancel: true });
      termTimer = setTimeout(poll, 2000);
    };
    termTimer = setTimeout(poll, 1500);
  };
  dlg.addEventListener('close', () => { clearTimeout(termTimer); });
  window.chargeCardOnFile = function (id) {
    const s = byId('sessions', id); if (!s) return;
    const due = R.balanceOf(s), member = s.memberId ? byId('members', s.memberId) : R.memberForPlate(normPlate(s.plate));
    confirmBox('Charge the card on file', `Charge ${money(R.taxOf(due).total)} to ${esc(member ? member.name : 'the driver')}’s card on file${member && member.card ? ' ending ' + esc(member.card) : ''} for ticket ${esc(R.ticketOf(s))}?${!s.endAt ? ' The ticket closes when the charge goes through.' : ''}`, 'Charge card', async () => {
      try { const r = await api('POST', '/api/tickets/' + encodeURIComponent(id) + '/chargeCard', { close: !s.endAt }); UI.deskDone = { id, change: null, amount: r.amount }; UI.payList = undefined; actReset(); toast(r.repeat ? 'That charge already went through.' : `Charged ${money(r.total)}${r.closed ? ' · ticket closed' : ''}`); render(); return true; }
      catch (e) { return e.message; }
    });
  };
  /* Refund a card payment from the ticket page (Square refunds go back to the same card). */
  window.refundByPid = true;
  ACT.refundPid = b => {
    openForm({ title: 'Refund card payment', submit: 'Refund', danger: true, fields: [{ id: 'amount', label: 'Amount ($)', type: 'number', step: '0.01', value: (+b.dataset.max).toFixed(2), required: true }, { id: 'reason', label: 'Reason', required: true }],
      onSubmit: async v => { if (!(+v.amount > 0 && +v.amount <= +b.dataset.max + 0.005)) return `Enter up to ${money(b.dataset.max)}.`; try { await api('POST', '/api/admin/refund', { sqId: b.dataset.pid, amount: +v.amount, reason: v.reason }); toast('Refunded ' + money(v.amount)); UI.payList = undefined; actReset(); return true; } catch (e) { return e.message; } } });
  };

  /* ---------- staff: payments tab (ledger, tax, hot list) ---------- */
  /* Sales tax by month: added up on the server from every payment, so it is complete however busy the year was. */
  function taxRange() { const t = dayStr(Date.now()), [y, m] = t.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 - 11, 1)); return [d.toISOString().slice(0, 10), t]; }
  function taxMonths() {
    const [f, t] = taxRange(), e = actGet(f, t, ''); if (!e.data) return e.err ? { error: e.err } : null;
    const m = new Map();
    e.data.days.forEach(d => { const k = d.date.slice(0, 7), r = m.get(k) || { month: k, gross: 0, refunds: 0, tax: 0, count: 0 }; r.gross += d.net + d.refunds; r.refunds += d.refunds; r.tax += d.tax; r.count += d.payments; m.set(k, r); });
    return [...m.values()].filter(r => r.count).sort((a, b) => b.month.localeCompare(a.month));
  }
  window.vPayments = function () {
    const pays = ledgerRows(), l = window.hostedLedger() || [];
    const hot = R.hotList();
    const cfg = HX.payments || {};
    const tmr = taxMonths(), tm = Array.isArray(tmr) ? tmr : [];
    const methodName = p => ParkRules.METHODS[p.method] || p.method || '';
    return `<div class="pagehead"><div><h1>Payments</h1><p>${cfg.enabled ? `Square ${esc(cfg.env)} is connected.` : 'Test mode: Square isn’t connected, so card payments are simulated.'} Refunds go back to the original card. Card disputes are handled in your Square Dashboard. Cash, checks and Terminal payments taken at the exit desk are here too.</p></div>
      <button class="btn" data-act="reloadPays">Refresh</button><a class="btn" href="/api/admin/collections.csv" data-perm="export">Export for collections</a><button class="btn" data-act="goTab" data-tab="reports" data-perm="reports">Reports</button></div>
    ${tm.length ? `<section class="panel"><div class="panel-h"><h2>Sales tax by month</h2><button class="btn sm" data-act="exportTax" data-perm="export">Export CSV</button></div><div class="tbl-wrap"><table><thead><tr><th>Month</th><th class="r">Payments</th><th class="r">Collected</th><th class="r">Refunded</th><th class="r">Net</th><th class="r">Sales tax (${esc(String((S.config || {}).taxRate || 0))}%)</th></tr></thead><tbody>${tm.slice(0, 12).map(r => `<tr><td class="num">${esc(r.month)}</td><td class="r num">${r.count}</td><td class="r num">${money(r.gross)}</td><td class="r num">${money(r.refunds)}</td><td class="r num">${money(r.gross - r.refunds)}</td><td class="r num"><b>${money(r.tax)}</b></td></tr>`).join('')}</tbody></table></div>
      <div class="panel-b note" style="padding-top:8px">Added up from every payment the system has recorded, last 12 months. Check your filing figures with your accountant.</div></section>` : ''}
    <section class="panel"><div class="panel-h"><h2>Hot list</h2><span class="muted" style="font-size:.84rem">Plates that owe ${money((S.config || {}).hotListAmount || 100)} or more, or have ${(S.config || {}).hotListCount || 3}+ open notices. Staff get an alert when one enters.</span></div>
      ${hot.length ? `<div class="tbl-wrap"><table><thead><tr><th>Plate</th><th class="r">Owed</th><th class="r">Unpaid exits</th><th class="r">Open notices</th></tr></thead><tbody>${hot.map(h => `<tr><td>${plateChip(h.plate)}</td><td class="r num"><b>${money(h.debt.total)}</b></td><td class="r num">${h.debt.owed.length}</td><td class="r num">${h.debt.cits.length}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No plates on the hot list.</div>'}</section>
    <section class="panel"><div class="panel-h"><h2>Recent payments</h2></div>
      ${!pays ? '<div class="empty">Loading…</div>' : pays.error ? `<div class="empty">${esc(pays.error)}</div>` : l.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Plate</th><th>Method</th><th class="r">Amount</th><th class="r">Tax</th><th>Taken by</th><th></th></tr></thead><tbody>${l.slice(0, 300).map(p => `<tr><td class="num">${fmtTime(p.at)}</td><td>${esc(PAYKIND[p.kind] || p.kind)}</td><td class="mono">${esc(p.ref || '')}${p.sessionId ? ` <button class="btn sm" data-act="openTicket" data-id="${esc(p.sessionId)}">Ticket</button>` : ''}</td><td>${esc(p.plate || '')}</td><td>${esc(methodName(p))}${String(p.pid || '').startsWith('sim_') ? '<span class="sub">Simulated</span>' : ''}</td><td class="r num">${money(p.amount)}${p.refunded ? `<span class="sub">${money(p.refunded)} refunded</span>` : ''}</td><td class="r num">${p.tax ? money(p.tax) : '—'}</td><td>${esc(p.by || '')}</td>
        <td><div class="acts">${p.pid && p.amount > p.refunded ? `<button class="btn sm" data-act="refund" data-id="${esc(p.id)}" data-max="${esc(p.amount - p.refunded)}" data-perm="refunds">Refund</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No payments yet.</div>'}</section>`;
  };
  Object.assign(ACT, {
    reloadPays() { UI.payList = undefined; actReset(); render(); },
    exportTax() { const tm = taxMonths(); if (!Array.isArray(tm)) { toast('Still adding it up. Try again in a moment.', true); return; } saveFile('sales-tax-by-month.csv', csv([['Month', 'Payments', 'Collected', 'Refunded', 'Net', 'Sales tax'], ...tm.map(r => [r.month, r.count, r.gross.toFixed(2), r.refunds.toFixed(2), (r.gross - r.refunds).toFixed(2), r.tax.toFixed(2)])])); },
    refund(b) {
      openForm({ title: 'Refund payment', submit: 'Refund', fields: [{ id: 'amount', label: 'Amount ($)', type: 'number', step: '0.01', value: (+b.dataset.max).toFixed(2), required: true }, { id: 'reason', label: 'Reason', value: '' }],
        onSubmit: async v => { if (!(+v.amount > 0 && +v.amount <= +b.dataset.max + 0.005)) return `Enter up to ${money(b.dataset.max)}.`; try { await api('POST', '/api/admin/refund', { id: b.dataset.id, amount: +v.amount, reason: v.reason }); toast('Refunded ' + money(v.amount)); UI.payList = undefined; actReset(); return true; } catch (e) { return e.message; } } });
    },
  });

  /* ---------- staff: ticket history ----------
     Every ticket ever recorded is kept in the server's database. The other screens hold the last few months in memory;
     this one searches the whole database, so a ticket from three years ago is as easy to find as one from today. */
  const fmtFull = (t, tz) => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '—';
  const fmtMins = m => m == null ? '—' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  const fmtBytes = n => !n ? '0 KB' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
  const HIST_PAGE = 50;
  const histParams = () => { const p = new URLSearchParams(); if (UI.histQ) p.set('q', UI.histQ); if (UI.histFac) p.set('facility', UI.histFac); if (UI.histFrom) p.set('from', UI.histFrom); if (UI.histTo) p.set('to', UI.histTo); if (UI.histStatus) p.set('status', UI.histStatus); return p; };
  function histLoad() {
    const p = histParams(); p.set('limit', HIST_PAGE); p.set('offset', UI.histOff || 0);
    const mine = UI.histSeq = (UI.histSeq || 0) + 1; UI.histBusy = true;
    api('GET', '/api/admin/history?' + p).then(d => { if (mine === UI.histSeq) { UI.hist = d; UI.histBusy = false; render(); } }).catch(e => { if (mine === UI.histSeq) { UI.hist = { error: e.message }; UI.histBusy = false; render(); } });
  }
  const histPreset = () => { const f = UI.histFrom || '', t = UI.histTo || ''; if (!f && !t) return 'all'; for (const [k] of PRESETS) { const d = presetDates(k); if (d && d[0] === f && d[1] === t) return k; } return 'custom'; };
  function histPresetPicked(v) {
    const set = (f, t) => { $('#hFrom').value = f; $('#hTo').value = t; };
    if (v === 'all') set('', ''); else if (v !== 'custom') { const d = presetDates(v); set(d[0], d[1]); } else { const el = $('#hFrom'); if (el) el.focus(); return; }
    FORMS.histSearch();
  }
  const histStatus = r => !r.endAt ? '<span class="pill info">On site</span>' : r.waived ? '<span class="pill">Waived</span>' : r.cited ? '<span class="pill">Cited</span>' : r.due > 0 ? '<span class="pill bad">Unpaid</span>' : '<span class="pill ok">Paid</span>';
  window.vHistory = function () {
    if (UI.hist === undefined) { UI.hist = null; histLoad(); }
    const h = UI.hist, rows = (h && h.rows) || [], total = (h && h.total) || 0, off = UI.histOff || 0, facs = S.facilities;
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(v) === String(cur || '') ? 'selected' : ''}>${esc(l)}</option>`;
    const filtered = !!(UI.histQ || UI.histFac || UI.histFrom || UI.histTo || UI.histStatus);
    return `<div class="pagehead"><div><h1>Ticket history</h1><p>Every ticket ever recorded is kept on the server and can be found here, however old. The other screens show only the most recent months, to stay fast.</p></div>
      <a class="btn" href="/api/admin/history.csv?${esc(histParams().toString())}" data-perm="export">Export ${filtered ? 'these results' : 'everything'} (CSV)</a></div>
    <section class="panel"><form class="panel-b filters" data-form="histSearch" autocomplete="off">
      <input id="hQ" type="search" placeholder="Plate or ticket number" value="${esc(UI.histQ || '')}" style="text-transform:uppercase">
      <select id="hFac" style="flex:0 1 200px">${opt('', 'All locations', UI.histFac)}${facs.map(f => opt(f.id, f.name, UI.histFac)).join('')}</select>
      <select id="hStatus" style="flex:0 1 150px">${opt('', 'Any status', UI.histStatus)}${opt('open', 'On site now', UI.histStatus)}${opt('closed', 'Left', UI.histStatus)}</select>
      <select id="hPreset" style="flex:0 1 150px" aria-label="Dates">${opt('all', 'Any date', histPreset())}${PRESETS.map(([k, l]) => opt(k, l, histPreset())).join('')}</select>
      <label class="field" style="flex:0 1 160px"><span class="help">From</span><input id="hFrom" type="date" value="${esc(UI.histFrom || '')}"></label>
      <label class="field" style="flex:0 1 160px"><span class="help">To</span><input id="hTo" type="date" value="${esc(UI.histTo || '')}"></label>
      <button class="btn pri">Search</button>${filtered ? '<button type="button" class="btn" data-act="histReset">Clear</button>' : ''}</form></section>
    <section class="panel"><div class="panel-h"><h2>${UI.histBusy ? 'Searching…' : h && !h.error ? `${total.toLocaleString()} ticket${total === 1 ? '' : 's'}${filtered ? ' match' : ' saved'}` : 'Tickets'}</h2>
      ${total > HIST_PAGE ? `<div class="row" style="align-items:center;gap:8px"><span class="muted" style="font-size:.84rem">${(off + 1).toLocaleString()}–${Math.min(total, off + HIST_PAGE).toLocaleString()}</span><button class="btn sm" data-act="histPage" data-v="-1" ${off <= 0 ? 'disabled' : ''}>‹ Newer</button><button class="btn sm" data-act="histPage" data-v="1" ${off + HIST_PAGE >= total ? 'disabled' : ''}>Older ›</button></div>` : ''}</div>
      ${!h ? '<div class="empty">Loading…</div>' : h.error ? `<div class="empty">${esc(h.error)}</div>` : rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Ticket</th><th>Plate</th><th>Location</th><th>Arrived</th><th>Left</th><th class="r">Time</th><th class="r">Charged</th><th class="r">Balance</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(r => { const tz = R.tzOf(facById(r.facilityId)); return `<tr><td class="mono">${esc(r.ticket)}</td><td>${plateChip(r.plate)}</td><td>${esc(r.facility)}</td><td class="num">${fmtFull(r.startAt, tz)}</td><td class="num">${fmtFull(r.endAt, tz)}</td><td class="r num">${fmtMins(r.minutes)}</td><td class="r num">${r.total == null ? '—' : money(r.total)}</td><td class="r num">${r.due > 0 ? `<b>${money(r.due)}</b>` : '—'}</td><td>${histStatus(r)}</td><td><div class="acts"><button class="btn sm" data-act="histOpen" data-id="${esc(r.id)}">Open</button></div></td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty">${filtered ? 'No tickets match. Try fewer filters, or part of the plate.' : 'No tickets recorded yet.'}</div>`}</section>`;
  };
  FORMS.histSearch = () => {
    const v = id => ($('#' + id) || {}).value || '';
    UI.histQ = v('hQ').trim(); UI.histFac = v('hFac'); UI.histStatus = v('hStatus'); UI.histFrom = v('hFrom'); UI.histTo = v('hTo'); UI.histOff = 0;
    if (UI.histFrom && UI.histTo && UI.histFrom > UI.histTo) { toast('The “from” date is after the “to” date.', true); return; }
    histLoad(); render();
  };
  /* A ticket from before the screens’ memory window opens here as a read-only record; recent ones open on the normal ticket page. */
  async function histDetail(id) {
    dlgCfg = null;
    dlgForm.innerHTML = `<div class="dlg-h"><h2>Ticket</h2><button type="button" class="btn sm" data-dlg="close">Close</button></div><div class="dlg-b"><div class="empty">Loading…</div></div>`;
    dlg.showModal();
    let d; try { d = await api('GET', '/api/admin/history/' + encodeURIComponent(id)); } catch (e) { dlgForm.querySelector('.dlg-b').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const r = d.row, tz = R.tzOf(facById(r.facilityId)), b = d.bill || {};
    const fact = (k, v) => `<div><small class="muted">${k}</small><div>${v}</div></div>`;
    dlgForm.innerHTML = `<div class="dlg-h"><h2>Ticket ${esc(r.ticket)} · ${esc(r.plate)}</h2><button type="button" class="btn sm" data-dlg="close">Close</button></div>
      <div class="dlg-b" style="display:grid;gap:14px">
        <div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${fact('Location', esc(r.facility || '—'))}${fact('Arrived', fmtFull(r.startAt, tz))}${fact('Left', r.endAt ? fmtFull(r.endAt, tz) : 'Still on site')}${fact('Time parked', fmtMins(r.minutes))}${fact('Charged', r.total == null ? '—' : money(r.total))}${fact('Paid', money(r.paid || 0))}${fact('Balance', r.due > 0 ? `<b>${money(r.due)}</b>` : '—')}${fact('Status', histStatus(r))}${r.validation ? fact('Validation', esc(r.validation)) : ''}${d.plateOriginal ? fact('Plate as first read', esc(d.plateOriginal)) : ''}${d.valet ? fact('Valet', `Key ${esc(d.valet.tag || '—')} · ${esc(d.valet.space || '')}`) : ''}</div>
        ${d.notes ? `<div class="note">${esc(d.notes)}</div>` : ''}
        ${d.photos && (d.photos.entry || d.photos.exit) ? `<div class="row">${d.photos.entry ? `<a class="btn sm" href="/photos/${esc(d.photos.entry)}" target="_blank" rel="noopener">Entry photo</a>` : ''}${d.photos.exit ? `<a class="btn sm" href="/photos/${esc(d.photos.exit)}" target="_blank" rel="noopener">Exit photo</a>` : ''}<span class="note">Photos are removed after a set number of days unless a notice was issued (Settings shows how many).</span></div>` : ''}
        <div><b>Payments</b>${d.payments.length ? `<div class="tbl-wrap"><table><thead><tr><th>When</th><th>How</th><th class="r">Amount</th><th>Taken by</th></tr></thead><tbody>${d.payments.map(x => `<tr><td class="num">${fmtFull(x.at, tz)}</td><td>${esc(ParkRules.METHODS[x.method] || x.method)}${x.simulated ? '<span class="sub">Simulated</span>' : ''}</td><td class="r num">${money(x.amount)}${x.refunded ? `<span class="sub">${money(x.refunded)} refunded</span>` : ''}</td><td>${esc(x.by)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="note">No payments recorded.</div>'}</div>
        <div><b>What happened</b>${d.history.length ? `<div class="list">${d.history.map(x => `<div class="li"><div class="grow"><b>${esc(String(x.action || '').replace(/_/g, ' '))}</b>${x.by ? `<span class="muted"> · ${esc(x.by)}</span>` : ''}${x.detail ? `<div class="muted" style="font-size:.84rem">${esc(x.detail)}</div>` : ''}</div><span class="muted num">${fmtFull(x.at, tz)}</span></div>`).join('')}</div>` : '<div class="note">No changes recorded.</div>'}</div>
      </div>
      <div class="dlg-f"><button type="button" class="btn" data-dlg="close">Close</button></div>`;
  }
  Object.assign(ACT, {
    histPage(b) { UI.histOff = Math.max(0, (UI.histOff || 0) + HIST_PAGE * (+b.dataset.v)); histLoad(); render(); window.scrollTo(0, 0); },
    histReset() { Object.assign(UI, { histQ: '', histFac: '', histFrom: '', histTo: '', histStatus: '', histOff: 0 }); histLoad(); render(); },
    histOpen(b) { if (byId('sessions', b.dataset.id)) return ACT.openTicket(b); histDetail(b.dataset.id); },
  });

  /* ---------- staff: activity by day ----------
     Pick any day, or a run of days, and see what happened: cars in and out, when they arrived, what was collected, who left
     without paying. The numbers come from the server's database, so it reaches back as far as your records go. */
  const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['lastmonth', 'Last month'], ['mtd', 'This month'], ['year', 'This year'], ['custom', 'Pick dates']];
  const dayStr = t => new Date(t).toLocaleDateString('en-CA', { timeZone: tzDefault() });
  const addDay = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  function presetDates(p) {
    const t = dayStr(Date.now());
    if (p === 'today') return [t, t];
    if (p === 'yesterday') { const y = addDay(t, -1); return [y, y]; }
    if (p === 'week') return [addDay(t, -6), t];
    if (p === 'month') return [addDay(t, -29), t];
    if (p === 'mtd') return [t.slice(0, 8) + '01', t];
    if (p === 'lastmonth') { const last = addDay(t.slice(0, 8) + '01', -1); return [last.slice(0, 8) + '01', last]; }
    if (p === 'year') return [t.slice(0, 5) + '01-01', t];
    return null;
  }
  const dayLabel = (str, withYear) => new Date(str + 'T12:00:00Z').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
  const shortDay = str => new Date(str + 'T12:00:00Z').toLocaleDateString([], { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

  /* One request per (range, location); a range that includes today is asked again every couple of minutes. */
  const actMap = new Map();
  function actReset() { actMap.clear(); }
  window.actReset = actReset;
  function actGet(from, to, fac) {
    const key = [from, to, fac || '', to >= dayStr(Date.now()) ? Math.floor(Date.now() / 12e4) : ''].join('|');
    let e = actMap.get(key);
    if (!e) {
      e = { data: null, err: '' }; actMap.set(key, e); if (actMap.size > 30) actMap.delete(actMap.keys().next().value);
      api('GET', '/api/admin/activity?from=' + from + '&to=' + to + (fac ? '&facility=' + encodeURIComponent(fac) : '')).then(d => { e.data = d; schedule(); }).catch(err => { e.err = err.message || 'Couldn’t load'; schedule(); });
    }
    return e;
  }

  /* A bar chart in plain HTML: hairline grid, bars no thicker than 24px with a rounded top, labels in text colours, hover for the number. */
  function niceTop(v, ticks) { if (!(v > 0)) return ticks; const raw = v / ticks, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e, n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return n * e * ticks; }
  function barChart(items, o) {
    o = o || {}; const max = Math.max(0, ...items.map(i => i.v)), ticks = 4, top = o.int && max <= 4 ? Math.max(1, Math.ceil(max)) : niceTop(max, ticks), tn = o.int && max <= 4 ? top : ticks, fmt = o.fmt || (x => x.toLocaleString());
    const step = Math.max(1, Math.ceil(items.length / (o.labels || 8))), ys = Array.from({ length: tn + 1 }, (_, i) => top * i / tn);
    return `<div class="ch" role="img" aria-label="${esc(o.aria || 'Chart')}">
      <div class="ch-y">${ys.map(y => `<span style="bottom:${y / top * 100}%">${esc(fmt(y))}</span>`).join('')}</div>
      <div class="ch-plot">${ys.slice(1).map(y => `<div class="gl" style="bottom:${y / top * 100}%"></div>`).join('')}<div class="ch-bars">${items.map(i => `<div class="ch-col" data-tip="${esc(i.tip)}"><i style="height:${i.v / top * 100}%${i.v > 0 ? ';min-height:2px' : ''}"></i></div>`).join('')}</div></div>
      <div class="ch-x">${items.map((i, k) => `<span>${k % step === 0 ? esc(i.label) : ''}</span>`).join('')}</div></div>`;
  }
  (function () {
    const tip = document.createElement('div'); tip.id = 'chTip'; tip.hidden = true; document.body.appendChild(tip);
    const place = e => { const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX + 12)) + 'px'; tip.style.top = (e.clientY - h - 12 < 4 ? e.clientY + 18 : e.clientY - h - 12) + 'px'; };
    document.addEventListener('mouseover', e => { const c = e.target.closest && e.target.closest('[data-tip]'); if (!c) { tip.hidden = true; return; } tip.textContent = c.dataset.tip; tip.hidden = false; place(e); });
    document.addEventListener('mousemove', e => { if (!tip.hidden) place(e); });
    document.addEventListener('scroll', () => { tip.hidden = true; }, true);
  })();
  const weekStart = str => { const d = new Date(str + 'T12:00:00Z'), k = (d.getUTCDay() + 6) % 7; return addDay(str, -k); };
  /* Past about four months the daily bars get too thin to read, so they become weekly bars. */
  function bucketed(days) {
    if (days.length <= 120) return days.map(d => Object.assign({}, d, { label: shortDay(d.date), name: dayLabel(d.date, true) }));
    const m = new Map();
    days.forEach(d => { const k = weekStart(d.date), b = m.get(k) || { date: k, arrivals: 0, departures: 0, net: 0, parking: 0, monthly: 0, notices: 0, refunds: 0, tax: 0, leftUnpaid: 0, days: 0 }; ['arrivals', 'departures', 'net', 'parking', 'monthly', 'notices', 'refunds', 'tax', 'leftUnpaid'].forEach(f => { b[f] += d[f]; }); b.days++; m.set(k, b); });
    return [...m.values()].map(b => Object.assign(b, { label: shortDay(b.date), name: 'Week of ' + dayLabel(b.date, true) }));
  }
  const money0 = n => '$' + Math.round(n).toLocaleString();
  const moneyK = n => n >= 1e6 ? '$' + +(n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? '$' + Math.round(n / 1e3) + 'k' : money0(n);
  const stay = m => m == null ? '—' : m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  const fmtHour = h => (h % 12 || 12) + (h < 12 ? 'a' : 'p');
  const fmtHourLong = h => (h % 12 || 12) + ':00 ' + (h < 12 ? 'am' : 'pm');
  function dailyRange() {
    let [from, to] = presetDates(UI.dyPreset || 'week') || [UI.dyFrom, UI.dyTo];
    if (!from || !to) { [from, to] = presetDates('week'); }
    if (from > to) [from, to] = [to, from];
    return [from, to];
  }
  window.vDaily = function () {
    if (!UI.dyPreset) UI.dyPreset = 'week';
    const [from, to] = dailyRange(), fac = UI.dyFac || '', e = actGet(from, to, fac);
    if (e.data) UI.dyLast = e.data;
    const rep = e.data || UI.dyLast, loading = !e.data && !e.err, stale = loading && rep, single = from === to;
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(v) === String(cur || '') ? 'selected' : ''}>${esc(l)}</option>`;
    const thisYear = dayStr(Date.now()).slice(0, 4), multiYear = from.slice(0, 4) !== to.slice(0, 4) || from.slice(0, 4) !== thisYear;
    const heading = single ? dayLabel(from, true) : dayLabel(from, multiYear) + ' – ' + dayLabel(to, multiYear);
    const qs = `from=${from}&to=${to}${fac ? '&facility=' + encodeURIComponent(fac) : ''}`;
    let body = '';
    if (e.err && !rep) body = `<section class="panel"><div class="empty">${esc(e.err)}</div></section>`;
    else if (!rep) body = '<section class="panel"><div class="empty">Loading…</div></section>';
    else {
      const T = rep.totals, days = rep.days, nonEmpty = days.some(d => d.arrivals || d.departures || d.payments);
      const first = rep.firstTicketAt ? dayStr(rep.firstTicketAt) : '';
      const kpi = (label, val, sub, alert) => `<div class="kpi ${alert ? 'alert' : ''}"><small>${label}</small><b>${val}</b><span>${sub || '&nbsp;'}</span></div>`;
      const lead = Math.max(0, days.findIndex(d => d.arrivals || d.departures || d.payments)), live = days.slice(lead), bk = bucketed(live), weekly = live.length > 120;
      const inTip = d => `${d.name}\n${d.arrivals.toLocaleString()} cars in · ${d.departures.toLocaleString()} out`;
      const cashTip = d => `${d.name}\n${money(d.net)} collected${d.refunds ? '\n' + money(d.refunds) + ' refunded' : ''}\n${money(d.parking)} parking · ${money(d.monthly)} monthly · ${money(d.notices)} notices`;
      const hoursChart = barChart(rep.hours.map((n, h) => ({ v: n, label: h % 3 === 0 ? fmtHour(h) : '', tip: `${fmtHourLong(h)}–${fmtHourLong((h + 1) % 24)}\n${n.toLocaleString()} car${n === 1 ? '' : 's'} arrived${single ? '' : ' (all days added up)'}` })), { int: true, labels: 24, aria: 'Cars arriving, by hour of the day' });
      const methodName = m => ParkRules.METHODS[m] || m;
      const rows = (UI.dyAll ? days.slice().reverse() : days.slice().reverse().slice(0, 62));
      body = `<div class="kpis sm">
        ${kpi('Cars in', T.arrivals.toLocaleString(), single ? '' : `${Math.round(T.arrivals / Math.max(1, live.length)).toLocaleString()} a day`)}
        ${kpi('Cars out', T.departures.toLocaleString(), T.monthlyVisits ? `${T.monthlyVisits.toLocaleString()} were monthly parkers` : '')}
        ${kpi('Collected', money0(T.net), `${money0(T.parking)} parking · ${money0(T.monthly)} monthly${T.notices ? ' · ' + money0(T.notices) + ' notices' : ''}`)}
        ${kpi('Average stay', stay(T.avgMinutes), 'Cars that left in this period')}
        ${kpi('Left without paying', T.leftUnpaid.toLocaleString(), T.leftUnpaid ? `${money0(T.leftUnpaidAmount)} not collected` : 'Nothing owed', T.leftUnpaid > 0)}
        ${kpi('Sales tax included', money0(T.tax), T.refunds ? `After ${money0(T.refunds)} of refunds` : 'In what was collected')}</div>
      ${nonEmpty ? '' : `<section class="panel"><div class="empty">Nothing was recorded ${single ? 'on this day' : 'in these days'}${first && from < first ? `. Your records begin ${dayLabel(first, true)}.` : '.'}</div></section>`}
      ${nonEmpty ? `<div class="grid g2e">
        <section class="panel"><div class="panel-h"><h2>${single ? 'Cars arriving, by hour' : 'Cars in' + (weekly ? ', by week' : ', by day')}</h2></div><div class="panel-b">${single ? hoursChart : barChart(bk.map(d => ({ v: d.arrivals, label: d.label, tip: inTip(d) })), { int: true, aria: 'Cars in by ' + (weekly ? 'week' : 'day') })}</div></section>
        <section class="panel"><div class="panel-h"><h2>${single ? 'When they came' : 'Collected' + (weekly ? ', by week' : ', by day')}</h2></div><div class="panel-b">${single
          ? `<div style="display:grid;gap:8px;font-size:.92rem"><div>Busiest hour: <b>${(() => { const mx = Math.max(...rep.hours); return mx ? fmtHourLong(rep.hours.indexOf(mx)) + ' (' + mx.toLocaleString() + ' cars)' : '—'; })()}</b></div><div>Collected: <b>${money(T.net)}</b> from ${T.payments.toLocaleString()} payment${T.payments === 1 ? '' : 's'}</div>${T.refunds ? `<div>Refunded: <b>${money(T.refunds)}</b></div>` : ''}</div>`
          : barChart(bk.map(d => ({ v: Math.max(0, d.net), label: d.label, tip: cashTip(d) })), { fmt: moneyK, aria: 'Money collected by ' + (weekly ? 'week' : 'day') })}</div></section>
        ${single ? '' : `<section class="panel"><div class="panel-h"><h2>When cars arrive</h2><span class="muted" style="font-size:.84rem">${live.length === 1 ? 'The one day' : 'All ' + live.length + ' days'} added up</span></div><div class="panel-b">${hoursChart}</div></section>`}
        <section class="panel"><div class="panel-h"><h2>By location</h2></div><div class="tbl-wrap"><table><thead><tr><th>Location</th><th class="r">Cars in</th><th class="r">Cars out</th><th class="r">Collected</th></tr></thead><tbody>${rep.byFacility.filter(f => f.arrivals || f.departures || f.revenue).map(f => `<tr><td>${esc(f.name)}</td><td class="r num">${f.arrivals.toLocaleString()}</td><td class="r num">${f.departures.toLocaleString()}</td><td class="r num">${money(f.revenue)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing recorded.</td></tr>'}</tbody></table></div></section>
        <section class="panel"><div class="panel-h"><h2>How people paid</h2></div><div class="tbl-wrap"><table><thead><tr><th>Method</th><th class="r">Payments</th><th class="r">Amount</th></tr></thead><tbody>${rep.byMethod.length ? rep.byMethod.map(m => `<tr><td>${esc(methodName(m.method))}</td><td class="r num">${m.count.toLocaleString()}</td><td class="r num">${money(m.amount)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">No payments.</td></tr>'}</tbody></table></div></section></div>` : ''}
      ${nonEmpty && !single ? `<section class="panel"><div class="panel-h"><h2>Day by day</h2><span class="muted" style="font-size:.84rem">Click a day to see its tickets</span></div><div class="tbl-wrap"><table class="daytbl"><thead><tr><th>Day</th><th class="r">Cars in</th><th class="r">Cars out</th><th class="r">Average stay</th><th class="r">Left without paying</th><th class="r">Collected</th><th class="r">Refunded</th><th class="r">Sales tax</th></tr></thead><tbody>${rows.map(d => `<tr data-act="dayOpen" data-d="${d.date}"><td>${dayLabel(d.date, multiYear)}</td><td class="r num">${d.arrivals.toLocaleString()}</td><td class="r num">${d.departures.toLocaleString()}</td><td class="r num">${d.avgMinutes == null ? '—' : fmtMins(d.avgMinutes)}</td><td class="r num">${d.leftUnpaid ? `${d.leftUnpaid.toLocaleString()} · ${money(d.leftUnpaidAmount)}` : '—'}</td><td class="r num">${money(d.net)}</td><td class="r num">${d.refunds ? money(d.refunds) : '—'}</td><td class="r num">${money(d.tax)}</td></tr>`).join('')}</tbody><tfoot><tr><td><b>Total</b></td><td class="r num"><b>${T.arrivals.toLocaleString()}</b></td><td class="r num"><b>${T.departures.toLocaleString()}</b></td><td class="r num"><b>${T.avgMinutes == null ? '—' : fmtMins(T.avgMinutes)}</b></td><td class="r num"><b>${T.leftUnpaid.toLocaleString()}</b></td><td class="r num"><b>${money(T.net)}</b></td><td class="r num"><b>${money(T.refunds)}</b></td><td class="r num"><b>${money(T.tax)}</b></td></tr></tfoot></table></div>
        ${days.length > rows.length ? `<div class="panel-b"><button class="btn sm" data-act="dayAll">Show all ${days.length} days</button></div>` : ''}</section>` : ''}
      ${single && nonEmpty ? `<div class="row"><button class="btn pri" data-act="dayOpen" data-d="${from}">See this day’s tickets</button></div>` : ''}
      <p class="skip-note">Days run midnight to midnight in ${esc(rep.timeZone)}. “Left without paying” counts cars that left owing money that was not paid, waived or sent as a notice. Collected is net of refunds.</p>`;
    }
    return `<div class="pagehead"><div><h1>Activity by day</h1><p>Pick any day, or a run of days, and see what happened. It reaches back as far as your records go.</p></div>
      <div class="row"><a class="btn" href="/api/admin/activity.csv?${esc(qs)}" data-perm="export">Summary (CSV)</a><a class="btn" href="/api/admin/payments.csv?${esc(qs)}" data-perm="export">Every payment (CSV)</a></div></div>
    <section class="panel"><div class="panel-b" style="display:grid;gap:12px">
      <div class="presets" role="group" aria-label="Dates">${PRESETS.map(([k, l]) => `<button type="button" data-act="dyPreset" data-v="${k}" aria-pressed="${(UI.dyPreset || 'week') === k}">${l}</button>`).join('')}</div>
      <div class="daybar">
        ${UI.dyPreset === 'custom' ? `<label class="field" style="flex:0 1 160px"><span class="help">From</span><input id="dyFrom" type="date" value="${esc(from)}" max="${esc(dayStr(Date.now()))}" data-dyfield="1"></label><label class="field" style="flex:0 1 160px"><span class="help">To</span><input id="dyTo" type="date" value="${esc(to)}" max="${esc(dayStr(Date.now()))}" data-dyfield="1"></label>` : ''}
        <button class="btn sm" data-act="dyStep" data-v="-1" aria-label="Earlier">‹ Earlier</button><button class="btn sm" data-act="dyStep" data-v="1" aria-label="Later" ${to >= dayStr(Date.now()) ? 'disabled' : ''}>Later ›</button>
        <span class="range">${esc(heading)}</span>${loading ? '<span class="muted">Loading…</span>' : ''}
        <span style="flex:1"></span>
        <select id="dyFac" style="flex:0 1 220px" aria-label="Location">${opt('', 'All locations', fac)}${S.facilities.map(f => opt(f.id, f.name, fac)).join('')}</select>
        <button class="btn sm" data-act="dyRefresh">Refresh</button></div></div></section>
    <div class="${stale ? 'dim' : ''}" style="display:grid;gap:14px">${body}</div>`;
  };
  document.addEventListener('change', e => {
    if (e.target.id === 'dyFac') { UI.dyFac = e.target.value; render(); }
    else if (e.target.dataset && e.target.dataset.dyfield) { const f = ($('#dyFrom') || {}).value, t = ($('#dyTo') || {}).value; if (f && t) { UI.dyFrom = f; UI.dyTo = t; UI.dyAll = false; render(); } }
    else if (e.target.id === 'hPreset') { histPresetPicked(e.target.value); }
  });
  Object.assign(ACT, {
    dyPreset(b) { const k = b.dataset.v; if (k === 'custom') { const [f, t] = dailyRange(); UI.dyFrom = f; UI.dyTo = t; } UI.dyPreset = k; UI.dyAll = false; render(); },
    dyStep(b) { /* move the whole window earlier or later by its own length */
      const [f, t] = dailyRange(), n = Math.round((Date.parse(t + 'T00:00:00Z') - Date.parse(f + 'T00:00:00Z')) / 864e5) + 1, v = +b.dataset.v, today = dayStr(Date.now());
      let nf = addDay(f, n * v), nt = addDay(t, n * v); if (nt > today) { nt = today; nf = addDay(nt, -(n - 1)); }
      UI.dyFrom = nf; UI.dyTo = nt; UI.dyPreset = 'custom'; UI.dyAll = false; render();
    },
    dyRefresh() { actReset(); render(); },
    dayAll() { UI.dyAll = true; render(); },
    dayOpen(b) { Object.assign(UI, { histQ: '', histFac: UI.dyFac || '', histStatus: '', histFrom: b.dataset.d, histTo: b.dataset.d, histOff: 0 }); UI.hist = undefined; ACT.goTab({ dataset: { tab: 'history' } }); },
  });

  /* ---------- staff: people & access, system, activity log ---------- */
  const ROLE_HELP = { owner: 'Everything, including staff accounts', manager: 'Everything except staff accounts', attendant: 'Exit desk, tickets, valet, notices and reservations', accountant: 'Reports, payments, refunds, monthly billing and exports', viewer: 'Read-only' };
  window.hostedSettings = function () {
    if (!can('users') && !can('settings')) return '';
    const users = can('users') ? lazy('users', '/api/admin/users') : null, audit = lazy('audit', '/api/admin/audit?limit=100'), out = can('settings') ? lazy('outbox', '/api/admin/outbox') : null;
    const cfg = HX.payments || {}, sm = out && out.sms, term = HX.terminal || {};
    return `<div class="grid g2e">
    ${can('users') ? `<section class="panel" style="grid-column:1/-1"><div class="panel-h"><h2>People & access</h2><button class="btn sm pri" data-act="addUser">Invite staff</button></div>
      ${!users ? '<div class="empty">Loading…</div>' : users.error ? `<div class="empty">${esc(users.error)}</div>` : `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>${users.map(u => `<tr><td><b>${esc(u.name)}</b><span class="sub">${esc(u.email)}</span></td><td>${esc(ParkRules.ROLE_NAMES[u.role] || u.role)}<span class="sub">${esc(ROLE_HELP[u.role] || '')}</span></td><td>${!u.active ? '<span class="pill">Off</span>' : u.invited ? `<span class="pill ${u.inviteExpired ? 'warn' : 'info'}">${u.inviteExpired ? 'Invitation expired' : 'Invited'}</span>` : '<span class="pill ok">Active</span>'}</td><td class="num">${u.last_login ? fmtTime(u.last_login) : 'Never'}</td>
        <td><div class="acts">${u.active && (u.invited || !u.last_login) ? `<button class="btn sm" data-act="reinvite" data-id="${u.id}">Resend invitation</button>` : ''}<button class="btn sm" data-act="editUser" data-id="${u.id}">Edit</button></div></td></tr>`).join('')}</tbody></table></div>
      <div class="panel-b note" style="padding-top:8px">Roles are enforced by the server on every request, not just by hiding buttons. ${HX.email ? 'Invitations are emailed with a link to choose a password.' : 'Email isn’t set up, so invitations show you a link to pass on yourself.'}</div>`}</section>` : ''}
    ${can('settings') ? `<section class="panel"><div class="panel-h"><h2>System</h2></div><div class="panel-b" style="display:grid;gap:10px;font-size:.9rem">
      <div><b>Payments:</b> ${cfg.enabled ? `Square ${esc(cfg.env)}` : 'Simulated (add Square keys to go live)'}</div>
      <div><b>Square Terminal:</b> ${cfg.enabled ? (term.defaultDevice ? 'Default device set; each location can have its own under Locations & rates' : 'Add a device ID under Locations & rates → Edit (or SQUARE_TERMINAL_DEVICE_ID)') : 'Simulated: the booth flow can be tried, but no device is charged until Square is connected'}</div>
      <div><b>Email:</b> ${out && out.configured ? 'Sending' : 'Not set up: messages are kept below instead of sent'}</div>
      <div><b>Text messages:</b> ${sm && sm.configured ? `Sending${HX.sms && HX.sms.number ? ' from ' + esc(HX.sms.number) : ''}` : 'Not set up: texts are kept below instead of sent'}</div>
      <div><b>Text-to-pay webhook:</b> <span class="mono">${esc(siteBase())}/sms/inbound</span></div>
      <div><b>Backups:</b> automatic every day, the last 7 kept on the server disk. Download one now and then and keep it somewhere else too.</div>
      ${(() => { const st = lazy('storage', '/api/admin/storage'); if (!st || st.error) return ''; const low = st.disk && (st.disk.free < Math.min(st.disk.total * 0.15, 2e9) || st.disk.free < 200e6);
        return `<div><b>Saved forever:</b> ${st.tickets.toLocaleString()} ticket${st.tickets === 1 ? '' : 's'}${st.firstTicketAt ? ` since ${fmtFull(st.firstTicketAt, tzDefault()).replace(/,[^,]*$/, '')}` : ''}, plus every payment and change. Search them under History.</div>
        <div><b>Storage:</b> ${fmtBytes(st.database)} records · ${fmtBytes(st.backups)} backups · ${fmtBytes(st.photos)} photos (${st.photoCount.toLocaleString()}, kept ${st.photoDays} days)${st.disk ? ` · ${fmtBytes(st.disk.free)} free of ${fmtBytes(st.disk.total)}` : ''}</div>
        ${low ? '<div class="callout warn"><b>The disk is getting full.</b> Your records are safe, but make the disk bigger soon: in Render open the parkops service, choose Disks, and increase the size (it can grow, not shrink).</div>' : ''}`; })()}
      <div class="row"><button class="btn" data-act="backupNow">Download a backup now</button></div></div></section>` : ''}
    <section class="panel" ${can('settings') ? '' : 'style="grid-column:1/-1"'}><div class="panel-h"><h2>Activity log</h2><button class="btn sm" data-act="reloadAudit">Refresh</button></div>
      ${!audit ? '<div class="empty">Loading…</div>' : audit.error ? `<div class="empty">${esc(audit.error)}</div>` : `<div class="tbl-wrap" style="max-height:420px;overflow:auto"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th></tr></thead><tbody>${audit.map(a => `<tr><td class="num">${fmtTime(a.at)}</td><td>${esc(a.actor || '')}</td><td>${esc(a.action)}</td><td class="mono">${esc([a.coll, a.doc_id].filter(Boolean).join('/'))}</td></tr>`).join('')}</tbody></table></div>`}</section></div>
    <div class="grid g2e">
    ${out && out.messages && out.messages.length ? `<section class="panel"><div class="panel-h"><h2>Recent emails</h2><span class="muted" style="font-size:.84rem">${out.configured ? 'Sent' : 'Not sent (email isn’t set up)'}</span></div><div class="list">${out.messages.slice(0, 15).map(m => `<div class="li"><span class="sev ${m.sent ? 'ok' : 'warn'}"></span><div class="grow"><b>${esc(m.subject)}</b><span class="muted" style="display:block;font-size:.82rem">${esc(m.to)} · ${fmtTime(m.at)}</span></div></div>`).join('')}</div></section>` : ''}
    ${sm && sm.messages && sm.messages.length ? `<section class="panel"><div class="panel-h"><h2>Recent texts</h2><span class="muted" style="font-size:.84rem">${sm.configured ? 'Sent' : 'Not sent (texting isn’t set up)'}</span></div><div class="list">${sm.messages.slice(0, 15).map(m => `<div class="li"><span class="sev ${m.sent ? 'ok' : m.error ? 'bad' : 'warn'}"></span><div class="grow"><b>${esc(m.to)}</b><span class="muted" style="display:block;font-size:.82rem">${esc(m.body)} · ${fmtTime(m.at)}${m.error ? ' · ' + esc(m.error) : ''}</span></div></div>`).join('')}</div></section>` : ''}
    </div>`;
  };
  const roleOptions = () => ParkRules.ROLE_NAMES ? Object.keys(ParkRules.ROLE_NAMES).map(k => [k, `${ParkRules.ROLE_NAMES[k]} · ${ROLE_HELP[k]}`]) : [];
  /* Invitation results say exactly what happened: "sent" only when the email really went out. */
  function inviteResult(r, name) {
    if (r.inviteSent) { toast(`Invitation emailed to ${name}`); return; }
    dlgCfg = null;
    dlgForm.innerHTML = `<div class="dlg-h"><h2>Invitation for ${esc(name)}</h2><button type="button" class="btn sm" data-dlg="close">Close</button></div><div class="dlg-b" style="display:grid;gap:10px">
      <p style="margin:0">${r.emailConfigured ? 'The invitation email couldn’t be sent.' : 'Email isn’t set up on this server, so the invitation wasn’t emailed.'} Send ${esc(name)} this link yourself. It works once, for 7 days:</p>
      <div class="row" style="align-items:center"><input id="invLink" value="${esc(r.link || '')}" readonly style="flex:1;font-family:'IBM Plex Mono',monospace;font-size:.85rem"><button type="button" class="btn sm" data-act="copy" data-v="${esc(r.link || '')}">Copy</button></div></div>
      <div class="dlg-f"><button type="button" class="btn pri" data-dlg="close">Done</button></div>`;
    if (!dlg.open) dlg.showModal();
  }
  function userForm(u) {
    const isNew = !u, self = u && HX.user && u.id === HX.user.id;
    openForm({ title: isNew ? 'Invite staff' : 'Edit ' + u.name, submit: isNew ? 'Send invitation' : 'Save', fields: [
      { id: 'name', label: 'Name', required: true, value: u ? u.name : '' },
      ...(isNew ? [{ id: 'email', label: 'Email', type: 'email', required: true, help: 'They get a link to choose their own password.' }] : []),
      { id: 'role', label: 'Role', type: 'select', options: roleOptions(), value: u ? u.role : 'attendant' },
      ...(isNew ? [] : [{ id: 'active', label: 'Account', type: 'select', options: [['1', 'On'], ['0', 'Off (signs them out)']], value: u.active ? '1' : '0' }]),
      ...(isNew ? [] : [{ id: 'password', label: 'Set a password (leave blank to keep)', type: 'password', help: 'At least 10 characters. Use this only if they can’t use an invitation link.' }]),
    ], onSubmit: async v => {
      try {
        if (isNew) { const r = await api('POST', '/api/admin/users', { name: v.name, email: v.email, role: v.role, invite: true }); UI.users = undefined; UI.audit = undefined; render(); inviteResult(r, v.name); return !!r.inviteSent; }
        if (self && (v.active !== '1' || v.role !== 'owner')) return 'You can’t turn off or demote your own account.';
        await api('PATCH', '/api/admin/users/' + u.id, Object.assign({ name: v.name, role: v.role, active: v.active === '1' }, v.password ? { password: v.password } : {}));
        UI.users = undefined; UI.audit = undefined; toast('Saved'); return true;
      } catch (e) { return e.message; }
    } });
  }
  Object.assign(ACT, {
    addUser() { userForm(null); },
    editUser(b) { userForm((UI.users || []).find(u => u.id === b.dataset.id)); },
    async reinvite(b) { const u = (UI.users || []).find(x => x.id === b.dataset.id); if (!u) return; try { const r = await api('POST', '/api/admin/users/' + u.id + '/invite', {}); UI.users = undefined; render(); inviteResult(r, u.name); } catch (e) { toast(e.message, true); } },
    reloadAudit() { UI.audit = undefined; UI.outbox = undefined; UI.auditAll = undefined; render(); },
    async backupNow(b) {
      b.disabled = true;
      try { const r = await fetch('/api/admin/backup', { method: 'POST', headers: { 'X-ParkOps': '1' } }); if (!r.ok) throw new Error('Backup failed (' + r.status + ')'); const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'parkops-backup-' + new Date().toISOString().slice(0, 10) + '.db'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); toast('Backup downloaded'); }
      catch (e) { toast(e.message, true); }
      b.disabled = false;
    },
  });
  /* Monthly parkers from a spreadsheet (hosted: the server checks plans, companies and duplicate plates). */
  window.hostedMonthlyImport = async (rows, dryRun) => api('POST', '/api/admin/monthly/import', { rows, dryRun: !!dryRun });
})();
