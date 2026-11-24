import { Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, EventEmitterReadinessWatcher } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DeferredEvent } from '../events/outbox.service.js';
import type { OutboxEvent } from '../events/outbox.service.js';
import { ReminderService } from './reminder.service.js';
interface DispatchResult {scheduled:number;processed:number;failed:number;deferred:number;}
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap,BeforeApplicationShutdown {
  private timer?:ReturnType<typeof setInterval>;
  private running?:Promise<DispatchResult>;
  private stopped=false;
  private readonly logger=new Logger(OutboxDispatcher.name);
  constructor(private readonly db:DataSource,private readonly emitter:EventEmitter2,private readonly readiness:EventEmitterReadinessWatcher,private readonly reminders:ReminderService,private readonly config:ConfigService){}
  onApplicationBootstrap(){
    if(!this.config.getOrThrow<boolean>('NOTIFICATION_WORKER_ENABLED'))return;
    this.timer=setInterval(()=>this.kick(),this.config.getOrThrow<number>('NOTIFICATION_POLL_MS'));this.timer.unref();this.kick();
  }
  private kick(){if(!this.stopped)void this.run().catch(()=>this.logger.warn('Notification worker will retry after a temporary failure.'));}
  run():Promise<DispatchResult>{
    if(this.running)return this.running;
    const task=this.process();this.running=task;
    void task.finally(()=>{if(this.running===task)this.running=undefined;}).catch(()=>{});
    return task;
  }
  private async process(){
    await this.readiness.waitUntilReady();
    const scheduled=await this.reminders.scheduleDue(),token=randomUUID();
    const rows:OutboxEvent[]=await this.db.query(`WITH candidates AS (
      SELECT id FROM outbox_events WHERE processed_at IS NULL AND available_at<=clock_timestamp() AND (leased_until IS NULL OR leased_until<=clock_timestamp())
      ORDER BY available_at,created_at,id LIMIT 10 FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE outbox_events e SET lease_token=$1,leased_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1 FROM candidates c WHERE e.id=c.id RETURNING e.*
    ) SELECT id,type,payload,created_at "createdAt",lease_token "leaseToken",attempts FROM claimed`,[token]);
    const result={scheduled,processed:0,failed:0,deferred:0};
    for(const event of rows){
      try{
        if(!this.emitter.hasListeners(event.type))throw Error('No observer registered for event.');
        await this.emitter.emitAsync(event.type,event);
        await this.db.query('UPDATE outbox_events SET processed_at=clock_timestamp(),lease_token=NULL,leased_until=NULL,last_error=NULL WHERE id=$1 AND lease_token=$2',[event.id,event.leaseToken]);result.processed++;
      }catch(error){
        const deferred=error instanceof DeferredEvent;
        const availableAt=deferred?error.availableAt:new Date(Date.now()+Math.min(60000,1000*2**Math.min(event.attempts,6)));
        const message=error instanceof Error?error.message:'Notification observer failed.';
        await this.db.query('UPDATE outbox_events SET lease_token=NULL,leased_until=NULL,available_at=$3,last_error=$4 WHERE id=$1 AND lease_token=$2',[event.id,event.leaseToken,availableAt,message.slice(0,500)]);
        if(deferred)result.deferred++;else result.failed++;
      }
    }
    return result;
  }
  async beforeApplicationShutdown(){this.stopped=true;if(this.timer)clearInterval(this.timer);await this.running?.catch(()=>{});}
}
