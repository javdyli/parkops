/* ============ utilities ============ */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>(n<0?'-':'')+'$'+Math.abs(Math.round((+n||0)*100)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const money0=n=>'$'+Math.round(+n||0).toLocaleString('en-US');
const normPlate=ParkRules.normPlate;
const now=()=>Date.now();
const M=6e4,H=36e5,D=864e5;
const fmtTime=(t,tz)=>{if(!t)return'—';const d=new Date(t);const o=tz?{timeZone:tz}:{};const same=d.toLocaleDateString([],o)===new Date().toLocaleDateString([],o);const tm=d.toLocaleTimeString([], Object.assign({hour:'numeric',minute:'2-digit'},o));return same?tm:d.toLocaleDateString([], Object.assign({month:'short',day:'numeric'},o))+', '+tm};
const fmtDate=(t,tz)=>t?new Date(t).toLocaleDateString([], Object.assign({month:'short',day:'numeric',year:'numeric'},tz?{timeZone:tz}:{})):'—';
const fmtDay=(t,tz)=>new Date(t).toLocaleDateString([], Object.assign({weekday:'short',month:'short',day:'numeric'},tz?{timeZone:tz}:{}));
const dur=ms=>{ms=Math.max(0,ms);const m=Math.round(ms/M);if(m<60)return m+'m';const h=Math.floor(m/60);if(h<48)return h+'h '+(m%60)+'m';return Math.floor(h/24)+'d '+(h%24)+'h'};
const ago=t=>dur(now()-t)+' ago';
const uid=p=>p+Math.random().toString(36).slice(2,8).toUpperCase();
const store={get(k){try{return localStorage.getItem('parkops.'+k)}catch(e){return null}},set(k,v){try{localStorage.setItem('parkops.'+k,v)}catch(e){}}};
const plateChip=p=>`<span class="plate" data-act="checkPlate" data-plate="${esc(p)}" title="Check this plate">${esc(p)}</span>`;
const sum=(a,f)=>a.reduce((s,x)=>s+(+f(x)||0),0);
const HOSTED=window.PARKOPS_HOSTED||null;

const DEFAULT_VIOLATIONS=[
  {code:'NOPERMIT',name:'No valid payment or monthly parking',fine:50},{code:'EXPIRED',name:'Paid time expired',fine:35},
  {code:'WRONGZONE',name:'Monthly parking not valid in this facility',fine:40},{code:'UNPAID',name:'Unpaid parking balance',fine:25},
  {code:'RESERVED',name:'Parked in reserved space',fine:75},{code:'ADA',name:'Accessible space without placard',fine:250},
  {code:'FIRELANE',name:'Fire lane / no parking zone',fine:100},{code:'RESERVEDZONE',name:'Parked in reservations-only section',fine:75}];
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const TIMEZONES=[['America/New_York','Eastern'],['America/Chicago','Central'],['America/Denver','Mountain'],['America/Phoenix','Arizona'],['America/Los_Angeles','Pacific'],['America/Anchorage','Alaska'],['Pacific/Honolulu','Hawaii']];

/* ============ state ============ */
const S={roles:null,role:'viewer',perms:new Set(),facilities:[],permitTypes:[],permits:[],sessions:[],citations:[],validations:[],members:[],tenants:[],cameras:[],reservations:[],companies:[],invoices:[],vips:[],ratings:[],config:null,feed:[],loaded:new Set(),db:null,online:null,writable:true};
const R=ParkRules(S);
const UI={role:store.get('role')||'ops',tab:store.get('tab')||'overview',permitQ:'',permitStatus:'all',citeStatus:'open',citeQ:'',check:null,enfFac:store.get('enfFac')||'',actFac:store.get('actFac')||'',auditRange:'today',auditFilter:'all',tenant:store.get('tenant')||'',tenantDay:0,lookup:'',lookupData:null,appealFor:null,receipt:null,lprResult:null};
const COLLS=['facilities','permitTypes','permits','sessions','citations','validations','members','tenants','cameras','reservations','companies','invoices','vips','ratings'];
const facById=id=>S.facilities.find(f=>f.id===id);
const typeById=id=>S.permitTypes.find(t=>t.id===id);
const violations=()=>{const v=(S.config&&Array.isArray(S.config.violations)&&S.config.violations.length)?S.config.violations:DEFAULT_VIOLATIONS;return v.some(x=>x.code==='RESERVEDZONE')?v:v.concat(DEFAULT_VIOLATIONS.filter(x=>x.code==='RESERVEDZONE'))};
const photoLink=id=>HOSTED&&id?` <a class="tag" href="/photos/${esc(id)}" target="_blank" rel="noopener">Photo</a>`:'';
const violByCode=c=>violations().find(v=>v.code===c);
const campusName=()=>(S.config&&S.config.campusName)||'ParkOps';
const tzF=f=>R.tzOf(f);
const byId=(arr,id)=>S[arr].find(x=>x.id===id);
const canEditOps=()=>S.roles&&S.roles.includes('ops');
const can=p=>S.perms.has(p);
const setRole=r=>{S.role=ParkRules.canonRole(r||'viewer');S.perms=new Set(ParkRules.ROLES[S.role]||[])};
const actorName=()=>(HOSTED&&HOSTED.user&&HOSTED.user.name)||store.get('officer')||'Staff';
/* Which permission each button or form needs. The server checks the same table; this only greys things out. */
const ACT_PERM={editFacility:'facilities',editRates:'facilities',makeSign:'facilities',recount:'facilities',editTenant:'validations',editValidation:'validations',toggleValidation:'validations',editType:'monthly',issuePermit:'monthly',approvePermit:'monthly',denyPermit:'monthly',reinstatePermit:'monthly',officePaid:'monthly',endMonthly:'monthly',editPermit:'monthly',editCompany:'monthly',sendCompanyLink:'monthly',runBilling:'monthly',invoicePaid:'monthly',importMonthly:'import',editCamera:'cameras',citePaid:'citations.decide',citeVoid:'citations.decide',appealDecide:'citations.decide',citeSession:'citations',addViolation:'settings',clearSamples:'settings',refreshSamples:'settings',pruneSessions:'settings',removeMember:'monthly',staffCancelRes:'reservations',refund:'refunds',addUser:'users',editUser:'users',backupNow:'settings',markSessionPaid:'tickets',waiveSession:'tickets.adjust',closeSession:'tickets',validateSession:'tickets',closeMissed:'tickets.adjust',confirmMatch:'tickets.adjust',rejectMatch:'tickets.adjust',missedBill:'tickets.adjust',missedFree:'tickets.adjust'};
const FORM_PERM={settings:'settings',violations:'settings',lprRead:'cameras',cite:'citations'};
/* One entry point for every ticket action, in both builds. Hosted: the server runs the planner and checks the role. */
async function ticketAction(id,action,args,okMsg){
  args=Object.assign({by:actorName()},args||{});
  if(HOSTED){try{const r=await HOSTED.api('POST',action==='create'?'/api/tickets':'/api/tickets/'+encodeURIComponent(id)+'/'+action,args);if(okMsg)toast(typeof okMsg==='function'?okMsg(r):okMsg);return r}catch(e){toast(e.message,true);return {error:e.message}}}
  args.allowBackdate=can('tickets.adjust');const s=id?byId('sessions',id):null;const r=action==='create'?R.TICKET.create(args):R.TICKET[action](s,args);
  if(r.error){toast(r.error,true);return r}
  applyLocal(r.ops);const ok=await write(db=>execOps(db,r.ops));if(!ok)return {error:'Couldn’t save.'};
  if(okMsg)toast(typeof okMsg==='function'?okMsg(r):okMsg);return r;
}

/* ============ data layer ============ */
async function write(fn,okMsg){
  if(!S.db){toast('Changes can’t be saved in this view.',true);return false}
  try{await fn(S.db);if(okMsg)toast(okMsg);return true}
  catch(e){
    if(e&&(e.code==='invalid_argument'||e.code==='forbidden'))toast('Your access level can’t change this. Ask the owner for edit access.',true);
    else if(e&&e.code==='quota_exceeded')toast('The parking database is full. Remove old records in Settings, then try again.',true);
    else toast('Couldn’t save: '+((e&&e.message)||'try again'),true);
    return false}
}
const col=(db,c)=>db.collection(c);
const addDoc=(c,data,id)=>write(db=>id?col(db,c).doc(id).set(data):col(db,c).add(data));
function applyLocal(ops){
  ops.forEach(o=>{if(!o.coll||!S[o.coll])return;const arr=S[o.coll];const i=arr.findIndex(x=>x.id===o.id);
    if(o.type==='set'){const d=Object.assign({id:o.id},o.data);if(i>=0)arr[i]=d;else arr.push(d)}
    else if(o.type==='update'&&i>=0)arr[i]=Object.assign({},arr[i],o.data);
    else if(o.type==='delete'&&i>=0)arr.splice(i,1)});
}
async function execOps(db,ops){
  for(const o of ops){
    if(o.type==='log'){const reads=[o.data,...S.feed].slice(0,100);S.feed=reads;await db.doc('feeds/lpr').set({reads});continue}
    const ref=col(db,o.coll).doc(o.id);
    if(o.coll==='validations'&&o.type==='update'){try{await ref.update(o.data)}catch(e){}continue}
    if(o.type==='set')await ref.set(o.data);else if(o.type==='update')await ref.update(o.data);else if(o.type==='delete')await ref.delete();
  }
}
async function lprRead(inp){
  if(HOSTED)return HOSTED.lprRead(inp);
  const r=R.planRead(inp);if(r.error)return {level:'bad',text:r.error};
  applyLocal(r.ops);await write(db=>execOps(db,r.ops));return r.result;
}
async function portalRun(op,args,payment){
  if(HOSTED)return HOSTED.portal(op,args,payment);
  const r=R.PORTAL[op](args);if(r.error)return r;
  r.ops=JSON.parse(JSON.stringify(r.ops).split('"__PAY__"').join(JSON.stringify(R.uid('sim_'))));
  applyLocal(r.ops);const ok=await write(db=>execOps(db,r.ops));return ok?r:{error:'Couldn’t save. Try again.'};
}
async function refreshLookup(){if(!UI.lookup){UI.lookupData=null;return}UI.lookupData=HOSTED?await HOSTED.lookup(UI.lookup):R.lookup(UI.lookup)}
async function saveFile(name,text){
  if(HOSTED)return HOSTED.download(name,text);
  const d=window.claude&&await window.claude.use('downloads');
  if(!d){toast('Downloads aren’t available in this view.',true);return}
  try{await d.save({filename:name,data:new Blob([text],{type:'text/csv'})})}catch(e){if(e&&e.code!=='declined')toast('Couldn’t save the file: '+(e.message||e.code),true)}
}
const csv=rows=>rows.map(r=>r.map(v=>{v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(',')).join('\n');

/* ============ boot ============ */
function setLive(state,txt){const el=$('#live');el.className='live '+state;el.lastElementChild.textContent=txt}
async function boot(){
  let env;
  if(HOSTED){try{env=await HOSTED.init()}catch(e){env=null}}
  else{
    const c=window.claude;
    if(!c||!c.use){S.online=false;S.roles=['ops','enf','portal'];setRole('owner');setLive('off','Offline preview');S.loaded=new Set(['all']);render();return}
    let u=null;try{u=await c.use('user')}catch(e){}
    let canEdit=false;try{canEdit=u?!!(await u.canEdit()):false}catch(e){}
    let w=null;try{w=u?await u.can('data.write'):null}catch(e){}
    let db=null;try{db=await c.use('db')}catch(e){}
    env={db,roles:canEdit?['ops','enf','portal']:['portal'],writable:w!==false,role:canEdit?'owner':'viewer'};
  }
  if(!env||!env.db){S.online=false;S.roles=(env&&env.roles)||['portal'];setLive('off','Not connected');S.loaded=new Set(['all']);render();return}
  S.db=env.db;S.roles=env.roles;S.writable=env.writable!==false;S.online=true;setLive('on','Live');setRole(env.role||(env.roles.includes('ops')?'owner':'viewer'));
  if(env.canLogout){const b=$('#logoutBtn');b.hidden=false;b.onclick=()=>HOSTED.logout()}
  else if(env.canLogin){const b=$('#logoutBtn');b.hidden=false;b.textContent='Staff sign in';b.onclick=()=>{location.href='/login'}}
  const onErr=e=>{setLive('off',e&&e.code==='revoked'?'Access changed':'Reconnect needed')};
  COLLS.forEach(k=>S.db.collection(k).onSnapshot(snap=>{S[k]=snap.docs.map(d=>Object.assign({id:d.id},d.data()));S.loaded.add(k);schedule()},onErr));
  S.db.doc('settings/config').onSnapshot(d=>{S.config=d.exists?d.data():null;S.loaded.add('config');schedule()},onErr);
  S.db.doc('feeds/lpr').onSnapshot(d=>{S.feed=(d.exists&&d.data().reads)||[];S.loaded.add('feed');schedule()},onErr);
}
const isLoaded=()=>S.roles!==null&&(S.loaded.has('all')||(S.loaded.has('facilities')&&S.loaded.has('sessions')&&S.loaded.has('permits')));

/* ============ render plumbing ============ */
let pend=false;function schedule(){if(pend)return;pend=true;requestAnimationFrame(()=>{pend=false;render()})}
function snapForm(root){const vals={};root.querySelectorAll('input[id],select[id],textarea[id]').forEach(el=>{if(el.type==='file')return;vals[el.id]=(el.type==='checkbox'||el.type==='radio')?el.checked:el.value});const a=document.activeElement;return {vals,focus:a&&a.id&&root.contains(a)?a.id:null,sel:a&&'selectionStart' in a?[a.selectionStart,a.selectionEnd]:null}}
function restoreForm(root,s){for(const [id,v] of Object.entries(s.vals)){const el=root.querySelector('#'+CSS.escape(id));if(!el||el.dataset.fresh)continue;if(el.type==='checkbox'||el.type==='radio')el.checked=v;else el.value=v}
  if(s.focus){const el=root.querySelector('#'+CSS.escape(s.focus));if(el){el.focus({preventScroll:true});if(s.sel&&el.setSelectionRange)try{el.setSelectionRange(s.sel[0],s.sel[1])}catch(e){}}}}
function render(){
  if(S.roles&&!S.roles.includes(UI.role))UI.role=S.roles[0];
  const rolesEl=$('.roles');rolesEl.hidden=!S.roles||S.roles.length<2;
  document.querySelectorAll('.roles button').forEach(b=>{b.hidden=!(S.roles||[]).includes(b.dataset.role);b.setAttribute('aria-pressed',b.dataset.role===UI.role)});
  $('#campusName').textContent=campusName();$('#brandSub').textContent=canEditOps()?(HOSTED?ParkRules.ROLE_NAMES[S.role]||'Parking operations':'Parking operations'):'Parking services';
  applyBrand();
  if(TAB_PERM[UI.tab]&&!can(TAB_PERM[UI.tab]))UI.tab='overview';
  renderTabs();
  const main=$('#main');const snap=snapForm(main);
  let html='';
  if(S.online===false&&!HOSTED)html+=`<div class="banner">Live data isn’t available in this view. Open the page on claude.ai while signed in to see and save your parking records.</div>`;
  else if(!S.writable&&canEditOps())html+=`<div class="banner">You have view-only access. Ask the owner for edit access to make changes.</div>`;
  else if(!S.writable&&UI.role==='portal')html+=`<div class="banner">You can look up any plate here. Paying, monthly sign-ups and appeals are handled by the parking office for now.</div>`;
  if(!isLoaded())html+=`<div class="skel">Loading your parking data…</div>`;
  else html+=UI.role==='enf'?vEnforcement():UI.role==='portal'?(window.vPortalHosted?window.vPortalHosted():vPortal()):(VIEWS[UI.tab]||VIEWS.overview)();
  main.innerHTML=html;restoreForm(main,snap);afterRender();
  if(!S.writable)main.querySelectorAll('form[data-form]:not([data-form=lookup]):not([data-form=check]) button,[data-act=payBalance],[data-act=payCitation],[data-act=startAppeal]').forEach(b=>b.disabled=true);
}
function afterRender(){updateQuote();updateTypeInfo();
  const main=$('#main');
  main.querySelectorAll('[data-act]').forEach(el=>{const p=ACT_PERM[el.dataset.act]||el.dataset.perm;if(p&&!can(p)){el.disabled=true;el.title='Your role can’t do this'}});
  main.querySelectorAll('form[data-form]').forEach(f=>{const p=FORM_PERM[f.dataset.form]||f.dataset.perm;if(p&&!can(p))f.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=true)});
}
function applyBrand(){const c=S.config||{};const r=document.documentElement.style;if(c.brandColor&&/^#[0-9a-f]{6}$/i.test(c.brandColor))r.setProperty('--accent',c.brandColor);else r.removeProperty('--accent');if(c.brandStripe&&/^#[0-9a-f]{6}$/i.test(c.brandStripe))r.setProperty('--stripe',c.brandStripe);else r.removeProperty('--stripe')}
const TABS=[['overview','Overview'],['selfparking','Self-parking'],['activity','Occupancy'],['review','Plate review'],['tenants','Validations'],['valet','Valet'],['permits','Monthly'],['facilities','Locations'],['citations','Notices'],['lpr','Cameras'],['reports','Reports'],['settings','Settings']];
if(HOSTED){TABS.splice(7,0,['reservations','Reservations']);TABS.splice(11,0,['payments','Payments'])}
const TAB_PERM={settings:'settings',reports:'reports',payments:'payments'};
function renderTabs(){
  const t=$('#tabs');t.hidden=UI.role!=='ops';if(t.hidden)return;
  const counts={permits:S.permits.filter(p=>p.status==='pending'||p.status==='waitlist'||p.status==='suspended').length,citations:S.citations.filter(c=>c.status==='appeal').length,selfparking:R.unpaidSessions().length,review:reviewList().length,valet:S.sessions.filter(s=>s.valet&&!s.endAt&&s.valet.status==='requested').length};
  t.innerHTML=TABS.filter(([k])=>!TAB_PERM[k]||can(TAB_PERM[k])).map(([k,l])=>`<button role="tab" data-tab="${k}" aria-selected="${UI.tab===k}">${l}${counts[k]?`<span class="badge">${counts[k]}</span>`:''}</button>`).join('');
}

/* ============ charts ============ */
function niceMax(v){if(v<=0)return 10;const p=10**Math.floor(Math.log10(v));const m=v/p;const s=[1,1.2,1.5,2,2.5,3,4,5,6,8,10].find(x=>m<=x);return s*p}
const axisText=(x,y,t,anchor='end',extra='')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono, monospace" ${extra}>${t}</text>`;
function revChart(days){
  const W=640,Hh=230,pl=52,pr=10,pt=14,pb=30,iw=W-pl-pr,ih=Hh-pt-pb;
  const tot=days.map(d=>d.parking+d.citations+d.permits);const max=niceMax(Math.max(...tot,100));
  const y=v=>pt+ih-(v/max)*ih;const bw=Math.min(46,iw/days.length*.58);
  let g='';[0,.25,.5,.75,1].forEach(t=>{const v=t*max;g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>`+axisText(pl-8,y(v)+4,money0(v))});
  days.forEach((d,i)=>{const cx=pl+(i+.5)*iw/days.length;const x=cx-bw/2;let base=0;const last=i===days.length-1;
    [['parking','var(--accent)'],['permits','var(--ok)'],['citations','var(--stripe)']].forEach(([k,c])=>{const v=d[k];if(v<=0)return;const y1=y(base+v),y0=y(base);g+=`<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(1,y0-y1)}" fill="${c}"><title>${d.label} ${k}: ${money(v)}</title></rect>`;base+=v});
    g+=`<text x="${cx}" y="${Hh-10}" text-anchor="middle" font-size="12" fill="${last?'var(--fg)':'var(--muted)'}" font-weight="${last?600:400}" font-family="Barlow, sans-serif">${last?'Today':d.label}</text>`;
    if(tot[i]>0)g+=axisText(cx,y(tot[i])-5,money0(tot[i]),'middle','fill-opacity="1" style="fill:var(--fg)"')});
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Revenue for the last 7 days">${g}</svg>`;
}
/* Step chart of vehicles on site across one parking day. */
function stepChart({pts,from,to,cap,capLabel,offset=0,tz,label}){
  const W=760,Hh=250,pl=46,pr=14,pt=16,pb=30,iw=W-pl-pr,ih=Hh-pt-pb;
  const peak=Math.max(0,...pts.map(p=>p[1]+offset));const max=niceMax(Math.max(peak,cap||0)*1.12||10);
  const x=t=>pl+((t-from)/(to-from))*iw, y=v=>pt+ih-(v/max)*ih;
  let g='';
  for(let i=0;i<=4;i++){const v=Math.round(max*i/4);g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>`+axisText(pl-6,y(v)+4,v.toLocaleString())}
  for(let h=0;h<=24;h+=3){const t=from+h*H;if(t>to)break;g+=axisText(x(t),Hh-10,new Date(t).toLocaleTimeString([], {hour:'numeric',timeZone:tz}),'middle')}
  let d='';pts.forEach((p,i)=>{const X=x(Math.max(from,Math.min(to,p[0]))),Y=y(p[1]+offset);d+=i?`H${X.toFixed(1)}V${Y.toFixed(1)}`:`M${X.toFixed(1)},${Y.toFixed(1)}`});
  const last=pts[pts.length-1];const area=d+`V${y(0)}H${x(pts[0][0])}Z`;
  const cid='clip'+Math.random().toString(36).slice(2,7);
  g+=`<path d="${area}" fill="var(--accent)" fill-opacity=".14"/>`;
  if(cap){g+=`<clipPath id="${cid}"><rect x="${pl}" y="${pt}" width="${iw}" height="${Math.max(0,y(cap)-pt)}"/></clipPath><path d="${area}" fill="var(--bad)" fill-opacity=".35" clip-path="url(#${cid})"/>`}
  g+=`<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  if(cap)g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(cap)}" y2="${y(cap)}" stroke="var(--bad)" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${W-pr}" y="${y(cap)-6}" text-anchor="end" font-size="12" fill="var(--bad)" font-family="Barlow, sans-serif" font-weight="600">${esc(capLabel||'Limit')} ${cap.toLocaleString()}</text>`;
  if(last&&last[0]<to-60000)g+=`<circle cx="${x(last[0])}" cy="${y(last[1]+offset)}" r="4" fill="var(--accent)"/>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(label||'Vehicles on site over the day')}">${g}</svg>`;
}
function peakBars(days,allot,tz){
  const W=760,Hh=220,pl=46,pr=14,pt=16,pb=30,iw=W-pl-pr,ih=Hh-pt-pb;
  const max=niceMax(Math.max(allot||0,...days.map(d=>d.peak))*1.12||10);const y=v=>pt+ih-(v/max)*ih;const bw=iw/days.length*.7;
  let g='';for(let i=0;i<=4;i++){const v=Math.round(max*i/4);g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>`+axisText(pl-6,y(v)+4,v)}
  days.forEach((d,i)=>{const cx=pl+(i+.5)*iw/days.length;const over=d.peak>allot;
    g+=`<rect x="${cx-bw/2}" y="${y(d.peak)}" width="${bw}" height="${Math.max(0,y(0)-y(d.peak))}" fill="${over?'var(--bad)':'var(--accent)'}" data-act="tenantDayPick" data-i="${i}" style="cursor:pointer"><title>${fmtDay(d.start,tz)}: peak ${d.peak}${over?`, ${d.over} over`:''}</title></rect>`;
    const st=Math.ceil(days.length/8);if((i%st===0&&days.length-1-i>=st/2)||i===days.length-1)g+=axisText(cx,Hh-10,new Date(d.start+12*H).toLocaleDateString([], {month:'numeric',day:'numeric',timeZone:tz}),'middle')});
  if(allot)g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(allot)}" y2="${y(allot)}" stroke="var(--bad)" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${W-pr}" y="${y(allot)-6}" text-anchor="end" font-size="12" fill="var(--bad)" font-family="Barlow, sans-serif" font-weight="600">Allotment ${allot}</text>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Daily peak of cars on site">${g}</svg>`;
}

/* ============ overview ============ */
function revenueByDay(n){
  const days=[];const d0=new Date();d0.setHours(0,0,0,0);
  for(let i=n-1;i>=0;i--){const s=d0.getTime()-i*D;days.push({s,e:s+D,label:new Date(s).toLocaleDateString([], {weekday:'short'}),parking:0,citations:0,permits:0})}
  const put=(t,k,a)=>{const d=days.find(x=>t>=x.s&&t<x.e);if(d)d[k]+=+a||0};
  S.sessions.forEach(s=>(s.payments||[]).forEach(p=>put(p.at,'parking',p.amount)));
  S.citations.forEach(c=>{if(c.status==='paid'&&c.paidAt)put(c.paidAt,'citations',c.fine)});
  S.permits.forEach(p=>{if(p.paidAt)put(p.paidAt,'permits',p.amountPaid)});
  if(HOSTED&&window.hostedRevenue){const h=window.hostedRevenue(days);if(h)return h}
  return days;
}
function emptyFacilities(){return `<div class="panel"><div class="empty"><h2 style="margin-bottom:6px">No garages or lots yet</h2><p>Add your first facility with its capacity, rates and daily reset time.</p>${canEditOps()?'<button class="btn pri" data-act="editFacility">Add a facility</button>':''}</div></div>`}
function attentionItems(){
  const it=[];
  const pend=S.permits.filter(p=>p.status==='pending');const wl=S.permits.filter(p=>p.status==='waitlist');
  const ap=S.citations.filter(c=>c.status==='appeal');const un=R.unpaidSessions();
  const grace=(+(S.config&&S.config.unpaidGraceHours)||48)*H;const late=un.filter(s=>now()-s.endAt>grace);
  const stale=S.sessions.filter(s=>!s.endAt&&s.mode==='lpr'&&now()-s.startAt>R.staleHours()*H&&s.kind!=='permit'&&!s.valet);
  const noEntry=S.sessions.filter(s=>(s.noEntry)&&!s.reviewed&&now()-s.endAt<D);
  const rv=reviewList(),susp=S.permits.filter(p=>p.status==='suspended');
  if(rv.length)it.push({sev:'warn',t:`${rv.length} exit${rv.length>1?'s':''} held for review (plate misread or missed exit)`,go:'review'});
  if(susp.length)it.push({sev:'bad',t:`${susp.length} monthly parker${susp.length>1?'s':''} suspended for non-payment`,go:'permits',f:'suspended'});
  if(pend.length)it.push({sev:'info',t:`${pend.length} monthly request${pend.length>1?'s':''} to review`,go:'permits',f:'pending'});
  if(ap.length)it.push({sev:'warn',t:`${ap.length} notice dispute${ap.length>1?'s':''} waiting for a decision`,go:'citations',f:'appeal'});
  if(late.length)it.push({sev:'bad',t:`${late.length} unpaid exit${late.length>1?'s':''} past the ${grace/H}-hour grace period (${money(sum(late,R.balanceOf))})`,go:'selfparking',f:'unpaid'});
  else if(un.length)it.push({sev:'warn',t:`${un.length} unpaid exit${un.length>1?'s':''} within grace period (${money(sum(un,R.balanceOf))})`,go:'selfparking',f:'unpaid'});
  const vreq=S.sessions.filter(s=>s.valet&&!s.endAt&&s.valet.status==='requested');
  if(vreq.length)it.push({sev:'warn',t:`${vreq.length} valet retrieval${vreq.length>1?'s':''} waiting for a runner`,go:'valet'});
  if(noEntry.length)it.push({sev:'warn',t:`${noEntry.length} exit${noEntry.length>1?'s':''} in the last 24 hours had no matching entry read`,go:'review'});
  if(stale.length)it.push({sev:'warn',t:`${stale.length} vehicle${stale.length>1?'s have':' has'} been on site over ${R.staleHours()} hours. Check for missed exit reads.`,go:'review'});
  S.tenants.forEach(t=>{const d=R.tenantDays(t,1)[0];if(d&&d.over>0)it.push({sev:'bad',t:`${t.name} valet is ${d.over} over its ${t.allotment}-space allotment today (peak ${d.peak})`,go:'tenants',tenant:t.id})});
  S.facilities.forEach(f=>{const p=R.occupancy(f)/(+f.capacity||1);if(p>=.9)it.push({sev:'bad',t:`${f.name} is ${Math.round(p*100)}% full`,go:'activity',fac:f.id})});
  if(wl.length)it.push({sev:'info',t:`${wl.length} driver${wl.length>1?'s':''} on a monthly waitlist`,go:'permits',f:'waitlist'});
  return it;
}
function vOverview(){
  if(!S.facilities.length)return emptyFacilities();
  const cap=sum(S.facilities,f=>f.capacity),occ=sum(S.facilities,R.occupancy);
  const days=revenueByDay(7);const today=days[days.length-1];const tToday=today.parking+today.citations+today.permits;const t7=sum(days,d=>d.parking+d.citations+d.permits);
  const openC=S.citations.filter(c=>c.status==='open'||c.status==='appeal');
  const att=attentionItems();const pct=cap?Math.round(occ/cap*100):0;
  const activeMonthly=S.permits.filter(p=>p.status==='active'&&(!p.endAt||p.endAt>now()));const mrr=sum(activeMonthly,p=>(typeById(p.permitTypeId)||{}).price);
  const hasSample=COLLS.some(k=>(S[k]||[]).some(x=>x&&x.sample));
  const d0=new Date();d0.setHours(0,0,0,0);const exitsToday=S.sessions.filter(s=>s.endAt>=d0.getTime()&&!s.noEntry&&s.kind!=='permit');
  const unpaidToday=exitsToday.filter(s=>R.exitStatus(s)==='unpaid');
  return `${hasSample?`<div class="banner">Sample records are included so the screens have something to show. Remove them in Settings → Records before going live.</div>`:''}
  <div class="pagehead"><div><h1>${esc(campusName())}</h1><p>${new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})} · ${S.facilities.length} facilities · ${cap.toLocaleString()} spaces</p></div>
    <button class="btn" data-role-go="enf">Open officer view</button></div>
  <div class="kpis">
    <div class="kpi"><small>Vehicles on site</small><b>${occ.toLocaleString()}</b><span class="num">${pct}% of ${cap.toLocaleString()} spaces</span></div>
    <div class="kpi"><small>Revenue today</small><b>${money0(tToday)}</b><span>${money0(today.parking)} parking · ${money0(today.citations)} notices</span></div>
    <div class="kpi"><small>Last 7 days</small><b>${money0(t7)}</b><span>Parking, monthly and notices</span></div>
    <div class="kpi ${unpaidToday.length?'alert':''}"><small>Exits not charged today</small><b>${unpaidToday.length}</b><span>${money(sum(unpaidToday,R.balanceOf))} owed · ${exitsToday.length} exits today</span></div>
    <div class="kpi"><small>Active monthly</small><b>${activeMonthly.length}</b><span>${money0(mrr)} per month</span></div>
    <div class="kpi"><small>Open notices</small><b>${openC.length}</b><span>${money(sum(openC,c=>c.fine))} outstanding</span></div>
    <div class="kpi ${att.length?'alert':''}"><small>Needs attention</small><b>${att.length}</b><span>${att.length?'See list below':'All clear'}</span></div>
  </div>
  <section class="panel"><div class="panel-h"><h2>Facilities right now</h2><span class="muted" style="font-size:.84rem">Garages count from lane cameras; QR lots count paid sessions</span></div>
    <div class="panel-b"><div class="facs">${S.facilities.map(facCard).join('')}</div></div></section>
  <div class="grid g2">
    <section class="panel"><div class="panel-h"><h2>Revenue, last 7 days</h2><div class="legend"><span><i style="background:var(--accent)"></i>Parking</span><span><i style="background:var(--ok)"></i>Monthly</span><span><i style="background:var(--stripe)"></i>Notices</span></div></div>
      <div class="panel-b chart">${revChart(days)}</div></section>
    <section class="panel"><div class="panel-h"><h2>Needs attention</h2></div>
      <div class="list">${att.length?att.map(a=>`<div class="li"><span class="sev ${a.sev}"></span><div class="grow">${esc(a.t)}</div><button class="btn sm" data-act="goTab" data-tab="${a.go}" data-filter="${a.f||''}" data-tenant="${a.tenant||''}" data-fac="${a.fac||''}">Review</button></div>`).join(''):'<div class="empty">Nothing needs a decision right now.</div>'}</div></section>
  </div>
  <section class="panel"><div class="panel-h"><h2>Latest camera reads</h2><button class="btn sm" data-act="goTab" data-tab="lpr">All reads</button></div>${feedTable(S.feed.slice(0,6))}</section>`;
}
function facCard(f){
  const o=R.occupancy(f),c=+f.capacity||0,p=c?o/c:0;const cls=p>=.9?'bad':p>=.75?'warn':'';
  const ds=R.dayStart(now(),f);const ins=S.sessions.filter(s=>s.facilityId===f.id&&s.startAt>=ds).length,outs=S.sessions.filter(s=>s.facilityId===f.id&&s.endAt>=ds).length;
  return `<button class="fac" data-act="goTab" data-tab="activity" data-fac="${f.id}"><div class="fac-top"><div><h3>${esc(f.name)}</h3><span class="tag">${f.type==='lot'?'Surface lot':'Garage'}</span> ${f.payMode==='qr'?`<span class="tag">QR pay${f.lotCode?' · '+esc(f.lotCode):''}</span>`:S.cameras.some(c=>c.facilityId===f.id)?`<span class="tag">${S.cameras.filter(c=>c.facilityId===f.id).length} lanes</span>`:'<span class="tag">No cameras</span>'}</div><div class="pct">${o.toLocaleString()}</div></div>
  <div class="bar ${cls}"><i style="width:${Math.min(100,p*100)}%"></i></div>
  <div class="fac-meta num"><span>${Math.round(p*100)}% of ${c.toLocaleString()}</span><span>${ins} in · ${outs} out today</span></div></button>`;
}
function feedTable(rows){
  if(!rows.length)return '<div class="empty">No camera reads yet.</div>';
  return `<div class="tbl-wrap"><table><thead><tr><th>Time</th><th>Camera</th><th>Plate</th><th>Result</th></tr></thead><tbody>${rows.map(r=>{const f=facById(r.facilityId);const c=r.cameraId&&byId('cameras',r.cameraId);return `<tr><td class="num">${fmtTime(r.at,tzF(facById((byId('cameras',r.cameraId)||{}).facilityId||r.facilityId)))}</td><td>${esc(c?c.name:(f?f.name:'Unknown'))} <span class="sub">${esc(f?f.name+' · ':'')}${r.dir==='in'?'Entry':'Exit'}${r.confidence!=null?` · ${Math.round(r.confidence)}% confidence`:''}</span></td><td>${r.plate==='NOREAD'?'<span class="pill warn">No plate</span>':plateChip(r.plate)}${photoLink(r.photoId)}</td><td><span class="pill dot ${r.level==='info'?'info':r.level}">${esc(r.text)}</span></td></tr>`}).join('')}</tbody></table></div>`;
}

/* ============ occupancy & exits ============ */
const STATUS={review:['warn','Held for review'],vip:['','VIP'],paid:['ok','Paid'],autopay:['ok','Charged to card'],unpaid:['bad','Not charged'],validated:['info','Validated'],free:['','No charge (grace)'],permit:['','Monthly parker'],waived:['','Waived'],cited:['warn','Cited'],noentry:['warn','No entry read'],missed:['warn','Exit never read'],noplate:['warn','No plate read'],onsite:['info','On site']};
const AUDIT_GROUPS={all:()=>true,charged:s=>['paid','autopay'].includes(s),unpaid:s=>s==='unpaid',validated:s=>s==='validated',permit:s=>s==='permit',problems:s=>['noentry','missed','noplate','review'].includes(s)};
const reviewList=()=>S.sessions.filter(s=>s.endAt&&((s.missedExit&&!s.missedResolved)||R.needsReview(s))&&!s.waived);
function vActivity(){
  if(!S.facilities.length)return emptyFacilities();
  if(!facById(UI.actFac))UI.actFac=(S.facilities.find(x=>x.payMode!=='qr')||S.facilities[0]).id;
  const f=facById(UI.actFac),tz=tzF(f),ds=R.dayStart(now(),f),de=R.nextDayStart(ds,f);
  const on=R.onSiteSessions(f),occ=R.occupancy(f),cap=+f.capacity||0;
  const tracked=on.filter(s=>!s.noPlate).length,unknown=on.filter(s=>s.noPlate).length,adj=+f.baseline||0;
  const facS=S.sessions.filter(s=>s.facilityId===f.id);
  const conc=R.concurrency(facS.filter(s=>s.startAt&&!s.noEntry),ds,de);
  const ins=facS.filter(s=>s.startAt>=ds).length,outs=facS.filter(s=>s.endAt>=ds).length;
  const rangeStart={today:ds,yesterday:R.dayStart(ds-H,f),week:ds-6*D}[UI.auditRange]||ds;const rangeEnd=UI.auditRange==='yesterday'?ds:Infinity;
  const exits=facS.filter(s=>s.endAt&&s.endAt>=rangeStart&&s.endAt<rangeEnd).sort((a,b)=>b.endAt-a.endAt).map(s=>({s,st:R.exitStatus(s)}));
  const cnt=k=>exits.filter(e=>AUDIT_GROUPS[k](e.st)).length;
  const rows=exits.filter(e=>AUDIT_GROUPS[UI.auditFilter](e.st)||(UI.auditFilter==='problems'&&e.s.matchedBy));
  const stale=on.filter(s=>s.mode==='lpr'&&now()-s.startAt>24*H&&s.kind!=='permit');
  const notCharged=exits.filter(e=>e.st==='unpaid');
  const segBtn=(k,l)=>`<button data-act="auditFilter" data-v="${k}" aria-pressed="${UI.auditFilter===k}">${l} <span class="muted">${cnt(k)+(k==='problems'?exits.filter(e=>e.s.matchedBy&&!AUDIT_GROUPS.problems(e.st)).length:0)}</span></button>`;
  return `<div class="pagehead"><div><h1>Occupancy & exits</h1><p>Live count from lane cameras, and whether every car that left was charged. Parking day starts at ${esc(fmtReset(f))}.</p></div>
    <select id="actFac" data-fresh="1" style="width:auto">${S.facilities.map(x=>`<option value="${x.id}" ${x.id===f.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
  <div class="grid g2">
    <section class="panel"><div class="panel-h"><h2>In ${esc(f.name)} now</h2><button class="btn sm" data-act="recount" data-id="${f.id}">Enter a physical count</button></div><div class="panel-b" style="display:grid;gap:12px">
      <div class="big-count"><b>${occ.toLocaleString()}</b><span>of ${cap.toLocaleString()} spaces · ${cap?Math.round(occ/cap*100):0}% full · ${Math.max(0,cap-occ).toLocaleString()} open</span></div>
      <div class="bar ${occ/cap>=.9?'bad':occ/cap>=.75?'warn':''}"><i style="width:${cap?Math.min(100,occ/cap*100):0}%"></i></div>
      <div class="split"><span><b>${tracked}</b> plates read in</span><span><b>${unknown}</b> no-plate entries</span><span><b>${adj>=0?'+':''}${adj}</b> count adjustment</span><span><b>${ins}</b> entries today</span><span><b>${outs}</b> exits today</span><span><b>${conc.peak+adj}</b> peak today at ${fmtTime(conc.peakAt,tz)}</span></div>
    </div></section>
    <section class="panel"><div class="panel-h"><h2>Charge check</h2><span class="muted" style="font-size:.84rem">${UI.auditRange==='today'?'Today':UI.auditRange==='yesterday'?'Yesterday':'Last 7 days'}</span></div><div class="panel-b"><div class="summary-row">
      <div><small>Exits</small><b>${exits.length}</b></div><div><small>Charged</small><b>${cnt('charged')}</b></div><div class="${notCharged.length?'over':''}"><small>Not charged</small><b>${notCharged.length}</b></div><div class="${notCharged.length?'over':''}"><small>Owed</small><b>${money0(sum(notCharged,e=>R.balanceOf(e.s)))}</b></div>
    </div></div></section>
  </div>
  <section class="panel"><div class="panel-h"><h2>Vehicles on site today</h2><span class="muted" style="font-size:.84rem">${fmtDay(ds,tz)} · from ${esc(fmtReset(f))}</span></div><div class="panel-b chart">${stepChart({pts:conc.pts,from:ds,to:de,cap,capLabel:'Capacity',offset:adj,tz,label:'Vehicles on site today'})}</div></section>
  ${stale.length?`<section class="panel"><div class="panel-h"><h2>Possible missed exit reads</h2><span class="muted" style="font-size:.84rem">On site more than 24 hours</span></div><div class="tbl-wrap"><table><thead><tr><th>Plate</th><th>Entered</th><th class="r">Time on site</th><th class="r">Would owe</th><th></th></tr></thead><tbody>${stale.map(s=>`<tr><td>${plateChip(s.plate)}</td><td class="num">${fmtTime(s.startAt,tz)}</td><td class="r num">${dur(now()-s.startAt)}</td><td class="r num">${money(R.sessionFee(s))}</td><td><div class="acts"><button class="btn sm" data-act="closeMissed" data-id="${s.id}">Send to review</button><button class="btn sm" data-act="closeSession" data-id="${s.id}">Record exit now</button></div></td></tr>`).join('')}</tbody></table></div></section>`:''}
  <section class="panel"><div class="panel-h"><h2>Exit audit</h2><div class="filters"><select id="auditRange" data-fresh="1" style="flex:0 0 auto"><option value="today" ${UI.auditRange==='today'?'selected':''}>Today</option><option value="yesterday" ${UI.auditRange==='yesterday'?'selected':''}>Yesterday</option><option value="week" ${UI.auditRange==='week'?'selected':''}>Last 7 days</option></select>
    <div class="seg">${segBtn('all','All')}${segBtn('charged','Charged')}${segBtn('unpaid','Not charged')}${segBtn('validated','Validated')}${segBtn('permit','Monthly')}${segBtn('problems','Read issues')}</div></div>
    <button class="btn sm" data-act="exportAudit">Export CSV</button></div>
  ${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>Plate</th><th>Entered</th><th>Exited</th><th class="r">Stay</th><th class="r">Fee</th><th class="r">Paid</th><th>Validation</th><th>Result</th><th></th></tr></thead><tbody>${rows.map(({s,st})=>{const [cls,lab]=STATUS[st]||['',st];return `<tr${st==='review'||st==='missed'?' class="sel"':''}><td>${s.noPlate?'<span class="pill warn">No plate</span>':plateChip(s.plate)}${photoLink(s.entryPhotoId)}${photoLink(s.exitPhotoId)}${s.matchedBy?`<span class="sub">Exit read as ${esc(s.exitPlate)} (${esc(s.matchedBy)} match)</span>`:''}${s.reservationId?'<span class="sub">Reservation</span>':''}</td><td class="num">${s.startAt?fmtTime(s.startAt,tz):'—'}</td><td class="num">${fmtTime(s.endAt,tz)}</td><td class="r num">${s.startAt?dur(s.endAt-s.startAt):'—'}</td><td class="r num">${money(R.sessionFee(s))}</td><td class="r num">${money(R.paidOf(s))}</td><td>${s.validation?`<span class="tag">${esc(s.validation.code)}</span>${s.validation.tenantName?`<span class="sub">${esc(s.validation.tenantName)}</span>`:''}`:'—'}</td><td><span class="pill ${cls}">${lab}${st==='unpaid'?' · '+money(R.balanceOf(s)):''}</span></td><td><div class="acts">${st==='unpaid'?`<button class="btn sm ok" data-act="markSessionPaid" data-id="${s.id}">Mark paid</button><button class="btn sm danger" data-act="citeSession" data-id="${s.id}">Cite</button>`:''}${st==='review'?`<button class="btn sm ok" data-act="confirmMatch" data-id="${s.id}">Same car: bill ${money(R.sessionFee(s)-R.paidOf(s))}</button><button class="btn sm" data-act="rejectMatch" data-id="${s.id}">Different car</button>`:''}${st==='missed'?`<button class="btn sm" data-act="missedBill" data-id="${s.id}">Bill 1 day (${money((facById(s.facilityId).rates||{}).dailyMax||0)})</button><button class="btn sm" data-act="missedFree" data-id="${s.id}">No charge</button>`:''}</div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No exits in this view.</div>'}</section>`;
}
const fmtReset=f=>{const r=(f.rates&&f.rates.resetTime)||'00:00';const [h,m]=r.split(':').map(Number);const d=new Date(2000,0,1,h,m);return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})};

/* ============ tenants & valet ============ */
function vTenants(){
  const ts=[...S.tenants].sort((a,b)=>a.name.localeCompare(b.name));
  const t=byId('tenants',UI.tenant)||ts.find(x=>+x.allotment>0)||ts[0];
  const vals=[...S.validations].sort((a,b)=>(b.active?1:0)-(a.active?1:0)||a.code.localeCompare(b.code));
  const benefit=v=>R.validationText(v);const vfacs=v=>{const ids=(v.facilityIds&&v.facilityIds.length)?v.facilityIds:(v.tenantId&&(byId('tenants',v.tenantId)||{}).facilityId?[(byId('tenants',v.tenantId)||{}).facilityId]:[]);return ids.length?ids.map(id=>(facById(id)||{}).name||'').filter(Boolean).join(', '):'All locations'};
  const tRow=x=>{const d=R.tenantDays(x,30);const today=d[d.length-1]||{peak:0,over:0};const onNow=R.sessionsForTenant(x).filter(s=>!s.endAt).length;const codes=S.validations.filter(v=>v.tenantId===x.id);
    return `<tr class="click ${t&&x.id===t.id?'sel':''}" data-act="pickTenant" data-id="${x.id}"><td><b>${esc(x.name)}</b><span class="sub">${esc((facById(x.facilityId)||{}).name||'Any facility')}</span></td><td><div class="plates">${codes.map(v=>`<span class="tag mono">${esc(v.code)}</span>`).join('')||'<span class="muted">None</span>'}</div></td><td class="r num">${+x.allotment?x.allotment:'—'}</td><td class="r num">${onNow}</td><td class="r num">${today.peak}${today.over?` <span class="pill bad">+${today.over}</span>`:''}</td><td class="r num">${sum(d,z=>z.over)}</td><td class="r num">${money(sum(d,z=>z.charge))}</td><td><div class="acts"><button class="btn sm" data-act="editTenant" data-id="${x.id}">Edit</button></div></td></tr>`};
  let report='';
  if(t){
    const f=facById(t.facilityId)||S.facilities[0];const tz=tzF(f);const allot=+t.allotment||0;
    const days=R.tenantDays(t,30);const idx=Math.max(0,Math.min(days.length-1,days.length-1-UI.tenantDay));const day=days[idx];
    const list=R.sessionsForTenant(t);const conc=R.concurrency(list,day.start,day.end);
    const overDays=days.filter(d=>d.over>0);const mStart=new Date();mStart.setDate(1);mStart.setHours(0,0,0,0);const mtd=days.filter(d=>d.start>=mStart.getTime()-3*H);
    report=`<section class="panel"><div class="panel-h"><h2>${esc(t.name)}: cars on site at once</h2>
      <div class="daynav"><button class="btn sm" data-act="tenantDay" data-v="1" ${idx===0?'disabled':''} aria-label="Previous day">‹</button><b>${UI.tenantDay===0?'Today':fmtDay(day.start+12*H,tz)}</b><button class="btn sm" data-act="tenantDay" data-v="-1" ${UI.tenantDay===0?'disabled':''} aria-label="Next day">›</button></div></div>
      <div class="panel-b" style="display:grid;gap:14px">
        <div class="summary-row"><div><small>Validated cars</small><b>${day.cars}</b></div><div><small>Peak at once</small><b>${day.peak}</b></div><div><small>Peak time</small><b style="font-size:1.1rem">${day.peak?fmtTime(day.peakAt,tz):'—'}</b></div><div class="${day.over?'over':''}"><small>Over allotment</small><b>${day.over}</b></div><div class="${day.over?'over':''}"><small>Overage charge</small><b>${money(day.charge)}</b></div></div>
        <div class="chart">${stepChart({pts:conc.pts,from:day.start,to:day.end,cap:allot,capLabel:'Allotment',tz,label:'Valet cars on site'})}</div>
        <p class="note" style="margin:0">A car counts from its entry read to its exit read once a ${esc(t.name)} code is applied to its stay. Parking day runs from ${esc(fmtReset(f))} to ${esc(fmtReset(f))}. Red shading is time above the allotment.</p>
      </div></section>
    <section class="panel"><div class="panel-h"><h2>Daily peak, last 30 days</h2><button class="btn sm" data-act="exportTenant" data-id="${t.id}">Export overage report</button></div>
      <div class="panel-b" style="display:grid;gap:14px">
        <div class="summary-row"><div><small>Days over</small><b>${overDays.length}</b></div><div><small>Highest peak</small><b>${Math.max(0,...days.map(d=>d.peak))}</b></div><div class="${overDays.length?'over':''}"><small>30-day overage</small><b>${money0(sum(days,d=>d.charge))}</b></div><div><small>Month to date</small><b>${money0(sum(mtd,d=>d.charge))}</b></div><div><small>Rate</small><b style="font-size:1.1rem">${money(t.overageRate)} / space / day</b></div></div>
        <div class="chart">${peakBars(days,allot,tz)}</div></div>
      <div class="tbl-wrap"><table><thead><tr><th>Parking day</th><th class="r">Validated cars</th><th class="r">Peak</th><th>Peak time</th><th class="r">Over</th><th class="r">Charge</th></tr></thead><tbody>${[...days].reverse().filter(d=>d.cars||d.peak).map(d=>`<tr><td>${fmtDay(d.start+12*H,tz)}</td><td class="r num">${d.cars}</td><td class="r num">${d.peak}</td><td class="num">${d.peak?fmtTime(d.peakAt,tz):'—'}</td><td class="r num">${d.over?`<span class="pill bad">${d.over}</span>`:'0'}</td><td class="r num">${money(d.charge)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No validated stays in the last 30 days.</td></tr>'}</tbody></table></div></section>`;
  }
  return `<div class="pagehead"><div><h1>Validations & tenants</h1><p>Validation codes, tenant allotments and how many validated cars were parked at once. Overage = cars over the allotment at the daily peak.</p></div><button class="btn" data-act="editValidation">New code</button><button class="btn pri" data-act="editTenant">Add tenant</button></div>
  <section class="panel"><div class="panel-h"><h2>Tenants</h2><span class="muted" style="font-size:.84rem">Select a tenant to see its valet report</span></div>
  ${ts.length?`<div class="tbl-wrap"><table><thead><tr><th>Tenant</th><th>Codes</th><th class="r">Allotment</th><th class="r">On site now</th><th class="r">Peak today</th><th class="r">Overage spaces, 30d</th><th class="r">Overage, 30d</th><th></th></tr></thead><tbody>${ts.map(tRow).join('')}</tbody></table></div>`:'<div class="empty">No tenants yet. Add one to issue its validation code and track its space allotment.</div>'}</section>
  ${report}
  <section class="panel"><div class="panel-h"><h2>All validation codes</h2></div>
  ${vals.length?`<div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Tenant or department</th><th>Covers</th><th>Valid at</th><th class="r">Used</th><th>Can be used</th><th></th></tr></thead><tbody>${vals.map(v=>{const off=!v.active||(v.expiresAt&&v.expiresAt<now())||(v.validFrom&&v.validFrom>now())||(+v.maxUses&&v.uses>=v.maxUses);const tn=v.tenantId&&byId('tenants',v.tenantId);
    return `<tr><td class="mono"><b>${esc(v.code)}</b>${v.name?`<span class="sub">${esc(v.name)}</span>`:''}</td><td>${esc(tn?tn.name:v.department)}</td><td>${esc(benefit(v))}</td><td>${esc(vfacs(v))}</td><td class="r num">${v.uses||0}${+v.maxUses?' / '+v.maxUses:''}</td><td class="num">${v.validFrom?fmtDate(v.validFrom)+' – ':''}${v.expiresAt?fmtDate(v.expiresAt):'no end date'} ${off?'<span class="pill">Inactive</span>':'<span class="pill ok">Active</span>'}</td><td><div class="acts"><button class="btn sm" data-act="editValidation" data-id="${v.id}">Edit</button><button class="btn sm" data-act="toggleValidation" data-id="${v.id}">${v.active?'Turn off':'Turn on'}</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No validation codes yet.</div>'}</section>
  ${window.vCodeOccupancy?window.vCodeOccupancy():''}`;
}
function tenantForm(t){
  t=t||{};const isNew=!t.id;
  openForm({title:isNew?'Add tenant':'Edit '+t.name,submit:isNew?'Add tenant':'Save changes',fields:[
    {id:'name',label:'Tenant name',value:t.name,required:true},
    {id:'facilityId',label:'Garage',type:'select',options:S.facilities.map(f=>[f.id,f.name]),value:t.facilityId},
    {id:'allotment',label:'Space allotment',type:'number',value:t.allotment??'',help:'Cars allowed at once. Leave blank if not limited.'},
    {id:'overageRate',label:'Overage charge ($ per space per day)',type:'number',step:'0.01',value:t.overageRate??''},
    {id:'contact',label:'Billing contact email',type:'email',value:t.contact},
    ...(isNew?[{id:'code',label:'Validation code',value:uid('').slice(0,6),help:'Staff or valet enter this to validate a stay.'},{id:'hours',label:'Free hours per validation',type:'number',step:'0.25',value:2.5}]:[]),
  ],extra:isNew?'':`<button type="button" class="btn danger" data-dlg="delete">Delete tenant</button>`,
  onExtra:()=>write(db=>col(db,'tenants').doc(t.id).delete(),'Tenant deleted'),
  onSubmit:async v=>{const data={name:v.name.trim(),facilityId:v.facilityId,allotment:v.allotment===''?0:+v.allotment,overageRate:+v.overageRate||0,contact:v.contact.trim()};
    if(!isNew)return write(db=>col(db,'tenants').doc(t.id).update(data),'Tenant saved');
    const code=normPlate(v.code);if(code&&S.validations.some(x=>x.code===code))return 'That validation code is already in use.';
    const id=R.uid('t');const ok=await addDoc('tenants',Object.assign(data,{createdAt:now()}),id);
    if(ok&&code)await addDoc('validations',{code,name:data.name+' validation',tenantId:id,department:data.name,type:'hours',value:+v.hours||2.5,maxUses:0,uses:0,active:true,validFrom:null,expiresAt:null,facilityIds:[],createdAt:now()});
    if(ok){UI.tenant=id;toast(`${data.name} added${code?' with code '+code:''}`)}return ok}});
}
const VAL_TYPES=[['hours','Free time (hours from arrival)'],['percent','Percent off'],['dollar','Dollars off'],['fixed','Fixed final price'],['full','Covers the full stay']];
function validationForm(v){
  v=v||{};const isNew=!v.id;const dIso=t=>t?new Date(t).toLocaleDateString('en-CA'):'';
  openForm({title:isNew?'New validation code':'Edit code '+v.code,submit:isNew?'Create code':'Save changes',fields:[
    {id:'code',label:'Code',value:v.code||uid('V').slice(0,7),required:true,help:isNew?'What staff, tenants or drivers type. Letters and numbers.':'Changing the code doesn’t change past visits; they keep the code they were validated with.'},
    {id:'name',label:'Display name',value:v.name||'',help:'Shown on tickets and reports, e.g. “Merchant 2.5 hours”.'},
    {id:'tenantId',label:'Tenant',type:'select',options:[['','None (department or event)'],...S.tenants.map(t=>[t.id,t.name])],value:v.tenantId||(UI.tab==='tenants'?UI.tenant:'')||''},
    {id:'department',label:'Department or event',value:v.department||'',help:'Used when no tenant is selected'},
    {id:'type',label:'What it covers',type:'select',options:VAL_TYPES,value:v.type||'hours'},
    {id:'value',label:'Hours, percent or dollars',type:'number',step:'0.25',value:v.value??2.5,help:'Free time starts at the car’s arrival, not when the code is entered.'},
    {id:'maxUses',label:'Maximum uses',type:'number',value:v.maxUses||0,help:'0 for unlimited'},
    {id:'validFrom',label:'Can be used from',type:'date',value:dIso(v.validFrom)},
    {id:'expiresAt',label:'Can be used until',type:'date',value:dIso(v.expiresAt),help:'When the code stops working. Separate from how much parking it covers.'},
    {id:'facilityIds',label:'Valid at',type:'checks',options:S.facilities.map(f=>[f.id,f.name]),value:v.facilityIds||[],help:'Select none for the tenant’s garage (or everywhere).'},
    ...(isNew?[]:[{id:'active',label:'Status',type:'select',options:[['1','On'],['0','Off']],value:v.active===false?'0':'1'}]),
  ],extra:isNew?'':`<button type="button" class="btn danger" data-dlg="delete">Delete code</button>`,
  onExtra:()=>write(db=>col(db,'validations').doc(v.id).delete(),'Code deleted'),
  onSubmit:x=>{const code=normPlate(x.code);if(!code)return 'Enter a code.';if(S.validations.some(y=>y.code===code&&y.id!==v.id))return 'That code already exists.';
    const t=x.tenantId&&byId('tenants',x.tenantId);if(!t&&!x.department.trim())return 'Pick a tenant or name the department.';
    const val=+x.value||0;if(x.type!=='full'&&!(val>0))return 'Enter how much the code covers.';if(x.type==='percent'&&val>100)return 'Percent can’t be over 100.';
    const validFrom=x.validFrom?new Date(x.validFrom+'T00:00:00').getTime():null,expiresAt=x.expiresAt?new Date(x.expiresAt+'T23:59:00').getTime():null;
    if(validFrom&&expiresAt&&validFrom>expiresAt)return 'The end date is before the start date.';
    const data={code,name:x.name.trim(),tenantId:t?t.id:null,department:t?t.name:x.department.trim(),type:x.type,value:x.type==='full'?0:val,maxUses:+x.maxUses||0,validFrom,expiresAt,facilityIds:x.facilityIds};
    if(!isNew){data.active=x.active==='1';return write(db=>col(db,'validations').doc(v.id).update(data),'Code saved')}
    return addDoc('validations',Object.assign(data,{uses:0,active:true,createdAt:now()})).then(ok=>{if(ok)toast('Validation code '+code+' created');return ok})}});
}

/* ============ facilities ============ */
const payModeLabel=f=>f.payMode==='qr'?'QR pay-by-plate':'Plate cameras';
function vFacilities(){
  return `<div class="pagehead"><div><h1>Locations & rates</h1><p>Capacity, how drivers pay, pricing, specials and the time each parking day resets.</p></div><button class="btn pri" data-act="editFacility">Add location</button></div>
  ${S.facilities.length?`<section class="panel"><div class="tbl-wrap"><table><thead><tr><th>Facility</th><th>How drivers pay</th><th class="r">Spaces</th><th class="r">On site</th><th>Rates</th><th>Day resets</th><th></th></tr></thead><tbody>
  ${S.facilities.map(f=>{const o=R.occupancy(f);const lines=R.rateSummary(f);return `<tr><td><b>${esc(f.name)}</b>${f.active===false?' <span class="pill">Closed</span>':''}<span class="sub">${f.type==='lot'?'Surface lot':'Garage'}${f.address?' · '+esc(f.address):''}</span></td>
    <td>${esc(payModeLabel(f))}${f.payMode==='qr'?`<span class="sub">Lot # ${esc(f.lotCode||'not set')}</span>`:`<span class="sub">${S.cameras.filter(c=>c.facilityId===f.id).length} lane cameras</span>`}${+f.reservedSpaces>0?`<span class="sub">${f.reservedSpaces} reservable</span>`:''}</td>
    <td class="r num">${(+f.capacity||0).toLocaleString()}</td><td class="r num">${o.toLocaleString()}</td>
    <td style="min-width:220px">${lines.map((l,i)=>i?`<span class="sub">${esc(l)}</span>`:`<b>${esc(l)}</b>`).join('')}</td>
    <td class="num">${esc(fmtReset(f))} <span class="sub">${esc((TIMEZONES.find(z=>z[0]===tzF(f))||[0,tzF(f)])[1])} time</span></td>
    <td><div class="acts"><button class="btn sm" data-act="editFacility" data-id="${f.id}">Edit</button><button class="btn sm" data-act="editRates" data-id="${f.id}">Rates & specials</button>${f.payMode==='qr'?`<button class="btn sm" data-act="makeSign" data-id="${f.id}">Pay sign</button>`:''}</div></td></tr>`}).join('')}
  </tbody></table></div></section>`:emptyFacilities()}
  <section class="panel"><div class="panel-h"><h3>How visitor fees are calculated</h3></div><div class="panel-b muted" style="font-size:.9rem;max-width:84ch;display:grid;gap:8px">
    <p style="margin:0">Each facility has a daily reset time. A parking day runs from that time until the same time the next day, and each parking day is capped at the daily maximum. A location can instead use a rolling 24-hour day from arrival. Every ticket keeps a copy of the rates it started under, so a rate change only affects new arrivals.</p>
    <p style="margin:0">Rates are either a price per increment (for example $3 per 30 minutes) or a rate table (up to 1 hour $5, up to 2 hours $9, and so on). Specials like early bird and evening are flat prices for stays that qualify; drivers always pay the lower of the special and the regular rate.</p>
    <p style="margin:0">Stays within the grace period are free. Hour validations, such as a tenant’s 2.5 hours, come off the start of the stay. ${+(S.config&&S.config.taxRate)?`Prices ${S.config.taxIncluded===false?'have':'include'} ${S.config.taxRate}% sales tax${S.config.taxIncluded===false?' added at checkout':''}.`:''}</p></div></section>`;
}
function facilityForm(f){
  f=f||{rates:{mode:'increment',incrementMin:60,incrementPrice:3,dailyMax:20,graceMin:10,resetTime:'03:00',specials:[]}};const r=f.rates||{};
  openForm({title:f.id?'Edit '+f.name:'Add facility',submit:f.id?'Save changes':'Add facility',
    fields:[
      {id:'name',label:'Name',value:f.name,required:true},
      {id:'type',label:'Type',type:'select',options:[['garage','Garage'],['lot','Surface lot']],value:f.type||'garage'},
      {id:'payMode',label:'How drivers pay',type:'select',options:[['lpr','LPR cameras at entry and exit (pay on exit, autopay)'],['qr','QR code / text-to-pay signs (pay by plate, no cameras)']],value:f.payMode||(f.type==='lot'?'qr':'lpr')},
      {id:'lotCode',label:'Lot number on signs',value:f.lotCode||'',help:'Short number drivers scan or text, like 4201. Used by QR lots.'},
      {id:'address',label:'Location note',value:f.address},
      {id:'capacity',label:'Total spaces',type:'number',value:f.capacity,required:true},
      {id:'mode',label:'Rate type',type:'select',options:[['increment','Price per time increment'],['table','Rate table (up to X minutes = $Y)']],value:r.mode==='table'?'table':'increment'},
      {id:'incrementMin',label:'Increment',type:'select',options:[[15,'Every 15 minutes'],[20,'Every 20 minutes'],[30,'Every 30 minutes'],[60,'Every hour']],value:+r.incrementMin||60},
      {id:'incrementPrice',label:'Price per increment ($)',type:'number',step:'0.25',value:r.incrementPrice??r.hourly??''},
      {id:'table',label:'Rate table (minutes=price, comma separated)',value:(r.table||[]).map(x=>x.upTo+'='+x.price).join(', '),help:'Example: 30=3, 60=5, 120=9, 180=12. Stays past the last step pay the daily max.',span:true},
      {id:'dailyMax',label:'Daily maximum ($)',type:'number',step:'0.25',value:r.dailyMax,required:true},
      {id:'dayMode',label:'Parking day',type:'select',options:[['reset','Resets at a set time each day'],['rolling','Rolling 24 hours from arrival']],value:r.rolling?'rolling':'reset'},
      {id:'resetTime',label:'Parking day resets at',type:'time',value:r.resetTime||'03:00',help:'Daily maximum starts over at this time each day (ignored when rolling).'},
      {id:'timeZone',label:'Time zone',type:'select',options:TIMEZONES.map(([k,l])=>[k,l+' time']),value:f.timeZone||(S.config&&S.config.timeZone)||'America/Chicago'},
      {id:'graceMin',label:'Grace period (minutes)',type:'number',value:r.graceMin??10},
      {id:'reservedSpaces',label:'Reservations-only spaces',type:'number',value:f.reservedSpaces||0,help:'Size of the signed reserved section. 0 turns reservations off.'},
      {id:'reservationPremium',label:'Reservation fee ($)',type:'number',step:'0.25',value:f.reservationPremium??5,help:'Paid when booking. Parking is billed at normal rates on exit.'},
      {id:'reservationGraceMin',label:'Hold a reserved spot for (minutes after arrival time)',type:'number',value:f.reservationGraceMin??60},
      {id:'cancelHours',label:'Free cancellation until (hours before)',type:'number',value:f.cancelHours??2},
      {id:'baseline',label:'Count adjustment',type:'number',value:f.baseline||0,help:'Vehicles the system can’t see. “Enter a physical count” sets this for you.'},
      {id:'valetRate',label:'Valet fee ($, optional)',type:'number',step:'0.25',value:f.valetRate??'',help:'Added to valet tickets on top of parking. Leave blank if valet is run by a tenant.'},
      ...(HOSTED?[{id:'terminalDeviceId',label:'Square Terminal device ID (exit booth)',value:f.terminalDeviceId||'',help:'From Devices in the Square Developer Dashboard, or the test IDs in the README. Lets attendants charge cards on the Terminal.'}]:[]),
      {id:'active',label:'Status',type:'select',options:[['1','Open'],['0','Closed (hidden from drivers)']],value:f.active===false?'0':'1'},
    ],
    extra:f.id?`<button type="button" class="btn danger" data-dlg="delete">Delete facility</button>`:'',
    onExtra:async()=>{const n=S.sessions.filter(s=>s.facilityId===f.id&&!s.endAt).length;if(n){toast(`${n} vehicles are on site. Close their sessions first.`,true);return false}return write(db=>col(db,'facilities').doc(f.id).delete(),'Facility deleted')},
    onSubmit:v=>{if(!/^\d{2}:\d{2}$/.test(v.resetTime))return 'Enter the reset time, like 03:00.';
      let table=[];if(v.mode==='table'){for(const part of v.table.split(',').map(x=>x.trim()).filter(Boolean)){const m=/^(\d+)\s*=\s*\$?(\d+(?:\.\d+)?)$/.exec(part);if(!m)return `“${part}” isn’t in the form minutes=price.`;table.push({upTo:+m[1],price:+m[2]})}
        table.sort((a,b)=>a.upTo-b.upTo);if(!table.length)return 'Add at least one rate table step, like 60=5.';if(table.some((x,i)=>i&&x.price<table[i-1].price))return 'Rate table prices should go up with time.'}
      else if(!(+v.incrementPrice>0))return 'Enter the price per increment.';
      const lotCode=String(v.lotCode||'').toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,12);
      if(v.payMode==='qr'&&!lotCode)return 'Give the lot a number for its signs.';
      if(lotCode&&S.facilities.some(x=>x.id!==f.id&&String(x.lotCode||'').toUpperCase()===lotCode))return 'Another facility already uses that lot number.';
      const rates=Object.assign({},r,{mode:v.mode,incrementMin:+v.incrementMin||60,incrementPrice:+v.incrementPrice||0,table,dailyMax:+v.dailyMax||0,graceMin:+v.graceMin||0,resetTime:v.resetTime,rolling:v.dayMode==='rolling',specials:r.specials||[]});delete rates.hourly;
      const data={name:v.name.trim(),type:v.type,payMode:v.payMode,lotCode,address:v.address.trim(),capacity:+v.capacity||0,baseline:+v.baseline||0,timeZone:v.timeZone,reservedSpaces:Math.max(0,Math.round(+v.reservedSpaces||0)),reservationPremium:Math.max(0,+v.reservationPremium||0),reservationGraceMin:Math.max(0,+v.reservationGraceMin||60),cancelHours:Math.max(0,+v.cancelHours||0),valetRate:v.valetRate===''?0:Math.max(0,+v.valetRate||0),active:v.active!=='0',rates};
      if(HOSTED)data.terminalDeviceId=String(v.terminalDeviceId||'').trim();
      return f.id?write(db=>col(db,'facilities').doc(f.id).update(data),'Facility saved'):addDoc('facilities',Object.assign(data,{createdAt:now()}),R.uid('f'))}
  });
}
/* Specials: early bird, evening, weekend and event flat rates. */
function ratesForm(f){
  const r=f.rates||{};let rows=(r.specials||[]).map(x=>Object.assign({},x));const hol=(S.config&&S.config.holidays)||[];
  const row=(x,i)=>`<div class="spec" data-i="${i}" style="border:1px solid var(--line);border-radius:8px;padding:10px;display:grid;gap:8px">
    <div class="form-grid"><div class="field"><label for="spn${i}">Name</label><input id="spn${i}" value="${esc(x.name||'')}" placeholder="Early bird"></div><div class="field"><label for="spp${i}">Flat price ($)</label><input id="spp${i}" type="number" step="0.25" value="${esc(x.price??'')}"></div>
    <div class="field"><label for="spf${i}">Enter from</label><input id="spf${i}" type="time" value="${esc(x.enterFrom||'05:00')}"></div><div class="field"><label for="spu${i}">Enter by</label><input id="spu${i}" type="time" value="${esc(x.enterUntil||'09:00')}"></div>
    <div class="field"><label for="spx${i}">Leave by (optional)</label><input id="spx${i}" type="time" value="${esc(x.exitBy||'')}"></div><div class="field"><label for="spa${i}">Leave after (optional)</label><input id="spa${i}" type="time" value="${esc(x.exitAfter||'')}"></div>
    <div class="field"><label for="spd${i}">Only on dates (optional)</label><input id="spd${i}" value="${esc((x.dates||[]).join(', '))}" placeholder="2026-12-31, 2027-01-01"><div class="help">For events. Leave blank to use the days below.</div></div>
    <div class="field"><label for="spm${i}">Minimum stay (minutes)</label><input id="spm${i}" type="number" value="${esc(x.minStayMin||'')}"></div></div>
    <div class="checks" id="spw${i}">${DAYS.map((d,k)=>`<label><input type="checkbox" value="${k}" ${(x.days||[1,2,3,4,5]).map(Number).includes(k)?'checked':''}>${d}</label>`).join('')}</div>
    <div class="checks"><label><input type="checkbox" id="spn2${i}" ${x.exitNextDay?'checked':''}>Leave-by time is the next day (overnight)</label><label><input type="checkbox" id="sph${i}" ${x.noHolidays===false?'':'checked'}>Not on holidays</label><label><input type="checkbox" id="spo${i}" ${x.active===false?'':'checked'}>Active</label><button type="button" class="btn sm danger" data-sp-rm="${i}">Remove</button></div></div>`;
  const body=()=>`<p class="muted" style="margin:0 0 10px;font-size:.9rem">Current rates: ${esc(R.rateSummary(Object.assign({},f,{rates:Object.assign({},r,{specials:[]})})).join(' · '))}. A special applies when the whole stay fits its rules; the driver pays whichever is lower.</p>
    <div id="specRows" style="display:grid;gap:10px">${rows.map(row).join('')||'<p class="note">No specials yet.</p>'}</div>
    <div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-sp-add="eb">+ Early bird</button><button type="button" class="btn sm" data-sp-add="ev">+ Evening</button><button type="button" class="btn sm" data-sp-add="wk">+ Weekend</button><button type="button" class="btn sm" data-sp-add="event">+ Event</button></div>
    <div class="field" style="margin-top:12px"><label for="spHol">Holidays (no specials unless an event date), all facilities</label><input id="spHol" value="${esc(hol.join(', '))}" placeholder="2026-11-26, 2026-12-25"></div>`;
  const read=()=>[...dlgForm.querySelectorAll('.spec')].map(el=>{const i=el.dataset.i,g=k=>$('#'+k+i,dlgForm);const dates=g('spd').value.split(',').map(x=>x.trim()).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x));
    return {id:rows[i]&&rows[i].id||R.uid('sp'),name:g('spn').value.trim()||'Special',price:+g('spp').value,enterFrom:g('spf').value||'00:00',enterUntil:g('spu').value||'23:59',exitBy:g('spx').value||'',exitAfter:g('spa').value||'',exitNextDay:g('spn2').checked,dates,minStayMin:+g('spm').value||0,
      days:[...g('spw').querySelectorAll('input:checked')].map(c=>+c.value),noHolidays:g('sph').checked,active:g('spo').checked}});
  const PRESET={eb:{name:'Early bird',price:12,enterFrom:'05:00',enterUntil:'09:00',exitBy:'19:00',days:[1,2,3,4,5]},ev:{name:'Evening',price:8,enterFrom:'16:00',enterUntil:'02:00',exitBy:'06:00',exitNextDay:true,days:[0,1,2,3,4,5,6]},wk:{name:'Weekend day',price:10,enterFrom:'00:00',enterUntil:'23:59',days:[0,6]},event:{name:'Event',price:20,enterFrom:'15:00',enterUntil:'22:00',dates:[],days:[]}};
  const redraw=()=>{rows=read();$('#specRows',dlgForm).innerHTML=rows.map(row).join('')||'<p class="note">No specials yet.</p>'};
  openForm({title:'Rates & specials: '+f.name,submit:'Save specials',body:body(),onSubmit:async()=>{
    const sp=read();const bad=sp.find(x=>!(x.price>=0)||isNaN(x.price));if(bad)return `Give “${bad.name}” a price.`;
    const bad2=sp.find(x=>!x.dates.length&&!x.days.length);if(bad2)return `Pick at least one day for “${bad2.name}”, or add event dates.`;
    const holidays=$('#spHol',dlgForm).value.split(',').map(x=>x.trim()).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x));
    const ok=await write(db=>col(db,'facilities').doc(f.id).update({rates:Object.assign({},r,{specials:sp})}),'Specials saved');
    if(ok&&holidays.join()!==hol.join())await write(db=>db.doc('settings/config').set(Object.assign({},S.config||{},{holidays})));return ok}});
  dlgForm.onclick=e=>{const a=e.target.closest('[data-sp-add]');const rm=e.target.closest('[data-sp-rm]');
    if(a){rows=read();rows.push(Object.assign({id:R.uid('sp')},PRESET[a.dataset.spAdd]));$('#specRows',dlgForm).innerHTML=rows.map(row).join('')}
    if(rm){rows=read();rows.splice(+rm.dataset.spRm,1);$('#specRows',dlgForm).innerHTML=rows.map(row).join('')||'<p class="note">No specials yet.</p>'}};
  dlg.addEventListener('close',()=>{dlgForm.onclick=null},{once:true});
  void redraw;
}
function recountForm(f){
  const tracked=R.onSiteSessions(f).length;
  openForm({title:'Physical count: '+f.name,submit:'Set count',fields:[{id:'count',label:'Vehicles counted in the facility right now',type:'number',value:R.occupancy(f),required:true,help:`Cameras show ${tracked} vehicles. The difference is saved as a count adjustment until the next recount.`}],
    onSubmit:v=>{const n=Math.max(0,Math.round(+v.count));return write(db=>col(db,'facilities').doc(f.id).update({baseline:n-tracked,lastRecountAt:now(),lastRecount:n}),`${f.name} count set to ${n}`)}});
}

/* ============ monthly parking ============ */
const MSTATUS={active:['ok','Active'],pending:['info','Pending'],waitlist:['warn','Waitlist'],approved:['info','Awaiting payment'],suspended:['bad','Suspended'],cancelled:['','Cancelled'],revoked:['bad','Revoked'],ended:['','Ended'],expired:['','Ended']};
const mStatus=p=>p.status==='active'&&p.endAt&&p.endAt<now()?'ended':p.status;
const permitPill=p=>{const st=mStatus(p);const [c,l]=MSTATUS[st]||['',st];return `<span class="pill ${c}">${l}${st==='active'&&p.endAt?' · ends '+fmtDate(p.endAt-1):''}</span>`};
const billingLabel=p=>p.companyId?'Company: '+((byId('companies',p.companyId)||{}).name||p.companyName||''):p.billing==='office'?'Billed by the office':p.accountId?'Card on file (driver account)':'Not linked to billing';
function vPermits(){
  const q=UI.permitQ.trim().toLowerCase();const qp=normPlate(q);
  let rows=S.permits.filter(p=>{const st=mStatus(p);if(UI.permitStatus==='pastdue'){if(!(p.pastDueSince||st==='suspended'))return false}else if(UI.permitStatus!=='all'&&st!==UI.permitStatus)return false;
    if(!q)return true;return (p.holder||'').toLowerCase().includes(q)||(p.email||'').toLowerCase().includes(q)||(p.companyName||'').toLowerCase().includes(q)||String(p.number).toLowerCase().includes(q)||(qp&&(p.plates||[]).some(x=>normPlate(x).includes(qp)))});
  const ord={suspended:0,pending:1,approved:2,waitlist:3,active:4,ended:5,cancelled:6,revoked:7};rows.sort((a,b)=>(ord[mStatus(a)]??8)-(ord[mStatus(b)]??8)||(a.createdAt||0)-(b.createdAt||0));
  const cnt=k=>S.permits.filter(p=>k==='pastdue'?(p.pastDueSince||p.status==='suspended'):mStatus(p)===k).length;
  const stBtn=(k,l)=>`<button data-act="permitStatus" data-v="${k}" aria-pressed="${UI.permitStatus===k}">${l}${k!=='all'&&cnt(k)?` <span class="muted">${cnt(k)}</span>`:''}</button>`;
  const active=S.permits.filter(p=>p.status==='active'&&(!p.endAt||p.endAt>now()));
  const mrr=sum(active,p=>{const t=typeById(p.permitTypeId);return t?+t.price:0});
  const tz=(S.config&&S.config.timeZone)||'America/Chicago';
  return `<div class="pagehead"><div><h1>Monthly parking</h1><p>Plans, monthly parkers and company accounts. Cards are billed on the 1st; companies can pay by card or Square invoice.</p></div><button class="btn" data-act="importMonthly">Import CSV</button><button class="btn" data-act="editType">New plan</button><button class="btn pri" data-act="issuePermit">Add monthly parker</button></div>
  <div class="kpis"><div class="kpi"><small>Active monthly parkers</small><b>${active.length}</b><span>${S.companies.length} compan${S.companies.length===1?'y':'ies'}</span></div><div class="kpi"><small>Monthly recurring</small><b>${money0(mrr)}</b><span>Before tax</span></div>
    <div class="kpi ${cnt('pastdue')?'alert':''}"><small>Past due or suspended</small><b>${cnt('pastdue')}</b><span>${S.permits.filter(p=>p.status==='suspended').length} suspended</span></div><div class="kpi"><small>Waitlist</small><b>${cnt('waitlist')}</b><span>Approve when a spot opens</span></div></div>
  <section class="panel"><div class="panel-h"><h2>Plans</h2><span class="muted" style="font-size:.84rem">Sold includes waitlisted-then-approved and suspended parkers</span></div>
  <div class="panel-b"><div class="facs">${S.permitTypes.length?[...S.permitTypes].sort((a,b)=>a.name.localeCompare(b.name)).map(t=>{const sold=R.soldOf(t),q=+t.quota||0,p=q?sold/q:0;const fs=(t.facilities||[]).map(facById).filter(Boolean);
    return `<button class="fac" data-act="editType" data-id="${t.id}"><div class="fac-top"><div><h3>${esc(t.name)}</h3><span class="tag">${t.kind==='reserved'?'Reserved space':'Unreserved'}</span> ${t.active===false?'<span class="tag">Not for sale</span>':''}</div><div class="pct" style="font-size:1.2rem">${money0(t.price)}<span class="muted" style="font-size:.8rem">/mo</span></div></div>
    <div class="bar ${p>=1?'bad':p>=.85?'warn':''}"><i style="width:${Math.min(100,p*100)}%"></i></div>
    <div class="fac-meta num"><span>${sold} / ${q||'∞'} sold</span><span>Up to ${t.maxVehicles||3} vehicles</span></div>
    <div class="muted" style="font-size:.8rem">${fs.length?fs.map(f=>esc(f.name)).join(', '):'All facilities'}</div></button>`}).join(''):'<div class="muted">No monthly plans yet.</div>'}</div></div></section>
  <section class="panel"><div class="panel-h"><h2>Monthly parkers</h2>
    <div class="filters"><input id="permitQ" type="search" placeholder="Search name, company, #, plate" value="${esc(UI.permitQ)}" data-fresh="1"><div class="seg">${stBtn('all','All')}${stBtn('active','Active')}${stBtn('pastdue','Past due')}${stBtn('waitlist','Waitlist')}${stBtn('approved','Awaiting payment')}${stBtn('suspended','Suspended')}${stBtn('ended','Ended')}</div></div></div>
  ${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Parker</th><th>Plan</th><th>Plates</th><th>Billing</th><th>Paid through</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(p=>{const t=typeById(p.permitTypeId);const st=mStatus(p);const late=p.paidThrough&&p.paidThrough<now()&&st==='active';
    return `<tr><td class="mono">#${esc(p.number)}</td><td><b>${esc(p.holder)}</b><span class="sub">${esc(p.email||'')}${p.phone?' · '+esc(p.phone):''}</span></td><td>${esc(t?t.name:'Unknown plan')}<span class="sub">${t?money(t.price)+'/mo':''}</span></td><td><div class="plates">${(p.plates||[]).map(plateChip).join('')}</div></td>
    <td>${esc(billingLabel(p))}${p.pastDueSince?`<span class="sub" style="color:var(--bad)">Past due since ${fmtDate(p.pastDueSince,tz)}${p.lateFeeDue?' · '+money(p.lateFeeDue)+' late fee':''}</span>`:''}${+p.prorateDue?`<span class="sub">${money(p.prorateDue)} first partial month on next bill</span>`:''}</td>
    <td class="num">${p.paidThrough?`<span style="${late?'color:var(--bad);font-weight:600':''}">${fmtDate(p.paidThrough-1,tz)}</span>`:'—'}</td><td>${permitPill(p)}</td>
    <td><div class="acts">${st==='pending'||st==='waitlist'?`<button class="btn sm ok" data-act="approvePermit" data-id="${p.id}">Approve</button><button class="btn sm danger" data-act="denyPermit" data-id="${p.id}">Decline</button>`:''}
    ${st==='suspended'?`<button class="btn sm" data-act="reinstatePermit" data-id="${p.id}">Reinstate</button>`:''}
    ${p.billing==='office'&&(st==='active'||st==='suspended')?`<button class="btn sm ok" data-act="officePaid" data-id="${p.id}">Record payment</button>`:''}
    ${st==='active'&&!p.endAt?`<button class="btn sm" data-act="endMonthly" data-id="${p.id}">Cancel</button>`:''}
    <button class="btn sm" data-act="editPermit" data-id="${p.id}">Edit</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No monthly parkers match.</div>'}</section>
  ${vCompanies()}`;
}
function vCompanies(){
  const cs=[...S.companies].sort((a,b)=>a.name.localeCompare(b.name));
  const invs=[...S.invoices].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,40);
  const ipill=st=>`<span class="pill ${({PAID:'ok',UNPAID:'warn',SCHEDULED:'info',PARTIALLY_PAID:'warn',CANCELED:'',FAILED:'bad'})[st]||''}">${esc(String(st||'').replace('_',' ').toLowerCase())}</span>`;
  return `<section class="panel"><div class="panel-h"><h2>Companies</h2><div class="row">${HOSTED&&canEditOps()?'<button class="btn sm" data-act="runBilling">Run billing now</button>':''}<button class="btn sm pri" data-act="editCompany">Add company</button></div></div>
  ${cs.length?`<div class="tbl-wrap"><table><thead><tr><th>Company</th><th>Contact</th><th>Billing</th><th class="r">Parkers</th><th class="r">Monthly</th><th></th></tr></thead><tbody>${cs.map(c=>{const ps=S.permits.filter(p=>p.companyId===c.id&&['active','suspended'].includes(p.status)&&(!p.endAt||p.endAt>now()));
    return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.contactName||'')}<span class="sub">${esc(c.email||'')}${c.phone?' · '+esc(c.phone):''}</span></td><td>${c.billing==='invoice'?'Square invoice':'Company card'}${c.billing==='card'?`<span class="sub">${c.card?esc(c.card.brand||'Card')+' ending '+esc(c.card.last4):'No card yet'}</span>`:`<span class="sub">Due ${(S.config&&S.config.invoiceDueDays)||5} days after the 1st</span>`}</td>
    <td class="r num">${ps.length}</td><td class="r num">${money(sum(ps,p=>(typeById(p.permitTypeId)||{}).price))}</td>
    <td><div class="acts">${HOSTED&&c.portalToken?`<button class="btn sm" data-act="copy" data-v="${esc(HOSTED.webhookBase+'/?company='+c.portalToken)}">Copy portal link</button><button class="btn sm" data-act="sendCompanyLink" data-id="${c.id}">Email link</button>`:''}<button class="btn sm" data-act="editCompany" data-id="${c.id}">Edit</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No companies yet. Add downtown employers that pay for their employees’ parking; they get a private link to add and remove employees.</div>'}</section>
  ${invs.length?`<section class="panel"><div class="panel-h"><h2>Company invoices</h2><span class="muted" style="font-size:.84rem">Sent through Square on the 1st. Past-due invoices suspend that company’s parkers after ${(S.config&&S.config.monthlyGraceDays)||5} days.</span></div>
  <div class="tbl-wrap"><table><thead><tr><th>Company</th><th>Month</th><th class="r">Amount</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${invs.map(i=>`<tr><td>${esc(i.companyName||'')}</td><td class="num">${esc(i.period)}</td><td class="r num">${money(i.amount)}${i.tax?`<span class="sub">incl. ${money(i.tax)} tax</span>`:''}</td><td class="num">${esc(i.dueDate||'')}</td><td>${ipill(i.status)}${i.suspended?'<span class="sub">Parkers suspended</span>':''}</td>
    <td><div class="acts">${i.publicUrl?`<a class="btn sm" href="${esc(i.publicUrl)}" target="_blank" rel="noopener">Open</a>`:''}${i.status!=='PAID'&&HOSTED?`<button class="btn sm ok" data-act="invoicePaid" data-id="${i.id}">Mark paid</button>`:''}</div></td></tr>`).join('')}</tbody></table></div></section>`:''}`;
}
function companyForm(c){
  c=c||{};const isNew=!c.id;
  openForm({title:isNew?'Add company':'Edit '+c.name,submit:isNew?'Add company':'Save changes',fields:[
    {id:'name',label:'Company name',value:c.name,required:true},
    {id:'contactName',label:'Parking contact',value:c.contactName},
    {id:'email',label:'Contact email (invoices and receipts)',type:'email',value:c.email,required:true},
    {id:'phone',label:'Contact phone',type:'tel',value:c.phone},
    {id:'billing',label:'How the company pays',type:'select',options:[['invoice','Square invoice each month (card or bank transfer)'],['card','Company card on file, charged on the 1st']],value:c.billing||'invoice'},
  ],extra:isNew?'':`<button type="button" class="btn danger" data-dlg="delete">Delete company</button>`,
  onExtra:async()=>{if(S.permits.some(p=>p.companyId===c.id&&['active','suspended','waitlist','approved'].includes(p.status)&&(!p.endAt||p.endAt>now()))){toast('Cancel this company’s monthly parkers first.',true);return false}return write(db=>col(db,'companies').doc(c.id).delete(),'Company deleted')},
  onSubmit:v=>{const data={name:v.name.trim(),contactName:v.contactName.trim(),email:v.email.trim().toLowerCase(),phone:v.phone.trim(),billing:v.billing};
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email))return 'Enter a valid email.';
    if(!isNew)return write(db=>col(db,'companies').doc(c.id).update(data),'Company saved');
    data.portalToken=Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>b.toString(16).padStart(2,'0')).join('');data.createdAt=now();
    return addDoc('companies',data,R.uid('co')).then(ok=>{if(ok)toast(`${data.name} added.${HOSTED?' Email them their portal link to add employees.':''}`);return ok})}});
}
function typeForm(t){
  t=t||{};
  openForm({title:t.id?'Edit '+t.name:'New monthly plan',submit:t.id?'Save changes':'Create plan',
    fields:[
      {id:'name',label:'Plan name',value:t.name,required:true,help:'e.g. “Main Street unreserved”'},
      {id:'kind',label:'Space',type:'select',options:[['unreserved','Unreserved (any open space)'],['reserved','Reserved (assigned space or section)']],value:t.kind||'unreserved'},
      {id:'price',label:'Price per month ($)',type:'number',step:'0.01',value:t.price,required:true,help:'Prices include sales tax when your settings say taxes are included.'},
      {id:'quota',label:'Spots for sale',type:'number',value:t.quota||'',help:'Blank for unlimited. Sign-ups past the limit join a waitlist.'},
      {id:'maxVehicles',label:'Vehicles per parker',type:'number',value:t.maxVehicles||3,help:'Plates allowed on one monthly account (one car parks at a time).'},
      {id:'active',label:'Sold online',type:'select',options:[['1','Yes, drivers and companies can sign up'],['0','No, office only']],value:t.active===false?'0':'1'},
      {id:'facilities',label:'Valid at',type:'checks',options:S.facilities.map(f=>[f.id,f.name]),value:t.facilities||[],help:'The first one sets the billing time zone. Select none for everywhere.'},
    ],
    extra:t.id?`<button type="button" class="btn danger" data-dlg="delete">Delete plan</button>`:'',
    onExtra:async()=>{if(S.permits.some(p=>p.permitTypeId===t.id&&!['revoked','cancelled'].includes(p.status)&&(!p.endAt||p.endAt>now()))){toast('Monthly parkers are still on this plan.',true);return false}return write(db=>col(db,'permitTypes').doc(t.id).delete(),'Plan deleted')},
    onSubmit:v=>{const data={name:v.name.trim(),kind:v.kind,price:+v.price||0,quota:v.quota===''?0:+v.quota,maxVehicles:Math.max(1,Math.min(5,+v.maxVehicles||3)),active:v.active==='1',facilities:v.facilities};
      return t.id?write(db=>col(db,'permitTypes').doc(t.id).update(data),'Plan saved'):addDoc('permitTypes',data,R.uid('t')).then(ok=>{if(ok)toast('Plan created');return ok})}
  });
}
function permitForm(p){
  p=p||{};const isNew=!p.id;
  if(!S.permitTypes.length){toast('Create a monthly plan first.',true);return}
  openForm({title:isNew?'Add monthly parker':'Edit #'+p.number,submit:isNew?'Add parker':'Save changes',
    fields:[
      {id:'holder',label:'Name',value:p.holder,required:true},{id:'email',label:'Email',type:'email',value:p.email},
      {id:'phone',label:'Mobile',type:'tel',value:p.phone},
      {id:'companyId',label:'Company',type:'select',options:[['','None (individual)'],...S.companies.map(c=>[c.id,c.name])],value:p.companyId||''},
      {id:'permitTypeId',label:'Plan',type:'select',options:S.permitTypes.map(t=>[t.id,`${t.name} · ${money0(t.price)}/mo`]),value:p.permitTypeId},
      {id:'plates',label:'License plates',value:(p.plates||[]).join(', '),required:true,help:'Separated by commas.'},
      ...(isNew?[{id:'paid',label:'This month',type:'select',options:[['bill','Add the rest of this month to the next bill (companies)'],['paid','Paid at the office']],value:'paid'}]:[]),
    ],
    onSubmit:v=>{const t=typeById(v.permitTypeId);const plates=v.plates.split(',').map(normPlate).filter(Boolean).slice(0,t.maxVehicles||3);if(!plates.length)return 'Add at least one license plate.';
      const co=v.companyId&&byId('companies',v.companyId);
      const data={holder:v.holder.trim(),email:v.email.trim().toLowerCase(),phone:v.phone.trim(),permitTypeId:v.permitTypeId,plates,companyId:co?co.id:null,companyName:co?co.name:''};
      if(isNew){const mb=R.monthBounds(now(),facById((t.facilities||[])[0]));if(v.paid==='bill'&&!co)return 'Only company parkers can be added to a bill. Choose “Paid at the office”.';
        Object.assign(data,{number:String(10000+Math.floor(Math.random()*89999)),status:'active',billing:co?'company':'office',createdAt:now(),startAt:now(),endAt:null,paidThrough:mb.end,source:'office'},v.paid==='bill'?{prorateDue:R.prorate(t)}:{paidAt:now(),amountPaid:R.prorate(t)})}
      else if(!p.accountId)data.billing=co?'company':'office';
      return isNew?addDoc('permits',data,R.uid('p')).then(ok=>{if(ok)toast(`Monthly #${data.number} added`);return ok}):write(db=>col(db,'permits').doc(p.id).update(data),'Saved')}
  });
}
/* ============ visitors ============ */
/* ============ citations ============ */
const citePill=c=>`<span class="pill ${({open:'bad',paid:'ok',appeal:'warn',voided:''})[c.status]||''}">${({open:'Open',paid:'Paid',appeal:'Under appeal',voided:'Voided'})[c.status]||c.status}</span>`;
function vCitations(){
  const qp=normPlate(UI.citeQ);
  const rows=S.citations.filter(c=>(UI.citeStatus==='all'||c.status===UI.citeStatus)&&(!qp||normPlate(c.plate).includes(qp)||String(c.number).includes(qp))).sort((a,b)=>b.issuedAt-a.issuedAt);
  const stBtn=(k,l)=>`<button data-act="citeStatus" data-v="${k}" aria-pressed="${UI.citeStatus===k}">${l} <span class="muted">${k==='all'?S.citations.length:S.citations.filter(c=>c.status===k).length}</span></button>`;
  const repeat={};S.citations.filter(c=>c.status==='open').forEach(c=>{const p=normPlate(c.plate);repeat[p]=(repeat[p]||0)+1});
  return `<div class="pagehead"><div><h1>Parking charge notices</h1><p>Notices left on windshields for unpaid or improper parking, with payments and disputes. Plates with 3 or more open notices are flagged for boot or tow.</p></div><button class="btn pri" data-role-go="enf">Issue a notice</button></div>
  <section class="panel"><div class="panel-h"><div class="filters" style="margin-right:auto"><div class="seg">${stBtn('open','Open')}${stBtn('appeal','Disputes')}${stBtn('paid','Paid')}${stBtn('voided','Voided')}${stBtn('all','All')}</div><input id="citeQ" type="search" placeholder="Plate or notice #" value="${esc(UI.citeQ)}" data-fresh="1"></div></div>
  ${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>Notice</th><th>Plate</th><th>Location</th><th>Reason</th><th class="r">Amount</th><th>Issued</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(c=>{const f=facById(c.facilityId);const rep=repeat[normPlate(c.plate)]>=3;
    return `<tr><td class="mono">${esc(c.number)}<span class="sub">${esc(c.officer||'')}</span></td><td>${plateChip(c.plate)} ${rep?'<span class="pill bad">Tow eligible</span>':''}</td><td>${esc(f?f.name:'—')}</td><td>${esc(c.violationName||c.violation)}${c.notes?`<span class="sub">${esc(c.notes)}</span>`:''}${c.status==='appeal'&&c.appeal?`<span class="sub"><b>Appeal:</b> “${esc(c.appeal.reason)}”</span>`:''}${c.appeal&&c.appeal.decision?`<span class="sub">Appeal ${esc(c.appeal.decision)}</span>`:''}</td><td class="r num">${money(c.fine)}</td><td class="num">${fmtTime(c.issuedAt,tzF(facById(c.facilityId)))}</td><td>${citePill(c)}</td>
    <td><div class="acts">${c.status==='appeal'?`<button class="btn sm ok" data-act="appealDecide" data-id="${c.id}" data-v="approved">Accept dispute</button><button class="btn sm danger" data-act="appealDecide" data-id="${c.id}" data-v="denied">Deny</button>`:''}${c.status==='open'?`<button class="btn sm ok" data-act="citePaid" data-id="${c.id}">Mark paid</button><button class="btn sm" data-act="citeVoid" data-id="${c.id}">Void</button>`:''}</div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No citations in this view.</div>'}</section>`;
}

/* ============ cameras ============ */
function webhookUrl(c){return HOSTED&&HOSTED.webhookBase?HOSTED.webhookBase+'/lpr/'+encodeURIComponent(c.token):null}
function vLpr(){
  const d0=new Date();d0.setHours(0,0,0,0);
  const cams=[...S.cameras].sort((a,b)=>((facById(a.facilityId)||{}).name||'').localeCompare((facById(b.facilityId)||{}).name||'')||a.direction.localeCompare(b.direction));
  const reads=c=>S.feed.filter(r=>r.cameraId===c.id&&r.at>=d0.getTime()).length;
  const stale=c=>!c.lastReadAt||now()-c.lastReadAt>2*H;
  return `<div class="pagehead"><div><h1>Cameras</h1><p>Each entry and exit lane camera sends plate reads here. Entries add a car to the count, exits remove it and settle the charge.</p></div><button class="btn pri" data-act="editCamera">Add lane camera</button></div>
  ${HOSTED?'':`<div class="callout warn"><b>Live camera connection runs on the hosted version.</b> This page can’t receive camera traffic directly. Deploy the ParkOps server from the download, then point each camera at its lane URL. Until then, use test reads or import a CSV export from your cameras.</div>`}
  <section class="panel"><div class="panel-h"><h2>Lane cameras</h2><span class="muted" style="font-size:.84rem">Lanes with no read in 2 hours are flagged</span></div>
  ${cams.length?`<div class="tbl-wrap"><table><thead><tr><th>Camera</th><th>Facility</th><th>Lane</th><th class="r">Reads today</th><th>Last read</th><th>Camera sends to</th><th></th></tr></thead><tbody>${cams.map(c=>{const f=facById(c.facilityId);const u=webhookUrl(c);
    return `<tr><td><b>${esc(c.name)}</b><span class="sub">${esc(c.model||'')}</span></td><td>${esc(f?f.name:'—')}</td><td><span class="pill ${c.direction==='in'?'ok':'info'}">${c.direction==='in'?'Entry':'Exit'}</span></td><td class="r num">${reads(c)}</td><td class="num">${c.lastReadAt?ago(c.lastReadAt):'Never'} ${stale(c)?'<span class="pill warn">Quiet</span>':''}${c.lastPlate?`<span class="sub">${esc(c.lastPlate)}</span>`:''}</td>
    <td>${u?`<div class="url"><code title="${esc(u)}">${esc(u)}</code><button class="btn sm" data-act="copy" data-v="${esc(u)}">Copy</button></div>`:'<span class="muted">Shown once hosted</span>'}</td><td><div class="acts"><button class="btn sm" data-act="editCamera" data-id="${c.id}">Edit</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No lane cameras yet. Add one camera per entry lane and one per exit lane.</div>'}</section>
  <div class="grid g2e">
  <section class="panel"><div class="panel-h"><h2>Send a test read</h2></div><form class="panel-b" data-form="lprRead" style="display:grid;gap:12px">
    <div class="form-grid"><div class="field span"><label for="lCam">Lane camera</label><select id="lCam">${cams.map(c=>`<option value="${c.id}">${esc((facById(c.facilityId)||{}).name||'')} · ${esc(c.name)} (${c.direction==='in'?'entry':'exit'})</option>`).join('')||'<option value="">Add a lane camera first</option>'}</select></div>
    <div class="field span"><label for="lPlate">Plate read</label><input id="lPlate" autocomplete="off" placeholder="e.g. 8KDM214, or leave blank for a no-plate read" style="text-transform:uppercase"></div></div>
    <div class="row"><button class="btn pri" ${cams.length?'':'disabled'}>Process read</button>${UI.lprResult?`<span class="pill dot ${UI.lprResult.level==='info'?'info':UI.lprResult.level}">${esc(UI.lprResult.text)}</span>`:''}</div>
  </form></section>
  <section class="panel"><div class="panel-h"><h2>Import reads</h2></div><div class="panel-b" style="display:grid;gap:10px">
    <p class="muted" style="margin:0;font-size:.9rem">CSV with columns <span class="mono">plate, camera, time</span>. Camera is the lane camera’s name. Time is optional. Reads are processed in time order, up to 500 at a time.</p>
    <input type="file" id="csvFile" accept=".csv,text/csv"></div></section></div>
  <section class="panel"><div class="panel-h"><h2>Read log</h2><span class="muted" style="font-size:.84rem">Last ${S.feed.length} reads</span></div>${feedTable(S.feed)}</section>`;
}
function cameraForm(c){
  c=c||{};
  if(!S.facilities.length){toast('Add a facility first.',true);return}
  openForm({title:c.id?'Edit '+c.name:'Add lane camera',submit:c.id?'Save changes':'Add camera',fields:[
    {id:'name',label:'Camera name',value:c.name,required:true,help:'e.g. “North Garage Entry 1”'},
    {id:'facilityId',label:'Facility',type:'select',options:S.facilities.map(f=>[f.id,f.name]),value:c.facilityId},
    {id:'direction',label:'Lane',type:'select',options:[['in','Entry lane'],['out','Exit lane']],value:c.direction||'in'},
    {id:'model',label:'Camera model',value:c.model||'',help:'For your records, e.g. Hikvision iDS-TCM403 or Axis P1465-LE-3'},
  ],extra:c.id?`<button type="button" class="btn danger" data-dlg="delete">Remove camera</button>`:'',
  onExtra:()=>write(db=>col(db,'cameras').doc(c.id).delete(),'Camera removed'),
  onSubmit:v=>{const data={name:v.name.trim(),facilityId:v.facilityId,direction:v.direction,model:v.model.trim()};
    if(c.id)return write(db=>col(db,'cameras').doc(c.id).update(data),'Camera saved');
    data.token=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');data.createdAt=now();
    return addDoc('cameras',data,R.uid('c')).then(ok=>{if(ok)toast('Camera added');return ok})}});
}
async function importCsv(file){
  const text=await file.text();const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(!lines.length){toast('That file is empty.',true);return}
  let rows=lines.map(l=>l.split(',').map(x=>x.trim().replace(/^"|"$/g,'')));
  if(/plate/i.test(rows[0][0]))rows=rows.slice(1);
  const parsed=[];let bad=0;
  rows.forEach(r=>{const [p,cam,t]=r;const c=S.cameras.find(x=>x.id===cam||x.name.toLowerCase()===String(cam||'').toLowerCase());const at=t?Date.parse(t):now();
    if(!c||isNaN(at)){bad++;return}parsed.push({plate:p,cameraId:c.id,at})});
  if(parsed.length>500){toast('Import up to 500 reads at a time.',true);return}
  parsed.sort((a,b)=>a.at-b.at);toast(`Processing ${parsed.length} reads…`);
  if(HOSTED){const r=await HOSTED.lprImport(parsed);toast(`Imported ${r.count} reads${bad?`, skipped ${bad} rows`:''}`);return}
  for(const r of parsed)await lprRead(r);
  toast(`Imported ${parsed.length} reads${bad?`, skipped ${bad} rows with an unknown camera or time`:''}`);
}

/* ============ settings ============ */
function vSettings(){
  const v=violations();
  return `<div class="pagehead"><div><h1>Settings</h1><p>Organization name, brand colors, taxes, collections, monthly billing and the violation schedule.</p></div></div>
  <div class="grid g2e">
  <section class="panel"><div class="panel-h"><h2>General</h2></div><form class="panel-b" data-form="settings" style="display:grid;gap:12px">
    <div class="field"><label for="sCampus">Organization name</label><input id="sCampus" value="${esc(S.config&&S.config.campusName||'')}" placeholder="ParkOps"></div>
    <div class="field"><label for="sTz">Default time zone</label><select id="sTz">${TIMEZONES.map(([k,l])=>`<option value="${k}" ${k===((S.config&&S.config.timeZone)||'America/Chicago')?'selected':''}>${l} time</option>`).join('')}</select></div>
    <div class="field"><label for="sGrace">Hours a driver has to pay after an unpaid exit</label><input id="sGrace" type="number" value="${esc((S.config&&S.config.unpaidGraceHours)||48)}"></div>
    <div class="form-grid"><div class="field"><label for="sLate">Late fee after that ($)</label><input id="sLate" type="number" step="0.25" value="${esc((S.config&&S.config.lateFee)??10)}"></div>
    <div class="field"><label for="sCiteH">Turn into a notice after (hours, 0 = never)</label><input id="sCiteH" type="number" value="${esc((S.config&&S.config.autoCiteHours)??96)}"></div>
    <div class="field"><label for="sHotAmt">Hot list at ($ owed)</label><input id="sHotAmt" type="number" value="${esc((S.config&&S.config.hotListAmount)??100)}"></div>
    <div class="field"><label for="sHotN">…or open notices</label><input id="sHotN" type="number" value="${esc((S.config&&S.config.hotListCount)??3)}"></div>
    <div class="field"><label for="sAlert">Alert email (cameras, hot list)</label><input id="sAlert" type="email" value="${esc((S.config&&S.config.alertEmail)||'')}"></div>
    <div class="field"><label for="sTax">Sales tax (%)</label><input id="sTax" type="number" step="0.001" value="${esc((S.config&&S.config.taxRate)??8.25)}"></div>
    <div class="field"><label for="sTaxInc">Posted prices</label><select id="sTaxInc"><option value="1" ${S.config&&S.config.taxIncluded===false?'':'selected'}>Include tax</option><option value="0" ${S.config&&S.config.taxIncluded===false?'selected':''}>Tax added at checkout</option></select></div>
    <div class="field"><label for="sEnfG">Officer grace after paid time ends (min)</label><input id="sEnfG" type="number" value="${esc((S.config&&S.config.enforcementGraceMin)??10)}"></div>
    <div class="field"><label for="sMLate">Monthly late fee ($)</label><input id="sMLate" type="number" step="0.25" value="${esc((S.config&&S.config.monthlyLateFee)??25)}"></div>
    <div class="field"><label for="sMGrace">Suspend monthly parking after (days past due)</label><input id="sMGrace" type="number" value="${esc((S.config&&S.config.monthlyGraceDays)??5)}"></div>
    <div class="field"><label for="sInvDue">Company invoices due (days after sending)</label><input id="sInvDue" type="number" value="${esc((S.config&&S.config.invoiceDueDays)??5)}"></div>
    <div class="field"><label for="sStale">Flag open visits older than (hours)</label><input id="sStale" type="number" value="${esc((S.config&&S.config.openVisitFlagHours)??24)}"></div>
    <div class="field"><label for="sBrand">Brand color</label><input id="sBrand" type="color" value="${esc((S.config&&S.config.brandColor)||'#1a56cc')}"></div>
    <div class="field"><label for="sStripe">Highlight color</label><input id="sStripe" type="color" value="${esc((S.config&&S.config.brandStripe)||'#e8a800')}"></div>
    <div class="field"><label for="sPrint">Notice printer paper</label><select id="sPrint">${[[2,'2 inch (ZQ110, ZQ210)'],[3,'3 inch (ZQ320, ZQ520, ZQ620)'],[4,'4 inch (ZQ630, ZQ521)']].map(([k,l])=>`<option value="${k}" ${+((S.config&&S.config.printerWidth)||3)===k?'selected':''}>${l}</option>`).join('')}</select></div></div>
    <div><button class="btn pri">Save settings</button></div></form></section>
  <section class="panel"><div class="panel-h"><h2>Violation schedule</h2><button class="btn sm" data-act="addViolation">Add violation</button></div>
    <form data-form="violations"><div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Violation</th><th class="r">Fine ($)</th></tr></thead><tbody>${v.map((x,i)=>`<tr><td><input id="vc${i}" value="${esc(x.code)}" style="width:110px" class="mono"></td><td><input id="vn${i}" value="${esc(x.name)}"></td><td class="r"><input id="vf${i}" type="number" value="${esc(x.fine)}" style="width:90px;text-align:right"></td></tr>`).join('')}</tbody></table></div>
    <div class="panel-b" style="padding-top:0"><button class="btn pri">Save schedule</button> <span class="note">Clear a code to remove that row.</span></div></form></section></div>
  <section class="panel"><div class="panel-h"><h2>Records</h2></div><div class="panel-b" style="display:grid;gap:10px">
    <p class="muted" style="margin:0;font-size:.9rem">${S.sessions.length} sessions · ${S.citations.length} notices · ${S.permits.length} monthly parkers · ${S.tenants.length} tenants · ${S.cameras.length} cameras. Remove records marked as samples before going live.</p>
    <div class="row">${HOSTED?'':'<button class="btn" data-act="refreshSamples">Move sample data to now</button>'}<button class="btn danger" data-act="clearSamples">Remove sample records</button><button class="btn" data-act="pruneSessions">Remove paid sessions older than 90 days</button></div></div></section>
  ${HOSTED&&window.hostedSettings?window.hostedSettings():''}`;
}

/* ============ enforcement ============ */
function vEnforcement(){
  if(!S.facilities.length)return emptyFacilities();
  if(!facById(UI.enfFac))UI.enfFac=S.facilities[0].id;
  const f=facById(UI.enfFac);const hasRes=+f.reservedSpaces>0;if(!hasRes)UI.enfZone='general';
  const r=UI.check&&UI.check.facId===UI.enfFac?R.checkPlate(UI.check.plate,UI.enfFac,UI.enfZone):null;
  const lastC=UI.lastCite&&byId('citations',UI.lastCite);
  const officer=store.get('officer')||'';
  const sweep=R.onSiteSessions(f).filter(s=>s.kind!=='permit'&&!s.noPlate).map(s=>({s,r:R.checkPlate(s.plate,f.id)})).sort((a,b)=>({bad:0,warn:1,ok:2}[a.r.level])-({bad:0,warn:1,ok:2}[b.r.level]));
  const mine=S.citations.filter(c=>c.facilityId===f.id&&now()-c.issuedAt<D).sort((a,b)=>b.issuedAt-a.issuedAt);
  return `<div class="enf">
  <section class="panel"><form class="panel-b" data-form="check" style="display:grid;gap:12px">
    <div class="row"><div class="field"><label for="enfFac">Patrolling</label><select id="enfFac" data-fresh="1">${S.facilities.map(x=>`<option value="${x.id}" ${x.id===UI.enfFac?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
    ${hasRes?`<div class="field"><label>Area</label><div class="seg"><button type="button" data-act="enfZone" data-v="general" aria-pressed="${UI.enfZone!=='reserved'}">General</button><button type="button" data-act="enfZone" data-v="reserved" aria-pressed="${UI.enfZone==='reserved'}">Reserved section</button></div></div>`:''}</div>
    <label for="enfPlate" class="muted" style="font-size:.78rem;font-weight:600">Plate</label>
    <input id="enfPlate" class="plate-in" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ENTER PLATE">
    <button class="btn pri lg">Check plate</button></form></section>
  ${r?`<section class="verdict ${r.level}" aria-live="polite"><div class="row" style="justify-content:space-between;align-items:center"><h2>${esc(r.title)}</h2>${plateChip(r.plate)}</div>
    ${r.lines.length?`<ul>${r.lines.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`:''}
    ${r.towEligible?`<div><span class="pill bad">Boot or tow eligible${r.hot?': hot list':': 3+ open notices'}</span></div>`:''}</section>
  ${lastC?'':`<section class="panel"><div class="panel-h"><h3>Issue a parking charge notice</h3>${r.level==='ok'?'<span class="pill ok">Not needed for payment</span>':''}</div><form class="panel-b" data-form="cite" style="display:grid;gap:12px">
    <div class="form-grid"><div class="field span"><label for="citeViol">Violation</label><select id="citeViol">${violations().map(v=>`<option value="${esc(v.code)}" ${v.code===(r.suggest||'')?'selected':''}>${esc(v.name)} · ${money0(v.fine)}</option>`).join('')}</select></div>
    <div class="field"><label for="citeOfficer">Officer</label><input id="citeOfficer" value="${esc(officer)}" placeholder="Name or badge #"></div>
    <div class="field"><label for="citeNotes">Notes</label><input id="citeNotes" placeholder="Row, space, vehicle color"></div>
    ${HOSTED?`<div class="field"><label for="citeState">Plate state</label><input id="citeState" maxlength="2" style="text-transform:uppercase" placeholder="TX"></div>
    <div class="field"><label for="citePhotos">Photos</label><input id="citePhotos" type="file" accept="image/*" capture="environment" multiple></div>
    <div class="span" id="photoStrip">${window.photoStrip?window.photoStrip():''}</div>`:''}</div>
    <button class="btn ${r.level==='ok'?'':'pri'} lg">Issue notice to ${esc(r.plate)}</button></form></section>`}`:''}
  ${lastC&&HOSTED&&window.printPanel?window.printPanel(lastC):lastC?`<section class="panel"><div class="panel-h"><h3>Notice ${esc(lastC.number)} issued</h3><span class="pill bad">${money(lastC.fine)}</span></div><div class="panel-b row"><button class="btn pri" data-act="doneCitePilot">Done · next plate</button><span class="note">Printing on a Zebra printer needs the hosted version.</span></div></section>`:''}
  <section class="panel"><div class="panel-h"><h3>Sweep: ${esc(f.name)}</h3><span class="muted" style="font-size:.84rem">Visitor vehicles on record, problems first</span></div>
    ${sweep.length?`<div class="list">${sweep.map(({s,r})=>`<div class="li"><span class="sev ${r.level}"></span>${plateChip(s.plate)}<div class="grow"><b>${esc(r.title)}</b><span class="muted" style="display:block;font-size:.82rem">${s.mode==='prepaid'?'Paid until '+fmtTime(s.paidUntil):'Entered '+fmtTime(s.startAt)}</span></div></div>`).join('')}</div>`:'<div class="empty">No visitor vehicles recorded here.</div>'}</section>
  <section class="panel"><div class="panel-h"><h3>Notices here, last 24 hours</h3></div>
    ${mine.length?`<div class="list">${mine.map(c=>`<div class="li"><span class="sev bad"></span>${plateChip(c.plate)}<div class="grow"><b>${esc(c.violationName)}</b><span class="muted" style="display:block;font-size:.82rem">${esc(c.number)} · ${fmtTime(c.issuedAt,tzF(facById(c.facilityId)))} · ${esc(c.officer||'')}</span></div>${citePill(c)}</div>`).join('')}</div>`:'<div class="empty">None yet today.</div>'}</section>
  </div>`;
}
async function issueCitation({plate,facId,code,officer,notes,sessionId,plateState,photoIds}){
  const v=violByCode(code)||{code,name:code,fine:0};const pl=normPlate(plate);
  const dup=S.citations.find(c=>normPlate(c.plate)===pl&&c.facilityId===facId&&c.violation===v.code&&now()-c.issuedAt<D&&c.status!=='voided');
  if(dup){toast(`${pl} already has this notice today (${dup.number}).`,true);return false}
  const number='C'+Date.now().toString(36).toUpperCase().slice(-6);
  const id=R.uid('c');
  const ok=await addDoc('citations',{number,plate:pl,plateState:(plateState||'').toUpperCase().slice(0,2),facilityId:facId,violation:v.code,violationName:v.name,fine:+v.fine||0,officer:officer||'',notes:notes||'',issuedAt:now(),status:'open',sessionId:sessionId||null,photoIds:photoIds||[]},id);
  if(ok){toast(`Notice ${number} issued to ${pl}`);UI.lastCite=id}return ok;
}

/* ============ driver portal ============ */
function vPortal(){
  const types=S.permitTypes.filter(t=>t.active!==false).sort((a,b)=>a.name.localeCompare(b.name));
  if(!HOSTED&&UI.lookup)UI.lookupData=R.lookup(UI.lookup);
  return `<div class="enf" style="max-width:900px">
  <section class="portal-hero"><h1>Parking at ${esc(campusName())}</h1><p>Pay by plate, start monthly parking, set up autopay, or settle a parking notice. No ticket needed: garages read your plate at entry and exit, and lots take payment by plate from the QR code on the sign.</p></section>
  ${UI.receipt?`<div class="receipt" role="status"><b>${esc(UI.receipt.title)}</b><br>${esc(UI.receipt.body)}${ratingWidget(UI.receipt)}</div>`:''}
  <div class="grid g2e">
  <section class="panel"><div class="panel-h"><h2>Pay to park</h2></div><form class="panel-b" data-form="payPark" style="display:grid;gap:12px">
    <div class="field"><label for="pPlate">License plate</label><input id="pPlate" autocomplete="off" style="text-transform:uppercase" placeholder="ABC1234"></div>
    <div class="field"><label for="pFac">Where are you parked?</label><select id="pFac">${S.facilities.map(f=>`<option value="${f.id}">${esc(f.name)} · ${esc(R.rateSummary(f)[0]||'')}</option>`).join('')}</select></div>
    <div class="field"><label for="pHours">How long?</label><select id="pHours">${[1,2,3,4,6,8,12].map(h=>`<option value="${h}" ${h===2?'selected':''}>${h} hour${h>1?'s':''}</option>`).join('')}</select></div>
    <div class="row" style="justify-content:space-between;align-items:center"><div><div class="note">Total</div><div class="quote" id="pQuote">—</div></div><button class="btn pri lg">Pay now</button></div>
    <p class="note" style="margin:0">Garages with cameras also bill automatically when you leave, so prepaying is optional there.</p></form></section>
  <section class="panel"><div class="panel-h"><h2>Look up my plate</h2></div><div class="panel-b" style="display:grid;gap:12px">
    <form data-form="lookup" class="row"><div class="field"><label for="lkPlate">License plate</label><input id="lkPlate" autocomplete="off" style="text-transform:uppercase" placeholder="ABC1234" value="${esc(UI.lookup)}" data-fresh="1"></div><button class="btn">Look up</button></form>
    ${UI.lookupData?lookupResults(UI.lookupData):'<p class="note" style="margin:0">See your monthly parking, current stay, balances and citations.</p>'}</div></section>
  <section class="panel"><div class="panel-h"><h2>Have a validation code?</h2></div><form class="panel-b" data-form="validate" style="display:grid;gap:12px">
    <div class="form-grid"><div class="field"><label for="vPlate">License plate</label><input id="vPlate" style="text-transform:uppercase"></div><div class="field"><label for="vCode">Code</label><input id="vCode" style="text-transform:uppercase"></div></div>
    <button class="btn">Apply code</button><p class="note" style="margin:0">Codes come from the business you’re visiting and apply to your current stay.</p></form></section>
  <section class="panel"><div class="panel-h"><h2>Autopay</h2></div><form class="panel-b" data-form="enroll" style="display:grid;gap:12px">
    <p class="muted" style="margin:0;font-size:.9rem">Register your plates once. Camera-equipped garages charge your card when you drive out.</p>
    <div class="form-grid"><div class="field"><label for="mName">Name</label><input id="mName"></div><div class="field"><label for="mEmail">Email</label><input id="mEmail" type="email"></div>
    <div class="field span"><label for="mPlates">Plates</label><input id="mPlates" placeholder="ABC1234, XYZ987" style="text-transform:uppercase"></div></div>
    <div class="row" style="justify-content:space-between;align-items:center"><span class="note">Pilot mode: a demo card ending 4242 is attached.</span><button class="btn pri">Turn on autopay</button></div></form></section>
  <section class="panel" style="grid-column:1/-1"><div class="panel-h"><h2>Monthly parking</h2></div><form class="panel-b" data-form="apply" style="display:grid;gap:12px">
    ${types.length?`<div class="form-grid"><div class="field"><label for="aName">Full name</label><input id="aName"></div><div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email"></div>
    <div class="field"><label for="aType">Plan</label><select id="aType">${types.map(t=>`<option value="${t.id}">${esc(t.name)} · ${money0(t.price)}/month</option>`).join('')}</select><div class="help" id="aTypeInfo"></div></div>
    <div class="field"><label for="aPlates">License plates</label><input id="aPlates" placeholder="Separated by commas" style="text-transform:uppercase"></div></div>
    <div><button class="btn pri">Start monthly parking</button></div>`:'<p class="muted">Monthly parking isn’t open for sign-up right now.</p>'}</form></section>
  </div>
  <p class="note" style="text-align:center">Payments in this pilot are simulated. No card is charged.</p></div>`;
}
/* Five stars under a receipt. One rating per ticket. */
function ratingWidget(rc){
  if(!rc||!rc.sessionId||UI.rated===rc.sessionId)return '';
  return `<div class="rate" style="margin-top:10px;display:grid;gap:6px"><span class="note">How was your parking experience?</span><div class="stars" role="group" aria-label="Rate 1 to 5 stars">${[1,2,3,4,5].map(n=>`<button type="button" class="star" data-act="rateVisit" data-id="${esc(rc.sessionId)}" data-v="${n}" aria-label="${n} star${n>1?'s':''}">★</button>`).join('')}</div><input id="rateText" placeholder="Anything we should know? (optional)" style="max-width:420px"></div>`;
}
function lookupResults(d){
  if(!d||!d.permits)return '<p class="note" style="margin:0">Couldn’t look up that plate. Try again.</p>';
  let h='<div class="list" style="border:1px solid var(--line);border-radius:var(--r)">';
  d.permits.forEach(p=>{h+=`<div class="li"><span class="sev ${p.valid?'ok':p.status==='waitlist'?'info':p.status==='suspended'?'bad':''}"></span><div class="grow"><b>${esc(p.typeName)}</b> <span class="mono">#${esc(p.number)}</span><span class="muted" style="display:block;font-size:.82rem">${p.status==='waitlist'?'On the waitlist':p.status==='suspended'?'Suspended for non-payment':p.valid?(p.endAt?'Ends '+fmtDate(p.endAt-1):p.paidThrough?'Paid through '+fmtDate(p.paidThrough-1):'Active'):'Not active'}</span></div>${permitPill({status:p.status,endAt:p.endAt})}</div>`});
  if(d.member)h+=`<div class="li"><span class="sev ok"></span><div class="grow"><b>Autopay is on</b><span class="muted" style="display:block;font-size:.82rem">Charged to the card on file when you leave</span></div></div>`;
  d.live.forEach(s=>{h+=`<div class="li"><span class="sev info"></span><div class="grow"><b>Parked now</b><span class="muted" style="display:block;font-size:.82rem">${s.mode==='prepaid'?'Paid until '+fmtTime(s.paidUntil):'Since '+fmtTime(s.startAt)+' · '+money(s.fee)+' so far'}${s.validation?' · code '+esc(s.validation)+' applied':''}</span></div></div>`});
  d.owed.forEach(s=>{h+=`<div class="li"><span class="sev warn"></span><div class="grow"><b>${money(s.balance)} due</b><span class="muted" style="display:block;font-size:.82rem">${esc(s.facilityName)} · left ${fmtTime(s.endAt)}</span></div><button class="btn sm pri" data-act="payBalance" data-id="${s.id}">Pay</button></div>`});
  d.citations.forEach(c=>{h+=`<div class="li" style="flex-wrap:wrap"><span class="sev ${c.status==='open'?'bad':c.status==='appeal'?'warn':'ok'}"></span><div class="grow"><b>${esc(c.violationName)} · ${money(c.fine)}</b><span class="muted" style="display:block;font-size:.82rem">${esc(c.number)} · ${esc(c.facilityName)} · ${fmtTime(c.issuedAt,tzF(facById(c.facilityId)))}${c.appealDecision?' · appeal '+esc(c.appealDecision):''}</span></div>
    ${c.status==='open'?`<button class="btn sm pri" data-act="payCitation" data-id="${c.id}">Pay</button>${c.hasAppeal?'':`<button class="btn sm" data-act="startAppeal" data-id="${c.id}">Appeal</button>`}`:citePill(c)}
    ${UI.appealFor===c.id?`<form data-form="appeal" data-id="${c.id}" style="flex-basis:100%;display:grid;gap:8px;margin-top:6px"><label for="apText" class="muted" style="font-size:.78rem;font-weight:600">Why should this be dismissed?</label><textarea id="apText"></textarea><div class="row"><button class="btn pri sm">Submit appeal</button><button type="button" class="btn sm" data-act="cancelAppeal">Cancel</button></div></form>`:''}</div>`});
  if(!d.permits.length&&!d.live.length&&!d.owed.length&&!d.citations.length&&!d.member)h+=`<div class="li"><span class="sev ok"></span><div class="grow">Nothing on file for <b>${esc(d.plate)}</b>. You’re all clear.</div></div>`;
  return h+'</div>';
}
function updateQuote(){const q=$('#pQuote');if(!q||HOSTED)return;const h=+(($('#pHours')||{}).value)||0;q.textContent=money(R.quote(($('#pFac')||{}).value,h))}
function updateTypeInfo(){const el=$('#aTypeInfo');if(!el)return;const t=typeById(($('#aType')||{}).value);if(!t){el.textContent='';return}
  const sold=t.sold!=null?t.sold:R.soldOf(t),q=+t.quota||0;const fs=(t.facilities||[]).map(facById).filter(Boolean).map(f=>f.name);
  el.textContent=`${t.kind==='reserved'?'Reserved space':'Any open space'} at ${fs.length?fs.join(', '):'all facilities'}. Up to ${t.maxVehicles||3} vehicles. ${q?(sold>=q?'Full: new sign-ups join the waitlist.':`${q-sold} of ${q} left.`):''} First month is prorated (${money(R.prorate(t))} today), then ${money(t.price)} on the 1st.`}
async function portalAction(op,args,after,payment){
  const r=await portalRun(op,args,payment);
  if(r.error){toast(r.error,true);return false}
  UI.receipt=r.receipt;if(after)after();await refreshLookup();render();window.scrollTo(0,0);return true;
}

/* ============ generic form dialog ============ */
const dlg=$('#dlg'),dlgForm=$('#dlgForm');let dlgCfg=null;
function openForm(cfg){
  dlgCfg=cfg;
  const fld=f=>{const id='f_'+f.id;const v=f.value??'';let input;
    if(f.type==='select')input=`<select id="${id}">${f.options.map(([k,l])=>`<option value="${esc(k)}" ${String(k)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
    else if(f.type==='checks')input=`<div class="checks" id="${id}">${f.options.map(([k,l])=>`<label><input type="checkbox" value="${esc(k)}" ${(v||[]).includes(k)?'checked':''}>${esc(l)}</label>`).join('')||'<span class="muted">None available</span>'}</div>`;
    else if(f.type==='textarea')input=`<textarea id="${id}">${esc(v)}</textarea>`;
    else if(f.type==='note')return `<div class="field span"><p class="note" style="margin:0">${esc(f.label)}</p></div>`;
    else input=`<input id="${id}" type="${f.type||'text'}" ${f.step?`step="${f.step}"`:''} value="${esc(v)}" ${f.required?'required':''}>`;
    return `<div class="field ${f.type==='checks'||f.span?'span':''}"><label for="${id}">${esc(f.label)}</label>${input}${f.help?`<div class="help">${esc(f.help)}</div>`:''}</div>`};
  dlgForm.innerHTML=`<div class="dlg-h"><h2>${esc(cfg.title)}</h2><button type="button" class="btn sm" data-dlg="close">Close</button></div>
  <div class="dlg-b">${cfg.body||`<div class="form-grid">${(cfg.fields||[]).map(fld).join('')}</div>`}<p id="dlgErr" class="pill bad" hidden style="margin-top:12px"></p></div>
  <div class="dlg-f">${cfg.extra?`<span style="margin-right:auto">${cfg.extra}</span>`:''}<button type="button" class="btn" data-dlg="close">Cancel</button><button class="btn ${cfg.danger?'danger':'pri'}" type="submit">${esc(cfg.submit||'Save')}</button></div>`;
  dlg.showModal();const first=dlgForm.querySelector('.dlg-b input,.dlg-b select,.dlg-b textarea');if(first)first.focus();
}
function confirmBox(title,msg,label,fn){openForm({title,body:`<p style="margin:0">${msg}</p>`,submit:label,danger:true,onSubmit:fn})}
dlgForm.addEventListener('submit',async e=>{e.preventDefault();if(!dlgCfg)return;
  const vals={};(dlgCfg.fields||[]).forEach(f=>{const el=$('#f_'+f.id,dlgForm);if(!el)return;vals[f.id]=f.type==='checks'?[...el.querySelectorAll('input:checked')].map(i=>i.value):el.value});
  const missing=(dlgCfg.fields||[]).find(f=>f.required&&!String(vals[f.id]||'').trim());
  const err=$('#dlgErr',dlgForm);
  if(missing){err.textContent=`${missing.label} is required.`;err.hidden=false;return}
  const btn=dlgForm.querySelector('[type=submit]');btn.disabled=true;
  const res=await dlgCfg.onSubmit(vals);btn.disabled=false;
  if(typeof res==='string'){err.textContent=res;err.hidden=false;return}
  if(res!==false){dlg.close();dlgCfg=null;schedule()}
});
dlgForm.addEventListener('click',async e=>{const b=e.target.closest('[data-dlg]');if(!b)return;
  if(b.dataset.dlg==='close'){dlg.close();dlgCfg=null}
  if(b.dataset.dlg==='delete'&&dlgCfg&&dlgCfg.onExtra){if(b.dataset.armed){const ok=await dlgCfg.onExtra();if(ok){dlg.close();dlgCfg=null}}else{b.dataset.armed='1';b.textContent='Click again to confirm'}}
});
let toastT;function toast(msg,err){const t=$('#toast');t.textContent=msg;t.className='toast'+(err?' err':'');t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,err?5200:3000)}

/* ============ actions ============ */
const VIEWS={overview:vOverview,activity:vActivity,tenants:vTenants,facilities:vFacilities,permits:vPermits,citations:vCitations,lpr:vLpr,settings:vSettings,reservations:()=>window.vReservations?window.vReservations():'',payments:()=>window.vPayments?window.vPayments():'',selfparking:()=>window.vSelfParking?window.vSelfParking():'',review:()=>window.vReview?window.vReview():'',valet:()=>window.vValet?window.vValet():'',reports:()=>window.vReports?window.vReports():''};
const ACT={
  goTab(b){UI.tab=b.dataset.tab;store.set('tab',UI.tab);const f=b.dataset.filter;if(f){if(UI.tab==='permits')UI.permitStatus=f==='pending'?'all':f;if(UI.tab==='citations')UI.citeStatus=f;if(UI.tab==='activity'){UI.auditFilter=f;UI.auditRange='week'}if(UI.tab==='selfparking'){UI.spView='tickets';UI.tkStatus=f;UI.tkRange='month'}}
    if(b.dataset.tenant){UI.tenant=b.dataset.tenant;UI.tenantDay=0}if(b.dataset.fac){UI.actFac=b.dataset.fac;store.set('actFac',UI.actFac)}render();window.scrollTo(0,0)},
  permitStatus(b){UI.permitStatus=b.dataset.v;render()},enfZone(b){UI.enfZone=b.dataset.v;render()},citeStatus(b){UI.citeStatus=b.dataset.v;render()},auditFilter(b){UI.auditFilter=b.dataset.v;render()},
  pickTenant(b,e){if(e.target.closest('[data-act=editTenant]'))return;UI.tenant=b.dataset.id;UI.tenantDay=0;store.set('tenant',UI.tenant);render()},
  tenantDay(b){UI.tenantDay=Math.max(0,Math.min(29,UI.tenantDay+(+b.dataset.v)));render()},
  tenantDayPick(b){UI.tenantDay=29-(+b.dataset.i);render()},
  editTenant(b,e){e.stopPropagation();tenantForm(b.dataset.id?byId('tenants',b.dataset.id):null)},
  exportTenant(b){const t=byId('tenants',b.dataset.id);const f=facById(t.facilityId);const tz=tzF(f);const days=R.tenantDays(t,30);
    saveFile(`${t.name.replace(/[^a-z0-9]+/gi,'-')}-valet-overage.csv`,csv([['Parking day','Validated cars','Peak cars at once','Peak time','Allotment','Over allotment','Charge'],...days.map(d=>[new Date(d.start+12*H).toLocaleDateString('en-CA',{timeZone:tz}),d.cars,d.peak,d.peak?new Date(d.peakAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZone:tz}):'',t.allotment||0,d.over,d.charge.toFixed(2)]),['Total','','','','',sum(days,d=>d.over),sum(days,d=>d.charge).toFixed(2)]]))},
  exportAudit(){const f=facById(UI.actFac);const tz=tzF(f);const ds=R.dayStart(now(),f);const start={today:ds,yesterday:R.dayStart(ds-H,f),week:ds-6*D}[UI.auditRange];const end=UI.auditRange==='yesterday'?ds:Infinity;
    const rows=S.sessions.filter(s=>s.facilityId===f.id&&s.endAt>=start&&s.endAt<end).sort((a,b)=>a.endAt-b.endAt);
    const t=x=>x?new Date(x).toLocaleString('en-US',{timeZone:tz}):'';
    saveFile(`${f.name.replace(/[^a-z0-9]+/gi,'-')}-exits-${UI.auditRange}.csv`,csv([['Plate','Exit read','Entered','Exited','Fee','Paid','Balance','Validation','Tenant','Result'],...rows.map(s=>[s.plate,s.exitPlate||'',t(s.startAt),t(s.endAt),R.sessionFee(s).toFixed(2),R.paidOf(s).toFixed(2),R.balanceOf(s).toFixed(2),s.validation?s.validation.code:'',s.validation&&s.validation.tenantName||'',(STATUS[R.exitStatus(s)]||[0,''])[1]])]))},
  recount(b){recountForm(facById(b.dataset.id))},
  closeMissed(b){const s=byId('sessions',b.dataset.id);ticketAction(s.id,'review',{decision:'sendToReview'},`${s.plate} moved to plate review`)},
  confirmMatch(b){const s=byId('sessions',b.dataset.id);ticketAction(s.id,'review',{decision:'confirm'},`Confirmed. ${money(R.sessionFee(s)-R.paidOf(s))} is now owed by ${s.plate}.`)},
  rejectMatch(b){const s=byId('sessions',b.dataset.id);confirmBox('Different car',`The exit read ${esc(s.exitPlate||'')} isn’t ${esc(s.plate)}. Reopen ${esc(s.plate)} as still on site?`,'Reopen stay',async()=>{const r=await ticketAction(s.id,'review',{decision:'reject'},`${s.plate} is back on site`);return !r.error})},
  missedBill(b){const s=byId('sessions',b.dataset.id);ticketAction(s.id,'review',{decision:'billDay'},r=>`${s.plate} billed ${money(r.fee)}`)},
  missedFree(b){const s=byId('sessions',b.dataset.id);ticketAction(s.id,'review',{decision:'noCharge'},`${s.plate} closed with no charge`)},
  editFacility(b){facilityForm(b.dataset.id?byId('facilities',b.dataset.id):null)},
  editType(b){typeForm(b.dataset.id?byId('permitTypes',b.dataset.id):null)},
  editCamera(b){cameraForm(b.dataset.id?byId('cameras',b.dataset.id):null)},
  copy(b){const v=b.dataset.v;(navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).then(()=>toast('Copied')).catch(()=>{const c=b.previousElementSibling;const r=document.createRange();r.selectNodeContents(c);const s=getSelection();s.removeAllRanges();s.addRange(r);toast('Selected. Press Ctrl+C or ⌘C to copy.')})},
  issuePermit(){permitForm()},editPermit(b){permitForm(byId('permits',b.dataset.id))},
  async approvePermit(b){const p=byId('permits',b.dataset.id);
    if(HOSTED){b.disabled=true;try{const r=await HOSTED.api('POST','/api/admin/approveMonthly',{id:p.id});toast(r.message)}catch(e){toast(e.message,true)}b.disabled=false;return}
    const t=typeById(p.permitTypeId);const mb=R.monthBounds(now(),facById(((t||{}).facilities||[])[0]));write(db=>col(db,'permits').doc(p.id).update({status:'active',startAt:now(),paidThrough:mb.end,paidAt:now(),amountPaid:t?R.prorate(t):0}),`#${p.number} approved`)},
  denyPermit(b){const p=byId('permits',b.dataset.id);confirmBox('Decline',`Remove ${esc(p.holder)} (#${esc(p.number)}) from the ${p.status==='waitlist'?'waitlist':'request list'}?`,'Decline',()=>write(db=>col(db,'permits').doc(p.id).update({status:'cancelled',endAt:now(),declinedAt:now()}),'Declined'))},
  reinstatePermit(b){const p=byId('permits',b.dataset.id);confirmBox('Reinstate',`Reinstate #${esc(p.number)} for ${esc(p.holder)}? Their plates will read as valid right away.${p.lateFeeDue?` The ${money(p.lateFeeDue)} late fee stays on their next bill.`:''}`,'Reinstate',()=>write(db=>col(db,'permits').doc(p.id).update({status:'active',pastDueSince:null,reinstatedAt:now()}),'Reinstated'))},
  officePaid(b){const p=byId('permits',b.dataset.id);const t=typeById(p.permitTypeId);const f=facById(((t||{}).facilities||[])[0]);const base=Math.max(p.paidThrough||now(),now()-40*D);const next=R.monthBounds(base+D,f);const through=p.paidThrough&&p.paidThrough>now()?next.end:R.monthBounds(now(),f).end;
    confirmBox('Record payment',`Record ${money((t||{}).price)} paid for #${esc(p.number)}? Paid through becomes ${fmtDate(through-1)}.`,'Record payment',()=>write(db=>col(db,'permits').doc(p.id).update({paidThrough:through,paidAt:now(),amountPaid:+(t||{}).price||0,status:'active',pastDueSince:null,lateFeeDue:0}),'Payment recorded'))},
  endMonthly(b){const p=byId('permits',b.dataset.id);const t=typeById(p.permitTypeId);const end=p.paidThrough&&p.paidThrough>now()?p.paidThrough:R.monthBounds(now(),facById(((t||{}).facilities||[])[0])).end;
    openForm({title:'Cancel #'+p.number,submit:'Cancel monthly parking',danger:true,fields:[{id:'when',label:'When',type:'select',options:[['end',`At the end of the paid period (${fmtDate(end-1)})`],['now','Right away (no refund is issued automatically)']],value:'end'}],
      onSubmit:v=>write(db=>col(db,'permits').doc(p.id).update(v.when==='now'?{status:'cancelled',endAt:now(),cancelledAt:now()}:{endAt:end,cancelledAt:now()}),'Cancelled')})},
  editCompany(b){companyForm(b.dataset.id?byId('companies',b.dataset.id):null)},
  async sendCompanyLink(b){try{await HOSTED.api('POST','/api/admin/companies/'+b.dataset.id+'/send-link');toast('Portal link emailed')}catch(e){toast(e.message,true)}},
  async runBilling(b){b.disabled=true;try{const r=await HOSTED.api('POST','/api/admin/billing/run');toast(r.billed?`Billed ${r.billed} account${r.billed>1?'s':''}`:'Nothing is due right now')}catch(e){toast(e.message,true)}b.disabled=false},
  async invoicePaid(b){const i=byId('invoices',b.dataset.id);confirmBox('Mark invoice paid',`Mark ${esc(i.companyName)}’s ${esc(i.period)} invoice (${money(i.amount)}) as paid outside Square? Its parkers are reactivated.`,'Mark paid',async()=>{try{await HOSTED.api('POST','/api/admin/invoices/'+i.id+'/paid');toast('Invoice marked paid');return true}catch(e){return e.message}})},
  editRates(b){ratesForm(byId('facilities',b.dataset.id))},
  makeSign(b){if(window.signForm)window.signForm(byId('facilities',b.dataset.id));else toast('Pay signs are made on the hosted version, where the QR code can point to your web address.',true)},
  closeSession(b){if(window.closeTicketDialog)window.closeTicketDialog(b.dataset.id)},
  validateSession(b){if(window.validateTicketDialog)window.validateTicketDialog(b.dataset.id)},
  markSessionPaid(b){if(window.payTicketDialog)window.payTicketDialog(b.dataset.id)},
  waiveSession(b){if(window.waiveTicketDialog)window.waiveTicketDialog(b.dataset.id)},
  doneCitePilot(){UI.lastCite=null;UI.check=null;render();const i=$('#enfPlate');if(i)i.focus()},
  async citeSession(b){const s=byId('sessions',b.dataset.id);const ok=await issueCitation({plate:s.plate,facId:s.facilityId,code:'UNPAID',officer:actorName(),notes:`Unpaid balance ${money(R.balanceOf(s))} from ${fmtTime(s.endAt)} · ticket ${R.ticketOf(s)}`,sessionId:s.id});if(ok)ticketAction(s.id,'markCited',{citationId:UI.lastCite})},
  openTicket(b){UI.tab='selfparking';UI.spView='ticket';UI.ticketId=b.dataset.id;store.set('tab',UI.tab);render();window.scrollTo(0,0)},
  editValidation(b){validationForm(b.dataset.id?byId('validations',b.dataset.id):null)},
  toggleValidation(b){const v=byId('validations',b.dataset.id);write(db=>col(db,'validations').doc(v.id).update({active:!v.active}),v.active?'Code turned off':'Code turned on')},
  removeMember(b){const m=byId('members',b.dataset.id);confirmBox('Remove autopay member',`Remove ${esc(m.name)} from autopay?`,'Remove',()=>write(db=>col(db,'members').doc(m.id).delete(),'Member removed'))},
  citePaid(b){const c=byId('citations',b.dataset.id);write(db=>col(db,'citations').doc(c.id).update({status:'paid',paidAt:now(),paidVia:'office'}),`Citation ${c.number} marked paid`)},
  citeVoid(b){const c=byId('citations',b.dataset.id);confirmBox('Void citation',`Void citation ${esc(c.number)} for ${esc(c.plate)}?`,'Void citation',()=>write(db=>col(db,'citations').doc(c.id).update({status:'voided',voidedAt:now()}),'Citation voided'))},
  appealDecide(b){const c=byId('citations',b.dataset.id);const d=b.dataset.v;write(db=>col(db,'citations').doc(c.id).update({status:d==='approved'?'voided':'open',appeal:Object.assign({},c.appeal,{decision:d,decidedAt:now()})}),d==='approved'?'Appeal approved, citation voided':'Appeal denied, citation reopened')},
  async checkPlate(b){const pl=b.dataset.plate;if(UI.role==='portal'){UI.lookup=pl;await refreshLookup();render();return}if(UI.role==='ops'){UI.tab='selfparking';UI.spView='vehicle';UI.vehicle=pl;store.set('tab',UI.tab);render();window.scrollTo(0,0);return}if(!S.roles.includes('enf'))return;UI.role='enf';store.set('role','enf');const cur=S.sessions.find(s=>normPlate(s.plate)===pl&&R.isLive(s));if(cur)UI.enfFac=cur.facilityId;UI.check={plate:pl,facId:UI.enfFac};render();window.scrollTo(0,0)},
  addViolation(){const v=[...violations(),{code:'NEW',name:'New violation',fine:0}];write(db=>db.doc('settings/config').set(Object.assign({},S.config||{},{violations:v})))},
  /* Demo helper: sample records keep their shape but every time on them moves forward so the latest sample activity is "now". */
  refreshSamples(){
    const keys=['sessions','citations','reservations','ratings','invoices','permits','cameras','validations'];const samp=k=>S[k].filter(x=>x.sample);
    const latest=Math.max(0,...samp('sessions').map(s=>Math.max(s.endAt||0,s.startAt||0,...(s.payments||[]).map(p=>p.at||0))));
    if(!latest){toast('No sample visits to move.');return}
    const delta=now()-latest-10*M;if(delta<H){toast('Sample data is already current.');return}
    const T=['startAt','endAt','paidUntil','createdAt','prepaidAt','issuedAt','paidAt','voidedAt','start','end','arrivedAt','completedAt','noShowAt','cancelledAt','at','lastReadAt','lastEventAt','waivedAt','adjustedAt','matchConfirmedAt','noticeAt','reminderAt','pastDueAt','paidThrough','pastDueSince','suspendedAt','approvedAt','startAt','expiresAt','validFrom'];
    const shift=v=>{if(Array.isArray(v))return v.map(shift);if(v&&typeof v==='object'){const o={};for(const [k,x] of Object.entries(v))o[k]=(T.includes(k)||/At$/.test(k))&&typeof x==='number'&&x>1e12?x+delta:shift(x);return o}return v};
    const ops=[];keys.forEach(k=>samp(k).forEach(x=>{const d=shift(x);delete d.id;ops.push({type:'set',coll:k,id:x.id,data:d})}));
    confirmBox('Move sample data to now',`Shift every time on ${ops.length} sample records forward by ${Math.round(delta/D)} day${Math.round(delta/D)===1?'':'s'} so the demo looks live again? Your own records are not touched.`,'Move to now',async()=>{
      applyLocal(ops);const feed=S.feed.map(shift);S.feed=feed;const ok=await write(db=>execOps(db,ops));if(!ok)return 'Couldn’t save every record; try again.';await write(db=>db.doc('feeds/lpr').set({reads:feed}));toast('Sample data moved to now');return true})},
  clearSamples(){const keys=COLLS;const n=keys.reduce((a,k)=>a+S[k].filter(x=>x.sample).length,0);
    if(!n){toast('No sample records left.');return}
    confirmBox('Remove sample records',`Delete ${n} records marked as samples and clear the camera log? Your own records stay.`,'Delete samples',async()=>{for(const k of keys){for(const x of S[k].filter(x=>x.sample)){await write(db=>col(db,k).doc(x.id).delete())}}await write(db=>db.doc('feeds/lpr').set({reads:[]}));toast('Sample records removed');return true})},
  pruneSessions(){const old=S.sessions.filter(s=>s.endAt&&now()-s.endAt>90*D&&R.balanceOf(s)===0);if(!old.length){toast('Nothing older than 90 days.');return}
    confirmBox('Remove old sessions',`Delete ${old.length} paid sessions older than 90 days?`,'Delete',async()=>{for(const s of old)await write(db=>col(db,'sessions').doc(s.id).delete());toast('Old sessions removed');return true})},
  payBalance(b){portalAction('payBalance',{sessionId:b.dataset.id})},
  payCitation(b){portalAction('payCitation',{citationId:b.dataset.id})},
  startAppeal(b){UI.appealFor=b.dataset.id;render();const t=$('#apText');if(t)t.focus()},
  async rateVisit(b){const id=b.dataset.id,stars=+b.dataset.v,comment=($('#rateText')||{}).value||'';const r=await portalRun('rate',{sessionId:id,stars,comment});if(r.error){toast(r.error,true);return}UI.rated=id;toast(r.receipt.title+' '+r.receipt.body);render()},
  cancelAppeal(){UI.appealFor=null;render()},
};
const FORMS={
  async lprRead(){const cam=$('#lCam').value;if(!cam){toast('Add a lane camera first.',true);return}const r=await lprRead({plate:$('#lPlate').value,cameraId:cam});UI.lprResult=r;$('#lPlate').value='';render()},
  check(){const pl=normPlate($('#enfPlate').value);if(!pl){toast('Enter a plate to check.',true);return}UI.check={plate:pl,facId:UI.enfFac};UI.lastCite=null;$('#enfPlate').value='';render()},
  async cite(){const officer=$('#citeOfficer').value.trim();store.set('officer',officer);
    let photoIds=[];if(HOSTED&&window.citePhotoIds)photoIds=window.citePhotoIds(UI.check.plate,UI.check.facId);
    const ok=await issueCitation({plate:UI.check.plate,facId:UI.check.facId,code:$('#citeViol').value,officer,notes:$('#citeNotes').value.trim(),plateState:($('#citeState')||{}).value,photoIds});
    if(ok){$('#citeNotes').value='';if(window.clearCitePhotos)window.clearCitePhotos();render()}},
  async settings(){const g=+$('#sGrace').value||48;await write(db=>db.doc('settings/config').set(Object.assign({},S.config||{},{campusName:$('#sCampus').value.trim(),timeZone:$('#sTz').value,unpaidGraceHours:g,lateFee:Math.max(0,+$('#sLate').value||0),autoCiteHours:Math.max(0,+$('#sCiteH').value||0),hotListAmount:Math.max(1,+$('#sHotAmt').value||100),hotListCount:Math.max(1,+$('#sHotN').value||3),alertEmail:$('#sAlert').value.trim(),printerWidth:+$('#sPrint').value||3,taxRate:Math.max(0,Math.min(20,+$('#sTax').value||0)),taxIncluded:$('#sTaxInc').value==='1',enforcementGraceMin:Math.max(0,+$('#sEnfG').value||0),monthlyLateFee:Math.max(0,+$('#sMLate').value||0),monthlyGraceDays:Math.max(1,+$('#sMGrace').value||5),invoiceDueDays:Math.max(1,+$('#sInvDue').value||5),openVisitFlagHours:Math.max(1,+$('#sStale').value||24),brandColor:$('#sBrand').value,brandStripe:$('#sStripe').value})),'Settings saved')},
  async violations(){const v=[];violations().forEach((_,i)=>{const code=normPlate($('#vc'+i).value);if(!code)return;v.push({code,name:$('#vn'+i).value.trim()||code,fine:+$('#vf'+i).value||0})});
    if(new Set(v.map(x=>x.code)).size!==v.length){toast('Each violation needs a unique code.',true);return}
    await write(db=>db.doc('settings/config').set(Object.assign({},S.config||{},{violations:v})),'Violation schedule saved')},
  payPark(){portalAction('prepay',{plate:$('#pPlate').value,facilityId:$('#pFac').value,hours:+$('#pHours').value},()=>{$('#pPlate').value=''})},
  async lookup(){UI.lookup=normPlate($('#lkPlate').value);UI.appealFor=null;await refreshLookup();render()},
  apply(){portalAction('monthlySignup',{name:$('#aName').value,email:$('#aEmail').value,planId:$('#aType').value,plates:$('#aPlates').value},()=>['aName','aEmail','aPlates'].forEach(i=>$('#'+i).value=''))},
  enroll(){portalAction('enroll',{name:$('#mName').value,email:$('#mEmail').value,plates:$('#mPlates').value},()=>['mName','mEmail','mPlates'].forEach(i=>$('#'+i).value=''))},
  validate(){portalAction('validate',{plate:$('#vPlate').value,code:$('#vCode').value},()=>{$('#vCode').value=''})},
  appeal(form){const id=form.dataset.id;portalAction('appeal',{citationId:id,plate:UI.lookup,reason:$('#apText').value},()=>{UI.appealFor=null})},
};

document.addEventListener('click',e=>{
  const r=e.target.closest('.roles [data-role]');if(r){UI.role=r.dataset.role;store.set('role',UI.role);UI.receipt=null;render();return}
  const rg=e.target.closest('[data-role-go]');if(rg){if(!S.roles.includes(rg.dataset.roleGo))return;UI.role=rg.dataset.roleGo;store.set('role',UI.role);render();window.scrollTo(0,0);return}
  const t=e.target.closest('#tabs [data-tab]');if(t){UI.tab=t.dataset.tab;store.set('tab',UI.tab);render();return}
  const a=e.target.closest('#main [data-act]');if(a&&ACT[a.dataset.act]){e.preventDefault();ACT[a.dataset.act](a,e)}
});
document.addEventListener('submit',e=>{const f=e.target.closest('#main form[data-form]');if(!f)return;e.preventDefault();const fn=FORMS[f.dataset.form];if(fn)fn(f)});
let qT;document.addEventListener('input',e=>{const id=e.target.id;
  if(id==='permitQ'||id==='citeQ'){clearTimeout(qT);qT=setTimeout(()=>{UI[id]=e.target.value;render()},200)}
  if(id==='pHours'||id==='pFac')updateQuote();if(id==='aType')updateTypeInfo()});
document.addEventListener('change',async e=>{const id=e.target.id;
  if(id==='enfFac'){UI.enfFac=e.target.value;store.set('enfFac',UI.enfFac);UI.check=null;UI.lastCite=null;render()}
  if(id==='actFac'){UI.actFac=e.target.value;store.set('actFac',UI.actFac);render()}
  if(id==='auditRange'){UI.auditRange=e.target.value;render()}
  if(id==='pHours'||id==='pFac')updateQuote();if(id==='aType')updateTypeInfo();
  if(id==='csvFile'&&e.target.files[0]){await importCsv(e.target.files[0]);e.target.value=''}
  if(id==='citePhotos'&&e.target.files.length&&window.addCitePhotos){await window.addCitePhotos(e.target.files);e.target.value=''}});
setInterval(()=>{if(!dlg.open&&isLoaded())schedule()},30000);
render();boot();
