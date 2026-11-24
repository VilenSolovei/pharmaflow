import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OutboxService } from '../events/outbox.service.js';
export function nextOccurrence(due:Date,intervalDays:number,now:Date):Date{
  if(!Number.isFinite(due.getTime())||!Number.isFinite(now.getTime())||!Number.isInteger(intervalDays)||intervalDays<1||intervalDays>365)throw Error('Invalid reminder schedule.');
  const period=intervalDays*86400000,elapsed=now.getTime()-due.getTime();
  return elapsed<0?new Date(due):new Date(due.getTime()+(Math.floor(elapsed/period)+1)*period);
}
@Injectable()
export class ReminderService {
  constructor(private readonly db:DataSource,private readonly outbox:OutboxService){}
  async scheduleDue(){return this.db.transaction(async m=>{
    const rows:{id:string;userId:string;productId:string;nextAt:Date;intervalDays:number;revision:number;now:Date}[]=await m.query(`SELECT r.id,r.user_id "userId",r.product_id "productId",r.next_at "nextAt",r.interval_days "intervalDays",r.revision,clock_timestamp() now
      FROM medication_reminders r JOIN products p ON p.id=r.product_id WHERE r.active AND p.active AND r.next_at<=clock_timestamp()
      ORDER BY r.next_at,r.id LIMIT 50 FOR UPDATE OF r SKIP LOCKED`);
    for(const row of rows){
      await m.query('UPDATE medication_reminders SET next_at=$2 WHERE id=$1',[row.id,nextOccurrence(row.nextAt,row.intervalDays,row.now)]);
      await this.outbox.enqueue(m,'REMINDER_DUE',`reminder:${row.id}:${row.revision}:${row.nextAt.toISOString()}`,{reminderId:row.id,userId:row.userId,revision:row.revision,scheduledFor:row.nextAt.toISOString()});
    }
    return rows.length;
  });}
}
