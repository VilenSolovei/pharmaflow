import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';

const root = resolve(import.meta.dirname, '../../..');
try { process.loadEnvFile(resolve(root, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (process.env.NODE_ENV === 'production') throw Error('Run integration tests only against a local development PostgreSQL.');

test('registration, sessions, authorization and persistence against PostgreSQL', { timeout: 90000 }, async () => {
  const name = 'pharmaflow_test_' + randomBytes(6).toString('hex');
  const settings = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = new pg.Client({ ...settings, database: process.env.DB_NAME });
  await admin.connect();
  let child; let db; let logs = ''; let created = false;
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const env = { ...process.env, NODE_ENV: 'test', DB_NAME: name, API_PORT: String(port), APP_ORIGIN: 'http://127.0.0.1:5173' };
  const origin = { Origin: env.APP_ORIGIN, 'X-PharmaFlow-Request': '1', 'Content-Type': 'application/json' };
  const email = 'test@example.invalid'; const password = 'A-test-password-2026';
  async function start() {
    child = spawn(process.execPath, ['dist/main.js'], { cwd: resolve(root, 'apps/api'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error('Test API exited: ' + logs);
      try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* startup */ }
      await new Promise(r => setTimeout(r, 100));
    }
    throw Error('Test API did not start: ' + logs);
  }
  async function stop() {
    if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
  }
  const request = (path, body, cookie, headers = origin) => fetch(`http://127.0.0.1:${port}/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function login() {
    const r = await request('login', { email, password }); assert.equal(r.status, 200);
    const setCookie = r.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i); assert.match(setCookie, /Path=\/api/i);
    return setCookie.split(';')[0];
  }
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    const migrate = () => execFileSync(process.execPath, ['dist/database/migrate.js'], { cwd: resolve(root, 'apps/api'), env, encoding: 'utf8' });
    assert.match(migrate(), /Applied migrations: 2/); assert.match(migrate(), /Applied migrations: 0/);
    db = new pg.Client({ ...settings, database: name }); await db.connect();
    await start();
    assert.equal((await request('me')).status, 401);
    assert.equal((await request('register', { email, password }, undefined, { ...origin, Origin: 'https://untrusted.invalid' })).status, 403);
    assert.equal((await request('register', { email, password: 'short' })).status, 400);
    assert.equal((await request('register', { email, password, role: 'ADMIN' })).status, 400);
    let r = await request('register', { email: ' TEST@example.invalid ', password }); assert.equal(r.status, 201);
    const user = await r.json(); assert.equal(user.role, 'CUSTOMER'); assert.equal(user.tier, 'STANDARD'); assert.equal(user.email, email); assert.equal(user.password_hash, undefined);
    assert.equal((await request('register', { email, password })).status, 409);
    const stored = (await db.query('SELECT password_hash FROM users')).rows[0].password_hash;
    assert.match(stored, /^scrypt\$/); assert.notEqual(stored, password);
    assert.equal((await request('login', { email, password: 'incorrect-password' })).status, 401);
    let cookie = await login();
    assert.equal((await request('me', undefined, cookie)).status, 200);
    const storedToken = (await db.query('SELECT token_hash FROM sessions')).rows[0].token_hash;
    assert.equal(storedToken, createHash('sha256').update(cookie.split('=')[1]).digest('hex'));
    assert.equal((await request('admin-access', undefined, cookie)).status, 403);
    await db.query("UPDATE users SET role='ADMIN' WHERE email=$1", [email]);
    assert.equal((await request('admin-access', undefined, cookie)).status, 200);
    await db.query("UPDATE users SET role='CUSTOMER' WHERE email=$1", [email]);
    await stop(); await start(); assert.equal((await request('me', undefined, cookie)).status, 200);
    assert.equal((await request('logout', {}, cookie)).status, 204);
    assert.equal((await request('me', undefined, cookie)).status, 401);
    cookie = await login(); await db.query("UPDATE sessions SET expires_at=now()-interval '1 minute'");
    assert.equal((await request('me', undefined, cookie)).status, 401);
    assert.equal((await request('me', undefined, 'pharmaflow_session=forged')).status, 401);
    let limited = false;
    for (let i = 0; i < 22; i++) { r = await request('login', { email, password: 'incorrect-password' }); if (r.status === 429) { limited = true; break; } }
    assert.ok(limited, 'login requests must be rate limited');
  } finally {
    await stop(); if (db) await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
