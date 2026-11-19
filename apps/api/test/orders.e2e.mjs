import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import pg from 'pg';
const root=resolve(import.meta.dirname,'../../..');
try{process.loadEnvFile(resolve(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(process.env.NODE_ENV==='production')throw Error('Use a local development PostgreSQL for integration tests.');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('orders: checkout, ownership, price confirmation, stock concurrency and cancellation',{timeout:90000},async()=>{
 const name='pharmaflow_orders_test_'+randomBytes(6).toString('hex');
 const settings={host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD};
 const admin=new pg.Client({...settings,database:process.env.DB_NAME});await admin.connect();
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const env={...process.env,NODE_ENV:'test',DB_NAME:name,API_PORT:String(port)};
 const baseHeaders={Origin:process.env.APP_ORIGIN??'http://127.0.0.1:5173','X-PharmaFlow-Request':'1','Content-Type':'application/json'};
 let db,child,created=false,logs='';
 async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}}
 async function start(){child=spawn(process.execPath,['dist/main.js'],{cwd:resolve(root,'apps/api'),env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('API startup timeout: '+logs);
 }
 const req=(path,method='GET',body,actor,extra={})=>fetch(`http://127.0.0.1:${port}/api/`+path,{method,headers:{...baseHeaders,...(actor?{Cookie:actor.cookie,'X-PharmaFlow-User':actor.user.id}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
 async function account(email){const password='Cart-password-test-2026';const r=await req('auth/register','POST',{email,password});assert.equal(r.status,201);const user=await r.json();const login=await req('auth/login','POST',{email,password});assert.equal(login.status,200);return {user,cookie:login.headers.get('set-cookie').split(';')[0]};}
 async function cart(actor){const r=await req('cart','GET',undefined,actor);assert.equal(r.status,200);return r.json();}
 try{
  await admin.query(`CREATE DATABASE "${name}"`);created=true;
  const run=file=>execFileSync(process.execPath,['dist/database/'+file+'.js'],{cwd:resolve(root,'apps/api'),env,encoding:'utf8'});
  assert.match(run('migrate'),/Applied migrations: 5/);assert.match(run('migrate'),/Applied migrations: 0/);run('seed');
  db=new pg.Client({...settings,database:name});await db.connect();await start();
  const contact={name:'Тестовий Одержувач',phone:'+380671234567',email:'recipient@example.invalid'};
  const address={city:'Львів',street:'Зелена',building:'15',apartment:'7'};
  const one=await account('one@example.invalid'),two=await account('two@example.invalid');
  const ph=id(21),product=id(102);
  async function fill(actor,items=[{productId:product,quantity:2}]){const c=await cart(actor);const r=await req('cart','PUT',{revision:c.revision,items},actor);assert.equal(r.status,200);return r.json();}
  async function quote(actor,mode='PICKUP',pharmacyId=ph){const c=await cart(actor);const r=await req('orders/quote','POST',{revision:c.revision,pharmacyId,mode},actor);assert.equal(r.status,200,await r.clone().text());return r.json();}
  const make=q=>({quoteId:q.id,requestId:crypto.randomUUID(),contact});
  assert.equal((await req('orders')).status,401);
  assert.equal((await req('orders','GET',undefined,one,{'X-PharmaFlow-User':two.user.id})).status,409);
  let r=await req('orders/quote','POST',{revision:0,pharmacyId:ph,mode:'PICKUP'},one);assert.equal(r.status,409);
  await fill(one);const initial=await cart(one);
  r=await req('orders/options','POST',{revision:initial.revision},one);assert.equal(r.status,200);assert.equal((await r.json()).pharmacies.length,3);
  assert.equal((await req('orders/quote','POST',{revision:initial.revision,pharmacyId:ph,mode:'PICKUP',totalMinor:1},one)).status,400);
  assert.equal((await req('orders/quote','POST',{revision:initial.revision,pharmacyId:ph,mode:'PICKUP'},one,{Origin:'https://other.invalid'})).status,403);
  const before=(await db.query('SELECT on_hand,reserved FROM stock_items WHERE pharmacy_id=$1 AND product_id=$2',[ph,product])).rows[0];
  let q=await quote(one);assert.equal(q.totalMinor,16400);assert.equal(q.deliveryMinor,0);
  assert.deepEqual((await db.query('SELECT on_hand,reserved FROM stock_items WHERE pharmacy_id=$1 AND product_id=$2',[ph,product])).rows[0],before);
  assert.equal((await req('orders','POST',make(q),two)).status,404);
  assert.equal((await req('orders','POST',{...make(q),contact:null},one)).status,400);
  assert.equal((await req('orders','POST',{...make(q),contact:{...contact,phone:'        '}},one)).status,400);
  assert.equal((await req('orders','POST',{...make(q),totalMinor:1},one)).status,400);
  // A changed catalog price requires a new visible quote; no reservation or cart loss.
  await db.query('UPDATE products SET price_minor=9000 WHERE id=$1',[product]);
  assert.equal((await req('orders','POST',make(q),one)).status,409);
  assert.deepEqual(await cart(one),{...initial,totalMinor:18000,items:initial.items.map(i=>({...i,priceMinor:9000,lineTotalMinor:18000}))});
  q=await quote(one);const body=make(q);
  const concurrent=await Promise.all([req('orders','POST',body,one),req('orders','POST',body,one)]);
  assert.ok(concurrent.every(r=>r.status===201));const order=await concurrent[0].json();assert.equal((await concurrent[1].json()).id,order.id);
  assert.equal(order.totalMinor,18000);assert.equal(order.status,'NEW');assert.equal(order.ownerId,one.user.id);
  assert.equal((await db.query('SELECT count(*)::int n FROM orders')).rows[0].n,1);
  let stock=(await db.query('SELECT on_hand,reserved FROM stock_items WHERE pharmacy_id=$1 AND product_id=$2',[ph,product])).rows[0];assert.equal(stock.on_hand,before.on_hand);assert.equal(stock.reserved,before.reserved+2);
  assert.equal((await cart(one)).count,0);
  await stop();await start();
  assert.equal((await (await req('orders','POST',body,one)).json()).id,order.id);
  assert.equal((await req('orders','POST',{...body,contact:{...contact,name:'Інше ім’я'}},one)).status,409);
  assert.equal((await req('orders/'+order.id,'GET',undefined,two)).status,404);
  assert.equal((await req('orders/'+order.id+'/cancel','POST',{},two)).status,404);
  assert.equal((await req('orders?page=0','GET',undefined,one)).status,400);
  const history=await (await req('orders','GET',undefined,one)).json();assert.equal(history.total,1);assert.equal(history.items[0].id,order.id);
  await db.query("UPDATE products SET name='Нова назва',price_minor=10000 WHERE id=$1",[product]);
  const snapshot=await (await req('orders/'+order.id,'GET',undefined,one)).json();assert.equal(snapshot.items[0].name,'Ібупрофен');assert.equal(snapshot.totalMinor,18000);
  const cancellations=await Promise.all([req('orders/'+order.id+'/cancel','POST',{},one),req('orders/'+order.id+'/cancel','POST',{},one)]);assert.ok(cancellations.every(r=>r.status===200));
  stock=(await db.query('SELECT on_hand,reserved FROM stock_items WHERE pharmacy_id=$1 AND product_id=$2',[ph,product])).rows[0];assert.deepEqual(stock,before);assert.equal((await cart(one)).count,0);
  // Courier address validation, delivery fee and expiry.
  await fill(one);q=await quote(one,'COURIER');assert.equal(q.deliveryMinor,6000);assert.equal(q.totalMinor,26000);
  assert.equal((await req('orders','POST',make(q),one)).status,400);
  assert.equal((await req('orders','POST',{...make(q),address:{}},one)).status,400);
  await db.query("UPDATE order_quotes SET expires_at=now()-interval '1 second' WHERE id=$1",[q.id]);
  assert.equal((await req('orders','POST',{...make(q),address},one)).status,409);
  q=await quote(one,'COURIER');r=await req('orders','POST',{...make(q),address},one);assert.equal(r.status,201);const courier=await r.json();assert.deepEqual(courier.address,address);assert.equal(courier.totalMinor,26000);
  await req('orders/'+courier.id+'/cancel','POST',{},one);
  // Cart edits and inactive pharmacy invalidate a previously displayed quote.
  await fill(one);q=await quote(one);await req('cart/items/'+product,'PATCH',{quantity:1},one);
  assert.equal((await req('orders','POST',make(q),one)).status,409);
  q=await quote(one);await db.query('UPDATE pharmacies SET active=false WHERE id=$1',[ph]);
  assert.equal((await req('orders','POST',make(q),one)).status,409);await db.query('UPDATE pharmacies SET active=true WHERE id=$1',[ph]);
  // Two customers contend for 3 units; neither partial orders nor overselling.
  await db.query('UPDATE stock_items SET on_hand=3,reserved=0 WHERE pharmacy_id=$1 AND product_id=$2',[ph,product]);
  await fill(one);await fill(two);const qa=await quote(one),qb=await quote(two);
  const race=await Promise.all([req('orders','POST',make(qa),one),req('orders','POST',make(qb),two)]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
  const win=race[0].status===201?one:two,lose=win===one?two:one;const winning=await race.find(r=>r.status===201).json();
  assert.equal((await cart(win)).count,0);assert.equal((await cart(lose)).count,2);
  assert.equal((await db.query('SELECT reserved FROM stock_items WHERE pharmacy_id=$1 AND product_id=$2',[ph,product])).rows[0].reserved,2);
  // Missing one of several lines rolls back the entire operation.
  await req('orders/'+winning.id+'/cancel','POST',{},win);
  await fill(one,[{productId:product,quantity:1},{productId:id(104),quantity:1}]);q=await quote(one);
  await db.query('UPDATE stock_items SET on_hand=reserved WHERE pharmacy_id=$1 AND product_id=$2',[ph,id(104)]);
  const sumBefore=(await db.query('SELECT sum(reserved)::int n FROM stock_items')).rows[0].n;
  const countBefore=(await db.query('SELECT count(*)::int n FROM orders')).rows[0].n;
  assert.equal((await req('orders','POST',make(q),one)).status,409);
  assert.equal((await db.query('SELECT sum(reserved)::int n FROM stock_items')).rows[0].n,sumBefore);
  assert.equal((await db.query('SELECT count(*)::int n FROM orders')).rows[0].n,countBefore);assert.equal((await cart(one)).count,2);
  // Stock constraints, quote reuse and terminal-state cancellation remain guarded.
  assert.equal((await req('orders','POST',{...body,requestId:crypto.randomUUID()},one)).status,409);
  // A non-cancelled courier fixture tests the forbidden transition without stock effects.
  await db.query("UPDATE orders SET status='OUT_FOR_DELIVERY',cancelled_at=NULL WHERE id=$1",[courier.id]);
  assert.equal((await req('orders/'+courier.id+'/cancel','POST',{},one)).status,409);
  await assert.rejects(db.query('UPDATE stock_items SET reserved=on_hand+1 WHERE pharmacy_id=$1',[ph]));
 }finally{await stop();if(db)await db.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
});
