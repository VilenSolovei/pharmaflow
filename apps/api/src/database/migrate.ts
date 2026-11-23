import { Loyalty1795478400000 } from './migrations/1795478400000-loyalty.js';
import { CustomerAccount1795219200000 } from './migrations/1795219200000-customer-account.js';
import { OrderProcessing1795046400000 } from './migrations/1795046400000-order-processing.js';
import { Orders1794960000000 } from './migrations/1794960000000-orders.js';
import { Cart1794873600000 } from './migrations/1794873600000-cart.js';
import { Catalog1794787200000 } from './migrations/1794787200000-catalog.js';
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
  synchronize: false, migrations: [UserAccess1794700800000, Catalog1794787200000, Cart1794873600000, Orders1794960000000, OrderProcessing1795046400000, CustomerAccount1795219200000, Loyalty1795478400000] });
try {
  await db.initialize();
  const migrations = await db.runMigrations({ transaction: 'all' });
  console.log(`Applied migrations: ${migrations.length}`);
} finally { if (db.isInitialized) await db.destroy(); }
