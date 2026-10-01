const Rules=require('../src/rules.js');const assert=require('assert');
const H=36e5,M=6e4,D=864e5;let T=Date.parse('2026-10-01T15:00:00-05:00');const clock=()=>T;
const f={id:'g',capacity:100,reservedSpaces:2,reservationPremium:5,reservationGraceMin:60,cancelHours:2,rates:{hourly:3,dailyMax:20,graceMin:15,resetTime:'03:00'},timeZone:'America/Chicago'};
const S={facilities:[f],permitTypes:[],permits:[],sessions:[],citations:[],validations:[],members:[{id:'m1',plates:['AUTO1'],card:'4242'}],tenants:[],cameras:[{id:'ci',facilityId:'g',direction:'in'},{id:'co',facilityId:'g',direction:'out'}],reservations:[],config:{unpaidGraceHours:48,lateFee:10,autoCiteHours:72,hotListAmount:100,hotListCount:3}};
const R=Rules(S,clock,{deferAutopay:true});
const apply=ops=>ops.forEach(o=>{if(!o.coll)return;const a=S[o.coll];const i=a.findIndex(x=>x.id===o.id);if(o.type==='set')a.push(Object.assign({id:o.id},o.data));if(o.type==='update')Object.assign(a[i],o.data)});
// reservations
const mk=pl=>R.PORTAL.reserve({facilityId:'g',plate:pl,start:T+2*H,hours:3,name:'A',email:'a@b.co'});
let r1=mk('RES1');assert.ok(!r1.error,r1.error);assert.equal(r1.charge.amount,5);apply(r1.ops);
let r2=mk('RES2');apply(r2.ops);
let r3=mk('RES3');assert.ok(/full/.test(r3.error),'third should be full');
assert.ok(/overlaps/.test(mk('RES1').error));
// arrival
T+=2*H;let r=R.planRead({cameraId:'ci',plate:'RES1'});apply(r.ops);assert.ok(/Reservation R/.test(r.result.text),r.result.text);
assert.equal(S.reservations[0].status,'arrived');
assert.equal(R.checkPlate('RES1','g','reserved').level,'ok');
assert.equal(R.checkPlate('ZZZ1','g','reserved').suggest,'RESERVEDZONE');
// no show for RES2 after grace
T+=61*M;apply(R.planNoShows());assert.equal(S.reservations[1].status,'no_show');
// cancellation refund window
let r4=R.PORTAL.reserve({facilityId:'g',plate:'RES4',start:T+5*H,hours:2,name:'B',email:'b@b.co'});apply(r4.ops);
S.reservations[2].paymentId='sq_1';
let c=R.PORTAL.cancelReservation({code:r4.code,email:'B@b.co'});assert.ok(c.refund&&c.refund.amount===5,JSON.stringify(c));
// exit completes reservation, visitor owes
T+=2*H;r=R.planRead({cameraId:'co',plate:'RES1'});apply(r.ops);assert.equal(S.reservations[0].status,'completed');console.log(r.result.text);
// deferred autopay with past due
S.sessions.push({id:'old',plate:'AUTO1',facilityId:'g',startAt:T-30*H,endAt:T-27*H,fee:9,payments:[],mode:'lpr',kind:'visitor'});
r=R.planRead({cameraId:'ci',plate:'AUTO1',at:T-2*H});apply(r.ops);
r=R.planRead({cameraId:'co',plate:'AUTO1'});apply(r.ops);assert.ok(r.result.charge&&r.result.charge.items.length===2,JSON.stringify(r.result));console.log(r.result.text);
// collections ladder
S.sessions.push({id:'u1',plate:'OWE1',facilityId:'g',startAt:T-4*H,endAt:T-H,fee:9,payments:[],mode:'lpr',kind:'visitor'});
let col=R.planCollections();apply(col.ops);const types=()=>col.notices.filter(n=>n.session.id==='u1').map(n=>n.type);
assert.deepEqual(types(),['unpaid']);
T+=25*H;col=R.planCollections();apply(col.ops);assert.deepEqual(types(),['reminder']);
T+=24*H;col=R.planCollections();apply(col.ops);assert.deepEqual(types(),['pastdue']);assert.equal(R.balanceOf(S.sessions.find(s=>s.id==='u1')),19);
T+=24*H;col=R.planCollections();apply(col.ops);assert.deepEqual(types(),['cited']);assert.equal(S.citations.find(c=>c.sessionId==='u1').fine,44);
assert.equal(R.balanceOf(S.sessions.find(s=>s.id==='u1')),0);
// hot list
S.citations.push({id:'h1',plate:'HOT1',status:'open',fine:60},{id:'h2',plate:'HOT1',status:'open',fine:60});
r=R.planRead({cameraId:'ci',plate:'HOT1'});assert.ok(r.result.hot,'hot');console.log(r.result.text);
console.log('rules2 ok');
