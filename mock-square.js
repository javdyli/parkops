/* Mock Square + Twilio for tests. Square: customers, cards, payments (idempotent), refunds, orders, invoices. Twilio: messages. */
const http=require('http');const log=[];let n=0;const idem=new Map();const invoices=new Map();const terminals=new Map();const payments=new Map();
const sdk=`window.Square={payments(){return{paymentRequest(r){return{update(){}}},async applePay(){throw new Error('no apple pay')},async googlePay(){throw new Error('no google pay')},async card(){return{async attach(sel){const el=typeof sel==='string'?document.querySelector(sel):sel;el.innerHTML='<input id="mockCardNum" value="4111111111111111"><input id="mockZip" value="78701">'},async tokenize(vd){window.__lastVD=vd;const num=document.querySelector('#mockCardNum').value;return {status:'OK',token:num.startsWith('4000')?'cnon:card-nonce-declined':'cnon:card-nonce-ok',details:{billing:{postalCode:document.querySelector('#mockZip').value}}}},async destroy(){}}}}}};`;
http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{
  let body={};try{body=b&&req.headers['content-type']==='application/json'?JSON.parse(b):Object.fromEntries(new URLSearchParams(b))}catch(e){}
  log.push({path:req.url,method:req.method,body,auth:req.headers.authorization,ver:req.headers['square-version']});
  const J=(code,o)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
  if(req.url==='/sdk.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(sdk)}
  if(req.url==='/log')return J(200,log);
  if(req.url==='/fail-next'){global.failNext=true;return J(200,{})}
  if(/^\/invoice-paid\//.test(req.url)){const i=invoices.get(req.url.split('/')[2]);if(i)i.status='PAID';return J(200,{ok:!!i})}
  if(/\/2010-04-01\/Accounts\/.+\/Messages\.json/.test(req.url))return J(201,{sid:'SM'+(++n),status:'queued'});
  if(req.url==='/v2/customers')return J(200,{customer:{id:'CUST'+(++n)}});
  if(req.url==='/v2/cards'){if(!body.card||!body.card.customer_id)return J(400,{errors:[{code:'MISSING',detail:'customer'}]});return J(200,{card:{id:'ccof:'+(++n),card_brand:'VISA',last_4:'1111',exp_month:12,exp_year:2030}})}
  if(/\/v2\/cards\/.+\/disable/.test(req.url))return J(200,{card:{}});
  if(req.url==='/v2/payments'){
    if(global.failNext){global.failNext=false;return J(503,{errors:[{code:'SERVICE_UNAVAILABLE'}]})}
    if(idem.has(body.idempotency_key))return J(200,idem.get(body.idempotency_key));
    if(body.source_id==='cnon:card-nonce-declined')return J(402,{errors:[{code:'CARD_DECLINED',detail:'declined'}]});
    if(!body.amount_money||!Number.isInteger(body.amount_money.amount))return J(400,{errors:[{code:'BAD_AMOUNT'}]});
    const out={payment:{id:'PAY'+(++n),status:'COMPLETED',amount_money:body.amount_money,receipt_url:'https://squareup.com/receipt/preview/PAY'+n,card_details:{card:{last_4:'1111'}}}};idem.set(body.idempotency_key,out);payments.set(out.payment.id,out.payment);return J(200,out)}
  if(req.url==='/v2/refunds')return J(200,{refund:{id:'REF'+(++n),status:'PENDING'}});
  let m;
  // Terminal API: a checkout is PENDING, then IN_PROGRESS, then COMPLETED on the third poll (or CANCELED for a "cancel" device).
  if(req.url==='/v2/terminals/checkouts'&&req.method==='POST'){if(!body.idempotency_key||!body.checkout||!body.checkout.device_options||!body.checkout.device_options.device_id)return J(400,{errors:[{code:'BAD_REQUEST',detail:'device_id required'}]});if(idem.has('tc:'+body.idempotency_key))return J(200,idem.get('tc:'+body.idempotency_key));const id='TC'+(++n);const c={id,status:'PENDING',amount_money:body.checkout.amount_money,device_options:body.checkout.device_options,reference_id:body.checkout.reference_id,payment_ids:[],polls:0};terminals.set(id,c);const out={checkout:c};idem.set('tc:'+body.idempotency_key,out);return J(200,out)}
  if((m=/^\/v2\/terminals\/checkouts\/([^/]+)\/cancel$/.exec(req.url))){const c=terminals.get(m[1]);if(!c)return J(404,{errors:[{code:'NOT_FOUND'}]});if(c.status!=='COMPLETED'){c.status='CANCELED';c.cancel_reason='SELLER_CANCELED'}return J(200,{checkout:c})}
  if((m=/^\/v2\/terminals\/checkouts\/([^/]+)$/.exec(req.url))){const c=terminals.get(m[1]);if(!c)return J(404,{errors:[{code:'NOT_FOUND'}]});c.polls++;if(c.status==='PENDING'&&c.polls>=2)c.status=/cancel/i.test(c.device_options.device_id)?'CANCELED':'IN_PROGRESS';else if(c.status==='IN_PROGRESS'&&c.polls>=3){c.status='COMPLETED';const pid='PAYT'+(++n);c.payment_ids=[pid];payments.set(pid,{id:pid,status:'COMPLETED',amount_money:c.amount_money,receipt_url:'https://squareup.com/receipt/preview/'+pid,card_details:{card:{last_4:'2222'}}})}return J(200,{checkout:c})}
  if((m=/^\/v2\/payments\/([^/]+)$/.exec(req.url))&&req.method==='GET'){const p=payments.get(m[1]);return p?J(200,{payment:p}):J(404,{errors:[{code:'NOT_FOUND'}]})}
  if(req.url==='/v2/orders')return J(200,{order:{id:'ORD'+(++n),line_items:body.order.line_items}});
  if(req.url==='/v2/invoices'&&req.method==='POST'){const id='INV'+(++n);const inv={id,version:0,status:'DRAFT',order_id:body.invoice.order_id,public_url:null};invoices.set(id,inv);return J(200,{invoice:inv})}
  if((m=/^\/v2\/invoices\/([^/]+)\/publish$/.exec(req.url))){const inv=invoices.get(m[1]);inv.status='UNPAID';inv.public_url='https://squareup.com/pay-invoice/'+m[1];return J(200,{invoice:inv})}
  if((m=/^\/v2\/invoices\/([^/]+)$/.exec(req.url))){const inv=invoices.get(m[1]);return inv?J(200,{invoice:inv}):J(404,{errors:[{code:'NOT_FOUND'}]})}
  J(404,{errors:[{code:'NOT_FOUND'}]});
})}).listen(8099,()=>console.log('mock square on 8099'));
