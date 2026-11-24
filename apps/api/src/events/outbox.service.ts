import { Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
export type EventType='STOCK_AVAILABLE'|'PROMOTION_PUBLISHED'|'REMINDER_DUE';
export interface OutboxEvent {id:string;type:EventType;payload:Record<string,unknown>;createdAt:Date;leaseToken:string;attempts:number;}
@Injectable()
export class OutboxService {
  async enqueue(m:EntityManager,type:EventType,key:string,payload:object,availableAt?:Date){
    await m.query(`INSERT INTO outbox_events(id,type,dedupe_key,payload,available_at) VALUES ($1,$2,$3,$4,coalesce($5::timestamptz,clock_timestamp()))
      ON CONFLICT(dedupe_key) DO UPDATE SET available_at=excluded.available_at WHERE outbox_events.processed_at IS NULL`,[randomUUID(),type,key,JSON.stringify(payload),availableAt??null]);
  }
}
@Module({providers:[OutboxService],exports:[OutboxService]})
export class OutboxModule {}
export class DeferredEvent extends Error {constructor(readonly availableAt:Date){super('Event is scheduled for a later time.');}}
