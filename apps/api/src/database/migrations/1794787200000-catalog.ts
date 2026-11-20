import type { MigrationInterface, QueryRunner } from 'typeorm';
export class Catalog1794787200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE categories (id uuid PRIMARY KEY, name varchar(100) NOT NULL UNIQUE)`);
    await q.query(`CREATE TABLE manufacturers (id uuid PRIMARY KEY, name varchar(100) NOT NULL UNIQUE)`);
    await q.query(`CREATE TABLE products (
      id uuid PRIMARY KEY, name varchar(160) NOT NULL, description text NOT NULL,
      type varchar(20) NOT NULL CHECK (type IN ('MEDICINE','VITAMIN','MEDICAL_DEVICE')),
      price_minor integer NOT NULL CHECK (price_minor >= 0), requires_prescription boolean NOT NULL,
      social_eligible boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
      category_id uuid NOT NULL REFERENCES categories(id), manufacturer_id uuid NOT NULL REFERENCES manufacturers(id)
    )`);
    await q.query(`CREATE TABLE pharmacies (
      id uuid PRIMARY KEY, name varchar(100) NOT NULL, address varchar(200) NOT NULL,
      latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
      longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180), active boolean NOT NULL DEFAULT true
    )`);
    await q.query(`CREATE TABLE stock_items (
      id uuid PRIMARY KEY, pharmacy_id uuid NOT NULL REFERENCES pharmacies(id), product_id uuid NOT NULL REFERENCES products(id),
      on_hand integer NOT NULL CHECK (on_hand >= 0), reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= on_hand),
      UNIQUE (pharmacy_id,product_id)
    )`);
    await q.query('CREATE INDEX products_category_idx ON products(category_id)');
    await q.query('CREATE INDEX products_manufacturer_idx ON products(manufacturer_id)');
    await q.query('CREATE INDEX stock_product_idx ON stock_items(product_id)');
  }
  async down(q: QueryRunner): Promise<void> {
    for (const name of ['stock_items','products','pharmacies','manufacturers','categories']) await q.query(`DROP TABLE ${name}`);
  }
}
