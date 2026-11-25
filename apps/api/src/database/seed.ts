import 'reflect-metadata';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { validateEnvironment } from '../config/environment.js';
try { loadEnvFile(resolve(import.meta.dirname,'../../../../.env')); } catch(e) { if ((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
const c=validateEnvironment(process.env);
if(c.NODE_ENV==='production') throw Error('Demo seed is disabled in production.');
const db=new DataSource({type:'postgres',host:String(c.DB_HOST),port:Number(c.DB_PORT),username:String(c.DB_USER),password:String(c.DB_PASSWORD),database:String(c.DB_NAME),synchronize:false});
export const demoId=(n:number)=>'00000000-0000-4000-8000-'+n.toString().padStart(12,'0');
try {
 await db.initialize();
 await db.transaction(async manager=>{
  for(const [i,name] of ['Знеболювальні','Вітаміни','Медичні вироби'].entries()) await manager.query('INSERT INTO categories VALUES ($1,$2) ON CONFLICT DO NOTHING',[demoId(i+1),name]);
  for(const [i,name] of ['ДемоФарм','ВітаЛаб','МедТех'].entries()) await manager.query('INSERT INTO manufacturers VALUES ($1,$2) ON CONFLICT DO NOTHING',[demoId(i+11),name]);
  const pharmacies=[['Аптека Центр','Львів, пл. Ринок, 1',49.8419,24.0315],['Аптека Південь','Львів, вул. Стрийська, 30',49.815,24.024],['Аптека Захід','Львів, вул. Городоцька, 100',49.831,23.995]];
  for(const [i,p] of pharmacies.entries()) await manager.query('INSERT INTO pharmacies (id,name,address,latitude,longitude) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[demoId(i+21),...p]);
  const products=[['Парацетамол','MEDICINE',4500,false,1,11],['Ібупрофен','MEDICINE',8200,false,1,11],['Рецептурний препарат А','MEDICINE',15000,true,1,11],['Вітамін C','VITAMIN',12500,false,2,12],['Вітамін D','VITAMIN',24000,false,2,12],['Мультивітаміни','VITAMIN',32000,false,2,12],['Термометр','MEDICAL_DEVICE',18500,false,3,13],['Бинт стерильний','MEDICAL_DEVICE',2900,false,3,13]];
  for(const [i,p] of products.entries()) {
   await manager.query(`INSERT INTO products (id,name,description,type,price_minor,requires_prescription,category_id,manufacturer_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[demoId(i+101),p[0],'',p[1],p[2],p[3],demoId(Number(p[4])),demoId(Number(p[5]))]);
   for(let ph=0;ph<3;ph++)await manager.query('INSERT INTO stock_items (id,pharmacy_id,product_id,on_hand,reserved) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[demoId(1001+i*3+ph),demoId(ph+21),demoId(i+101),i===5?0:(i+ph)%4===0?0:10+i, i===5||((i+ph)%4===0)?0:2]);
  }
 });
 console.log('Demo catalog ready; existing records were not overwritten.');
}finally{if(db.isInitialized)await db.destroy();}
