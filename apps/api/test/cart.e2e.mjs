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
test('cart ownership, concurrent writes, limits, import conflicts and persistence',{timeout:90000},async()=>{
 const name='pharmaflow_cart_test_'+randomBytes(6).toString('hex');
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
  assert.match(run('migrate'),/Applied migrations: 9/);assert.match(run('migrate'),/Applied migrations: 0/);run('seed');
  db=new pg.Client({...settings,database:name});await db.connect();await start();
  assert.equal((await req('cart')).status,401);
  let r=await req('cart/preview','POST',{items:[{productId:id(102),quantity:2}]});assert.equal(r.status,200);let body=await r.json();assert.equal(body.totalMinor,16400);assert.equal(body.ownerId,null);
  assert.equal((await req('cart/preview','POST',{items:[null]})).status,400);
  assert.equal((await req('cart/preview','POST',{items:[{productId:id(102),quantity:2,priceMinor:1}]})).status,400);
  assert.equal((await req('cart/preview','POST',{items:[{productId:id(102),quantity:1},{productId:id(102).toUpperCase(),quantity:2}]})).status,400);
  assert.equal((await req('cart/preview','POST',{items:[{productId:id(102),quantity:2}]},undefined,{Origin:'https://other.invalid'})).status,403);
  const one=await account('one@example.invalid'),two=await account('two@example.invalid');
  assert.equal((await cart(one)).id,null);assert.equal((await db.query('SELECT count(*)::int count FROM carts')).rows[0].count,0);
  const before=(await db.query('SELECT sum(on_hand)::int total,sum(reserved)::int reserved FROM stock_items')).rows[0];
  assert.equal((await req('cart/items','POST',{productId:id(9999),quantity:1},one)).status,404);
  assert.equal((await db.query('SELECT count(*)::int count FROM carts')).rows[0].count,0);
  assert.equal((await req('cart/items','POST',{productId:id(102),quantity:1},one,{Origin:'https://other.invalid'})).status,403);
  assert.equal((await req('cart/items','POST',{productId:id(102),quantity:1},two,{'X-PharmaFlow-User':one.user.id})).status,409);
  for(const quantity of [0,-1,100,1.2,'2'])assert.equal((await req('cart/items','POST',{productId:id(102),quantity},one)).status,400);
  const concurrent=await Promise.all(Array.from({length:10},()=>req('cart/items','POST',{productId:id(102),quantity:1},one)));
  assert.ok(concurrent.every(r=>r.status===200));body=await cart(one);assert.equal(body.items.length,1);assert.equal(body.items[0].quantity,10);assert.equal(body.count,10);assert.equal(body.totalMinor,82000);
  assert.equal((await db.query('SELECT count(*)::int count FROM carts')).rows[0].count,1);
  assert.equal((await cart(two)).items.length,0);
  assert.equal((await req('cart/items/'+id(102),'PATCH',{quantity:1},two)).status,404);
  await req('cart/items/'+id(102),'DELETE',undefined,two);assert.equal((await cart(one)).count,10);
  assert.equal((await req('cart/items','POST',{productId:id(102),quantity:90},one)).status,400);assert.equal((await cart(one)).count,10);
  await db.query('UPDATE products SET price_minor=9000 WHERE id=$1',[id(102)]);assert.equal((await cart(one)).totalMinor,90000);
  await stop();await start();assert.equal((await cart(one)).count,10);
  const revision=(await cart(one)).revision;
  const replacements=await Promise.all([req('cart','PUT',{revision,items:[{productId:id(101),quantity:2}]},one),req('cart','PUT',{revision,items:[{productId:id(103),quantity:3}]},one)]);
  assert.deepEqual(replacements.map(r=>r.status).sort(),[200,409]);assert.equal((await cart(one)).items.length,1);
  const current=await cart(one);
  assert.equal((await req('cart','PUT',{revision:current.revision,items:[{productId:id(9999),quantity:1}]},one)).status,404);
  assert.deepEqual(await cart(one),current);
  await db.query('UPDATE products SET active=false WHERE id=$1',[current.items[0].productId]);
  assert.equal((await cart(one)).items[0].active,false);
  assert.equal((await req('cart/items','POST',{productId:current.items[0].productId,quantity:1},one)).status,404);
  body=await (await req('cart/preview','POST',{items:[{productId:current.items[0].productId,quantity:1}]})).json();assert.equal(body.items[0].priceMinor,0);assert.equal(body.items[0].name,'Товар недоступний');
  await req('cart/items/'+current.items[0].productId,'DELETE',undefined,one);const empty=await cart(one);assert.equal(empty.count,0);
  await req('cart/items/'+current.items[0].productId,'DELETE',undefined,one);assert.equal((await cart(one)).revision,empty.revision);
  const hundred=Array.from({length:100},(_,i)=>({productId:id(2000+i),quantity:1}));
  for(let i=0;i<=100;i++)await db.query(`INSERT INTO products(id,name,description,type,price_minor,requires_prescription,category_id,manufacturer_id) VALUES ($1,$2,'','VITAMIN',100,false,$3,$4)`,[id(2000+i),'Limit fixture '+i,id(2),id(12)]);
  r=await req('cart','PUT',{revision:empty.revision,items:hundred},one);assert.equal(r.status,200);
  assert.equal((await req('cart/items','POST',{productId:id(2100),quantity:1},one)).status,400);
  assert.equal((await req('cart/preview','POST',{items:[...hundred,{productId:id(2100),quantity:1}]})).status,400);
  await assert.rejects(db.query('UPDATE cart_items SET quantity=0 WHERE cart_id=$1',[(await cart(one)).id]));
  assert.deepEqual((await db.query('SELECT sum(on_hand)::int total,sum(reserved)::int reserved FROM stock_items')).rows[0],before);
 }finally{await stop();if(db)await db.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
});
