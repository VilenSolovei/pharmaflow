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
test('customer account: profile, private prescriptions, version conflicts and safe order repeat',{timeout:90000},async()=>{
 const name='pharmaflow_account_test_'+randomBytes(6).toString('hex');
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
  assert.match(run('migrate'),/Applied migrations: 7/);assert.match(run('migrate'),/Applied migrations: 0/);run('seed');
  db=new pg.Client({...settings,database:name});await db.connect();await start();
  const one=await account('one@example.invalid'),two=await account('two@example.invalid'),operator=await account('operator@example.invalid');
  await db.query("UPDATE users SET role='ADMIN' WHERE id=$1",[operator.user.id]);
  const profile=async actor=>{const r=await req('account','GET',undefined,actor);assert.equal(r.status,200);return r.json();};
  assert.equal((await req('account')).status,401);assert.equal((await req('account/prescriptions')).status,401);
  assert.equal((await req('account','GET',undefined,one,{'X-PharmaFlow-User':two.user.id})).status,409);
  let p=await profile(one);assert.equal(p.name,'');assert.equal(p.phone,'');assert.equal(p.revision,0);assert.ok(!('password_hash' in p));
  assert.equal((await req('account','PATCH',{name:'Вілен Соловей',phone:'+380671234567',revision:0,role:'ADMIN'},one)).status,400);
  assert.equal((await req('account','PATCH',{name:'Вілен Соловей',phone:'   ---  ',revision:0},one)).status,400);
  assert.equal((await req('account','PATCH',{name:'Вілен Соловей',phone:'+380671234567',revision:0},one,{Origin:'https://other.invalid'})).status,403);
  const edits=await Promise.all([req('account','PATCH',{name:'Вілен Соловей',phone:'+380671234567',revision:0},one),req('account','PATCH',{name:'Інше ім’я',phone:'',revision:0},one)]);assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
  p=await profile(one);assert.equal(p.revision,1);assert.equal(p.email,one.user.email);assert.equal(p.role,'CUSTOMER');assert.equal(p.tier,'STANDARD');assert.equal((await profile(two)).revision,0);
  const createData={number:'RX-2026-01',issuedOn:'2024-02-29',medication:'Назва препарату',notes:'Примітка з <script>alert(1)</script>',requestId:crypto.randomUUID()};
  for(const issuedOn of ['2025-02-29','2026-02-30','0000-01-01','9999-12-31','2024-02-29T00:00:00Z'])assert.equal((await req('account/prescriptions','POST',{...createData,issuedOn},one)).status,400);
  assert.equal((await req('account/prescriptions','POST',{...createData,number:'  '},one)).status,400);
  assert.equal((await req('account/prescriptions','POST',{...createData,userId:two.user.id},one)).status,400);
  const recipes=await Promise.all([req('account/prescriptions','POST',createData,one),req('account/prescriptions','POST',createData,one)]);assert.ok(recipes.every(r=>r.status===201));let recipe=await recipes[0].json();assert.equal((await recipes[1].json()).id,recipe.id);assert.equal(recipe.issuedOn,'2024-02-29');assert.equal(recipe.notes,createData.notes);
  assert.equal((await req('account/prescriptions','POST',{...createData,medication:'Інша назва'},one)).status,409);
  for(const actor of [two,operator]){
   assert.equal((await req('account/prescriptions/'+recipe.id,'GET',undefined,actor)).status,404);
   assert.equal((await req('account/prescriptions/'+recipe.id,'PATCH',{number:'HACK',issuedOn:'2024-01-01',medication:'Чуже',notes:'',revision:0},actor)).status,404);
   assert.equal((await req('account/prescriptions/'+recipe.id,'DELETE',{revision:0},actor)).status,404);
   assert.equal((await (await req('account/prescriptions','GET',undefined,actor)).json()).total,0);
  }
  const changed={number:'RX-EDIT',issuedOn:'2025-01-10',medication:'Оновлена назва',notes:'Без зміни історії замовлень',revision:recipe.revision};
  const concurrent=await Promise.all([req('account/prescriptions/'+recipe.id,'PATCH',changed,one),req('account/prescriptions/'+recipe.id,'PATCH',changed,one)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  recipe=await (await req('account/prescriptions/'+recipe.id,'GET',undefined,one)).json();assert.equal(recipe.number,changed.number);assert.equal(recipe.revision,1);
  assert.equal((await req('account/prescriptions/'+recipe.id,'DELETE',{revision:0},one)).status,409);
  await stop();await start();assert.equal((await profile(one)).revision,1);assert.equal((await (await req('account/prescriptions/'+recipe.id,'GET',undefined,one)).json()).revision,1);
  for(let i=0;i<20;i++)assert.equal((await req('account/prescriptions','POST',{...createData,number:'PAGE-'+i,requestId:crypto.randomUUID()},one)).status,201);
  let list=await (await req('account/prescriptions','GET',undefined,one)).json();assert.equal(list.total,21);assert.equal(list.items.length,20);
  list=await (await req('account/prescriptions?page=2','GET',undefined,one)).json();assert.equal(list.items.length,1);assert.equal((await req('account/prescriptions?page=0','GET',undefined,one)).status,400);
  assert.equal((await req('account/prescriptions/'+recipe.id,'DELETE',{revision:1},one)).status,204);assert.equal((await req('account/prescriptions/'+recipe.id,'GET',undefined,one)).status,404);
  // Reorder copies items into a confirmed replacement cart, using current catalog data.
  const product=id(102),ph=id(21);let c=await cart(one);
  let r=await req('cart','PUT',{revision:c.revision,items:[{productId:product,quantity:2}]},one);assert.equal(r.status,200);c=await r.json();
  r=await req('orders/quote','POST',{revision:c.revision,pharmacyId:ph,mode:'PICKUP'},one);assert.equal(r.status,200);const quote=await r.json();
  r=await req('orders','POST',{quoteId:quote.id,requestId:crypto.randomUUID(),contact:{name:'Одержувач Тест',phone:'+380671234567',email:one.user.email}},one);assert.equal(r.status,201);const order=await r.json();
  await req('orders/'+order.id+'/cancel','POST',{},one);
  await db.query("UPDATE products SET price_minor=10000,name='Нова назва' WHERE id=$1",[product]);
  await req('cart/items','POST',{productId:id(104),quantity:1},one);const current=await cart(one);
  const stock=(await db.query('SELECT id,on_hand,reserved FROM stock_items ORDER BY id')).rows;
  const count=(await db.query('SELECT count(*)::int n FROM orders')).rows[0].n;
  for(const actor of [two,operator])assert.equal((await req('orders/'+order.id+'/repeat-preview','POST',{},actor)).status,404);
  r=await req('orders/'+order.id+'/repeat-preview','POST',{},one);assert.equal(r.status,200);const preview=await r.json();assert.equal(preview.totalMinor,20000);assert.equal(preview.items[0].name,'Нова назва');assert.equal(preview.replacesCount,1);assert.equal(preview.revision,current.revision);assert.equal(preview.canRepeat,true);assert.deepEqual(await cart(one),current);
  const repeat={revision:preview.revision,requestId:crypto.randomUUID()};
  assert.equal((await req('orders/'+order.id+'/repeat','POST',{...repeat,totalMinor:1},one)).status,400);
  assert.equal((await req('orders/'+order.id+'/repeat','POST',repeat,two)).status,404);
  assert.equal((await req('orders/'+order.id+'/repeat','POST',repeat,one,{Origin:'https://other.invalid'})).status,403);
  const repeated=await Promise.all([req('orders/'+order.id+'/repeat','POST',repeat,one),req('orders/'+order.id+'/repeat','POST',repeat,one)]);assert.ok(repeated.every(r=>r.status===200));let result=await repeated[0].json();assert.equal(result.cart.count,2);assert.equal(result.cart.items[0].productId,product);assert.equal(result.cart.totalMinor,20000);
  const repeatedCart=await cart(one);assert.equal(repeatedCart.revision,current.revision+1);
  await req('cart/items/'+product,'PATCH',{quantity:3},one);const later=await cart(one);
  r=await req('orders/'+order.id+'/repeat','POST',repeat,one);assert.equal(r.status,200);assert.deepEqual((await r.json()).cart,later);
  assert.equal((await req('orders/'+order.id+'/repeat','POST',{revision:preview.revision,requestId:crypto.randomUUID()},one)).status,409);assert.deepEqual(await cart(one),later);
  assert.equal((await req('orders/'+id(9999)+'/repeat','POST',repeat,one)).status,409);
  await db.query('UPDATE products SET active=false WHERE id=$1',[product]);
  const unavailable=await (await req('orders/'+order.id+'/repeat-preview','POST',{},one)).json();assert.equal(unavailable.canRepeat,false);assert.equal(unavailable.items[0].name,'Товар недоступний');
  assert.equal((await req('orders/'+order.id+'/repeat','POST',{revision:later.revision,requestId:crypto.randomUUID()},one)).status,404);
  assert.equal((await cart(one)).count,3);
  assert.deepEqual((await db.query('SELECT id,on_hand,reserved FROM stock_items ORDER BY id')).rows,stock);assert.equal((await db.query('SELECT count(*)::int n FROM orders')).rows[0].n,count);
  const historical=await (await req('orders/'+order.id,'GET',undefined,one)).json();assert.equal(historical.items[0].name,'Ібупрофен');assert.equal(historical.totalMinor,16400);
 }finally{await stop();if(db)await db.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
});
