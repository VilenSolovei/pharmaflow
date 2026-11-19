import 'reflect-metadata';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { isEmail } from 'class-validator';
import { validateEnvironment } from '../config/environment.js';
try{loadEnvFile(resolve(import.meta.dirname,'../../../../.env'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const c=validateEnvironment(process.env);
if(c.NODE_ENV==='production')throw Error('This local setup command is disabled in production.');
const args=process.argv.slice(2);
const email=args[1]?.trim().toLowerCase();
if(args.length!==2||args[0]!=='--email'||!email||!isEmail(email))throw Error('Usage: npm run admin:grant -- --email existing-account@example.com');
const db=new DataSource({type:'postgres',host:String(c.DB_HOST),port:Number(c.DB_PORT),username:String(c.DB_USER),password:String(c.DB_PASSWORD),database:String(c.DB_NAME),synchronize:false});
try{
  await db.initialize();
  const rows:{id:string}[]=await db.query("WITH changed AS (UPDATE users SET role='ADMIN' WHERE email=$1 RETURNING id) SELECT id FROM changed",[email]);
  if(!rows.length)throw Error('Account not found. Register the account through the website first.');
  console.log('Administrator access granted to the selected existing account. Sign in again or refresh your account.');
}finally{if(db.isInitialized)await db.destroy();}
