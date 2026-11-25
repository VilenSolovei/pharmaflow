import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { InventoryService } from '../inventory/inventory.service.js';
import { AdminListQuery, AdminRequestDto, AdminVersionDto, NamedFieldsDto, PharmacyFieldsDto, ProductFieldsDto, StockAdjustmentDto, StockQuery, UpdateNamedDto, UpdatePharmacyDto, UpdateProductDto } from './catalog-admin.dto.js';

type Dictionary = 'categories' | 'manufacturers';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
const productColumns = `id,name,description,type,price_minor "priceMinor",requires_prescription "requiresPrescription",active,category_id "categoryId",manufacturer_id "manufacturerId",catalog_revision revision`;
const pharmacyColumns = 'id,name,address,latitude,longitude,active,catalog_revision revision';

@Injectable()
export class CatalogAdminService {
  constructor(private readonly db: DataSource, private readonly inventory: InventoryService) {}
  private async admin(m: EntityManager, actorId: string, lock = false) {
    const rows: { role: string }[] = await m.query(`SELECT role FROM users WHERE id=$1 ${lock ? 'FOR SHARE' : ''}`, [actorId]);
    if (rows[0]?.role !== 'ADMIN') throw new ForbiddenException('Потрібні права адміністратора.');
  }
  private escaped(value: string) { return '%' + value.replace(/[\\%_]/g, '\\$&') + '%'; }
  private version(current: { revision: number } | undefined, revision: number) {
    if (!current) throw new NotFoundException('Запис не знайдено.');
    if (current.revision !== revision) throw new ConflictException('Дані вже змінилися. Оновіть список і повторіть редагування.');
  }
  private async mutate(actorId: string, action: string, data: AdminRequestDto, apply: (m: EntityManager) => Promise<object>) {
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ action, data }))).digest('hex');
    try {
      return await this.db.transaction(async m => {
        await this.admin(m, actorId, true);
        // A transaction-level lock also serializes a retry before its receipt exists.
        await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [actorId + ':' + data.requestId.toLowerCase()]);
        const previous: { fingerprint: string; result: object }[] = await m.query('SELECT fingerprint,result FROM admin_operations WHERE actor_id=$1 AND request_id=$2', [actorId, data.requestId]);
        if (previous[0]) {
          if (previous[0].fingerprint !== fingerprint) throw new ConflictException('Цей запит уже використано для іншої зміни.');
          return previous[0].result;
        }
        const result = { ownerId: actorId, ...await apply(m) };
        await m.query('INSERT INTO admin_operations(actor_id,request_id,fingerprint,result) VALUES ($1,$2,$3,$4)', [actorId, data.requestId, fingerprint, JSON.stringify(result)]);
        return result;
      });
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const code = (error.driverError as { code?: string }).code;
        if (code === '23505') throw new ConflictException('Запис із такою назвою вже існує.');
        if (code === '23503') throw new ConflictException('Запис використовується іншими даними або вже видалений. Оновіть список.');
        if (code === '40001' || code === '40P01') throw new ConflictException('Одночасно виконувалась інша зміна. Повторіть дію.');
      }
      throw error;
    }
  }
  async references(actorId: string) {
    return this.db.transaction('REPEATABLE READ', async m => {
      await this.admin(m, actorId);
      return { ownerId: actorId, categories: await m.query('SELECT id,name FROM categories ORDER BY name,id'), manufacturers: await m.query('SELECT id,name FROM manufacturers ORDER BY name,id'), pharmacies: await m.query('SELECT id,name,active FROM pharmacies ORDER BY name,id') };
    });
  }
  async named(actorId: string, table: Dictionary, q: AdminListQuery) {
    return this.db.transaction('REPEATABLE READ', async m => {
      await this.admin(m, actorId); const term = this.escaped(q.q);
      const [{ total }]: { total: number }[] = await m.query(`SELECT count(*)::integer total FROM ${table} WHERE name ILIKE $1`, [term]);
      const items = await m.query(`SELECT id,name,catalog_revision revision FROM ${table} WHERE name ILIKE $1 ORDER BY name,id LIMIT 20 OFFSET $2`, [term, (q.page - 1) * 20]);
      return { ownerId: actorId, items, total, page: q.page, limit: 20 };
    });
  }
  createNamed(actorId: string, table: Dictionary, data: NamedFieldsDto) {
    return this.mutate(actorId, table + ':create', data, async m => {
      const [item] = await m.query(`INSERT INTO ${table}(id,name) VALUES ($1,$2) RETURNING id,name,catalog_revision revision`, [randomUUID(), data.name]);
      return { item };
    });
  }
  updateNamed(actorId: string, table: Dictionary, id: string, data: UpdateNamedDto) {
    return this.mutate(actorId, table + ':' + id, data, async m => {
      const [current] = await m.query(`SELECT catalog_revision revision FROM ${table} WHERE id=$1 FOR UPDATE`, [id]); this.version(current, data.revision);
      const [item] = await m.query(`WITH changed AS (UPDATE ${table} SET name=$2,catalog_revision=catalog_revision+1 WHERE id=$1 RETURNING id,name,catalog_revision revision) SELECT * FROM changed`, [id, data.name]);
      return { item };
    });
  }
  deleteNamed(actorId: string, table: Dictionary, id: string, data: AdminVersionDto) {
    return this.mutate(actorId, table + ':delete:' + id, data, async m => {
      const [current] = await m.query(`SELECT catalog_revision revision FROM ${table} WHERE id=$1 FOR UPDATE`, [id]); this.version(current, data.revision);
      await m.query(`DELETE FROM ${table} WHERE id=$1`, [id]); return { deletedId: id };
    });
  }
  async products(actorId: string, q: AdminListQuery) {
    return this.db.transaction('REPEATABLE READ', async m => {
      await this.admin(m, actorId);
      const condition = `name ILIKE $1 ${q.status === 'all' ? '' : q.status === 'active' ? 'AND active' : 'AND NOT active'}`;
      const [{ total }]: { total: number }[] = await m.query(`SELECT count(*)::integer total FROM products WHERE ${condition}`, [this.escaped(q.q)]);
      const items = await m.query(`SELECT ${productColumns} FROM products WHERE ${condition} ORDER BY name,id LIMIT 20 OFFSET $2`, [this.escaped(q.q), (q.page - 1) * 20]);
      return { ownerId: actorId, items, total, page: q.page, limit: 20 };
    });
  }
  private async productReferences(m: EntityManager, data: ProductFieldsDto) {
    for (const [table, id] of [['categories', data.categoryId], ['manufacturers', data.manufacturerId]]) {
      if (!(await m.query(`SELECT id FROM ${table} WHERE id=$1 FOR KEY SHARE`, [id])).length) throw new NotFoundException('Категорія або виробник більше недоступні.');
    }
  }
  createProduct(actorId: string, data: ProductFieldsDto) {
    return this.mutate(actorId, 'products:create', data, async m => {
      await this.productReferences(m, data);
      const [item] = await m.query(`INSERT INTO products(id,name,description,type,price_minor,requires_prescription,active,category_id,manufacturer_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${productColumns}`, [randomUUID(), data.name, data.description, data.type, data.priceMinor, data.requiresPrescription, data.active, data.categoryId, data.manufacturerId]);
      return { item };
    });
  }
  updateProduct(actorId: string, id: string, data: UpdateProductDto) {
    return this.mutate(actorId, 'products:' + id, data, async m => {
      await this.productReferences(m, data);
      const [current] = await m.query('SELECT catalog_revision revision FROM products WHERE id=$1 FOR UPDATE', [id]); this.version(current, data.revision);
      // Checkout locks this product before rechecking its quote fingerprint.
      const [item] = await m.query(`WITH changed AS (UPDATE products SET name=$2,description=$3,type=$4,price_minor=$5,requires_prescription=$6,active=$7,category_id=$8,manufacturer_id=$9,catalog_revision=catalog_revision+1 WHERE id=$1 RETURNING ${productColumns}) SELECT * FROM changed`, [id, data.name, data.description, data.type, data.priceMinor, data.requiresPrescription, data.active, data.categoryId, data.manufacturerId]);
      return { item };
    });
  }
  async pharmacies(actorId: string, q: AdminListQuery) {
    return this.db.transaction('REPEATABLE READ', async m => {
      await this.admin(m, actorId);
      const condition = `(name ILIKE $1 OR address ILIKE $1) ${q.status === 'all' ? '' : q.status === 'active' ? 'AND active' : 'AND NOT active'}`;
      const [{ total }]: { total: number }[] = await m.query(`SELECT count(*)::integer total FROM pharmacies WHERE ${condition}`, [this.escaped(q.q)]);
      const items = await m.query(`SELECT ${pharmacyColumns} FROM pharmacies WHERE ${condition} ORDER BY name,id LIMIT 20 OFFSET $2`, [this.escaped(q.q), (q.page - 1) * 20]);
      return { ownerId: actorId, items, total, page: q.page, limit: 20 };
    });
  }
  createPharmacy(actorId: string, data: PharmacyFieldsDto) {
    return this.mutate(actorId, 'pharmacies:create', data, async m => {
      const [item] = await m.query(`INSERT INTO pharmacies(id,name,address,latitude,longitude,active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${pharmacyColumns}`, [randomUUID(), data.name, data.address, data.latitude, data.longitude, data.active]);
      return { item };
    });
  }
  updatePharmacy(actorId: string, id: string, data: UpdatePharmacyDto) {
    return this.mutate(actorId, 'pharmacies:' + id, data, async m => {
      const [current] = await m.query('SELECT catalog_revision revision FROM pharmacies WHERE id=$1 FOR UPDATE', [id]); this.version(current, data.revision);
      const [item] = await m.query(`WITH changed AS (UPDATE pharmacies SET name=$2,address=$3,latitude=$4,longitude=$5,active=$6,catalog_revision=catalog_revision+1 WHERE id=$1 RETURNING ${pharmacyColumns}) SELECT * FROM changed`, [id, data.name, data.address, data.latitude, data.longitude, data.active]);
      return { item };
    });
  }
  async stock(actorId: string, q: StockQuery) {
    if (!q.pharmacyId) throw new NotFoundException('Оберіть аптеку.');
    return this.db.transaction('REPEATABLE READ', async m => {
      await this.admin(m, actorId);
      if (!(await m.query('SELECT id FROM pharmacies WHERE id=$1', [q.pharmacyId])).length) throw new NotFoundException('Аптеку не знайдено.');
      const where = `p.name ILIKE $2 AND ($3::uuid IS NULL OR p.id=$3) ${q.status === 'all' ? '' : q.status === 'active' ? 'AND p.active' : 'AND NOT p.active'}`;
      const args = [q.pharmacyId, this.escaped(q.q), q.productId ?? null];
      const [{ total }]: { total: number }[] = await m.query(`SELECT count(*)::integer total FROM products p WHERE ${where.replaceAll('$2', '$1').replaceAll('$3', '$2')}`, args.slice(1));
      const items = await m.query(`SELECT p.id "productId",p.name,p.active,coalesce(s.on_hand,0)::integer "onHand",coalesce(s.reserved,0)::integer reserved,coalesce(s.on_hand-s.reserved,0)::integer available FROM products p LEFT JOIN stock_items s ON s.product_id=p.id AND s.pharmacy_id=$1 WHERE ${where} ORDER BY p.name,p.id LIMIT 20 OFFSET $4`, [...args, (q.page - 1) * 20]);
      return { ownerId: actorId, pharmacyId: q.pharmacyId, items, total, page: q.page, limit: 20 };
    });
  }
  adjustStock(actorId: string, data: StockAdjustmentDto) {
    return this.mutate(actorId, 'stock:adjust', data, async m => ({ stock: await this.inventory.adjust(m, actorId, data) }));
  }
  async history(actorId: string, q: StockQuery) {
    return this.db.transaction('REPEATABLE READ', async m => {
      await this.admin(m, actorId);
      const args = [q.pharmacyId ?? null, q.productId ?? null];
      const condition = '($1::uuid IS NULL OR a.pharmacy_id=$1) AND ($2::uuid IS NULL OR a.product_id=$2)';
      const [{ total }]: { total: number }[] = await m.query(`SELECT count(*)::integer total FROM stock_adjustments a WHERE ${condition}`, args);
      const items = await m.query(`SELECT a.id,p.name "productName",ph.name "pharmacyName",a.before_on_hand "beforeOnHand",a.after_on_hand "afterOnHand",a.reserved,a.reason,a.created_at "createdAt",u.email "actorEmail" FROM stock_adjustments a JOIN products p ON p.id=a.product_id JOIN pharmacies ph ON ph.id=a.pharmacy_id JOIN users u ON u.id=a.actor_id WHERE ${condition} ORDER BY a.created_at DESC,a.id DESC LIMIT 20 OFFSET $3`, [...args, (q.page - 1) * 20]);
      return { ownerId: actorId, items, total, page: q.page, limit: 20 };
    });
  }
}
