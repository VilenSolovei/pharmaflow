import type { MigrationInterface, QueryRunner } from 'typeorm';
export class Loyalty1795478400000 implements MigrationInterface {
  async up(q:QueryRunner):Promise<void>{
    await q.query('ALTER TABLE users ADD COLUMN tier_revision integer NOT NULL DEFAULT 0 CHECK (tier_revision>=0)');
    await q.query('ALTER TABLE products ADD COLUMN loyalty_revision integer NOT NULL DEFAULT 0 CHECK (loyalty_revision>=0)');
    await q.query('CREATE TABLE pricing_revision (id integer PRIMARY KEY CHECK (id=1),revision integer NOT NULL DEFAULT 0 CHECK (revision>=0))');
    await q.query('INSERT INTO pricing_revision(id) VALUES (1)');
    await q.query(`CREATE TABLE promotions (
      id uuid PRIMARY KEY,name varchar(120) NOT NULL CHECK (length(trim(name))>0),
      discount_bps integer NOT NULL CHECK (discount_bps BETWEEN 1 AND 10000),
      starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK (ends_at>starts_at),
      active boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
      created_by uuid NOT NULL REFERENCES users(id),request_id uuid NOT NULL,request_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(created_by,request_id)
    )`);
    await q.query('CREATE TABLE promotion_items (promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,product_id uuid NOT NULL REFERENCES products(id),PRIMARY KEY(promotion_id,product_id))');
    await q.query('CREATE INDEX promotion_items_product_idx ON promotion_items(product_id)');
    await q.query(`CREATE TABLE loyalty_cards (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
      balance_minor bigint NOT NULL DEFAULT 0 CHECK (balance_minor BETWEEN 0 AND 9007199254740991),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query('INSERT INTO loyalty_cards(user_id) SELECT id FROM users ORDER BY created_at,id');
    await q.query(`CREATE TABLE bonus_entries (
      id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES loyalty_cards(user_id),order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
      amount_minor bigint NOT NULL CHECK (amount_minor>0 AND amount_minor<=9007199254740991),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query('CREATE INDEX bonus_entries_user_idx ON bonus_entries(user_id,created_at DESC,id DESC)');
    const constraints:{conname:string}[]=await q.query("SELECT conname FROM pg_constraint WHERE conrelid='orders'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%total_minor =%'");
    if(constraints.length!==1)throw Error('Expected one existing order total constraint.');
    await q.query('ALTER TABLE orders DROP CONSTRAINT "'+constraints[0].conname.replace(/"/g,'""')+'"');
    await q.query('ALTER TABLE orders ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor BETWEEN 0 AND subtotal_minor),ADD COLUMN bonus_rate_bps integer NOT NULL DEFAULT 0 CHECK (bonus_rate_bps BETWEEN 0 AND 10000)');
    await q.query('ALTER TABLE orders ADD CONSTRAINT orders_total_with_discount_check CHECK (total_minor=subtotal_minor-discount_minor+delivery_minor)');
    await q.query('ALTER TABLE order_items ADD COLUMN discount_bps integer NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0,ADD COLUMN discount_source varchar(160),ADD COLUMN line_total_minor bigint');
    await q.query('UPDATE order_items SET line_total_minor=price_minor::bigint*quantity');
    await q.query('ALTER TABLE order_items ALTER COLUMN line_total_minor SET NOT NULL,ADD CONSTRAINT order_items_discount_check CHECK (discount_minor BETWEEN 0 AND price_minor::bigint*quantity),ADD CONSTRAINT order_items_line_total_check CHECK (line_total_minor=price_minor::bigint*quantity-discount_minor)');
  }
  async down(q:QueryRunner):Promise<void>{
    const rows:{n:number}[]=await q.query('SELECT count(*)::integer n FROM orders WHERE discount_minor<>0');
    if(rows[0].n)throw Error('Cannot remove loyalty schema while discounted orders exist.');
    await q.query('ALTER TABLE order_items DROP COLUMN line_total_minor,DROP COLUMN discount_source,DROP COLUMN discount_minor,DROP COLUMN discount_bps');
    await q.query('ALTER TABLE orders DROP CONSTRAINT orders_total_with_discount_check,DROP COLUMN discount_minor,DROP COLUMN bonus_rate_bps,ADD CONSTRAINT orders_total_minor_check CHECK (total_minor=subtotal_minor+delivery_minor)');
    for(const table of ['bonus_entries','loyalty_cards','promotion_items','promotions','pricing_revision'])await q.query(`DROP TABLE ${table}`);
    await q.query('ALTER TABLE products DROP COLUMN loyalty_revision');await q.query('ALTER TABLE users DROP COLUMN tier_revision');
  }
}
