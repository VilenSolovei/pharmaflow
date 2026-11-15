import { Column, Entity, PrimaryColumn } from 'typeorm';
@Entity('users')
export class User {
  @PrimaryColumn('uuid') id!: string;
  @Column({ length: 254, unique: true }) email!: string;
  @Column({ name: 'password_hash', type: 'text', select: false }) passwordHash!: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 16, default: 'CUSTOMER' }) role!: 'CUSTOMER' | 'ADMIN';
  @Column({ type: 'varchar', length: 16, default: 'STANDARD' }) tier!: 'STANDARD' | 'SOCIAL' | 'PREMIUM';
  @Column({ name: 'promotion_opt_in', default: false }) promotionOptIn!: boolean;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' }) createdAt!: Date;
}
