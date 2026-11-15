import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { hashPassword, verifyPassword } from './password.js';
export interface PublicUser { id: string; email: string; role: 'CUSTOMER' | 'ADMIN'; tier: string; }
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const fields = 'id, email, role, tier';
@Injectable()
export class AuthService {
  constructor(private readonly db: DataSource) {}
  private dummyHash = hashPassword(randomBytes(32).toString('hex'));
  async register(email: string, password: string): Promise<PublicUser> {
    const hash = await hashPassword(password);
    try {
      const rows: PublicUser[] = await this.db.query(
        `INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3) RETURNING ${fields}`,
        [randomUUID(), email, hash]);
      return rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Цей email уже зареєстрований.');
      throw error;
    }
  }
  async login(email: string, password: string) {
    const rows: (PublicUser & { password_hash: string })[] = await this.db.query(
      `SELECT ${fields}, password_hash FROM users WHERE email=$1`, [email]);
    const user = rows[0];
    const valid = await verifyPassword(password, user?.password_hash ?? await this.dummyHash);
    if (!user || !valid) throw new UnauthorizedException('Неправильний email або пароль.');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.db.query('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)',
      [randomUUID(), user.id, tokenHash(token), expiresAt]);
    return { token, expiresAt, user: { id: user.id, email: user.email, role: user.role, tier: user.tier } };
  }
  async current(token: string): Promise<PublicUser> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException();
    const rows: PublicUser[] = await this.db.query(
      `SELECT u.id,u.email,u.role,u.tier FROM users u JOIN sessions s ON s.user_id=u.id
       WHERE s.token_hash=$1 AND s.expires_at > now()`, [tokenHash(token)]);
    if (!rows[0]) throw new UnauthorizedException();
    return rows[0];
  }
  async logout(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
  }
}
