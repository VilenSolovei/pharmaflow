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
test('order processing: State, admin authorization, stock effects, replay and concurrent transitions',{timeout:90000},async()=>{
 const name='pharmaflow_processing_test_'+randomBytes(6).toString('hex');
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
  assert.match(run('migrate'),/Applied migrations: 6/);assert.match(run('migrate'),/Applied migrations: 0/);run('seed');
  db=new pg.Client({...settings,database:name});await db.connect();await start();
  const customer=await account('customer@example.invalid'),operator=await account('operator@example.invalid'),other=await account('other@example.invalid');
  await db.query("UPDATE users SET role='ADMIN' WHERE id=$1",[operator.user.id]);
  const ph=id(21),product=id(102),contact={name:'Одержувач Тест',phone:'+380671234567',email:'recipient@example.invalid'};
  async function place(mode='PICKUP',items=[{productId:product,quantity:1}]){
   const c=await cart(customer);let r=await req('cart','PUT',{revision:c.revision,items},customer);assert.equal(r.status,200);const saved=await r.json();
   r=await req('orders/quote','POST',{revision:saved.revision,pharmacyId:ph,mode},customer);assert.equal(r.status,200);const q=await r.json();
   r=await req('orders','POST',{quoteId:q.id,requestId:crypto.randomUUID(),contact,...(mode==='COURIER'?{address:{city:'Львів',street:'Зелена',building:'15'}}:{})},customer);assert.equal(r.status,201);return r.json();
  }
  const stock=async()=>(await db.query('SELECT product_id,on_hand,reserved FROM stock_items WHERE pharmacy_id=$1 ORDER BY product_id',[ph])).rows;
  const payload=(action,expectedStatus)=>({action,expectedStatus,requestId:crypto.randomUUID()});
  const act=(order,action,status,body)=>req('admin/orders/'+order.id+'/actions','POST',body??payload(action,status),operator);
  const detail=async order=>{const r=await req('admin/orders/'+order.id,'GET',undefined,operator);assert.equal(r.status,200);return r.json();};
  const baseline=await stock();const pickup=await place();const reserved=await stock();
  assert.equal((await req('admin/orders')).status,401);
  assert.equal((await req('admin/orders','GET',undefined,customer)).status,403);
  assert.equal((await req('admin/orders/'+pickup.id,'GET',undefined,customer)).status,403);
  assert.equal((await req('admin/orders/'+pickup.id+'/actions','POST',payload('COMPLETE','NEW'),customer)).status,403);
  assert.equal((await req('admin/orders','GET',undefined,operator,{'X-PharmaFlow-User':customer.user.id})).status,409);
  assert.equal((await req('admin/orders?status=INVALID','GET',undefined,operator)).status,400);
  assert.equal((await req('admin/orders/'+id(9999),'GET',undefined,operator)).status,404);
  let r=await req('admin/orders','GET',undefined,operator),list=await r.json();assert.equal(list.ownerId,operator.user.id);assert.equal(list.total,1);assert.equal(list.items[0].ownerId,customer.user.id);
  assert.equal((await act(pickup,'COMPLETE','NEW')).status,409);
  assert.equal((await req('admin/orders/'+pickup.id+'/actions','POST',{...payload('CONFIRM','NEW'),status:'COMPLETED'},operator)).status,400);
  assert.equal((await req('admin/orders/'+pickup.id+'/actions','POST',payload('CONFIRM','NEW'),operator,{Origin:'https://other.invalid'})).status,403);
  const confirm=payload('CONFIRM','NEW');
  const confirmations=await Promise.all([act(pickup,'CONFIRM','NEW',confirm),act(pickup,'CONFIRM','NEW',confirm)]);assert.ok(confirmations.every(r=>r.status===200),(await Promise.all(confirmations.map(async r=>[r.status,await r.clone().text()]))).join()+logs);
  let data=await detail(pickup);assert.equal(data.order.status,'CONFIRMED');assert.equal(data.history.length,1);assert.equal(data.history[0].actorId,operator.user.id);assert.deepEqual(await stock(),reserved);
  assert.equal((await act(pickup,'CONFIRM','NEW')).status,409);
  assert.equal((await act(pickup,'DISPATCH','CONFIRMED')).status,409);
  assert.equal((await act(pickup,'COMPLETE','CONFIRMED')).status,409);
  assert.equal((await act(pickup,'PREPARE_PICKUP','CONFIRMED')).status,200);
  const complete=payload('COMPLETE','READY_FOR_PICKUP');
  const completions=await Promise.all([act(pickup,'COMPLETE','READY_FOR_PICKUP',complete),act(pickup,'COMPLETE','READY_FOR_PICKUP',complete)]);assert.ok(completions.every(r=>r.status===200));
  data=await detail(pickup);assert.equal(data.order.status,'COMPLETED');assert.ok(data.order.completedAt);assert.deepEqual(data.order.allowedActions,[]);assert.equal(data.history.length,3);
  let now=await stock();for(let i=0;i<now.length;i++){assert.equal(now[i].on_hand,baseline[i].on_hand-(now[i].product_id===product?1:0));assert.equal(now[i].reserved,baseline[i].reserved);}
  await stop();await start();
  assert.equal((await act(pickup,'COMPLETE','READY_FOR_PICKUP',complete)).status,200);assert.deepEqual(await stock(),now);
  assert.equal((await act(pickup,'COMPLETE','COMPLETED')).status,409);
  assert.equal((await req('orders/'+pickup.id+'/cancel','POST',{},customer)).status,409);
  assert.equal((await act(pickup,'CANCEL','COMPLETED',{...complete,action:'CANCEL'})).status,409);
  assert.equal((await act(pickup,'CONFIRM','NEW',confirm)).status,200);assert.equal((await detail(pickup)).history.length,3);
  // Courier route excludes pickup readiness, retains the reserve during dispatch.
  const courier=await place('COURIER');const beforeCourier=await stock();
  assert.equal((await act(courier,'CONFIRM','NEW')).status,200);
  assert.equal((await act(courier,'PREPARE_PICKUP','CONFIRMED')).status,409);
  assert.equal((await act(courier,'DISPATCH','CONFIRMED')).status,200);assert.deepEqual(await stock(),beforeCourier);
  assert.equal((await req('orders/'+courier.id+'/cancel','POST',{},customer)).status,409);
  assert.equal((await act(courier,'CANCEL','OUT_FOR_DELIVERY')).status,409);
  assert.equal((await act(courier,'COMPLETE','OUT_FOR_DELIVERY')).status,200);
  // Admin cancellation releases once; customers share the same State rules.
  const cancelled=await place();const beforeCancel=await stock();const cancel=payload('CANCEL','NEW');
  const cancellations=await Promise.all([act(cancelled,'CANCEL','NEW',cancel),act(cancelled,'CANCEL','NEW',cancel)]);assert.ok(cancellations.every(r=>r.status===200));
  const afterCancel=await stock();for(let i=0;i<afterCancel.length;i++){assert.equal(afterCancel[i].on_hand,beforeCancel[i].on_hand);assert.equal(afterCancel[i].reserved,beforeCancel[i].reserved-(afterCancel[i].product_id===product?1:0));}
  assert.equal((await detail(cancelled)).history.length,1);
  const customerCancel=await place();await act(customerCancel,'CONFIRM','NEW');await act(customerCancel,'PREPARE_PICKUP','CONFIRMED');
  assert.equal((await req('orders/'+customerCancel.id+'/cancel','POST',{},other)).status,404);
  assert.equal((await req('orders/'+customerCancel.id+'/cancel','POST',{},customer)).status,200);
  assert.equal((await req('orders/'+customerCancel.id+'/cancel','POST',{},customer)).status,200);
  data=await detail(customerCancel);assert.equal(data.history.length,3);assert.equal(data.history[2].actorId,customer.user.id);
  // Completion versus customer cancellation: exactly one wins the locked transition.
  const raceOrder=await place();await act(raceOrder,'CONFIRM','NEW');await act(raceOrder,'PREPARE_PICKUP','CONFIRMED');const beforeRace=await stock();
  const race=await Promise.all([act(raceOrder,'COMPLETE','READY_FOR_PICKUP'),req('orders/'+raceOrder.id+'/cancel','POST',{},customer)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  data=await detail(raceOrder);const afterRace=await stock();for(let i=0;i<afterRace.length;i++){const target=afterRace[i].product_id===product;assert.equal(afterRace[i].reserved,beforeRace[i].reserved-(target?1:0));assert.equal(afterRace[i].on_hand,beforeRace[i].on_hand-(target&&data.order.status==='COMPLETED'?1:0));}assert.equal(data.history.length,3);
  // Reusing a request key on a different order cannot modify that order.
  const reused=await place();const beforeReuse=await stock();assert.equal((await act(reused,'CONFIRM','NEW',confirm)).status,409);assert.deepEqual(await stock(),beforeReuse);assert.equal((await detail(reused)).order.status,'NEW');
  // Any inconsistent line rolls back completion and all stock changes.
  const broken=await place('PICKUP',[{productId:product,quantity:1},{productId:id(104),quantity:1}]);await act(broken,'CONFIRM','NEW');await act(broken,'PREPARE_PICKUP','CONFIRMED');
  await db.query('UPDATE stock_items SET reserved=0 WHERE pharmacy_id=$1 AND product_id=$2',[ph,id(104)]);const beforeBroken=await stock();
  assert.equal((await act(broken,'COMPLETE','READY_FOR_PICKUP')).status,409);assert.deepEqual(await stock(),beforeBroken);data=await detail(broken);assert.equal(data.order.status,'READY_FOR_PICKUP');assert.equal(data.history.length,2);
  // Filters and the user view reflect durable status changes.
  list=await (await req('admin/orders?status=COMPLETED','GET',undefined,operator)).json();assert.ok(list.items.length>=2);assert.ok(list.items.every(i=>i.status==='COMPLETED'));
  const userView=await (await req('orders/'+pickup.id,'GET',undefined,customer)).json();assert.equal(userView.status,'COMPLETED');assert.deepEqual(userView.allowedActions,[]);
  // Local setup promotes only an explicitly named existing account in this isolated DB.
  execFileSync(process.execPath,[process.env.npm_execpath,'run','admin:grant','--','--email',other.user.email],{cwd:root,env,stdio:'pipe'});
  assert.equal((await req('admin/orders','GET',undefined,other)).status,200);
  assert.throws(()=>execFileSync(process.execPath,['dist/admin/grant-admin.js','--email','missing@example.invalid'],{cwd:resolve(root,'apps/api'),env,stdio:'pipe'}));
  await db.query("UPDATE users SET role='CUSTOMER' WHERE id=$1",[operator.user.id]);assert.equal((await req('admin/orders','GET',undefined,operator)).status,403);
 }finally{await stop();if(db)await db.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
});
