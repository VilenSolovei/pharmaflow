import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';
const root = resolve(import.meta.dirname, '../../..');
try { process.loadEnvFile(resolve(root, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (process.env.NODE_ENV === 'production') throw Error('Use a local development PostgreSQL for integration tests.');

test('administration: roles, catalog, durable retries, stock reservations, audit and availability events', { timeout: 150000 }, async () => {
  const name = 'pharmaflow_admin_test_' + randomBytes(6).toString('hex');
  const settings = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const control = new pg.Client({ ...settings, database: process.env.DB_NAME }); await control.connect();
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(r => socket.close(r));
  const env = { ...process.env, NODE_ENV: 'test', DB_NAME: name, API_PORT: String(port), NOTIFICATION_WORKER_ENABLED: 'false' };
  const headers = { Origin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173', 'X-PharmaFlow-Request': '1', 'Content-Type': 'application/json' };
  let db, child, created = false, logs = '';
  const req = (path, method = 'GET', body, actor, extra = {}) => fetch(`http://127.0.0.1:${port}/api/` + path, { method, headers: { ...headers, ...(actor ? { Cookie: actor.cookie, 'X-PharmaFlow-User': actor.user.id } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function json(response, status = 200) { const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data; }
  async function account(email) { const password = 'Administration-password-2026'; const user = await json(await req('auth/register', 'POST', { email, password }), 201); const login = await req('auth/login', 'POST', { email, password }); assert.equal(login.status, 200); return { user, cookie: login.headers.get('set-cookie').split(';')[0] }; }
  async function start() {
    child = spawn(process.execPath, ['dist/main.js'], { cwd: resolve(root, 'apps/api'), env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', b => logs += b); child.stderr.on('data', b => logs += b);
    for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw Error(logs); try { if ((await req('health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw Error(logs);
  }
  async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; } }
  const run = file => execFileSync(process.execPath, ['dist/database/' + file + '.js'], { cwd: resolve(root, 'apps/api'), env, encoding: 'utf8' });
  const worker = () => JSON.parse(execFileSync(process.execPath, ['dist/notifications/run.js'], { cwd: resolve(root, 'apps/api'), env, encoding: 'utf8' }).trim());
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true;
    assert.match(run('migrate'), /Applied migrations: 9/); assert.match(run('migrate'), /Applied migrations: 0/); run('seed');
    db = new pg.Client({ ...settings, database: name }); await db.connect(); await start();
    const operator = await account('operator-admin@example.invalid'), customer = await account('customer-admin@example.invalid'), second = await account('second-admin@example.invalid');
    await db.query("UPDATE users SET role='ADMIN' WHERE id=ANY($1::uuid[])", [[operator.user.id, second.user.id]]);
    const api = (path, method = 'GET', data, who = operator, extra) => req('admin/catalog' + path, method, data, who, extra);
    for (const path of ['/references', '/products', '/pharmacies', '/categories', '/manufacturers', '/stock/history']) {
      assert.equal((await api(path, 'GET', undefined, null)).status, 401); assert.equal((await api(path, 'GET', undefined, customer)).status, 403);
      assert.match((await api(path)).headers.get('cache-control'), /no-store/);
    }
    const named = { name: 'Категорія %_ тест', requestId: randomUUID() };
    assert.equal((await api('/categories', 'POST', named, customer)).status, 403);
    assert.equal((await api('/categories', 'POST', named, operator, { Origin: 'https://other.invalid' })).status, 403);
    assert.equal((await api('/categories', 'POST', named, operator, { 'X-PharmaFlow-User': customer.user.id })).status, 409);
    assert.equal((await api('/categories', 'POST', { ...named, extra: true })).status, 400);
    const copies = await Promise.all([api('/categories', 'POST', named), api('/categories', 'POST', named)]);
    const category = (await json(copies[0], 201)).item; assert.equal((await json(copies[1], 201)).item.id, category.id);
    assert.equal((await api('/categories', 'POST', { ...named, name: 'Інша' })).status, 409);
    assert.equal((await api('/categories', 'POST', { ...named, requestId: randomUUID() })).status, 409);
    assert.equal((await api('/categories', 'POST', { name: '   ', requestId: randomUUID() })).status, 400);
    assert.equal((await json(await api('/categories?q=' + encodeURIComponent('%_')))).total, 1);
    const manufacturer = (await json(await api('/manufacturers', 'POST', { name: 'Виробник тесту', requestId: randomUUID() }), 201)).item;
    const updates = await Promise.all([api('/manufacturers/' + manufacturer.id, 'PATCH', { name: 'Оновлений виробник', revision: 0, requestId: randomUUID() }), api('/manufacturers/' + manufacturer.id, 'PATCH', { name: 'Інша зміна', revision: 0, requestId: randomUUID() }, second)]);
    assert.deepEqual(updates.map(r => r.status).sort(), [200, 409]);
    const empty = (await json(await api('/categories', 'POST', { name: 'Без товарів', requestId: randomUUID() }), 201)).item;
    const removal = { revision: empty.revision, requestId: randomUUID() };
    await json(await api('/categories/' + empty.id, 'DELETE', removal)); await json(await api('/categories/' + empty.id, 'DELETE', removal));
    const pharmacyFields = { name: 'Аптека тестування', address: 'Київ, вул. Тестова, 10', latitude: 50.45, longitude: 30.52, active: true, requestId: randomUUID() };
    let pharmacy = (await json(await api('/pharmacies', 'POST', pharmacyFields), 201)).item;
    assert.equal((await json(await api('/pharmacies', 'POST', pharmacyFields), 201)).item.id, pharmacy.id);
    assert.equal((await api('/pharmacies', 'POST', { ...pharmacyFields, latitude: 91, requestId: randomUUID() })).status, 400);
    const productFields = { name: 'Товар адміністратора', description: 'Опис товару', type: 'MEDICINE', priceMinor: 12050, active: true, requiresPrescription: false, categoryId: category.id, manufacturerId: manufacturer.id, requestId: randomUUID() };
    let product = (await json(await api('/products', 'POST', productFields), 201)).item;
    assert.equal((await json(await api('/products', 'POST', productFields), 201)).item.id, product.id);
    for (const patch of [{ priceMinor: -1 }, { priceMinor: '10' }, { active: 'true' }, { categoryId: randomUUID() }]) {
      assert.equal((await api('/products', 'POST', { ...productFields, ...patch, requestId: randomUUID() })).status, patch.categoryId ? 404 : 400);
    }
    assert.equal((await api('/categories/' + category.id, 'DELETE', { revision: category.revision, requestId: randomUUID() })).status, 409);
    assert.equal((await api('/manufacturers/' + manufacturer.id, 'DELETE', { revision: 1, requestId: randomUUID() })).status, 409);
    await json(await req('notifications/subscriptions', 'POST', { productId: product.id, pharmacyId: pharmacy.id }, customer));
    const stock = async () => (await json(await api(`/stock?pharmacyId=${pharmacy.id}&productId=${product.id}`))).items[0];
    const adjust = async (onHand, reason = 'Надходження товару') => { const before = await stock(); return { productId: product.id, pharmacyId: pharmacy.id, onHand, expectedOnHand: before.onHand, expectedReserved: before.reserved, reason, requestId: randomUUID() }; };
    const first = await adjust(10);
    await json(await api('/stock/adjustments', 'POST', first)); await json(await api('/stock/adjustments', 'POST', first));
    assert.equal((await api('/stock/adjustments', 'POST', { ...first, onHand: 11 })).status, 409);
    assert.equal((await db.query('SELECT count(*)::int n FROM stock_adjustments')).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int n FROM outbox_events WHERE type='STOCK_AVAILABLE'")).rows[0].n, 1);
    assert.equal(worker().processed, 1); assert.equal((await json(await req('notifications', 'GET', undefined, customer))).total, 1);
    const stale = { ...first, requestId: randomUUID() }; assert.equal((await api('/stock/adjustments', 'POST', stale)).status, 409);
    // Product changes invalidate an earlier quote, preserving a later order's snapshots.
    async function quote(quantity = 2) {
      let c = await json(await req('cart', 'GET', undefined, customer)); c = await json(await req('cart', 'PUT', { revision: c.revision, items: [{ productId: product.id, quantity }] }, customer));
      return json(await req('orders/quote', 'POST', { revision: c.revision, pharmacyId: pharmacy.id, mode: 'PICKUP' }, customer));
    }
    const contact = { name: 'Одержувач Тест', phone: '+380671234567', email: customer.user.email };
    const checkout = quoteId => req('orders', 'POST', { quoteId, requestId: randomUUID(), contact }, customer);
    const oldQuote = await quote();
    const editProduct = async patch => { const data = { ...productFields, ...product, ...patch, requestId: randomUUID() }; delete data.id; product = (await json(await api('/products/' + product.id, 'PATCH', data))).item; return product; };
    await json(await req('admin/loyalty/products/' + product.id, 'PATCH', { socialEligible: true, revision: 0 }, operator));
    await editProduct({ priceMinor: 13050 });
    assert.equal((await db.query('SELECT social_eligible FROM products WHERE id=$1', [product.id])).rows[0].social_eligible, true); assert.equal((await checkout(oldQuote.id)).status, 409);
    const order = await json(await checkout((await quote()).id), 201); assert.equal((await stock()).reserved, 2);
    assert.equal((await api('/stock/adjustments', 'POST', await adjust(1))).status, 409);
    // Inventory, its audit entry, receipt and event commit or roll back together.
    await json(await api('/stock/adjustments', 'POST', await adjust(2, 'Уточнення обліку')));
    const failed = await adjust(3); const countBefore = (await db.query('SELECT count(*)::int n FROM stock_adjustments')).rows[0].n;
    await db.query("CREATE FUNCTION reject_admin_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.dedupe_key LIKE 'adjust:%' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$");
    await db.query('CREATE TRIGGER reject_admin_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_admin_event()');
    assert.equal((await api('/stock/adjustments', 'POST', failed)).status, 500); assert.equal((await stock()).onHand, 2);
    assert.equal((await db.query('SELECT count(*)::int n FROM stock_adjustments')).rows[0].n, countBefore);
    assert.equal((await db.query('SELECT count(*)::int n FROM admin_operations WHERE request_id=$1', [failed.requestId])).rows[0].n, 0);
    await db.query('DROP TRIGGER reject_admin_event ON outbox_events'); await db.query('DROP FUNCTION reject_admin_event()'); await json(await api('/stock/adjustments', 'POST', failed));
    const cancelledLater = await json(await checkout((await quote(1)).id), 201);
    await editProduct({ name: 'Нова назва', priceMinor: 15000, active: false });
    const pharmacyUpdate = { ...pharmacyFields, ...pharmacy, name: 'Нова аптека', active: false, requestId: randomUUID() }; delete pharmacyUpdate.id;
    pharmacy = (await json(await api('/pharmacies/' + pharmacy.id, 'PATCH', pharmacyUpdate))).item;
    assert.equal((await req('products/' + product.id)).status, 404); assert.ok(!(await json(await req('pharmacies'))).some(p => p.id === pharmacy.id));
    assert.equal((await stock()).reserved, 3); assert.equal((await api('/stock/adjustments', 'POST', await adjust(10))).status, 404);
    const historical = await json(await req('orders/' + order.id, 'GET', undefined, customer));
    assert.equal(historical.items[0].name, productFields.name); assert.equal(historical.items[0].priceMinor, 13050); assert.equal(historical.pharmacyName, pharmacyFields.name);
    let expectedStatus = 'NEW';
    for (const action of ['CONFIRM', 'PREPARE_PICKUP', 'COMPLETE']) {
      const done = await json(await req('admin/orders/' + order.id + '/actions', 'POST', { action, expectedStatus, requestId: randomUUID() }, operator)); expectedStatus = done.order.status;
    }
    assert.equal(expectedStatus, 'COMPLETED'); assert.equal((await stock()).reserved, 1);
    await json(await req('orders/' + cancelledLater.id + '/cancel', 'POST', {}, customer)); assert.equal((await stock()).reserved, 0); assert.equal((await stock()).onHand, 1);
    await editProduct({ active: true });
    const reactivate = { ...pharmacyFields, ...pharmacy, active: true, requestId: randomUUID() }; delete reactivate.id; pharmacy = (await json(await api('/pharmacies/' + pharmacy.id, 'PATCH', reactivate))).item;
    // A stock correction racing checkout can never reduce on-hand below a reservation.
    await json(await api('/stock/adjustments', 'POST', await adjust(2)));
    const raceQuote = await quote(2), raceChange = await adjust(0, 'Звірка залишку');
    const race = await Promise.all([checkout(raceQuote.id), api('/stock/adjustments', 'POST', raceChange)]);
    assert.ok(race.every(r => [200, 201, 409].includes(r.status)));
    const afterRace = await stock(); assert.ok(afterRace.onHand >= afterRace.reserved);
    if (race[0].status === 201) { const placed = await race[0].json(); await json(await req('orders/' + placed.id + '/cancel', 'POST', {}, customer)); }
    assert.equal((await json(await api('/stock/history?pharmacyId=' + pharmacy.id))).items[0].actorEmail, operator.user.email);
    // Data and idempotency receipts survive an API restart.
    await stop(); await start(); assert.equal((await json(await api('/products', 'POST', productFields), 201)).item.id, product.id);
    await db.query("UPDATE users SET role='CUSTOMER' WHERE id=$1", [operator.user.id]); assert.equal((await api('/products')).status, 403);
  } finally { await stop(); if (db) await db.end(); if (created) await control.query(`DROP DATABASE "${name}"`); await control.end(); }
});
