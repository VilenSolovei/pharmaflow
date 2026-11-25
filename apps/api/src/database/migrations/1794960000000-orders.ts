import type { MigrationInterface, QueryRunner } from 'typeorm';
export class Orders1794960000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE order_quotes (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pharmacy_id uuid NOT NULL REFERENCES pharmacies(id), mode varchar(10) NOT NULL CHECK (mode IN ('PICKUP','COURIER')),
      cart_revision integer NOT NULL, fingerprint char(64) NOT NULL,
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query('CREATE INDEX order_quotes_user_idx ON order_quotes(user_id)');
    await q.query(`CREATE TABLE orders (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
      quote_id uuid NOT NULL UNIQUE REFERENCES order_quotes(id), request_id uuid NOT NULL,
      request_hash char(64) NOT NULL,
      pharmacy_id uuid NOT NULL REFERENCES pharmacies(id), pharmacy_name varchar(100) NOT NULL, pharmacy_address varchar(200) NOT NULL,
      mode varchar(10) NOT NULL CHECK (mode IN ('PICKUP','COURIER')),
      status varchar(24) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONFIRMED','READY_FOR_PICKUP','OUT_FOR_DELIVERY','COMPLETED','CANCELLED')),
      contact jsonb NOT NULL, address jsonb,
      subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
      delivery_minor integer NOT NULL CHECK (delivery_minor >= 0),
      total_minor bigint NOT NULL CHECK (total_minor = subtotal_minor + delivery_minor),
      created_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz,
      UNIQUE(user_id,request_id),
      CHECK ((mode='PICKUP' AND address IS NULL) OR (mode='COURIER' AND address IS NOT NULL)),
      CHECK ((status='CANCELLED') = (cancelled_at IS NOT NULL))
    )`);
    await q.query('CREATE INDEX orders_user_created_idx ON orders(user_id,created_at DESC,id DESC)');
    await q.query(`CREATE TABLE order_items (
      id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES products(id), name varchar(160) NOT NULL,
      price_minor integer NOT NULL CHECK (price_minor >= 0), quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
      requires_prescription boolean NOT NULL, UNIQUE(order_id,product_id)
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of ['order_items','orders','order_quotes']) await q.query(`DROP TABLE ${table}`);
  }
}
