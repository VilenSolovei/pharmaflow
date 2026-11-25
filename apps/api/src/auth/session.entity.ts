import { Column, Entity, PrimaryColumn } from 'typeorm';
@Entity('sessions')
export class Session {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true, select: false }) tokenHash!: string;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' }) createdAt!: Date;
  isExpired(now = new Date()): boolean { return this.expiresAt <= now; }
}
