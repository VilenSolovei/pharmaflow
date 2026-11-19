import type { MigrationInterface, QueryRunner } from 'typeorm';
export class OrderProcessing1795046400000 implements MigrationInterface {
  async up(q:QueryRunner):Promise<void>{
    await q.query('ALTER TABLE orders ADD COLUMN completed_at timestamptz');
    await q.query("ALTER TABLE orders ADD CONSTRAINT orders_completed_at_check CHECK (status='COMPLETED' OR completed_at IS NULL)");
    await q.query(`CREATE TABLE order_transitions (
      id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id), actor_id uuid NOT NULL REFERENCES users(id),
      request_id uuid NOT NULL, expected_status varchar(24) NOT NULL,
      action varchar(20) NOT NULL CHECK (action IN ('CONFIRM','PREPARE_PICKUP','DISPATCH','COMPLETE','CANCEL')),
      from_status varchar(24) NOT NULL CHECK (from_status IN ('NEW','CONFIRMED','READY_FOR_PICKUP','OUT_FOR_DELIVERY','COMPLETED','CANCELLED')),
      to_status varchar(24) NOT NULL CHECK (to_status IN ('NEW','CONFIRMED','READY_FOR_PICKUP','OUT_FOR_DELIVERY','COMPLETED','CANCELLED')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_id), CHECK (from_status<>to_status)
    )`);
    await q.query('CREATE INDEX order_transitions_order_idx ON order_transitions(order_id,created_at,id)');
    await q.query('CREATE INDEX orders_status_created_idx ON orders(status,created_at DESC,id DESC)');
  }
  async down(q:QueryRunner):Promise<void>{
    await q.query('DROP INDEX orders_status_created_idx');await q.query('DROP TABLE order_transitions');
    await q.query('ALTER TABLE orders DROP CONSTRAINT orders_completed_at_check');await q.query('ALTER TABLE orders DROP COLUMN completed_at');
  }
}
