import 'reflect-metadata';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { validateEnvironment } from '../config/environment.js';
import { UserAccess1794700800000 } from './migrations/1794700800000-user-access.js';
const envPath = resolve(import.meta.dirname, '../../../../.env');
try { loadEnvFile(envPath); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const c = validateEnvironment(process.env);
const db = new DataSource({ type: 'postgres', host: String(c.DB_HOST), port: Number(c.DB_PORT),
  username: String(c.DB_USER), password: String(c.DB_PASSWORD), database: String(c.DB_NAME),
  synchronize: false, migrations: [UserAccess1794700800000] });
try {
  await db.initialize();
  const migrations = await db.runMigrations({ transaction: 'all' });
  console.log(`Applied migrations: ${migrations.length}`);
} finally { if (db.isInitialized) await db.destroy(); }
