/* Live plate scanner for iPhone, iPad and Android: hold the phone over a plate and ParkOps reads it, checks it against permits,
   payments and open notices, and shows OK or a violation. The officer confirms the plate, issues the notice and prints it on a
   Zebra printer. Loaded after hosted-ui.js (it shares the printer connection).

   How it keeps the bill small: the phone looks at the camera picture itself, for free, about seven times a second. It only sends
   a frame to the plate reader when the picture is sharp, held steady, and different from the last frame that was sent (a new
   vehicle). A frame that reads nothing gets two more tries, then waits for the picture to change. The server adds a monthly
   spending cap on top (SCAN_MONTHLY_CAP). Every number that decides this is in TUNE just below. */
(function () {
  const HX = window.PARKOPS_HOSTED;
  if (!HX) return;

  const TUNE = {
    tickMs: 140,       // how often the phone looks at the camera picture (free, nothing leaves the phone)
    minGapMs: 450,     // never send frames closer together than this
    fastGapMs: 1000,   // "Every second" mode
    stillMax: 7,       // how much the picture may change between two looks and still count as held steady
    changeMin: 16,     // how different from the last frame sent counts as a new vehicle
    panTicks: 3,       // the phone moving for this many looks in a row (about half a second) means "on to the next car", even if the next car looks the same
    sharpFloor: 2.2,   // below this the box is blank or hopelessly out of focus
    sharpRel: 0.55,    // must be at least this share of the sharpest recent picture, or it is motion blur
    contrastMin: 14,   // a plate in the box has contrast; an empty road does not
    darkMean: 30,      // average brightness (0 to 255) below which we say "too dark"
    retryEmpty: 2,     // extra tries on a picture that read nothing, before waiting for it to change
    maxInflight: 2,    // frames being read at the same time
    minScore: 0.45,    // reads the service is less sure of than this are thrown away
    lowScore: 0.8,     // reads less sure than this are flagged: check the plate on the vehicle
    sameCarMs: 10 * 60e3, // the same plate seen again inside this time updates its card instead of adding another
    keepFrames: 60,    // evidence frames kept in memory for flagged vehicles
    listMax: 300,
    sendW: 960,        // the box is sent at most this wide
    quality: 0.82,
  };
  const GW = 192, GH = 96;
  const SC = { open: false, items: [], byKey: new Map(), seq: 0, cur: null, filter: 'problems', paused: false, mode: 'auto', sound: store.get('scanSound') !== '0', counts: { checked: 0, flagged: 0, notices: 0 },
    inflight: 0, lastSend: 0, lastSig: null, prevSig: null, sharpRef: 0, retries: 0, lastEmpty: false, fails: 0, backoffUntil: 0, disabled: false, used: null, cap: null, armLeave: false, sent: 0, movingRun: 0, panned: false };
  const k = () => window.printerKit;
  const IOSDEV = () => !!(k() && k().ios);
  const rank = l => (l === 'bad' ? 2 : l === 'warn' ? 1 : 0);
  const hhmm = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const zoneFor = facId => { const f = facById(facId); return f && +f.reservedSpaces > 0 && UI.enfZone === 'reserved' ? 'reserved' : 'general'; };
  const verdictOf = (pl, facId) => R.checkPlate(pl, facId, zoneFor(facId));
  const supportsCamera = () => !!HX.demo || !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
  body.scan-on{overflow:hidden}
  .scan{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;background:#0b0f17;color:#eef2f8;--sc-ok:#35b26f;--sc-warn:#e8a92d;--sc-bad:#ee5a4d;
    padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);touch-action:manipulation;overscroll-behavior:contain;-webkit-text-size-adjust:100%}
  .scan *{box-sizing:border-box}
  .scan[hidden]{display:none}
  .scan-top{display:flex;gap:8px;align-items:center;padding:8px 10px;background:#121927;border-bottom:1px solid #243049}
  .scan-top select{flex:1;min-width:0;min-height:44px;font-size:16px;border-radius:10px;border:1px solid #33425f;background:#0f1522;color:#fff;padding:0 10px}
  .sc-btn{min-height:44px;padding:0 14px;border-radius:10px;border:1px solid #33425f;background:#1a2438;color:#eef2f8;font-weight:600;font-size:.92rem;cursor:pointer;white-space:nowrap}
  .sc-btn.on{border-color:var(--sc-ok);color:#9be3bc}.sc-btn.on:disabled{opacity:1}.sc-btn.pri{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}.sc-btn:disabled{opacity:.55}
  .scan-body{flex:1;min-height:0;display:flex;flex-direction:column}
  .scan-view{position:relative;flex:0 0 auto;height:min(46vh,420px);min-height:230px;background:#000;overflow:hidden}
  .scan-view video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}
  .reticle{position:absolute;inset:0;margin:auto;height:68%;aspect-ratio:2.2/1;max-width:92%;border-radius:12px;box-shadow:0 0 0 9999px rgba(0,0,0,.4);pointer-events:none}
  .reticle i{position:absolute;width:28px;height:28px;border:4px solid #fff;transition:border-color .15s}
  .reticle i:nth-child(1){left:-3px;top:-3px;border-right:0;border-bottom:0;border-top-left-radius:12px}
  .reticle i:nth-child(2){right:-3px;top:-3px;border-left:0;border-bottom:0;border-top-right-radius:12px}
  .reticle i:nth-child(3){left:-3px;bottom:-3px;border-right:0;border-top:0;border-bottom-left-radius:12px}
  .reticle i:nth-child(4){right:-3px;bottom:-3px;border-left:0;border-top:0;border-bottom-right-radius:12px}
  .scan-view[data-hit=ok] .reticle i{border-color:var(--sc-ok)}.scan-view[data-hit=warn] .reticle i{border-color:var(--sc-warn)}.scan-view[data-hit=bad] .reticle i{border-color:var(--sc-bad)}
  .scan-view[data-busy="1"] .reticle i{border-color:#9db7ff}
  .scan-status{position:absolute;left:50%;top:10px;transform:translateX(-50%);width:max-content;max-width:92%;background:rgba(0,0,0,.62);padding:6px 14px;border-radius:999px;font-weight:600;font-size:.9rem;text-align:center}
  .scan-status.bad{background:rgba(190,50,40,.85)}
  .scan-ctl{position:absolute;left:0;right:0;bottom:0;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:24px 8px 8px;background:linear-gradient(transparent,rgba(0,0,0,.7))}
  .scan-ctl .sc-btn{min-height:40px;padding:0 12px;font-size:.85rem;background:rgba(18,25,39,.82)}
  .scan-msg{position:absolute;inset:0;display:grid;align-content:center;justify-items:center;gap:12px;padding:20px;text-align:center;background:rgba(5,8,14,.92);font-size:1rem;line-height:1.4}
  .scan-msg[hidden]{display:none}
  .scan-note{background:#3a2b0d;color:#ffd98a;padding:8px 12px;font-size:.88rem;text-align:center}
  .scan-note[hidden]{display:none}
  .scan-side{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;padding:10px;display:grid;gap:10px;align-content:start}
  .sc-empty{padding:18px;text-align:center;color:#94a3bd;border:1px dashed #33425f;border-radius:14px}
  .sc-cur{border-radius:14px;padding:14px;display:grid;gap:8px;border:2px solid}
  .sc-cur.ok{background:#0e2a1c;border-color:var(--sc-ok)}.sc-cur.warn{background:#33260b;border-color:var(--sc-warn)}.sc-cur.bad{background:#3a1512;border-color:var(--sc-bad)}
  .sc-cur.fresh{animation:scflash .9s}
  @keyframes scflash{from{box-shadow:0 0 0 6px rgba(255,255,255,.55)}to{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
  .sc-cur h2{margin:0;font-size:1.5rem;line-height:1.15}.sc-cur.ok h2{color:#7ee0a8}.sc-cur.warn h2{color:#ffd37a}.sc-cur.bad h2{color:#ff9d93}
  .sc-cur ul{margin:0;padding-left:18px;color:#d5deee;font-size:.95rem}
  .sc-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .sc-word{font-size:.74rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:999px;background:#fff;color:#111}
  .sc-st{font-weight:700;color:#c8d3ea}
  .sc-flag{display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border-radius:999px;font-size:.8rem;font-weight:700;background:#4a3511;color:#ffd98a}
  .sc-flag.bad{background:#4c1b17;color:#ffb3aa}
  .sc-alts{font-size:.88rem;color:#c8d3ea}.sc-alts button{margin-left:6px;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid #4a5b7c;background:#1a2438;color:#fff;font-weight:700;letter-spacing:.08em}
  .sc-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .sc-b{min-height:48px;padding:0 18px;border-radius:10px;font-weight:700;font-size:1rem;border:1px solid #3a4a69;background:#1a2438;color:#eef2f8;cursor:pointer}
  .sc-b.go{background:#fff;color:#111;border-color:#fff}.sc-cur.bad .sc-b.go,.sc-row.bad .sc-b.go{background:var(--sc-bad);border-color:var(--sc-bad);color:#fff}
  .sc-cur.warn .sc-b.go,.sc-row.warn .sc-b.go{background:var(--sc-warn);border-color:var(--sc-warn);color:#1a1200}
  .sc-b.quiet{background:transparent}.sc-b:disabled{opacity:.55}
  .sc-done{font-weight:700;color:#9be3bc}
  .scan-manual{display:flex;gap:8px}
  .scan-manual input{flex:1;min-width:0;min-height:48px;font-size:1.1rem;text-transform:uppercase;letter-spacing:.1em;border-radius:10px;border:1px solid #33425f;background:#0f1522;color:#fff;padding:0 12px}
  .scan-sum{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;color:#94a3bd;font-size:.85rem}
  .scan-sum .hot{color:#ffd98a;font-weight:700}
  .sc-zone{display:flex;gap:6px}.sc-zone button{flex:1}
  .sc-filter{display:flex;gap:6px}.sc-filter button{flex:1;min-height:42px;border-radius:10px;border:1px solid #33425f;background:#121927;color:#c8d3ea;font-weight:700}.sc-filter button[aria-pressed=true]{background:#24324f;color:#fff;border-color:#5b78b5}
  .scan-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
  .sc-row{display:grid;gap:8px;background:#121927;border:1px solid #243049;border-left:6px solid #52627f;border-radius:10px;padding:10px 12px}
  .sc-row.ok{border-left-color:var(--sc-ok)}.sc-row.warn{border-left-color:var(--sc-warn)}.sc-row.bad{border-left-color:var(--sc-bad)}
  .sc-row-h{display:flex;align-items:center;gap:10px}.sc-row-h .grow{flex:1;min-width:0}.sc-row-h b{display:block}.sc-row-h .sub{display:block;color:#94a3bd;font-size:.82rem}
  .sc-row .thumb{width:54px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #33425f}
  .scan .plate{font-size:1.15rem;padding:2px 10px}
  .sc-cur .plate{font-size:1.7rem;padding:3px 14px}
  @media (min-width:760px) and (min-aspect-ratio:1/1){.scan-body{flex-direction:row}.scan-view{flex:1.25 1 0;height:auto;min-height:0}.scan-side{flex:1 1 0;max-width:540px}}
  .scancard h3{margin:0}
  `;
  document.head.appendChild(css);

  /* ---------- sound ---------- */
  function tone(freq, ms, at, vol) {
    const a = SC.audio; if (!a || !SC.sound) return;
    try { const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + (at || 0); o.type = 'square'; o.frequency.value = freq; o.connect(g); g.connect(a.destination);
      g.gain.setValueAtTime(vol || .12, t); g.gain.exponentialRampToValueAtTime(.0001, t + ms / 1000); o.start(t); o.stop(t + ms / 1000 + .03); } catch (e) {}
  }
  function alertFor(level) {
    if (level === 'bad') { tone(880, 160, 0, .18); tone(620, 280, .2, .18); try { navigator.vibrate && navigator.vibrate([180, 80, 180]); } catch (e) {} }
    else if (level === 'warn') { tone(540, 220, 0, .15); try { navigator.vibrate && navigator.vibrate(120); } catch (e) {} }
    else tone(1250, 40, 0, .05);
  }

  /* ---------- what the phone sees ---------- */
  /* Sharpness, contrast and a tiny fingerprint of the box, from a small copy of it. Pure and fast (about 20,000 pixels). */
  function analyse(d, w, h) {
    const n = w * h, Y = new Float32Array(n); let sum = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) { const y = .299 * d[j] + .587 * d[j + 1] + .114 * d[j + 2]; Y[i] = y; sum += y; }
    const mean = sum / n; let vs = 0, grad = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, c = Y[i]; vs += (c - mean) * (c - mean); if (x < w - 1) grad += Math.abs(Y[i + 1] - c); if (y < h - 1) grad += Math.abs(Y[i + w] - c); }
    const SW = 12, SH = 6, sig = new Float32Array(SW * SH);
    for (let by = 0; by < SH; by++) for (let bx = 0; bx < SW; bx++) { let s = 0, c = 0; const y0 = Math.floor(by * h / SH), y1 = Math.floor((by + 1) * h / SH), x0 = Math.floor(bx * w / SW), x1 = Math.floor((bx + 1) * w / SW);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += Y[y * w + x]; c++; } sig[by * SW + bx] = s / c - mean; }
    return { sharp: grad / (n * 2), contrast: Math.sqrt(vs / n), mean, sig };
  }
  const sigDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

  /* The yellow box sits on top of a video that is scaled to fill its area (cropped at the edges). This finds the same box in the video's own pixels. */
  function cropRect() {
    const v = SC.video, rb = SC.reticle.getBoundingClientRect(), vb = v.getBoundingClientRect(), vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh || !vb.width || !vb.height) return null;
    const s = Math.max(vb.width / vw, vb.height / vh), ox = (vb.width - vw * s) / 2, oy = (vb.height - vh * s) / 2;
    let sx = (rb.left - vb.left - ox) / s, sy = (rb.top - vb.top - oy) / s, sw = rb.width / s, sh = rb.height / s;
    sx = Math.max(0, Math.min(vw - 2, sx)); sy = Math.max(0, Math.min(vh - 2, sy)); sw = Math.max(2, Math.min(vw - sx, sw)); sh = Math.max(2, Math.min(vh - sy, sh));
    return { sx, sy, sw, sh };
  }
  const grabBlob = r => new Promise(res => {
    const w = Math.min(TUNE.sendW, Math.round(r.sw)), h = Math.max(2, Math.round(w * r.sh / r.sw)), c = SC.sendCanvas; c.width = w; c.height = h;
    c.getContext('2d').drawImage(SC.video, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    try { c.toBlob(b => res(b), 'image/jpeg', TUNE.quality); } catch (e) { res(null); }
  });

  const setStatus = (txt, bad) => { const el = $('#scStatus'); if (!el) return; if (el.textContent !== txt) el.textContent = txt; el.className = 'scan-status' + (bad ? ' bad' : ''); };
  const setBusy = () => { const v = $('#scView'); if (v) v.dataset.busy = SC.inflight > 0 ? '1' : '0'; };
  const note = txt => { const el = $('#scNote'); if (!el) return; el.hidden = !txt; el.textContent = txt || ''; };

  function tick() {
    if (!SC.open || document.hidden || !SC.video) return;
    const v = SC.video; if (v.readyState < 2 || !v.videoWidth) return;
    if (SC.disabled) { setStatus('Camera scanning is off. Type plates below.', true); return; }
    if (SC.paused) { setStatus('Paused'); return; }
    const r = cropRect(); if (!r) return;
    const g = SC.gctx; g.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, GW, GH);
    let a; try { a = analyse(g.getImageData(0, 0, GW, GH).data, GW, GH); } catch (e) { return; }
    let gate = 'ready';
    if (a.contrast < TUNE.contrastMin || a.sharp < TUNE.sharpFloor) gate = a.mean < TUNE.darkMean ? 'dark' : 'idle';
    else if (SC.prevSig && sigDiff(a.sig, SC.prevSig) > TUNE.stillMax) gate = 'moving';
    else if (a.sharp < TUNE.sharpRel * SC.sharpRef) gate = 'blurry';
    if (gate === 'moving') SC.movingRun++; else { if (SC.movingRun >= TUNE.panTicks) SC.panned = true; SC.movingRun = 0; }
    SC.sharpRef = Math.max(a.sharp, SC.sharpRef * .97); SC.prevSig = a.sig; SC.gate = gate; SC.lastLook = { sharp: a.sharp, contrast: a.contrast, mean: a.mean };
    const t = Date.now();
    if (t < SC.backoffUntil) { setStatus('Waiting to reconnect…'); return; }
    if (SC.inflight >= TUNE.maxInflight) { setStatus('Reading…'); return; }
    if (gate !== 'ready') { setStatus(SC.inflight ? 'Reading…' : gate === 'moving' ? 'Hold steady' : gate === 'blurry' ? 'Too blurry. Hold steady' : gate === 'dark' ? 'Too dark. Try the light' : 'Hold the box over a plate'); return; }
    const gap = SC.mode === 'fast' ? TUNE.fastGapMs : TUNE.minGapMs;
    if (t - SC.lastSend < gap) return;
    const changed = !SC.lastSig || SC.panned || sigDiff(a.sig, SC.lastSig) > TUNE.changeMin;
    let why = '';
    if (changed) { why = 'new'; SC.retries = 0; SC.panned = false; }
    else if (SC.lastEmpty && SC.retries < TUNE.retryEmpty && t - SC.lastSend >= 900) { why = 'retry'; SC.retries++; }
    else if (SC.mode === 'fast') why = 'fast';
    if (!why) { if (!SC.inflight) setStatus(SC.lastEmpty ? 'No plate found. Move closer or tilt' : 'Move to the next vehicle'); return; }
    SC.lastSig = a.sig; send(why, r);
  }

  /* ---------- reading a frame ---------- */
  async function post(blob) {
    if (HX.demo) return HX.demo.read(blob);   // demo build: the pretend reader answers from the pretend camera
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch('/api/enforcement/scan', { method: 'POST', headers: { 'X-ParkOps': '1', 'Content-Type': 'image/jpeg' }, body: blob, credentials: 'same-origin', signal: ctl.signal });
      let j = {}; try { j = await res.json(); } catch (e) {}
      if (res.ok) return j;
      const e = new Error((j.error && j.error.message) || ('Scan failed (' + res.status + ')')); e.status = res.status; e.code = j.error && j.error.code; e.retryAfterMs = j.retryAfterMs || 0; e.used = j.used; e.cap = j.cap; throw e;
    } catch (e) { if (!e.status) { const n = new Error(navigator.onLine === false ? 'No connection' : 'Couldn’t reach ParkOps'); n.status = 0; throw n; } throw e; }
    finally { clearTimeout(to); }
  }
  async function send(why, r) {
    SC.inflight++; SC.lastSend = Date.now(); setBusy(); if (why !== 'retry') setStatus('Reading…');
    try {
      const blob = await grabBlob(r || cropRect());
      if (!blob || !SC.open) return;
      SC.sent++;
      const j = await post(blob);
      SC.fails = 0; SC.backoffUntil = 0; note('');
      if (j.used != null) { SC.used = j.used; SC.cap = j.cap; }
      const got = onPlates(j.plates || [], blob);
      SC.lastEmpty = !got; if (got) SC.retries = 0;
      if (!got) setStatus(why === 'read' ? 'No plate found. Move closer or tilt' : 'Looking…');
    } catch (e) { onError(e); }
    finally { SC.inflight--; setBusy(); renderSum(); }
  }
  function onError(e) {
    if (e.code === 'scan_cap') { SC.disabled = true; if (e.used != null) { SC.used = e.used; SC.cap = e.cap; } note(e.message); return; }
    if (e.code === 'scan_off') { SC.disabled = true; note(e.message); return; }
    if (e.status === 401 || e.status === 403) { SC.disabled = true; note('You were signed out. Close the scanner and sign in again.'); return; }
    SC.lastSig = null; // that frame was never read, so the same picture is allowed another try
    if (e.status === 429) { SC.backoffUntil = Date.now() + (e.retryAfterMs || 1500); return; }
    SC.fails++; SC.backoffUntil = Date.now() + Math.min(8000, 1000 * Math.pow(2, Math.min(SC.fails, 3)));
    if (SC.fails >= 3) note(e.message + '. Still trying. You can type plates meanwhile.');
  }

  /* ---------- results ---------- */
  function onPlates(list, frame) {
    const good = list.filter(p => p.score >= TUNE.minScore).slice(0, 3); if (!good.length) return 0;
    let top = null;
    good.forEach(p => { const r = addRead({ plate: p.plate, score: p.score, state: p.state || '', alts: (p.candidates || []).map(c => c.plate).filter(x => x && x !== p.plate && x.length >= 2).slice(0, 2), frame });
      if (r && r.beep && (!top || rank(r.level) > rank(top))) top = r.level; });
    if (top) alertFor(top);
    renderAll(); return good.length;
  }
  function addRead(r) {
    const pl = normPlate(r.plate); if (!pl) return null;
    const facId = SC.facId, key = facId + '|' + pl, v = verdictOf(pl, facId), t = Date.now();
    let it = SC.byKey.get(key), beep = false;
    if (!it || t - it.at > TUNE.sameCarMs) {
      it = { id: ++SC.seq, key, plate: pl, facId, at: t, n: 1, score: r.score, state: r.state, manual: !!r.manual, alts: r.alts || [], level: v.level }; beep = true;
      SC.items.unshift(it); SC.byKey.set(key, it); SC.counts.checked++; if (v.level !== 'ok') SC.counts.flagged++;
      log(it, r, v);
    } else {
      it.n++; const worse = rank(v.level) > rank(it.level) || (v.level !== it.level && it.dismissed); it.at = t;
      if (v.level !== it.level && !it.cited) log(it, r, v);
      if (r.score > it.score) { it.score = r.score; it.state = r.state || it.state; it.alts = r.alts || it.alts; }
      if (worse && !it.cited) { beep = true; it.dismissed = false; if (it.level === 'ok') SC.counts.flagged++; }
      it.level = it.cited ? it.level : v.level;
      if (!it.dismissed && !it.cited && v.level !== 'ok') { SC.items.splice(SC.items.indexOf(it), 1); SC.items.unshift(it); }
    }
    Object.assign(it, { title: v.title, lines: v.lines || [], suggest: v.suggest, towEligible: !!v.towEligible, hot: !!v.hot });
    if (v.level !== 'ok' && !it.cited && !it.frame && r.frame) { it.frame = r.frame; it.thumb = URL.createObjectURL(r.frame); trimFrames(); }
    if (SC.items.length > TUNE.listMax) { SC.items.slice(TUNE.listMax).forEach(dropFrame); SC.items.length = TUNE.listMax; for (const [kk, x] of SC.byKey) if (!SC.items.includes(x)) SC.byKey.delete(kk); }
    SC.cur = it; SC.curFresh = true;
    const view = $('#scView'); if (view) { view.dataset.hit = v.level; clearTimeout(SC.hitT); SC.hitT = setTimeout(() => { const vv = $('#scView'); if (vv) vv.dataset.hit = ''; }, 1600); }
    return { level: v.level, beep };
  }
  /* The patrol log keeps every vehicle checked. A doubtful read that looks like a violation waits until the officer acts
     on it (issues a notice, or picks another plate), so misreads don't fill the log with violators that never were. */
  function log(it, r, v) {
    if (!window.recordCheck) return;
    if (v.level !== 'ok' && !r.manual && r.score < TUNE.lowScore) { it.unlogged = true; return; }
    it.unlogged = false; window.recordCheck(it.plate, it.facId, r.manual ? 'typed' : 'scanner', r.manual ? {} : { score: r.score });
  }
  function dropFrame(it) { if (it.thumb) { try { URL.revokeObjectURL(it.thumb); } catch (e) {} } it.thumb = null; it.frame = null; }
  function trimFrames() { const withF = SC.items.filter(x => x.frame); for (let i = TUNE.keepFrames; i < withF.length; i++) dropFrame(withF[i]); }

  /* ---------- drawing the screen ---------- */
  const plateHtml = it => `<span class="plate">${esc(it.plate)}</span>${it.state ? `<span class="sc-st">${esc(it.state)}</span>` : ''}`;
  function printBtn(it) {
    const kit = k(); if (!kit) return '';
    if (it.printed) return `<button class="sc-b quiet" data-sc="print" data-id="${it.id}">Print again</button>`;
    return kit.supported() ? `<button class="sc-b go" data-sc="print" data-id="${it.id}">Print notice</button>` : `<button class="sc-b" data-sc="printhelp">How to print</button>${it.cited && it.citeId ? `<button class="sc-b quiet" data-sc="printsys" data-id="${it.id}">Print dialog</button>` : ''}`;
  }
  function actionsHtml(it) {
    if (it.cited) return `<span class="sc-done">Notice ${esc(it.cited)} issued${it.printed ? ' and printed' : ''}</span>${printBtn(it)}`;
    const ok = it.level === 'ok';
    return `<button class="sc-b ${ok ? 'quiet' : 'go'}" data-sc="notice" data-id="${it.id}">${ok ? 'Issue anyway' : 'Issue notice'}</button><button class="sc-b quiet" data-sc="dismiss" data-id="${it.id}">${ok ? 'Next' : 'Dismiss'}</button>`;
  }
  function flagsHtml(it) {
    const low = !it.manual && it.score < TUNE.lowScore;
    return `${low ? `<span class="sc-flag">Not sure of this read (${Math.round(it.score * 100)}%). Check the plate on the vehicle</span>` : ''}${it.towEligible ? `<span class="sc-flag bad">Boot or tow eligible${it.hot ? ': hot list' : ': 3+ open notices'}</span>` : ''}${it.manual ? '<span class="sc-flag">Typed in</span>' : ''}`
      + (low && it.alts && it.alts.length && !it.cited ? `<div class="sc-alts">Could also be:${it.alts.map(a => `<button data-sc="use" data-id="${it.id}" data-plate="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : '');
  }
  const WORD = { bad: 'Violation', warn: 'Check', ok: 'OK' };
  function curHtml() {
    const it = SC.cur; if (!it) return HX.demo ? '<div class="sc-empty">Nothing read yet. Hold steady and the plate in the box is read on its own. Tap Next car for another vehicle, or type any plate below.</div>' : '<div class="sc-empty">Nothing read yet. Hold the box over a plate, or type one below.</div>';
    const fresh = SC.curFresh; SC.curFresh = false;
    return `<div class="sc-cur ${it.level}${fresh ? ' fresh' : ''}"><div class="sc-head"><span class="sc-word">${WORD[it.level]}</span>${plateHtml(it)}</div><h2>${esc(it.title)}</h2>
      ${it.lines.length ? `<ul>${it.lines.slice(0, 3).map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}<div>${flagsHtml(it)}</div><div class="sc-acts">${actionsHtml(it)}</div></div>`;
  }
  function rowHtml(it) {
    return `<li class="sc-row ${it.level}"><div class="sc-row-h">${it.thumb ? `<img class="thumb" alt="Camera frame for ${esc(it.plate)}" src="${it.thumb}">` : ''}${plateHtml(it)}<div class="grow"><b>${esc(it.title)}</b><span class="sub">${hhmm(it.at)}${it.n > 1 ? ' · seen ' + it.n + ' times' : ''}</span></div></div>
      <div>${flagsHtml(it)}</div><div class="sc-acts">${actionsHtml(it)}</div></li>`;
  }
  const shown = () => SC.items.filter(x => !x.dismissed && x !== SC.cur && (SC.filter === 'all' || x.level !== 'ok' || x.cited));
  function renderList() {
    const el = $('#scList'); if (!el) return;
    const rows = shown();
    el.innerHTML = rows.length ? rows.map(rowHtml).join('') : `<li class="sc-empty">${SC.filter === 'all' ? 'No vehicles yet.' : 'No problems so far. Vehicles that are fine are counted above.'}</li>`;
    document.querySelectorAll('#scFilter button').forEach(b => b.setAttribute('aria-pressed', b.dataset.f === SC.filter));
  }
  function renderSum() {
    const el = $('#scSum'); if (!el) return;
    const c = SC.counts, pct = SC.cap ? SC.used / SC.cap : 0;
    el.innerHTML = `<span>${c.checked} checked · ${c.flagged} flagged · ${c.notices} notice${c.notices === 1 ? '' : 's'}</span>${SC.used != null ? `<span class="${pct >= .8 ? 'hot' : ''}">${SC.used.toLocaleString()} of ${SC.cap.toLocaleString()} scans this month</span>` : ''}`;
  }
  const unhandled = () => SC.items.filter(x => x.level !== 'ok' && !x.dismissed && !x.cited).length;
  function renderTop() {
    const f = facById(SC.facId), sel = $('#scFac'); if (sel && sel.value !== SC.facId) sel.value = SC.facId;
    const z = $('#scZone'); if (z) { const res = f && +f.reservedSpaces > 0; z.hidden = !res; z.innerHTML = res ? `<button class="sc-btn" data-sc="zone" data-v="general" aria-pressed="${UI.enfZone !== 'reserved'}">General</button><button class="sc-btn" data-sc="zone" data-v="reserved" aria-pressed="${UI.enfZone === 'reserved'}">Reserved section</button>` : ''; z.querySelectorAll('[aria-pressed=true]').forEach(b => b.classList.add('on')); }
    const p = $('#scPrinter'), kit = k(); if (p && kit) {
      if (kit.connected()) { p.textContent = 'Printer: ' + kit.name(); p.className = 'sc-btn on'; p.disabled = true; }
      else if (kit.supported()) { p.textContent = kit.remembered() ? 'Reconnect printer' : 'Connect printer'; p.className = 'sc-btn pri'; p.disabled = false; }
      else { p.textContent = 'Printing: how'; p.className = 'sc-btn'; p.disabled = false; }
    }
    const pause = $('#scPause'); if (pause) pause.textContent = SC.paused ? 'Resume' : 'Pause';
    const mode = $('#scMode'); if (mode) mode.textContent = SC.mode === 'fast' ? 'Every second' : 'Auto';
    const snd = $('#scSound'); if (snd) snd.textContent = SC.sound ? 'Sound on' : 'Sound off';
    const done = $('#scDone'); if (done) { const open = unhandled(); done.textContent = SC.armLeave ? `Leave with ${open} unhandled?` : 'Done'; done.className = 'sc-btn' + (SC.armLeave ? ' pri' : ''); }
  }
  function renderAll() { const cur = $('#scCur'); if (cur) cur.innerHTML = curHtml(); renderList(); renderSum(); renderTop(); }

  /* ---------- notice ---------- */
  const dupOf = (pl, facId, code) => S.citations.find(c => normPlate(c.plate) === pl && c.facilityId === facId && c.violation === code && now() - c.issuedAt < D && c.status !== 'voided');
  async function uploadFrame(it) {
    if (!it.frame) return [];
    try { const r = await HX.api('POST', '/api/photos?plate=' + encodeURIComponent(it.plate), it.frame, 'image/jpeg'); return r && r.id ? [r.id] : []; } catch (e) { return []; }
  }
  async function printCite(it, c) {
    const kit = k(); if (!kit || !kit.supported() || !c) return false;
    try { await kit.send(kit.zpl()(c)); it.printed = true; return true; }
    catch (e) { if (e.name !== 'NotFoundError' && e.name !== 'AbortError') note('Printing failed: ' + e.message); return false; }
  }
  function noticeForm(it) {
    const vs = violations(), kit = k(), willPrint = !!(kit && kit.supported() && kit.remembered());
    const sure = it.manual ? 'You typed this plate.' : `Read by the camera as ${it.plate} (${Math.round(it.score * 100)}% sure).`;
    openForm({ title: 'Notice for ' + it.plate, submit: willPrint ? 'Issue and print' : 'Issue notice', fields: [
      { id: 'sure', type: 'note', label: sure + ' Check that it matches the plate on the vehicle before you issue.' },
      { id: 'plate', label: 'Plate', value: it.plate, required: true },
      { id: 'state', label: 'Plate state', value: it.state || '', help: 'Two letters, for example TX' },
      { id: 'code', label: 'Violation', type: 'select', span: true, options: vs.map(v => [v.code, `${v.name} · ${money0(v.fine)}`]), value: it.suggest || (vs[0] && vs[0].code) },
      { id: 'notes', label: 'Notes', span: true, value: '', help: 'Row, space, vehicle color' },
    ], onSubmit: async v => {
      const pl = normPlate(v.plate); if (pl.length < 2) return 'Enter the plate.';
      if (pl !== it.plate) { const r2 = verdictOf(pl, it.facId); if (r2.level === 'ok') return `${pl} is fine (${r2.title}). Check the plate again.`; }
      const dup = dupOf(pl, it.facId, v.code); if (dup) return `${pl} already has this notice today (${dup.number}).`;
      const photoIds = await uploadFrame(it);
      const ok = await issueCitation({ plate: pl, facId: it.facId, code: v.code, officer: actorName(), notes: (v.notes || '').trim(), plateState: v.state, photoIds });
      if (!ok) return 'Couldn’t save the notice. Check the connection and try again.';
      const c = byId('citations', UI.lastCite); UI.lastCite = null;
      it.cited = c ? c.number : 'issued'; it.citeId = c && c.id; SC.counts.notices++; dropFrame(it);
      if (pl !== it.plate) { SC.byKey.delete(it.key); it.plate = pl; it.key = it.facId + '|' + pl; SC.byKey.set(it.key, it); }
      if (willPrint) await printCite(it, c);
      renderAll(); return true;
    } });
  }
  const itemOf = el => SC.items.find(x => String(x.id) === String(el.dataset.id));

  /* ---------- opening and closing ---------- */
  function shell() {
    const f = S.facilities;
    const d = document.createElement('div'); d.className = 'scan'; d.id = 'scan'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Plate scanner');
    d.innerHTML = `<header class="scan-top"><select id="scFac" aria-label="Location">${f.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>
      <button class="sc-btn" id="scPrinter" data-sc="printer"></button><button class="sc-btn" id="scDone" data-sc="done">Done</button></header>
      <div class="scan-note" id="scNote" role="status" hidden></div>
      <div class="scan-body"><section class="scan-view${HX.demo ? ' is-demo' : ''}" id="scView" data-hit="" data-busy="0">
        ${HX.demo ? '<canvas id="scVideo" class="demo-cam" width="1280" height="720" aria-label="Demo camera"></canvas><div class="sc-demo-chip" id="scDemo">Demo camera</div>' : '<video id="scVideo" playsinline muted autoplay></video>'}<div class="reticle" id="scReticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="scan-status" id="scStatus" role="status" aria-live="polite">Starting camera…</div>
        <div class="scan-msg" id="scMsg" hidden></div>
        <div class="scan-ctl">${HX.demo ? '<button class="sc-btn pri" data-sc="demonext">Next car</button>' : ''}<button class="sc-btn" data-sc="read">Read now</button><button class="sc-btn" id="scPause" data-sc="pause">Pause</button><button class="sc-btn" id="scMode" data-sc="mode">Auto</button><button class="sc-btn" id="scTorch" data-sc="torch" hidden>Light</button><button class="sc-btn" id="scSound" data-sc="sound">Sound on</button></div></section>
      <section class="scan-side"><div id="scZone" class="sc-zone" hidden></div><div id="scCur"></div>
        <form class="scan-manual" id="scManual"><input id="scPlate" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" inputmode="text" enterkeyhint="go" maxlength="10" placeholder="Or type a plate" aria-label="Type a plate"><button class="sc-b go">Check</button></form>
        <div class="scan-sum" id="scSum"></div><div class="sc-filter" id="scFilter"><button data-sc="filter" data-f="problems">Problems</button><button data-sc="filter" data-f="all">All</button></div>
        <ul class="scan-list" id="scList" aria-live="polite"></ul></section></div>`;
    return d;
  }
  function showMsg(html) { const m = $('#scMsg'); if (!m) return; m.hidden = !html; m.innerHTML = html || ''; }
  const camError = e => {
    const n = e && e.name;
    if (!window.isSecureContext && location.hostname !== 'localhost') return 'The camera only works on a secure (https) address.';
    if (n === 'NotAllowedError' || n === 'SecurityError') return IOSDEV() ? 'The camera is blocked. Open Settings on the iPhone or iPad, find this browser (Safari or Bluefy), turn on Camera, then tap Try again.' : 'The camera is blocked. Allow the camera for this site in the browser, then tap Try again.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device. You can still type plates below.';
    if (n === 'NotReadableError') return 'Another app is using the camera. Close it, then tap Try again.';
    return 'Couldn’t start the camera. Tap Try again.';
  };
  async function startCamera() {
    stopCamera(); showMsg('');
    if (HX.demo) { HX.demo.start(SC.video); SC.prevSig = null; SC.lastSig = null; SC.sharpRef = 0; setStatus('Hold the box over a plate'); return true; }
    if (!supportsCamera()) { showMsg(`<p style="margin:0">This browser can’t use the camera for scanning.</p><button class="sc-b" data-sc="done">Close</button>`); return false; }
    let err;
    for (const c of [{ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }, { video: true, audio: false }]) {
      try { SC.stream = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { err = e; if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break; }
    }
    if (!SC.stream) { setStatus('Camera off', true); showMsg(`<p style="margin:0">${esc(camError(err))}</p><button class="sc-b go" data-sc="retry">Try again</button>`); return false; }
    if (!SC.open) { stopCamera(); return false; }
    const v = SC.video; v.srcObject = SC.stream; v.muted = true; v.setAttribute('playsinline', '');
    try { await v.play(); } catch (e) {}
    SC.track = SC.stream.getVideoTracks()[0];
    try { await SC.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
    try { const caps = SC.track.getCapabilities ? SC.track.getCapabilities() : {}; const t = $('#scTorch'); if (t) t.hidden = !caps.torch; } catch (e) {}
    SC.prevSig = null; SC.lastSig = null; SC.sharpRef = 0; setStatus('Hold the box over a plate');
    return true;
  }
  function stopCamera() { if (HX.demo) HX.demo.stop(); if (SC.stream) SC.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); SC.stream = null; SC.track = null; if (SC.video) SC.video.srcObject = null; }
  async function wake() { try { if (navigator.wakeLock && !SC.lock) { SC.lock = await navigator.wakeLock.request('screen'); SC.lock.addEventListener('release', () => { SC.lock = null; }); } } catch (e) {} }

  async function open() {
    if (SC.open) return;
    if (!HX.scan || !HX.scan.on) { toast('Camera scanning isn’t set up yet. Type the plate instead.', true); return; }
    if (!S.facilities.length) return;
    SC.open = true; SC.facId = facById(UI.enfFac) ? UI.enfFac : S.facilities[0].id;
    Object.assign(SC, { items: [], byKey: new Map(), cur: null, filter: 'problems', paused: false, disabled: false, counts: { checked: 0, flagged: 0, notices: 0 }, inflight: 0, lastSend: 0, lastSig: null, prevSig: null, sharpRef: 0, retries: 0, lastEmpty: false, fails: 0, backoffUntil: 0, armLeave: false, sent: 0, movingRun: 0, panned: false, used: SC.used, cap: SC.cap });
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { SC.audio = new AC(); if (SC.audio.state === 'suspended') SC.audio.resume(); } } catch (e) {}
    const el = shell(); document.body.appendChild(el); document.body.classList.add('scan-on');
    const hdr = document.querySelector('header.top'), main = $('#main'); if (hdr) hdr.inert = true; if (main) main.inert = true;
    SC.el = el; SC.video = $('#scVideo'); SC.reticle = $('#scReticle');
    const gc = document.createElement('canvas'); gc.width = GW; gc.height = GH; SC.gctx = gc.getContext('2d', { willReadFrequently: true }); SC.sendCanvas = document.createElement('canvas');
    $('#scFac').value = SC.facId; renderAll(); wake();
    SC.timer = setInterval(tick, TUNE.tickMs);
    await startCamera();
  }
  function close() {
    if (!SC.open) return;
    SC.open = false; clearInterval(SC.timer); clearTimeout(SC.hitT); stopCamera();
    try { if (SC.lock) SC.lock.release(); } catch (e) {} SC.lock = null;
    try { if (SC.audio) SC.audio.close(); } catch (e) {} SC.audio = null;
    SC.items.forEach(dropFrame); SC.items = []; SC.byKey = new Map(); SC.cur = null;
    if (SC.el) SC.el.remove(); SC.el = null; SC.video = null; SC.reticle = null;
    document.body.classList.remove('scan-on');
    const hdr = document.querySelector('header.top'), main = $('#main'); if (hdr) hdr.inert = false; if (main) main.inert = false;
    render();
  }
  document.addEventListener('visibilitychange', () => { if (!SC.open || document.hidden) return; wake(); if (SC.track && SC.track.readyState !== 'live') startCamera(); else if (SC.video && SC.video.play) SC.video.play().catch(() => {}); });
  window.addEventListener('pagehide', () => { if (SC.open) stopCamera(); });
  if (k()) k().onChange(() => { if (SC.open) { renderTop(); renderList(); const cur = $('#scCur'); if (cur) cur.innerHTML = curHtml(); } });

  /* ---------- taps ---------- */
  document.addEventListener('click', async e => {
    const root = e.target.closest('#scan'); if (!root) return;
    const b = e.target.closest('[data-sc]');
    if (!b) { if (e.target.closest('#scView') && !e.target.closest('.scan-ctl,.scan-msg') && SC.video && !SC.disabled) readNow(); return; }
    const a = b.dataset.sc, it = b.dataset.id ? itemOf(b) : null;
    if (a !== 'done' && SC.armLeave) { SC.armLeave = false; renderTop(); }
    if (a === 'done') { const open = unhandled(); if (open && !SC.armLeave) { SC.armLeave = true; renderTop(); clearTimeout(SC.armT); SC.armT = setTimeout(() => { SC.armLeave = false; renderTop(); }, 4000); } else close(); }
    else if (a === 'retry') startCamera();
    else if (a === 'demonext') { HX.demo.next(); SC.lastEmpty = false; setStatus('Next car'); }
    else if (a === 'read') readNow();
    else if (a === 'pause') { SC.paused = !SC.paused; renderTop(); }
    else if (a === 'mode') { SC.mode = SC.mode === 'fast' ? 'auto' : 'fast'; SC.lastSig = null; renderTop(); }
    else if (a === 'sound') { SC.sound = !SC.sound; store.set('scanSound', SC.sound ? '1' : '0'); renderTop(); if (SC.sound) tone(900, 80, 0, .1); }
    else if (a === 'torch' && SC.track) { SC.torch = !SC.torch; try { await SC.track.applyConstraints({ advanced: [{ torch: SC.torch }] }); } catch (x) { SC.torch = false; } b.textContent = SC.torch ? 'Light on' : 'Light'; }
    else if (a === 'filter') { SC.filter = b.dataset.f; renderList(); }
    else if (a === 'zone') { UI.enfZone = b.dataset.v; renderTop(); }
    else if (a === 'printer') { const kit = k(); if (kit && kit.supported()) { b.disabled = true; try { await kit.connect(); } catch (x) { if (x.name !== 'NotFoundError' && x.name !== 'AbortError') note(x.message); } b.disabled = false; renderTop(); } else window.printHelpDialog(); }
    else if (a === 'printhelp') window.printHelpDialog();
    else if (a === 'printsys' && it && it.citeId) ACT.printSys({ dataset: { id: it.citeId } });
    else if (a === 'notice' && it) noticeForm(it);
    else if (a === 'dismiss' && it) { it.dismissed = true; if (SC.cur === it) SC.cur = SC.items.find(x => !x.dismissed && x !== it) || null; renderAll(); }
    else if (a === 'print' && it) { const c = byId('citations', it.citeId); b.disabled = true; await printCite(it, c); renderAll(); }
    else if (a === 'use' && it) { const pl = normPlate(b.dataset.plate); if (pl) { SC.byKey.delete(it.key); const v = verdictOf(pl, it.facId); Object.assign(it, { plate: pl, key: it.facId + '|' + pl, alts: [], score: 1, level: v.level, title: v.title, lines: v.lines || [], suggest: v.suggest, towEligible: !!v.towEligible, hot: !!v.hot }); SC.byKey.set(it.key, it); SC.cur = it; log(it, { manual: true }, v); alertFor(v.level); renderAll(); } }
  });
  document.addEventListener('submit', e => {
    if (!e.target.closest('#scManual')) return; e.preventDefault();
    const inp = $('#scPlate'), pl = normPlate(inp.value); if (pl.length < 2) { inp.focus(); return; }
    inp.value = ''; const r = addRead({ plate: pl, score: 1, state: '', manual: true });
    if (r) alertFor(r.level); renderAll();
  });
  document.addEventListener('change', e => { if (e.target.id !== 'scFac' || !SC.open) return; SC.facId = e.target.value; UI.enfFac = SC.facId; store.set('enfFac', SC.facId); SC.lastSig = null; renderTop(); });
  async function readNow() {
    if (!SC.open || SC.disabled || SC.inflight >= TUNE.maxInflight + 1 || !SC.video || !SC.video.videoWidth) { setStatus(SC.inflight ? 'Still reading…' : 'Camera isn’t ready'); return; }
    const r = cropRect(); if (!r) return; SC.paused = false; SC.retries = 0; SC.lastSig = null; send('read', r);
  }

  /* ---------- the enforcement screen and Settings ---------- */
  window.scanCard = () => {
    if (!can('citations')) return '';
    const on = !!(HX.scan && HX.scan.on), cam = supportsCamera(), kit = k();
    return (HX.demo ? HX.demo.introHtml() : '') + `<section class="panel scancard"><div class="panel-b" style="display:grid;gap:10px"><div class="row" style="justify-content:space-between;align-items:center;gap:12px"><div><h3>Scan plates with the camera</h3>
      <p class="note" style="margin:2px 0 0">Walk the lot with the phone pointed at plates. Each one is checked and flagged on the spot.</p></div>
      <button class="btn pri lg" data-act="scanStart" data-perm="citations" ${on && cam ? '' : 'disabled'}>Start scanning</button></div>
      ${!on ? '<p class="note" style="margin:0">Camera scanning isn’t switched on for this account yet (the owner can do this under Settings). You can still type plates below.</p>' : !cam ? '<p class="note" style="margin:0">This browser can’t use the camera here. Type plates below.</p>' : ''}
      ${kit && kit.ios && !kit.supported() ? '<p class="note" style="margin:0">To print notices from an iPhone or iPad, open ParkOps in the free Bluefy app. <button type="button" class="btn sm" data-act="printHelp">How</button></p>' : ''}</div></section>`;
  };
  window.scanSettings = () => {
    if (!can('settings')) return '';
    if (UI.scanStat === undefined) { UI.scanStat = null; HX.api('GET', '/api/admin/scan').then(d => { UI.scanStat = d; schedule(); }).catch(e => { UI.scanStat = { error: e.message }; schedule(); }); }
    const d = UI.scanStat, pct = d && d.cap ? Math.min(100, Math.round(d.used / d.cap * 100)) : 0;
    return `<section class="panel"><div class="panel-h"><h2>Plate scanning (camera)</h2>${d && d.configured ? '<span class="pill ok">On</span>' : d ? '<span class="pill">Off</span>' : ''}<button class="btn sm" data-act="scanRefresh">Refresh</button></div><div class="panel-b" style="display:grid;gap:10px;font-size:.9rem">
      ${!d ? 'Loading…' : d.error ? esc(d.error) : !d.configured ? `<p style="margin:0">Officers can scan plates with an iPhone, iPad or Android phone, and ParkOps checks each one for violations. It needs a plate-reading service, which charges a fraction of a cent per scan. Until it’s set up, officers type plates instead.</p>
        <ol style="margin:0;padding-left:20px;display:grid;gap:4px"><li>Make an account at <b>platerecognizer.com</b> and copy your API token.</li><li>In Render, open the parkops service → Environment, add <span class="mono">PLATE_RECOGNIZER_TOKEN</span> with that token, and save.</li><li>Optional: add <span class="mono">SCAN_MONTHLY_CAP</span> to set the most scans allowed per month (default 60,000).</li></ol>`
      : `<div><b>This month:</b> ${d.used.toLocaleString()} of ${d.cap.toLocaleString()} scans</div><div class="bar ${pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : ''}" role="img" aria-label="${pct}% of the monthly scan limit used"><i style="width:${pct}%"></i></div>
        <div class="note" style="margin:0">Scanning stops at the limit (typing plates keeps working), and you get an email at 80% and at 100%. Change the limit with <span class="mono">SCAN_MONTHLY_CAP</span> in Render. Plate region: ${esc((d.regions || []).join(', ') || 'us')}.</div>
        ${d.days && d.days.length ? `<div class="tbl-wrap"><table><thead><tr><th>Day</th><th class="r">Scans</th></tr></thead><tbody>${d.days.slice(-8).reverse().map(x => `<tr><td>${esc(x.day)}</td><td class="r num">${(+x.n).toLocaleString()}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${d.reader ? `<div class="note" style="margin:0">Since the server last restarted: ${d.reader.sent} frames sent, ${d.reader.ok} with a plate, ${d.reader.empty} with none, ${d.reader.failed} failed${d.reader.throttled ? ', ' + d.reader.throttled + ' slowed down by the service' : ''}.</div>` : ''}`}
      <div class="note" style="margin:0">Frames of the plate area are sent to the plate-reading service to be read. ParkOps itself keeps a frame only when an officer issues a notice, as evidence with that notice.</div></div></section>`;
  };
  Object.assign(ACT, { scanStart() { open(); }, scanRefresh() { UI.scanStat = undefined; render(); } });
  window.scanKit = { TUNE, analyse, sigDiff, open, close, readNow, get state() { return SC; } };
})();
