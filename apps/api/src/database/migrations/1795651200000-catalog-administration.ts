import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CatalogAdministration1795651200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    for (const table of ['products', 'pharmacies', 'categories', 'manufacturers']) {
      await q.query(`ALTER TABLE ${table} ADD COLUMN catalog_revision integer NOT NULL DEFAULT 0 CHECK (catalog_revision>=0)`);
    }
    await q.query(`CREATE TABLE admin_operations (
      actor_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
      fingerprint char(64) NOT NULL, result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,request_id)
    )`);
    await q.query(`CREATE TABLE stock_adjustments (
      id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
      product_id uuid NOT NULL REFERENCES products(id), pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
      before_on_hand integer NOT NULL CHECK (before_on_hand>=0), after_on_hand integer NOT NULL CHECK (after_on_hand>=0),
      reserved integer NOT NULL CHECK (reserved>=0 AND reserved<=before_on_hand AND reserved<=after_on_hand),
      reason varchar(300) NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_id)
    )`);
    await q.query('CREATE INDEX stock_adjustments_pair_idx ON stock_adjustments(pharmacy_id,product_id,created_at DESC,id DESC)');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE stock_adjustments');
    await q.query('DROP TABLE admin_operations');
    for (const table of ['products', 'pharmacies', 'categories', 'manufacturers']) await q.query(`ALTER TABLE ${table} DROP COLUMN catalog_revision`);
  }
}
