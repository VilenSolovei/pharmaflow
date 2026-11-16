import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';
const root=resolve(import.meta.dirname,'../../..');
try{process.loadEnvFile(resolve(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(process.env.NODE_ENV==='production')throw Error('Use only a local development PostgreSQL for integration tests.');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('catalog filtering, stock integrity, nearest pharmacies and demo seed', {timeout:60000},async()=>{
 const name='pharmaflow_catalog_test_'+randomBytes(6).toString('hex');
 const config={host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD};
 const admin=new pg.Client({...config,database:process.env.DB_NAME});await admin.connect();
 let db,child,created=false;let logs='';
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const env={...process.env,NODE_ENV:'test',DB_NAME:name,API_PORT:String(port)};
 const run=file=>execFileSync(process.execPath,['dist/database/'+file+'.js'],{cwd:resolve(root,'apps/api'),env,encoding:'utf8'});
 const get=path=>fetch(`http://127.0.0.1:${port}/api/`+path);
 const list=async query=>{const r=await get('products?'+query);assert.equal(r.status,200);return r.json();};
 try{
  await admin.query(`CREATE DATABASE "${name}"`);created=true;
  assert.match(run('migrate'),/Applied migrations: 2/);assert.match(run('migrate'),/Applied migrations: 0/);
  run('seed');run('seed');db=new pg.Client({...config,database:name});await db.connect();
  child=spawn(process.execPath,['dist/main.js'],{cwd:resolve(root,'apps/api'),env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(logs);try{if((await get('health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const all=await list('limit=48');assert.equal(all.total,8);assert.equal(all.items.length,8);
  assert.equal((await list('q='+encodeURIComponent('ПАРАЦЕТАМОЛ'))).total,1);
  assert.equal((await list('q='+encodeURIComponent('ДемоФарм'))).total,3);
  assert.equal((await list('q='+encodeURIComponent('Вітаміни'))).total,3);
  for(const q of ['%','_','\\',"' OR true --"])assert.equal((await list('q='+encodeURIComponent(q))).total,0);
  assert.equal((await list('categoryId='+id(2))).total,3);
  assert.equal((await list('manufacturerId='+id(13))).total,2);
  assert.equal((await list('type=VITAMIN&minPrice=120&maxPrice=250')).total,2);
  assert.equal((await list('requiresPrescription=true')).total,1);
  assert.equal((await list('requiresPrescription=false')).total,7);
  assert.equal((await list('inStock=false')).total,1);
  assert.equal((await list('inStock=true')).total,7);
  const selected=await list('pharmacyId='+id(21));assert.equal(selected.items.find(p=>p.id===id(102)).available,9);
  const asc=await list('sort=price_asc&limit=48');assert.equal(asc.items[0].priceMinor,2900);
  const desc=await list('sort=price_desc&limit=48');assert.equal(desc.items[0].priceMinor,32000);
  const a=await list('limit=2&page=1'),b=await list('limit=2&page=2');assert.equal(a.items.length,2);assert.equal(new Set([...a.items,...b.items].map(p=>p.id)).size,4);
  assert.equal((await list('page=100')).total,8);assert.equal((await list('page=100')).items.length,0);
  for(const query of ['minPrice=100&maxPrice=10','inStock=garbage','sort=random','pharmacyId=broken','limit=999','page=-1','minPrice=-1','latitude=2'])assert.equal((await get('products?'+query)).status,400);
  assert.equal((await get('products/broken')).status,400);assert.equal((await get('products/'+id(999))).status,404);
  const detail=await (await get('products/'+id(102))).json();assert.equal(detail.pharmacies.length,3);assert.equal(detail.pharmacies.find(p=>p.id===id(21)).available,9);
  const near=await (await get('pharmacies?latitude=49.8419&longitude=24.0315')).json();assert.equal(near[0].id,id(21));assert.equal(near[0].distanceKm,0);
  assert.equal((await get('pharmacies?latitude=99&longitude=20')).status,400);assert.equal((await get('pharmacies?latitude=20')).status,400);
  await db.query('UPDATE stock_items SET reserved=on_hand WHERE pharmacy_id=$1',[id(21)]);
  assert.equal((await list('pharmacyId='+id(21)+'&inStock=true')).total,0);
  await assert.rejects(db.query('UPDATE stock_items SET reserved=on_hand+1 WHERE product_id=$1',[id(102)]));
  await db.query('UPDATE products SET active=false WHERE id=$1',[id(102)]);assert.equal((await get('products/'+id(102))).status,404);
  await db.query('UPDATE pharmacies SET active=false WHERE id=$1',[id(22)]);
  assert.equal((await (await get('pharmacies')).json()).length,2);
  const filters=await (await get('catalog/filters')).json();assert.equal(filters.categories.length,3);assert.equal(filters.manufacturers.length,3);
  await db.query('UPDATE products SET price_minor=7777 WHERE id=$1',[id(101)]);run('seed');assert.equal((await db.query('SELECT price_minor FROM products WHERE id=$1',[id(101)])).rows[0].price_minor,7777);
 }finally{
  if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
  if(db)await db.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();
 }
});
