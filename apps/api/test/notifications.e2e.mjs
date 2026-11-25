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
test('notifications: durable events, observer retries, subscriptions, promotions and recurring reminders',{timeout:150000},async()=>{
 const name='pharmaflow_notifications_test_'+randomBytes(6).toString('hex');
 const settings={host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD};
 const admin=new pg.Client({...settings,database:process.env.DB_NAME});await admin.connect();
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const env={...process.env,NODE_ENV:'test',DB_NAME:name,API_PORT:String(port),NOTIFICATION_WORKER_ENABLED:'false'};
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
  assert.match(run('migrate'),/Applied migrations: 9/);assert.match(run('migrate'),/Applied migrations: 0/);run('seed');
  db=new pg.Client({...settings,database:name});await db.connect();await start();
  const one=await account('watcher-one@example.invalid'),two=await account('watcher-two@example.invalid'),buyer=await account('buyer@example.invalid'),operator=await account('operator@example.invalid');
  await db.query("UPDATE users SET role='ADMIN' WHERE id=$1",[operator.user.id]);
  const product=id(102),ph=id(21),contact={name:'Одержувач Тест',phone:'+380671234567',email:buyer.user.email};
  const worker=()=>JSON.parse(execFileSync(process.execPath,['dist/notifications/run.js'],{cwd:resolve(root,'apps/api'),env,encoding:'utf8'}).trim());
  async function workerAsync(){const p=spawn(process.execPath,['dist/notifications/run.js'],{cwd:resolve(root,'apps/api'),env,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);const [code]=await once(p,'exit');assert.equal(code,0,err);return JSON.parse(out.trim());}
  function scheduleOnly(){return execFileSync(process.execPath,['--input-type=module','-e',"import {NestFactory} from '@nestjs/core';import {AppModule} from './dist/app.module.js';import {ReminderService} from './dist/notifications/reminder.service.js';const app=await NestFactory.createApplicationContext(AppModule,{logger:false});try{console.log(await app.get(ReminderService).scheduleDue())}finally{await app.close()}"],{cwd:resolve(root,'apps/api'),env,encoding:'utf8'});}
  const inbox=async actor=>{const r=await req('notifications','GET',undefined,actor);assert.equal(r.status,200);return r.json();};
  async function prefs(actor,opt){const p=await (await req('notifications/preferences','GET',undefined,actor)).json();const r=await req('notifications/preferences','PATCH',{promotionOptIn:opt,revision:p.revision},actor);assert.equal(r.status,200);return r.json();}
  const subscribe=actor=>req('notifications/subscriptions','POST',{productId:product,pharmacyId:ph},actor);
  async function order(){await db.query('UPDATE stock_items SET on_hand=2,reserved=0 WHERE product_id=$1 AND pharmacy_id=$2',[product,ph]);let c=await cart(buyer);let r=await req('cart','PUT',{revision:c.revision,items:[{productId:product,quantity:2}]},buyer);c=await r.json();r=await req('orders/quote','POST',{revision:c.revision,pharmacyId:ph,mode:'PICKUP'},buyer);assert.equal(r.status,200);const quote=await r.json();r=await req('orders','POST',{quoteId:quote.id,requestId:crypto.randomUUID(),contact},buyer);assert.equal(r.status,201);return r.json();}
  assert.equal((await req('notifications')).status,401);assert.equal((await req('notifications/subscriptions')).status,401);
  assert.equal((await req('notifications','GET',undefined,one,{'X-PharmaFlow-User':two.user.id})).status,409);
  assert.equal((await req('notifications?page=0','GET',undefined,one)).status,400);
  assert.equal((await req('notifications/subscriptions','POST',{productId:product,pharmacyId:ph,userId:two.user.id},one)).status,400);
  assert.equal((await req('notifications/subscriptions','POST',{productId:product,pharmacyId:ph},one,{Origin:'https://other.invalid'})).status,403);
  const purchased=await order();assert.equal((await subscribe(one)).status,200);assert.equal((await subscribe(one)).status,200);assert.equal((await subscribe(two)).status,200);
  let subscriptions=await (await req('notifications/subscriptions','GET',undefined,one)).json();assert.equal(subscriptions.items.length,1);
  assert.equal((await req('notifications/subscriptions/'+subscriptions.items[0].id,'DELETE',undefined,two)).status,404);
  const secondSub=(await (await req('notifications/subscriptions','GET',undefined,two)).json()).items[0];assert.equal((await req('notifications/subscriptions/'+secondSub.id,'DELETE',undefined,two)).status,200);
  assert.equal((await req('orders/'+purchased.id+'/cancel','POST',{},buyer)).status,200);
  assert.equal((await db.query("SELECT count(*)::int n FROM outbox_events WHERE type='STOCK_AVAILABLE'")).rows[0].n,1);assert.equal((await inbox(one)).total,0);
  // A subscription made after the event does not receive an old notification.
  await subscribe(two);assert.equal(worker().processed,1);let messages=await inbox(one);assert.equal(messages.total,1);assert.equal(messages.items[0].kind,'AVAILABILITY');assert.equal((await inbox(two)).total,0);
  const availability=messages.items[0];
  for(const actor of [two,operator])assert.equal((await req('notifications/'+availability.id+'/read','PATCH',{read:true},actor)).status,404);
  assert.equal((await req('notifications/'+availability.id+'/read','PATCH',{read:true},one)).status,200);assert.equal((await (await req('notifications/summary','GET',undefined,one)).json()).unreadCount,0);
  assert.equal((await req('notifications/'+availability.id+'/read','PATCH',{read:false},one)).status,200);
  // Recovery after delivery but before marking the event processed remains duplicate-free.
  await db.query(`UPDATE outbox_events SET processed_at=NULL,leased_until=clock_timestamp()-interval '1 second',lease_token=$1 WHERE id=(SELECT event_id FROM notifications WHERE id=$2)`,[crypto.randomUUID(),availability.id]);worker();assert.equal((await inbox(one)).total,1);
  const bad=crypto.randomUUID();await db.query("INSERT INTO outbox_events(id,type,dedupe_key,payload) VALUES ($1,'STOCK_AVAILABLE','bad-event','{}')",[bad]);assert.equal(worker().failed,1);assert.equal((await db.query('SELECT processed_at FROM outbox_events WHERE id=$1',[bad])).rows[0].processed_at,null);
  await db.query('UPDATE outbox_events SET payload=$2,available_at=clock_timestamp() WHERE id=$1',[bad,{productId:product,pharmacyId:ph}]);assert.equal(worker().processed,1);assert.equal((await inbox(one)).total,2);assert.equal((await inbox(two)).total,1);
  // A producer failure rolls back cancellation and reservation release together.
  const rollbackOrder=await order();await db.query("CREATE FUNCTION reject_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.dedupe_key LIKE 'cancel:%' THEN RAISE EXCEPTION 'test outbox failure'; END IF; RETURN NEW; END $$");await db.query('CREATE TRIGGER reject_test_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_test_event()');
  assert.equal((await req('orders/'+rollbackOrder.id+'/cancel','POST',{},buyer)).status,500);assert.equal((await (await req('orders/'+rollbackOrder.id,'GET',undefined,buyer)).json()).status,'NEW');assert.equal((await db.query('SELECT reserved FROM stock_items WHERE product_id=$1 AND pharmacy_id=$2',[product,ph])).rows[0].reserved,2);
  await db.query('DROP TRIGGER reject_test_event ON outbox_events');await db.query('DROP FUNCTION reject_test_event()');assert.equal((await req('orders/'+rollbackOrder.id+'/cancel','POST',{},buyer)).status,200);worker();
  // Only current subscribers who opted in before publication receive a promotion.
  const now=Date.now(),promo={name:'Сезонна пропозиція',discountBps:1000,startsAt:new Date(now-60000).toISOString(),endsAt:new Date(now+86400000).toISOString(),active:true,productIds:[product],requestId:crypto.randomUUID()};
  await prefs(one,true);let r=await req('admin/loyalty/promotions','POST',promo,operator);assert.equal(r.status,201);let saved=(await r.json()).promotion;await prefs(two,true);worker();
  const countKind=async(actor,kind)=>(await inbox(actor)).items.filter(i=>i.kind===kind).length;
  assert.equal(await countKind(one,'PROMOTION'),1);assert.equal(await countKind(two,'PROMOTION'),0);
  let edit={name:promo.name+' оновлена',discountBps:1500,startsAt:promo.startsAt,endsAt:promo.endsAt,active:true,productIds:promo.productIds,revision:saved.revision};r=await req('admin/loyalty/promotions/'+saved.id,'PATCH',edit,operator);assert.equal(r.status,200);saved=(await r.json()).promotion;worker();assert.equal(await countKind(one,'PROMOTION'),1);
  r=await req('admin/loyalty/promotions/'+saved.id,'PATCH',{...edit,active:false,revision:saved.revision},operator);saved=(await r.json()).promotion;r=await req('admin/loyalty/promotions/'+saved.id,'PATCH',{...edit,active:true,revision:saved.revision},operator);assert.equal(r.status,200);worker();assert.equal(await countKind(one,'PROMOTION'),2);assert.equal(await countKind(two,'PROMOTION'),1);
  await prefs(two,false);const scheduled={...promo,name:'Майбутня акція',startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),requestId:crypto.randomUUID()};r=await req('admin/loyalty/promotions','POST',scheduled,operator);const future=(await r.json()).promotion;await prefs(two,true);assert.equal(worker().processed,0);
  r=await req('admin/loyalty/promotions/'+future.id,'PATCH',{name:scheduled.name,discountBps:scheduled.discountBps,startsAt:new Date().toISOString(),endsAt:scheduled.endsAt,active:true,productIds:scheduled.productIds,revision:future.revision},operator);assert.equal(r.status,200);worker();assert.equal(await countKind(two,'PROMOTION'),2);
  // Overdue reminders collapse missed periods and survive API/worker restarts.
  const reminder={productId:product,nextAt:new Date(Date.now()-10*86400000).toISOString(),intervalDays:3,active:true,requestId:crypto.randomUUID()};
  for(const data of [{intervalDays:0},{intervalDays:366},{nextAt:'0000-01-01T00:00:00Z'},{nextAt:'2026-02-30T00:00:00Z'}])assert.equal((await req('notifications/reminders','POST',{...reminder,...data},one)).status,400);
  const creates=await Promise.all([req('notifications/reminders','POST',reminder,one),req('notifications/reminders','POST',reminder,one)]);assert.ok(creates.every(r=>r.status===201));assert.equal((await db.query('SELECT count(*)::int n FROM medication_reminders')).rows[0].n,1);
  assert.equal((await req('notifications/reminders','POST',{...reminder,intervalDays:4},one)).status,409);
  await stop();const parallel=await Promise.all([workerAsync(),workerAsync()]);assert.equal(parallel.reduce((sum,r)=>sum+r.scheduled,0),1);await start();assert.equal(await countKind(one,'REMINDER'),1);worker();assert.equal(await countKind(one,'REMINDER'),1);
  let rem=(await (await req('notifications/reminders','GET',undefined,one)).json()).items[0];assert.ok(new Date(rem.nextAt)>new Date());
  for(const actor of [two,operator]){
   assert.equal((await req('notifications/reminders/'+rem.id,'PATCH',{productId:product,nextAt:rem.nextAt,intervalDays:3,active:false,revision:rem.revision},actor)).status,404);
   assert.equal((await req('notifications/reminders/'+rem.id,'DELETE',{revision:rem.revision},actor)).status,404);
  }
  const next={productId:product,nextAt:new Date(Date.now()-86400000).toISOString(),intervalDays:2,active:true,revision:rem.revision};r=await req('notifications/reminders/'+rem.id,'PATCH',next,one);assert.equal(r.status,200);assert.equal((await req('notifications/reminders/'+rem.id,'PATCH',next,one)).status,409);
  scheduleOnly();rem=(await (await req('notifications/reminders','GET',undefined,one)).json()).items[0];
  r=await req('notifications/reminders/'+rem.id,'PATCH',{productId:product,nextAt:rem.nextAt,intervalDays:2,active:false,revision:rem.revision},one);assert.equal(r.status,200);worker();assert.equal(await countKind(one,'REMINDER'),1);
  rem=(await (await req('notifications/reminders','GET',undefined,one)).json()).items[0];assert.equal((await req('notifications/reminders/'+rem.id,'DELETE',{revision:rem.revision-1},one)).status,409);assert.equal((await req('notifications/reminders/'+rem.id,'DELETE',{revision:rem.revision},one)).status,200);
  // Preferences use optimistic versions; all-read affects only the owner.
  const pref=await (await req('notifications/preferences','GET',undefined,one)).json();const changes=await Promise.all([req('notifications/preferences','PATCH',{promotionOptIn:false,revision:pref.revision},one),req('notifications/preferences','PATCH',{promotionOptIn:false,revision:pref.revision},one)]);assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
  const twoUnread=(await inbox(two)).unreadCount;assert.equal((await req('notifications/read-all','POST',{},one)).status,200);assert.equal((await inbox(one)).unreadCount,0);assert.equal((await inbox(two)).unreadCount,twoUnread);
  for(let i=0;i<21;i++){const eventId=crypto.randomUUID();await db.query("INSERT INTO outbox_events(id,type,dedupe_key,payload,processed_at) VALUES ($1,'REMINDER_DUE',$2,'{}',clock_timestamp())",[eventId,'page-'+i]);await db.query("INSERT INTO notifications(id,user_id,event_id,kind,title,body) VALUES ($1,$2,$3,'REMINDER','Перевірка сторінок','Запис')",[crypto.randomUUID(),one.user.id,eventId]);}
  const filtered=await (await req('notifications?unreadOnly=true','GET',undefined,one)).json();assert.equal(filtered.total,21);assert.equal(filtered.items.length,20);assert.equal((await (await req('notifications?page=2&unreadOnly=true','GET',undefined,one)).json()).items.length,1);
 }finally{await stop();if(db)await db.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
});
