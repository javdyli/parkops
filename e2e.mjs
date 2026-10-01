import { chromium } from 'playwright';
import fs from 'fs';
const B='http://localhost:8092';const out=[];const ok=(c,m)=>{out.push((c?'PASS ':'FAIL ')+m)};
const b=await chromium.launch();const pages=[];process.on('unhandledRejection',async e=>{console.log(out.join('\n'));console.log('ERROR',e.message.split('\n')[0]);for(const [n,p] of pages)await p.screenshot({path:'shots/fail-'+n+'.png',fullPage:true}).catch(()=>{});console.log('errs',errs.join(' | '));process.exit(1)});
const errs=[];try{
const errs=[];const mk=async(w=1280)=>{const ctx=await b.newContext({viewport:{width:w,height:900}});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|ERR_/.test(m.text()))errs.push(m.text())});p.on('dialog',d=>d.dismiss());await p.addInitScript(()=>{window.print=()=>{window.__printed=true}});pages.push([pages.length,p]);return p};
const H={'X-ParkOps':'1','Content-Type':'application/json'};
// ---------- admin ----------
const admin=await mk();await admin.goto(B+'/login');await admin.fill('#em','boss@example.com');await admin.fill('#pw','supersecret1');await admin.click('button');await admin.waitForTimeout(800);
ok(await admin.evaluate(()=>!document.querySelector('#tabs').hidden),'admin signed in with individual account');
// create officer
let r=await admin.request.post(B+'/api/admin/users',{headers:H,data:{name:'Ofc Diaz',email:'diaz@example.com',role:'attendant',password:'officerpass1'}});ok(r.ok(),'admin created officer');
// tenant validation + facility has reserved section
const st=await (await admin.request.get(B+'/api/state')).json();const camIn=st.cameras.find(c=>c.direction==='in'),camOut=st.cameras.find(c=>c.direction==='out');
ok(st.facilities[0].reservedSpaces===20,'starter garage has 20 reserved spaces');
// ---------- driver signs up, adds card ----------
const d=await mk(420);await d.goto(B+'/?account=1');await d.waitForTimeout(700);
await d.fill('#suName','Maya Okafor');await d.fill('#suEmail','maya@example.com');await d.fill('#suPw','drivingpass1');await d.fill('#suPlates','auto111');await d.click('form[data-form=acctSignup] button');await d.waitForTimeout(700);
ok(await d.locator('text=Hi, Maya').count()>0,'driver account created');
await d.click('[data-act=addCard]');await d.waitForSelector('#mockCardNum');await d.click('#payGo');await d.waitForTimeout(800);
const acct=await (await d.request.get(B+'/api/account/me')).json();ok(acct.account.card&&acct.account.card.last4==='1111','card saved to Square customer');
await d.screenshot({path:'shots/e-account.png',fullPage:true});
// ---------- camera entry with photo then exit: autopay ----------
const jpg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(3000,7),Buffer.from([0xff,0xd9])]);
const xml=`<EventNotificationAlert><eventType>ANPR</eventType><ANPR><licensePlate>AUTO111</licensePlate><confidenceLevel>97</confidenceLevel></ANPR></EventNotificationAlert>`;
r=await d.request.post(B+'/lpr/'+camIn.token,{multipart:{'anpr.xml':{name:'anpr.xml',mimeType:'application/xml',buffer:Buffer.from(xml)},'licensePlatePicture.jpg':{name:'licensePlatePicture.jpg',mimeType:'image/jpeg',buffer:jpg}}});
ok((await r.json()).result==='Autopay member entered','camera entry recognized autopay member');
let s2=await (await admin.request.get(B+'/api/state')).json();let sess=s2.sessions.find(s=>s.plate==='AUTO111');ok(!!sess.entryPhotoId,'plate photo saved from camera event');
ok((await d.request.get(B+'/photos/'+sess.entryPhotoId)).status()===403,'camera photo is private to staff');
ok((await admin.request.get(B+'/photos/'+sess.entryPhotoId)).status()===200,'staff can view camera photo');
// backdate entry 3h via admin patch then exit
await admin.request.patch(B+'/api/db/sessions/'+sess.id,{headers:H,data:{startAt:Date.now()-3*3600e3}});
r=await d.request.post(B+'/lpr/'+camOut.token+'?plate=AUTO111');ok(/Charging \$\d/.test((await r.json()).result),'exit computed fee and started autopay');
await admin.waitForTimeout(600);
s2=await (await admin.request.get(B+'/api/state')).json();sess=s2.sessions.find(s=>s.id===sess.id);ok(sess.payments.length===1&&sess.payments[0].method==='autopay'&&/^PAY/.test(sess.payments[0].pid),'autopay charged through Square and recorded');
// ---------- reservation with saved card ----------
await d.goto(B+'/');await d.waitForTimeout(600);await d.click('[data-act=pv][data-v=reserve]');await d.waitForTimeout(600);
ok(/reserved spots open/.test(await d.textContent('#rQuote')),'availability shown');
await d.click('#rGo');await d.waitForSelector('#payGo');await d.click('#payGo');await d.waitForTimeout(900);
const rec=await d.textContent('.receipt');ok(/Spot reserved · R/.test(rec),'reservation booked and paid: '+rec.slice(0,40));
s2=await (await admin.request.get(B+'/api/state')).json();const resv=s2.reservations[0];ok(resv&&/^PAY/.test(resv.paymentId)&&resv.premium===5,'reservation fee charged $5');
await d.screenshot({path:'shots/e-reserve.png',fullPage:true});
// arrival via camera links reservation
await admin.request.patch(B+'/api/db/reservations/'+resv.id,{headers:H,data:{start:Date.now()+10*60000}});
r=await admin.request.post(B+'/api/lpr/test',{headers:H,data:{cameraId:camIn.id,plate:'AUTO111'}});const arr=(await r.json()).text;ok(/Reservation R\w+ arrived/.test(arr),'camera matched reservation on arrival');
// cancel a second reservation from account → refund
await d.click('[data-act=pv][data-v=reserve]');await d.waitForTimeout(400);await d.fill('#rTime','23:30');await d.dispatchEvent('#rTime','change');await d.waitForTimeout(500);
await d.click('#rGo');await d.waitForSelector('#payGo');await d.click('#payGo');await d.waitForTimeout(900);
await d.click('[data-act=pv][data-v=account]');await d.waitForTimeout(900);
const cancelBtn=d.locator('[data-act=cancelResH]');ok(await cancelBtn.count()===1,'booked reservation listed in account');
await cancelBtn.click();await d.click('#dlgForm [type=submit]');await d.waitForTimeout(900);
ok(/refunded/.test(await d.textContent('.receipt')),'cancellation refunded the fee');
let mlog=await (await fetch('http://localhost:8099/log')).json();ok(mlog.some(x=>x.path==='/v2/refunds'),'Square refund called');
ok(mlog.filter(x=>x.path.startsWith('/v2')).every(x=>x.auth==='Bearer tok'&&x.ver),'Square calls carry token and version');
// ---------- guest pays to park with new card; decline path ----------
const g=await mk(400);await g.goto(B+'/');await g.waitForTimeout(600);
await g.fill('#pPlate','GUEST22');await g.waitForTimeout(700);const exp2h=await g.evaluate(()=>money(R.quote('f-main',2)));ok((await g.textContent('#pQuote'))===exp2h,'quote shown ('+exp2h+' for 2 hours, specials applied)');await g.click('#pGo');await g.waitForSelector('#mockCardNum');
await g.fill('#mockCardNum','4000000000000002');await g.click('#payGo');await g.waitForTimeout(700);
ok(/declined/.test(await g.textContent('#payErr')),'declined card shows error');
await g.fill('#mockCardNum','4111111111111111');await g.click('#payGo');await g.waitForTimeout(800);
ok((await g.textContent('.receipt')).includes('Paid '+exp2h+' for GUEST22'),'guest paid '+exp2h+' by card');
await g.screenshot({path:'shots/e-guest.png',fullPage:true});
// ---------- unpaid exit → notice email to account without card ----------
const d2=await mk(400);r=await d2.request.post(B+'/api/account/signup',{headers:H,data:{name:'Leo Park',email:'leo@example.com',password:'leopassword1',plates:'OWE222'}});ok(r.ok(),'second account');
await admin.request.post(B+'/api/lpr/test',{headers:H,data:{cameraId:camIn.id,plate:'OWE222',at:Date.now()-2*3600e3}});
r=await admin.request.post(B+'/api/lpr/test',{headers:H,data:{cameraId:camOut.id,plate:'OWE222'}});ok(/owing \$\d/.test((await r.json()).text),'unpaid exit flagged');
await admin.waitForTimeout(6500);
const ob=await (await admin.request.get(B+'/api/admin/outbox')).json();ok(ob.messages.some(m=>m.to==='leo@example.com'&&/Payment due/.test(m.subject)),'pay notice emailed to plate owner account');
// driver 2 pays all from account with new card
await d2.goto(B+'/?account=1');await d2.waitForTimeout(900);ok(await d2.locator('[data-act=payAll]').count()===1,'account shows amount owed');
await d2.click('[data-act=payAll]');await d2.waitForSelector('#mockCardNum');await d2.click('#payGo');await d2.waitForTimeout(900);
ok(/Paid \$\d/.test(await d2.textContent('.receipt')),'pay-all settled balance');
// ---------- officer: cite with photo, print ----------
const o=await mk(400);await o.goto(B+'/login');await o.fill('#em','diaz@example.com');await o.fill('#pw','officerpass1');await o.click('button');await o.waitForTimeout(900);
ok(await o.evaluate(()=>[...document.querySelectorAll('.roles button')].filter(x=>!x.hidden).map(x=>x.dataset.role).join())==='ops,enf,portal','attendant sees the console and enforcement');
await o.click('.roles button[data-role=enf]');await o.waitForTimeout(300);await o.click('[data-act=enfZone][data-v=reserved]');await o.fill('#enfPlate','ZZZ999');await o.click('form[data-form=check] button.lg');await o.waitForTimeout(300);
ok(/No reservation/.test(await o.textContent('.verdict h2')),'reserved-section check flags non-holder');
ok(await o.$eval('#citeViol',e=>e.value)==='RESERVEDZONE','suggests reserved-section violation');
fs.writeFileSync('/tmp/ev.jpg',jpg);await o.setInputFiles('#citePhotos','/tmp/ev.jpg');await o.waitForTimeout(800);
ok(await o.locator('#photoStrip img').count()>=1,'officer photo uploaded');
await o.fill('#citeState','tx');await o.click('form[data-form=cite] button.lg');await o.waitForTimeout(800);
ok(await o.locator('[data-act=printBT]').count()===1,'print panel shown after citation');
const zpl=await o.evaluate(()=>{const c=S.citations.find(x=>x.plate==='ZZZ999');return window.citationZpl(c)});
ok(zpl.startsWith('^XA')&&zpl.includes('^BQN')&&zpl.includes('ZZZ999')&&zpl.includes('/c/'),'ZPL ticket with QR code built');
await o.click('[data-act=printSys]');ok(await o.evaluate(()=>window.__printed===true),'print dialog opened');
await o.click('[data-act=printBT]');await o.waitForTimeout(400);ok(/Bluetooth/.test(await o.textContent('#toast')),'no Bluetooth in this browser is explained');
await o.screenshot({path:'shots/e-officer.png',fullPage:true});
s2=await (await admin.request.get(B+'/api/state')).json();const cit=s2.citations.find(x=>x.plate==='ZZZ999');ok(cit.photoIds.length>=1&&cit.plateState==='TX','citation stored photo ids and state');
ok((await g.request.get(B+'/photos/'+cit.photoIds[0])).status()===200,'driver can see evidence photo on their citation');
r=await o.request.patch(B+'/api/db/facilities/f-main',{headers:H,data:{capacity:1}});ok(r.status()===403,'officer cannot change rates');
// public lookup by citation link
await g.goto(B+'/c/'+cit.number);await g.waitForTimeout(900);ok((await g.textContent('#main')).includes(cit.number),'citation QR link opens lookup');
await g.screenshot({path:'shots/e-citelookup.png',fullPage:true});
// ---------- security ----------
r=await g.request.post(B+'/api/account/login',{data:{email:'x',password:'y'}});ok(r.status()===403,'CSRF header required');
for(let i=0;i<6;i++)await g.request.post(B+'/api/account/login',{headers:H,data:{email:'maya@example.com',password:'wrong-password'}});
r=await g.request.post(B+'/api/account/login',{headers:H,data:{email:'maya@example.com',password:'drivingpass1'}});ok(/Too many attempts/.test((await r.json()).error.message),'account locks after repeated failures');
const hd=(await g.request.get(B+'/')).headers();ok(hd['x-frame-options']==='DENY'&&hd['referrer-policy'],'security headers set');
// ---------- admin pages ----------
await admin.goto(B+'/');await admin.waitForTimeout(700);await admin.click('#tabs [data-tab=settings]');await admin.waitForTimeout(900);
ok(/Ofc Diaz/.test(await admin.textContent('#main')),'staff list shows officer');ok(/refund|login|set/.test(await admin.textContent('#main')),'activity log shows entries');
await admin.screenshot({path:'shots/e-settings.png',fullPage:true});
r=await admin.request.post(B+'/api/admin/backup',{headers:{'X-ParkOps':'1'}});const buf=await r.body();ok(r.ok()&&buf.slice(0,15).toString()==='SQLite format 3','backup download is a valid SQLite file');
await admin.click('#tabs [data-tab=payments]');await admin.waitForTimeout(900);ok(await admin.locator('[data-act=refund]').count()>=3,'payments list with refund buttons');
await admin.screenshot({path:'shots/e-payments.png',fullPage:true});
await admin.click('#tabs [data-tab=reservations]');await admin.waitForTimeout(600);await admin.screenshot({path:'shots/e-reservations.png',fullPage:true});
ok(/Bookings/.test(await admin.textContent('#main')),'reservations tab renders');
r=await admin.request.get(B+'/api/admin/collections.csv');ok(r.ok()&&(await r.text()).startsWith('Plate,Type'),'collections export');
const audit=await (await admin.request.get(B+'/api/admin/audit')).json();ok(audit.some(a=>a.action==='update'&&/boss@example.com/.test(a.actor)),'audit records who changed what');
}catch(e){console.log('ERROR',e.message.split('\n')[0]);for(const [n,p] of pages)await p.screenshot({path:'shots/fail-'+n+'.png',fullPage:true}).catch(()=>{})}
console.log(out.join('\n'));console.log('page errors:',errs.length?errs.join(' | '):'none');await b.close();
