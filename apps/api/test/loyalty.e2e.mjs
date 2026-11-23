import {readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DataSource} from 'typeorm';
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
test('loyalty: legacy migration, pricing snapshots, admin rules and atomic bonus awards',{timeout:90000},async()=>{
 const name='pharmaflow_loyalty_test_'+randomBytes(6).toString('hex');
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
  const migrationDir=resolve(root,'apps/api/dist/database/migrations');const oldMigrations=[];
  for(const file of (await readdir(migrationDir)).filter(n=>/^\d{13}.*\.js$/.test(n)&&n<'1795478400000').sort())oldMigrations.push(...Object.values(await import(pathToFileURL(resolve(migrationDir,file)).href)));
  const oldDb=new DataSource({type:'postgres',host:settings.host,port:settings.port,username:settings.user,password:settings.password,database:name,migrations:oldMigrations,synchronize:false});
  await oldDb.initialize();assert.equal((await oldDb.runMigrations()).length,6);await oldDb.destroy();run('seed');
  db=new pg.Client({...settings,database:name});await db.connect();
  const legacyUser=id(9001),legacyOrder=id(9012);
  await db.query("INSERT INTO users(id,email,password_hash) VALUES ($1,'legacy@example.invalid','legacy fixture')",[legacyUser]);
  await db.query("INSERT INTO order_quotes(id,user_id,pharmacy_id,mode,cart_revision,fingerprint,expires_at) VALUES ($1,$2,$3,'PICKUP',0,$4,now())",[id(9011),legacyUser,id(21),'0'.repeat(64)]);
  await db.query("INSERT INTO orders(id,user_id,quote_id,request_id,request_hash,pharmacy_id,pharmacy_name,pharmacy_address,mode,contact,subtotal_minor,delivery_minor,total_minor) VALUES ($1,$2,$3,$4,$5,$6,'Стара аптека','Стара адреса','PICKUP','{}',16400,0,16400)",[legacyOrder,legacyUser,id(9011),id(9013),'0'.repeat(64),id(21)]);
  await db.query("INSERT INTO order_items(id,order_id,product_id,name,price_minor,quantity,requires_prescription) VALUES ($1,$2,$3,'Ібупрофен',8200,2,false)",[id(9014),legacyOrder,id(102)]);
  assert.match(run('migrate'),/Applied migrations: 1/);assert.match(run('migrate'),/Applied migrations: 0/);
  const legacy=(await db.query('SELECT total_minor,discount_minor,bonus_rate_bps FROM orders WHERE id=$1',[legacyOrder])).rows[0];assert.equal(Number(legacy.total_minor),16400);assert.equal(Number(legacy.discount_minor),0);assert.equal(legacy.bonus_rate_bps,0);assert.equal((await db.query('SELECT count(*)::int n FROM loyalty_cards')).rows[0].n,1);
  await start();
  const standard=await account('standard@example.invalid'),social=await account('social@example.invalid'),premium=await account('premium@example.invalid'),operator=await account('operator@example.invalid');
  await db.query("UPDATE users SET role='ADMIN' WHERE id=$1",[operator.user.id]);
  const contact={name:'Одержувач Тест',phone:'+380671234567',email:'recipient@example.invalid'},address={city:'Львів',street:'Зелена',building:'15'};
  const eligible=id(102),ordinary=id(104),ph=id(21);
  const products=[{productId:eligible,quantity:2},{productId:ordinary,quantity:1}];
  async function quote(actor,mode='PICKUP',items=products){const c=await cart(actor);let r=await req('cart','PUT',{revision:c.revision,items},actor);assert.equal(r.status,200);const saved=await r.json();r=await req('orders/quote','POST',{revision:saved.revision,pharmacyId:ph,mode},actor);assert.equal(r.status,200,await r.clone().text());return r.json();}
  const create=(actor,q)=>req('orders','POST',{quoteId:q.id,requestId:crypto.randomUUID(),contact,...(q.mode==='COURIER'?{address}:{})},actor);
  const customers=async()=>{const r=await req('admin/loyalty/customers','GET',undefined,operator);assert.equal(r.status,200);return r.json();};
  async function tier(actor,value){const current=(await customers()).items.find(i=>i.id===actor.user.id);const r=await req('admin/loyalty/customers/'+actor.user.id,'PATCH',{tier:value,revision:current.revision},operator);assert.equal(r.status,200);}
  const card=async actor=>{const r=await req('loyalty','GET',undefined,actor);assert.equal(r.status,200);return r.json();};
  async function transition(order,action,status,requestId=crypto.randomUUID()){const r=await req('admin/orders/'+order.id+'/actions','POST',{action,expectedStatus:status,requestId},operator);assert.equal(r.status,200,await r.clone().text());return r.json();}
  async function ready(order){await transition(order,'CONFIRM','NEW');await transition(order,order.mode==='PICKUP'?'PREPARE_PICKUP':'DISPATCH','CONFIRMED');}
  assert.equal((await req('loyalty')).status,401);assert.equal((await req('admin/loyalty/customers','GET',undefined,standard)).status,403);
  assert.equal((await req('loyalty','GET',undefined,standard,{'X-PharmaFlow-User':social.user.id})).status,409);assert.equal((await req('loyalty?page=0','GET',undefined,standard)).status,400);
  assert.equal((await card(standard)).balanceMinor,0);assert.notEqual((await card(standard)).number,(await card(social)).number);
  assert.equal((await req('admin/loyalty/customers/'+standard.user.id,'PATCH',{tier:'PREMIUM',revision:0},standard)).status,403);
  assert.equal((await req('account','PATCH',{name:'Клієнт',phone:'',revision:0,tier:'PREMIUM'},standard)).status,400);
  let r=await req('admin/loyalty/products/'+eligible,'PATCH',{socialEligible:true,revision:0},operator);assert.equal(r.status,200);
  assert.equal((await req('admin/loyalty/products/'+eligible,'PATCH',{socialEligible:false,revision:0},operator)).status,409);
  await tier(social,'SOCIAL');await tier(premium,'PREMIUM');
  let q=await quote(social,'COURIER');assert.equal(q.subtotalMinor,28900);assert.equal(q.discountMinor,1640);assert.equal(q.totalMinor,33260);assert.equal(q.expectedBonusMinor,545);
  q=await quote(premium);assert.equal(q.discountMinor,1445);assert.equal(q.expectedBonusMinor,824);
  const oldTierQuote=await quote(standard);await tier(standard,'PREMIUM');assert.equal((await create(standard,oldTierQuote)).status,409);assert.equal((await cart(standard)).count,3);await tier(standard,'STANDARD');
  const now=Date.now();const promotion={name:'Акція 20%',discountBps:2000,startsAt:new Date(now-86400000).toISOString(),endsAt:new Date(now+86400000).toISOString(),active:true,productIds:[eligible],requestId:crypto.randomUUID()};
  assert.equal((await req('admin/loyalty/promotions','POST',promotion,standard)).status,403);
  for(const data of [{discountBps:10001},{discountBps:0},{endsAt:promotion.startsAt},{startsAt:'2026-01-01T00:00:00'},{startsAt:'0000-01-01T00:00:00Z'},{productIds:[eligible,eligible]},{productIds:[null]}])assert.equal((await req('admin/loyalty/promotions','POST',{...promotion,...data},operator)).status,400);
  assert.equal((await req('admin/loyalty/promotions','POST',promotion,operator,{Origin:'https://other.invalid'})).status,403);
  const duplicates=await Promise.all([req('admin/loyalty/promotions','POST',promotion,operator),req('admin/loyalty/promotions','POST',promotion,operator)]);assert.ok(duplicates.every(r=>r.status===201));const saved=(await duplicates[0].json()).promotion;assert.equal((await duplicates[1].json()).promotion.id,saved.id);
  assert.equal((await req('admin/loyalty/promotions','POST',{...promotion,name:'Інша акція'},operator)).status,409);
  for(const data of [{name:'Слабша акція',discountBps:500},{name:'Майбутня',discountBps:9000,startsAt:new Date(now+2*86400000).toISOString(),endsAt:new Date(now+3*86400000).toISOString()},{name:'Завершена',discountBps:8000,startsAt:new Date(now-3*86400000).toISOString(),endsAt:new Date(now-2*86400000).toISOString()}])assert.equal((await req('admin/loyalty/promotions','POST',{...promotion,...data,requestId:crypto.randomUUID()},operator)).status,201);
  q=await quote(social);assert.equal(q.discountMinor,3280);assert.equal(q.totalMinor,25620);assert.equal(q.items[0].discountSource,'Акція: Акція 20%');
  const beforePromoChange=await quote(standard);const update={...promotion,discountBps:3000,revision:saved.revision};delete update.requestId;
  const edits=await Promise.all([req('admin/loyalty/promotions/'+saved.id,'PATCH',update,operator),req('admin/loyalty/promotions/'+saved.id,'PATCH',update,operator)]);assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
  assert.equal((await create(standard,beforePromoChange)).status,409);
  q=await quote(premium,'COURIER');assert.equal(q.discountMinor,5545);assert.equal(q.totalMinor,29355);assert.equal(q.expectedBonusMinor,701);
  r=await create(premium,q);assert.equal(r.status,201);const order=await r.json();assert.equal(order.bonusRateBps,300);assert.equal((await card(premium)).balanceMinor,0);
  // Later rule/category/catalog changes leave the historical price and bonus rate intact.
  await tier(premium,'STANDARD');const current=(await (await req('admin/loyalty/promotions','GET',undefined,operator)).json()).items.find(i=>i.id===saved.id);
  r=await req('admin/loyalty/promotions/'+saved.id,'PATCH',{...update,revision:current.revision,active:false},operator);assert.equal(r.status,200);
  await db.query("UPDATE products SET price_minor=9000,name='Оновлена назва' WHERE id=$1",[eligible]);
  const historical=await (await req('orders/'+order.id,'GET',undefined,premium)).json();assert.equal(historical.totalMinor,29355);assert.equal(historical.discountMinor,5545);assert.equal(historical.items[0].name,'Ібупрофен');assert.equal(historical.expectedBonusMinor,701);
  await ready(order);assert.equal((await card(premium)).balanceMinor,0);
  const key=crypto.randomUUID(),body={action:'COMPLETE',expectedStatus:'OUT_FOR_DELIVERY',requestId:key};
  const completions=await Promise.all([req('admin/orders/'+order.id+'/actions','POST',body,operator),req('admin/orders/'+order.id+'/actions','POST',body,operator)]);assert.ok(completions.every(r=>r.status===200));let wallet=await card(premium);assert.equal(wallet.balanceMinor,701);assert.equal(wallet.total,1);assert.equal(wallet.items[0].amountMinor,701);assert.equal((await card(social)).balanceMinor,0);
  await stop();await start();assert.equal((await req('admin/orders/'+order.id+'/actions','POST',body,operator)).status,200);assert.equal((await card(premium)).balanceMinor,701);
  assert.equal((await req('admin/orders/'+order.id+'/actions','POST',{...body,requestId:crypto.randomUUID(),expectedStatus:'COMPLETED'},operator)).status,409);
  // Cancellation earns nothing; independent completions add exact amounts to one card.
  q=await quote(premium,'PICKUP',[{productId:ordinary,quantity:1}]);r=await create(premium,q);const cancelled=await r.json();assert.equal((await req('orders/'+cancelled.id+'/cancel','POST',{},premium)).status,200);assert.equal((await card(premium)).balanceMinor,701);
  const more=[];for(let i=0;i<2;i++){q=await quote(premium,'PICKUP',[{productId:ordinary,quantity:1}]);r=await create(premium,q);const o=await r.json();await ready(o);more.push(o);}
  await Promise.all(more.map(o=>transition(o,'COMPLETE','READY_FOR_PICKUP')));wallet=await card(premium);assert.equal(wallet.balanceMinor,1201);assert.equal(wallet.total,3);assert.equal(Number((await db.query('SELECT sum(amount_minor) n FROM bonus_entries WHERE user_id=$1',[premium.user.id])).rows[0].n),wallet.balanceMinor);
  // A ledger/balance failure rolls back the state transition and stock consumption too.
  q=await quote(premium,'PICKUP',[{productId:ordinary,quantity:1}]);r=await create(premium,q);const blocked=await r.json();await ready(blocked);const stocks=(await db.query('SELECT id,on_hand,reserved FROM stock_items ORDER BY id')).rows;
  await db.query('UPDATE loyalty_cards SET balance_minor=9007199254740991 WHERE user_id=$1',[premium.user.id]);const failedKey=crypto.randomUUID();r=await req('admin/orders/'+blocked.id+'/actions','POST',{action:'COMPLETE',expectedStatus:'READY_FOR_PICKUP',requestId:failedKey},operator);assert.equal(r.status,500);assert.deepEqual((await db.query('SELECT id,on_hand,reserved FROM stock_items ORDER BY id')).rows,stocks);assert.equal((await (await req('orders/'+blocked.id,'GET',undefined,premium)).json()).status,'READY_FOR_PICKUP');assert.equal((await db.query('SELECT count(*)::int n FROM bonus_entries WHERE order_id=$1',[blocked.id])).rows[0].n,0);
  await db.query('UPDATE loyalty_cards SET balance_minor=1201 WHERE user_id=$1',[premium.user.id]);await transition(blocked,'COMPLETE','READY_FOR_PICKUP',failedKey);assert.equal((await card(premium)).balanceMinor,1451);
  // A full discount generates no bonus, and legacy pre-loyalty orders do not gain a new rate.
  r=await req('admin/loyalty/promotions','POST',{...promotion,name:'Повна знижка',discountBps:10000,productIds:[ordinary],requestId:crypto.randomUUID()},operator);assert.equal(r.status,201);
  q=await quote(premium,'COURIER',[{productId:ordinary,quantity:1}]);assert.equal(q.totalMinor,6000);assert.equal(q.expectedBonusMinor,0);r=await create(premium,q);const free=await r.json();await ready(free);await transition(free,'COMPLETE','OUT_FOR_DELIVERY');assert.equal((await card(premium)).balanceMinor,1451);
  const oldOrder={id:legacyOrder,mode:'PICKUP'};await ready(oldOrder);await transition(oldOrder,'COMPLETE','READY_FOR_PICKUP');assert.equal((await db.query('SELECT balance_minor FROM loyalty_cards WHERE user_id=$1',[legacyUser])).rows[0].balance_minor,'0');
  await assert.rejects(db.query('INSERT INTO bonus_entries(id,user_id,order_id,amount_minor) VALUES ($1,$2,$3,1)',[crypto.randomUUID(),premium.user.id,order.id]));
  await assert.rejects(db.query('UPDATE orders SET total_minor=total_minor+1 WHERE id=$1',[order.id]));
  await db.query('UPDATE products SET active=false WHERE id=$1',[eligible]);
  r=await req('admin/loyalty/promotions','POST',promotion,operator);assert.equal(r.status,201);assert.equal((await r.json()).promotion.id,saved.id);
  assert.equal((await req('admin/loyalty/promotions','POST',{...promotion,requestId:crypto.randomUUID()},operator)).status,404);
  await db.query("UPDATE users SET role='CUSTOMER' WHERE id=$1",[operator.user.id]);assert.equal((await req('admin/loyalty/customers','GET',undefined,operator)).status,403);
 }finally{await stop();if(db)await db.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
});
