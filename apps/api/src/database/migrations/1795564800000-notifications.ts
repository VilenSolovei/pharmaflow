import type { MigrationInterface, QueryRunner } from 'typeorm';
export class Notifications1795564800000 implements MigrationInterface {
  async up(q:QueryRunner):Promise<void>{
    await q.query('ALTER TABLE users ADD COLUMN notification_settings_revision integer NOT NULL DEFAULT 0 CHECK (notification_settings_revision>=0),ADD COLUMN promotion_opt_in_since timestamptz');
    await q.query('UPDATE users SET promotion_opt_in_since=clock_timestamp() WHERE promotion_opt_in');
    await q.query('ALTER TABLE promotions ADD COLUMN notification_generation integer NOT NULL DEFAULT 0 CHECK (notification_generation>=0)');
    await q.query(`CREATE TABLE outbox_events (
      id uuid PRIMARY KEY,type varchar(24) NOT NULL CHECK (type IN ('STOCK_AVAILABLE','PROMOTION_PUBLISHED','REMINDER_DUE')),
      dedupe_key varchar(200) NOT NULL UNIQUE,payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      lease_token uuid,leased_until timestamptz,attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
      processed_at timestamptz,last_error varchar(500)
    )`);
    await q.query('CREATE INDEX outbox_pending_idx ON outbox_events(available_at,created_at) WHERE processed_at IS NULL');
    await q.query(`CREATE TABLE availability_subscriptions (
      id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES products(id),pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
      subscribed_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(user_id,product_id,pharmacy_id)
    )`);
    await q.query('CREATE INDEX availability_pair_idx ON availability_subscriptions(product_id,pharmacy_id)');
    await q.query(`CREATE TABLE medication_reminders (
      id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,product_id uuid NOT NULL REFERENCES products(id),
      next_at timestamptz NOT NULL,interval_days integer NOT NULL CHECK (interval_days BETWEEN 1 AND 365),active boolean NOT NULL DEFAULT true,
      revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),request_id uuid NOT NULL,request_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(user_id,request_id)
    )`);
    await q.query('CREATE INDEX reminders_due_idx ON medication_reminders(next_at) WHERE active');
    await q.query('CREATE INDEX reminders_user_idx ON medication_reminders(user_id,created_at DESC,id DESC)');
    await q.query(`CREATE TABLE notifications (
      id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_id uuid NOT NULL REFERENCES outbox_events(id),
      kind varchar(20) NOT NULL CHECK (kind IN ('AVAILABILITY','REMINDER','PROMOTION')),
      title varchar(160) NOT NULL,body varchar(2000) NOT NULL,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(user_id,event_id)
    )`);
    await q.query('CREATE INDEX notifications_user_idx ON notifications(user_id,created_at DESC,id DESC)');
    await q.query('CREATE INDEX notifications_unread_idx ON notifications(user_id) WHERE read_at IS NULL');
  }
  async down(q:QueryRunner):Promise<void>{
    for(const table of ['notifications','medication_reminders','availability_subscriptions','outbox_events'])await q.query(`DROP TABLE ${table}`);
    await q.query('ALTER TABLE promotions DROP COLUMN notification_generation');
    await q.query('ALTER TABLE users DROP COLUMN notification_settings_revision,DROP COLUMN promotion_opt_in_since');
  }
}
