import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CustomerAccount1795219200000 implements MigrationInterface {
  async up(q:QueryRunner):Promise<void>{
    await q.query("ALTER TABLE users ADD COLUMN full_name varchar(100) NOT NULL DEFAULT '', ADD COLUMN profile_revision integer NOT NULL DEFAULT 0 CHECK (profile_revision>=0)");
    await q.query(`CREATE TABLE prescriptions (
      id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number varchar(80) NOT NULL CHECK (length(trim(number))>0),issued_on date NOT NULL,
      medication varchar(160) NOT NULL CHECK (length(trim(medication))>0),notes varchar(1000) NOT NULL DEFAULT '',
      revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
      request_id uuid NOT NULL,request_hash char(64) NOT NULL,UNIQUE(user_id,request_id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query('CREATE INDEX prescriptions_user_idx ON prescriptions(user_id,created_at DESC,id DESC)');
    await q.query(`CREATE TABLE cart_repeats (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id uuid NOT NULL,
      order_id uuid NOT NULL REFERENCES orders(id),source_revision integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(user_id,request_id)
    )`);
  }
  async down(q:QueryRunner):Promise<void>{
    await q.query('DROP TABLE cart_repeats');await q.query('DROP TABLE prescriptions');
    await q.query('ALTER TABLE users DROP COLUMN profile_revision,DROP COLUMN full_name');
  }
}
