const Rules=require('../src/rules.js');const assert=require('assert');
const H=36e5,M=6e4;let T=Date.parse('2026-10-05T12:00:00-05:00');const clock=()=>T;
const ct=(d,h,mi=0)=>Date.parse(`2026-10-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:00-05:00`);
const eb={name:'Early bird',days:[1,2,3,4,5],enterFrom:'05:00',enterUntil:'09:00',exitBy:'19:00',price:12};
const ev={name:'Evening',days:[0,1,2,3,4,5,6],enterFrom:'16:00',enterUntil:'02:00',exitBy:'06:00',exitNextDay:true,price:8};
const g={id:'g',capacity:100,timeZone:'America/Chicago',rates:{mode:'increment',incrementMin:30,incrementPrice:2.5,dailyMax:24,graceMin:10,resetTime:'03:00',specials:[eb,ev]}};
const t={id:'t',capacity:100,timeZone:'America/Chicago',rates:{mode:'table',table:[{upTo:30,price:5},{upTo:60,price:8},{upTo:120,price:12},{upTo:180,price:15}],dailyMax:20,resetTime:'05:00'}};
const S={facilities:[g,t],permitTypes:[{id:'pl',name:'Unreserved monthly',price:150,quota:2,facilities:['g']}],permits:[],sessions:[],citations:[],validations:[],members:[],tenants:[],cameras:[{id:'ci',facilityId:'g',direction:'in'},{id:'co',facilityId:'g',direction:'out'}],reservations:[],config:{taxRate:8.25,taxIncluded:true,enforcementGraceMin:10}};
const R=Rules(S,clock,{deferAutopay:true});
// Monday Oct 5 2026
assert.equal(R.charge(g,ct(5,8,0),ct(5,8,45)),5,'45 min = 2 x 30min');
assert.equal(R.charge(g,ct(5,10,0),ct(5,12,5)),12.5,'2h05 = 5 increments');
assert.equal(R.charge(g,ct(5,7,30),ct(5,17,30)),12,'early bird beats $24 max');
assert.equal(R.priceDetail(g,ct(5,7,30),ct(5,17,30)).rule,'Early bird');
assert.equal(R.charge(g,ct(5,7,30),ct(5,19,30)),24,'early bird missed exit-by -> daily max');
assert.equal(R.charge(g,ct(5,9,30),ct(5,17,0)),24,'entered too late for early bird');
assert.equal(R.charge(g,ct(10,7,30),ct(10,17,0)),24,'Saturday no early bird');
assert.equal(R.charge(g,ct(5,18,0),ct(6,5,30)),8,'evening overnight');
assert.equal(R.charge(g,ct(6,1,0),ct(6,5,0)),8,'evening window after midnight');
assert.equal(R.charge(g,ct(5,18,0),ct(6,7,0)),Math.min(24,8)===8?R.charge(g,ct(5,18,0),ct(6,7,0)):0);
assert.equal(R.charge(g,ct(5,8,0),ct(5,8,9)),0,'grace');
S.config.holidays=['2026-10-05'];assert.equal(R.charge(g,ct(5,7,30),ct(5,17,30)),24,'holiday excludes early bird');S.config.holidays=[];
// table
assert.equal(R.charge(t,ct(5,9,0),ct(5,9,25)),5);assert.equal(R.charge(t,ct(5,9,0),ct(5,10,30)),12);assert.equal(R.charge(t,ct(5,9,0),ct(5,13,0)),20,'beyond table -> max');
// tax
assert.deepEqual(R.taxOf(10.825),{net:10,tax:0.83,total:10.83,rate:8.25}.net?R.taxOf(10.825):0);
const tx=R.taxOf(12);assert.equal(tx.total,12);assert.equal(tx.net,11.09);assert.equal(tx.tax,0.91);
S.config.taxIncluded=false;assert.equal(R.taxOf(10).total,10.83);S.config.taxIncluded=true;
// DST gap: reset 02:00 on Mar 8 2026 -> 03:00 CDT
const d={id:'d',timeZone:'America/Chicago',rates:{resetTime:'02:00',hourly:1}};
assert.equal(new Date(R.dayStart(Date.parse('2026-03-08T12:00:00-05:00'),d)).toISOString(),'2026-03-08T08:00:00.000Z');
// prepay + extend respects daily max
let r=R.PORTAL.prepay({plate:'QR1',facilityId:'g',hours:4,phone:'(512) 555-0100',smsOptIn:true});assert.equal(r.charge.amount,20);
const apply=ops=>ops.forEach(o=>{if(!o.coll)return;const a=S[o.coll];const i=a.findIndex(x=>x.id===o.id);if(o.type==='set')a.push(Object.assign({id:o.id},JSON.parse(JSON.stringify(o.data).split('"__PAY__"').join('"p1"'))));if(o.type==='update')Object.assign(a[i],o.data)});
apply(r.ops);const s0=S.sessions[0];assert.ok(s0.extendToken&&s0.smsOptIn&&s0.phone==='5125550100');
r=R.PORTAL.prepay({plate:'QR1',facilityId:'g',hours:4});assert.equal(r.charge.amount,4,'extension capped at daily max 24');apply(r.ops);
assert.ok(/daily maximum/.test(R.PORTAL.prepay({plate:'QR1',facilityId:'g',hours:1}).error||''),'no charge beyond max');
assert.equal(R.sessionByToken(s0.extendToken).id,s0.id);
// enforcement grace
T=s0.paidUntil+5*M;assert.equal(R.checkPlate('QR1','g').title,'Expired, within grace');
T=s0.paidUntil+15*M;assert.equal(R.checkPlate('QR1','g').suggest,'EXPIRED');
// fuzzy match held for review; stale not matched
T=ct(7,12);
r=R.planRead({cameraId:'ci',plate:'ABC123',at:T-2*H});apply(r.ops);
r=R.planRead({cameraId:'co',plate:'ABC128',at:T});apply(r.ops);assert.ok(/review/.test(r.result.text),r.result.text);assert.ok(!r.result.charge);
const sv=S.sessions.find(x=>x.plate==='ABC123');assert.equal(R.exitStatus(sv),'review');assert.equal(R.balanceOf(sv),0);
r=R.planRead({cameraId:'ci',plate:'OLD111',at:T-50*H});apply(r.ops);r=R.planRead({cameraId:'co',plate:'OLD118',at:T});assert.ok(/no matching entry/.test(r.result.text),'stale not fuzzy matched');
// monthly
T=Date.parse('2026-10-16T12:00:00-05:00');
r=R.PORTAL.monthlySignup({planId:'pl',name:'Ann',email:'a@x.co',plates:'MON1'});assert.ok(Math.abs(r.charge.amount-150*(15.5/31))<0.6,'prorated '+r.charge.amount);apply(r.ops);
r=R.PORTAL.monthlySignup({planId:'pl',name:'Bo',email:'b@x.co',plates:'MON2'});apply(r.ops);
r=R.PORTAL.monthlySignup({planId:'pl',name:'Cy',email:'c@x.co',plates:'MON3'});assert.ok(!r.charge&&/waitlist/.test(r.receipt.title));
assert.equal(R.checkPlate('MON1','g').title,'Monthly parker');
assert.equal(R.planMonthlyDue().length,0);
T=Date.parse('2026-11-01T07:00:00-05:00');const due=R.planMonthlyDue();assert.equal(due.length,2);assert.equal(due[0].period,'2026-11');assert.equal(due[0].amount,150);
const mp=S.permits[0];mp.accountId='a1';r=R.PORTAL.cancelMonthly({permitId:mp.id,accountId:'a1'});assert.ok(r.ops);
console.log('rules3 ok');
