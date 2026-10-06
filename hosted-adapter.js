/* Hosted adapter: gives the console the same db interface it uses on claude.ai,
   backed by the ParkOps server's REST API and a live event stream. */
window.PARKOPS_HOSTED = (function () {
  const COLLS = ['facilities', 'permitTypes', 'permits', 'sessions', 'citations', 'validations', 'members', 'tenants', 'cameras', 'reservations', 'companies', 'invoices', 'vips', 'ratings'];
  const data = {}; COLLS.forEach(c => { data[c] = new Map(); });
  let config = null, feed = [], role = 'public', webhookBase = '', payments = null, account = null, user = null, sms = null, terminal = null, email = false, screenSince = null, scan = null;
  const subs = {}; const docSubs = { 'settings/config': [], 'feeds/lpr': [] };
  const fire = c => (subs[c] || []).forEach(fn => fn());
  const fireDoc = k => (docSubs[k] || []).forEach(fn => fn());
  const snapOf = c => { const docs = [...data[c].entries()].map(([id, d]) => ({ id, exists: true, data: () => d, metadata: {} })); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }; };
  async function api(method, url, body, raw) {
    const h = { 'X-ParkOps': '1' }; if (body && !raw) h['Content-Type'] = 'application/json'; if (raw) h['Content-Type'] = raw;
    const r = await fetch(url, { method, headers: h, body: body ? (raw ? body : JSON.stringify(body)) : undefined, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((j.error && j.error.message) || ('Request failed (' + r.status + ')')); e.code = (j.error && j.error.code) || 'unavailable'; if (j.amount != null) e.amount = j.amount; throw e; }
    return j;
  }
  const strip = d => { const o = Object.assign({}, d); delete o.id; return o; };
  function docRef(coll, id) {
    const key = coll + '/' + id;
    return {
      id,
      async set(d) { await api('PUT', '/api/db/' + coll + '/' + id, d); local(coll, id, d); },
      async update(d) { await api('PATCH', '/api/db/' + coll + '/' + id, d); const cur = coll === 'settings' ? config : data[coll].get(id); local(coll, id, Object.assign({}, cur, d)); },
      async delete() { await api('DELETE', '/api/db/' + coll + '/' + id); local(coll, id, null); },
      onSnapshot(next) {
        const fn = () => {
          if (key === 'settings/config') next({ id, exists: !!config, data: () => config });
          else if (key === 'feeds/lpr') next({ id, exists: true, data: () => ({ reads: feed }) });
        };
        (docSubs[key] = docSubs[key] || []).push(fn); setTimeout(fn, 0); return () => {};
      },
    };
  }
  function local(coll, id, d) {
    if (coll === 'settings') { config = d; fireDoc('settings/config'); return; }
    if (!data[coll]) return;
    if (d === null) data[coll].delete(id); else data[coll].set(id, d);
    fire(coll);
  }
  const db = {
    collection(c) {
      return {
        doc: id => docRef(c, id || ('x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7))),
        async add(d) { const r = await api('POST', '/api/db/' + c, d); local(c, r.id, d); return docRef(c, r.id); },
        onSnapshot(next) { const fn = () => next(snapOf(c)); (subs[c] = subs[c] || []).push(fn); setTimeout(fn, 0); return () => {}; },
      };
    },
    doc(path) { const [c, id] = path.split('/'); return docRef(c, id); },
  };
  function stream() {
    const es = new EventSource('/api/stream');
    es.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.type === 'feed') { feed = [m.read, ...feed].slice(0, 100); fireDoc('feeds/lpr'); }
      else if (m.type === 'doc') local(m.coll, m.id, m.data === undefined ? null : m.data);
    };
    es.onerror = () => { const el = document.querySelector('#live'); if (el) { el.className = 'live off'; el.lastElementChild.textContent = 'Reconnecting'; } };
    es.onopen = () => { const el = document.querySelector('#live'); if (el) { el.className = 'live on'; el.lastElementChild.textContent = 'Live'; } };
  }
  return {
    get webhookBase() { return webhookBase; }, get terminal() { return terminal; }, get email() { return email; }, get screenSince() { return screenSince; }, get scan() { return scan; },
    get payments() { return payments; }, get account() { return account; }, set account(a) { account = a; }, get user() { return user; }, get role() { return role; }, get sms() { return sms; },
    api,
    async init() {
      const st = await api('GET', '/api/state');
      role = st.role; webhookBase = st.webhookBase; config = st.config; feed = st.feed || []; payments = st.payments; account = st.account; user = st.user; sms = st.sms || null; terminal = st.terminal || null; email = !!st.email; screenSince = st.screenSince || null; scan = st.scan || null;
      COLLS.forEach(c => (st[c] || []).forEach(d => data[c].set(d.id, strip(d))));
      /* Only staff screens take live updates. A driver's page has what it needs from this first load, and thousands of
         drivers holding a connection open on a busy night would only take room from the exit desks. */
      if (user) stream(); else { const lv = document.querySelector('#live'); if (lv) lv.hidden = true; }
      /* Which console views a role gets: owners, managers and attendants work tickets and enforcement; accountants and
         viewers see the operations console read-only (the server refuses their writes). The public gets the driver portal. */
      const roles = role === 'public' ? ['portal'] : role === 'attendant' ? ['ops', 'enf', 'portal'] : role === 'viewer' || role === 'accountant' ? ['ops', 'portal'] : ['ops', 'enf', 'portal'];
      return { db, roles, role, writable: role !== 'viewer', canLogout: role !== 'public', canLogin: role === 'public' };
    },
    logout() { fetch('/logout', { method: 'POST', headers: { 'X-ParkOps': '1' }, credentials: 'same-origin' }).catch(() => {}).then(() => { location.href = '/'; }); },
    async lprRead(inp) { try { return await api('POST', '/api/lpr/test', inp); } catch (e) { return { level: 'bad', text: e.message }; } },
    async lprImport(reads) { return api('POST', '/api/lpr/import', { reads }); },
    async portal(op, args, payment, expectedAmount) { try { return await api('POST', '/api/portal/' + op, { args, payment, expectedAmount }); } catch (e) { return { error: e.message, amount: e.amount }; } },
    async lookup(plate) { try { return await api('GET', '/api/portal/lookup?plate=' + encodeURIComponent(plate)); } catch (e) { return null; } },
    download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); },
  };
})();
