import type { MigrationInterface, QueryRunner } from 'typeorm';
export class UserAccess1794700800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE users (
      id uuid PRIMARY KEY, email varchar(254) NOT NULL UNIQUE,
      password_hash text NOT NULL, phone varchar(30),
      role varchar(16) NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','ADMIN')),
      tier varchar(16) NOT NULL DEFAULT 'STANDARD' CHECK (tier IN ('STANDARD','SOCIAL','PREMIUM')),
      promotion_opt_in boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (email = lower(trim(email)))
    )`);
    await q.query(`CREATE TABLE sessions (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash char(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query('CREATE INDEX sessions_user_id_idx ON sessions(user_id)');
    await q.query('CREATE INDEX sessions_expires_at_idx ON sessions(expires_at)');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE sessions'); await q.query('DROP TABLE users');
  }
}
