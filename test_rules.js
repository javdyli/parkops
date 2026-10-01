const Rules=require('../src/rules.js');const assert=require('assert');
const H=36e5,M=6e4;
const f={id:'g',capacity:100,rates:{hourly:3,dailyMax:20,graceMin:15,resetTime:'03:00'},timeZone:'America/Chicago'};
const S={facilities:[f],permitTypes:[],permits:[],sessions:[],citations:[],validations:[],members:[],tenants:[],cameras:[],config:{}};
const R=Rules(S);
const ct=(y,mo,d,h,mi)=>Date.parse(`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:00-05:00`); // CDT
// 10pm -> 5am next day: 5h day1 ($15) + 2h day2 ($6) = 21
assert.equal(R.charge(f,ct(2026,9,29,22,0),ct(2026,9,30,5,0)),21);
// 8am->6pm: 10h=30 capped 20
assert.equal(R.charge(f,ct(2026,9,29,8,0),ct(2026,9,29,18,0)),20);
// grace
assert.equal(R.charge(f,ct(2026,9,29,8,0),ct(2026,9,29,8,14)),0);
// 2.5h validation: 3h stay -> 0.5h -> 1 hour = 3
const v={type:'hours',value:2.5};
assert.equal(R.charge(f,ct(2026,9,29,8,0),ct(2026,9,29,11,0),v),3);
assert.equal(R.charge(f,ct(2026,9,29,8,0),ct(2026,9,29,10,20),v),0);
// 2:30am -> 3:30am crosses reset: 1 started hour = 3
assert.equal(R.charge(f,ct(2026,9,29,2,30),ct(2026,9,29,3,30)),3);
// 3 days: 8am day1 -> 8am day4 = 72 hours: day1 (8am-3am)=19h cap20; days2,3 cap 20 each; day4 3am-8am=5h $15 => 75
assert.equal(R.charge(f,ct(2026,9,29,8,0),ct(2026,10,2,8,0)),75);
// dayStart
assert.equal(R.dayStart(ct(2026,9,29,2,0),f),ct(2026,9,28,3,0));
assert.equal(R.dayStart(ct(2026,9,29,4,0),f),ct(2026,9,29,3,0));
// DST fall back Nov 1 2026: reset 03:00 CST (-06:00)
const d1=R.dayStart(Date.parse('2026-11-01T12:00:00-06:00'),f);assert.equal(d1,Date.parse('2026-11-01T03:00:00-06:00'));
assert.equal(R.nextDayStart(d1,f),Date.parse('2026-11-02T03:00:00-06:00'));
// reads
S.cameras=[{id:'ci',facilityId:'g',direction:'in'},{id:'co',facilityId:'g',direction:'out'}];
const apply=r=>r.ops.forEach(o=>{if(o.type==='set')S.sessions.push(Object.assign({id:o.id},o.data));if(o.type==='update'&&o.coll==='sessions')Object.assign(S.sessions.find(x=>x.id===o.id),o.data)});
let now0=Date.now();
let r=R.planRead({cameraId:'ci',plate:'ABC-1O8',at:now0-3*H});apply(r);assert.equal(r.result.text,'Visitor entered');
assert.equal(R.occupancy(f),1);
r=R.planRead({cameraId:'ci',plate:'ABC1O8',at:now0-3*H+20000});assert.ok(r.result.duplicate);
r=R.planRead({cameraId:'co',plate:'ABC108',at:now0});apply(r);console.log(r.result.text);assert.ok(/lookalike/.test(r.result.text));
assert.equal(R.occupancy(f),0);
r=R.planRead({cameraId:'co',plate:'ABC108',at:now0+30000});assert.ok(r.result.duplicate);
r=R.planRead({cameraId:'co',plate:'ZZZ999',at:now0});apply(r);assert.ok(/no matching entry/.test(r.result.text));
r=R.planRead({cameraId:'ci',plate:'unknown',at:now0});apply(r);assert.equal(R.occupancy(f),1);
r=R.planRead({cameraId:'co',plate:'',at:now0+H});apply(r);assert.equal(R.occupancy(f),0);
// fuzzy: one char dropped
r=R.planRead({cameraId:'ci',plate:'KLM4455',at:now0-H});apply(r);r=R.planRead({cameraId:'co',plate:'KLM445',at:now0});apply(r);assert.ok(/fuzzy/.test(r.result.text));
// statuses
console.log(S.sessions.map(s=>R.exitStatus(s)));
// tenant concurrency
S.tenants=[{id:'t1',name:'Valet',facilityId:'g',allotment:2,overageRate:15}];
S.validations=[{id:'v1',code:'VAL1',tenantId:'t1',type:'hours',value:2.5,active:true}];
S.sessions=[];for(let i=0;i<5;i++)S.sessions.push({id:'x'+i,facilityId:'g',plate:'P'+i,startAt:now0-5*H+i*10*M,endAt:now0-H,mode:'lpr',validation:{code:'VAL1',tenantId:'t1'}});
const days=R.tenantDays(S.tenants[0],3);console.log(days.map(d=>[new Date(d.start).toISOString(),d.peak,d.over,d.charge]));
console.log('all ok');
