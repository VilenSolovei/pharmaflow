import type { MigrationInterface, QueryRunner } from 'typeorm';
export class Cart1794873600000 implements MigrationInterface {
 async up(q:QueryRunner):Promise<void>{
  await q.query(`CREATE TABLE carts(id uuid PRIMARY KEY,user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,revision integer NOT NULL DEFAULT 0 CHECK(revision>=0))`);
  await q.query(`CREATE TABLE cart_items(id uuid PRIMARY KEY,cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,product_id uuid NOT NULL REFERENCES products(id),quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99),UNIQUE(cart_id,product_id))`);
 }
 async down(q:QueryRunner):Promise<void>{await q.query('DROP TABLE cart_items');await q.query('DROP TABLE carts');}
}
