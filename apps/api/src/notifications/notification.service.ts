import { DeferredEvent } from '../events/outbox.service.js';
import type { OutboxEvent } from '../events/outbox.service.js';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CreateReminderDto, NotificationPreferencesDto, NotificationsQueryDto, UpdateReminderDto } from './notifications.dto.js';
const reminderFields='r.id,r.product_id "productId",p.name "productName",p.active "productActive",r.next_at "nextAt",r.interval_days "intervalDays",r.active,r.revision';
@Injectable()
export class NotificationService {
  constructor(private readonly db:DataSource){}
  async summary(userId:string){const [{unreadCount}]:{unreadCount:number}[]=await this.db.query('SELECT count(*)::integer "unreadCount" FROM notifications WHERE user_id=$1 AND read_at IS NULL',[userId]);return {ownerId:userId,unreadCount};}
  async list(userId:string,q:NotificationsQueryDto){return this.db.transaction('REPEATABLE READ',async m=>{
    const [{total,unreadCount}]:{total:number;unreadCount:number}[]=await m.query(`SELECT count(*) FILTER (WHERE NOT $2 OR read_at IS NULL)::integer total,count(*) FILTER (WHERE read_at IS NULL)::integer "unreadCount" FROM notifications WHERE user_id=$1`,[userId,q.unreadOnly==='true']);
    const items=await m.query('SELECT id,kind,title,body,read_at "readAt",created_at "createdAt" FROM notifications WHERE user_id=$1 AND (NOT $2 OR read_at IS NULL) ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $3',[userId,q.unreadOnly==='true',(q.page-1)*20]);
    return {ownerId:userId,items,total,unreadCount,page:q.page,limit:20};
  });}
  async read(userId:string,id:string,read:boolean){
    const rows:{id:string}[]=await this.db.query('WITH changed AS (UPDATE notifications SET read_at=CASE WHEN $3::boolean THEN coalesce(read_at,clock_timestamp()) ELSE NULL END WHERE id=$1 AND user_id=$2 RETURNING id) SELECT id FROM changed',[id,userId,read]);
    if(!rows.length)throw new NotFoundException('Сповіщення не знайдено.');return {ownerId:userId};
  }
  async readAll(userId:string){await this.db.query('UPDATE notifications SET read_at=clock_timestamp() WHERE user_id=$1 AND read_at IS NULL',[userId]);return {ownerId:userId};}
  private async preferencesIn(m:EntityManager,userId:string){const rows:{promotionOptIn:boolean;revision:number}[]=await m.query('SELECT promotion_opt_in "promotionOptIn",notification_settings_revision revision FROM users WHERE id=$1',[userId]);return {ownerId:userId,...rows[0]};}
  preferences(userId:string){return this.preferencesIn(this.db.manager,userId);}
  async updatePreferences(userId:string,data:NotificationPreferencesDto){return this.db.transaction(async m=>{
    await m.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);const current=await this.preferencesIn(m,userId);
    if(current.revision!==data.revision)throw new ConflictException('Налаштування вже змінилися. Оновіть їх перед збереженням.');
    if(current.promotionOptIn!==data.promotionOptIn)await m.query('UPDATE users SET promotion_opt_in=$2,promotion_opt_in_since=CASE WHEN $2::boolean THEN clock_timestamp() ELSE NULL END,notification_settings_revision=notification_settings_revision+1 WHERE id=$1',[userId,data.promotionOptIn]);
    return this.preferencesIn(m,userId);
  });}
  private async activeProduct(m:EntityManager,productId:string,requiredActive=true){const rows:unknown[]=await m.query(`SELECT id FROM products WHERE id=$1 ${requiredActive?'AND active':''} FOR SHARE`,[productId]);if(!rows.length)throw new NotFoundException('Товар більше недоступний.');}
  async subscriptions(userId:string){const items=await this.db.query(`SELECT s.id,s.product_id "productId",p.name "productName",s.pharmacy_id "pharmacyId",ph.name "pharmacyName",ph.address,p.active AND ph.active enabled
    FROM availability_subscriptions s JOIN products p ON p.id=s.product_id JOIN pharmacies ph ON ph.id=s.pharmacy_id WHERE s.user_id=$1 ORDER BY s.subscribed_at DESC,s.id`,[userId]);return {ownerId:userId,items};}
  async subscribe(userId:string,productId:string,pharmacyId:string){return this.db.transaction(async m=>{
    await m.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);await this.activeProduct(m,productId);
    const ph:unknown[]=await m.query('SELECT id FROM pharmacies WHERE id=$1 AND active FOR SHARE',[pharmacyId]);if(!ph.length)throw new NotFoundException('Аптека більше недоступна.');
    const count:{n:number}[]=await m.query('SELECT count(*)::integer n FROM availability_subscriptions WHERE user_id=$1',[userId]);
    const existing:unknown[]=await m.query('SELECT id FROM availability_subscriptions WHERE user_id=$1 AND product_id=$2 AND pharmacy_id=$3',[userId,productId,pharmacyId]);
    if(!existing.length&&count[0].n>=100)throw new BadRequestException('Можна зберегти до 100 підписок на наявність.');
    await m.query('INSERT INTO availability_subscriptions(id,user_id,product_id,pharmacy_id) VALUES ($1,$2,$3,$4) ON CONFLICT(user_id,product_id,pharmacy_id) DO NOTHING',[randomUUID(),userId,productId,pharmacyId]);return {ownerId:userId};
  });}
  async unsubscribe(userId:string,id:string){const rows:{id:string}[]=await this.db.query('WITH removed AS (DELETE FROM availability_subscriptions WHERE id=$1 AND user_id=$2 RETURNING id) SELECT id FROM removed',[id,userId]);if(!rows.length)throw new NotFoundException('Підписку не знайдено.');return {ownerId:userId};}
  async reminders(userId:string){const items=await this.db.query(`SELECT ${reminderFields} FROM medication_reminders r JOIN products p ON p.id=r.product_id WHERE r.user_id=$1 ORDER BY r.created_at DESC,r.id`,[userId]);return {ownerId:userId,items};}
  private date(value:string){const date=new Date(value);if(!Number.isFinite(date.getTime())||date.getUTCFullYear()<1)throw new BadRequestException('Перевірте дату нагадування.');return date;}
  async createReminder(userId:string,data:CreateReminderDto){
    const date=this.date(data.nextAt);const fingerprint=createHash('sha256').update(JSON.stringify({productId:data.productId.toLowerCase(),nextAt:date.toISOString(),intervalDays:data.intervalDays,active:data.active})).digest('hex');
    return this.db.transaction(async m=>{
      await m.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
      const previous:{hash:string}[]=await m.query('SELECT request_hash hash FROM medication_reminders WHERE user_id=$1 AND request_id=$2',[userId,data.requestId]);
      if(previous[0]){if(previous[0].hash!==fingerprint)throw new ConflictException('Цей запит уже використано для іншого нагадування.');return {ownerId:userId};}
      await this.activeProduct(m,data.productId);
      const [{n}]:{n:number}[]=await m.query('SELECT count(*)::integer n FROM medication_reminders WHERE user_id=$1',[userId]);if(n>=100)throw new BadRequestException('Можна зберегти до 100 нагадувань.');
      await m.query('INSERT INTO medication_reminders(id,user_id,product_id,next_at,interval_days,active,request_id,request_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),userId,data.productId,date,data.intervalDays,data.active,data.requestId,fingerprint]);return {ownerId:userId};
    });
  }
  async updateReminder(userId:string,id:string,data:UpdateReminderDto){const date=this.date(data.nextAt);return this.db.transaction(async m=>{
    await this.activeProduct(m,data.productId,data.active);
    const rows:{revision:number}[]=await m.query('SELECT revision FROM medication_reminders WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);if(!rows.length)throw new NotFoundException('Нагадування не знайдено.');
    if(rows[0].revision!==data.revision)throw new ConflictException('Нагадування вже змінилося. Оновіть список.');
    await m.query('UPDATE medication_reminders SET product_id=$2,next_at=$3,interval_days=$4,active=$5,revision=revision+1 WHERE id=$1',[id,data.productId,date,data.intervalDays,data.active]);return {ownerId:userId};
  });}
  async deleteReminder(userId:string,id:string,revision:number){return this.db.transaction(async m=>{
    const rows:{revision:number}[]=await m.query('SELECT revision FROM medication_reminders WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);if(!rows.length)throw new NotFoundException('Нагадування не знайдено.');
    if(rows[0].revision!==revision)throw new ConflictException('Нагадування вже змінилося. Перевірте його перед видаленням.');
    await m.query('DELETE FROM medication_reminders WHERE id=$1',[id]);return {ownerId:userId};
  });}
  private eventId(event:OutboxEvent,key:string){const value=event.payload[key];if(typeof value!=='string'||!/^[-0-9a-f]{36}$/i.test(value))throw Error('Invalid event identifier.');return value;}
  private eventRevision(event:OutboxEvent,key:string){const value=event.payload[key];if(typeof value!=='number'||!Number.isInteger(value)||value<0)throw Error('Invalid event revision.');return value;}
  async deliverAvailability(event:OutboxEvent){
    const productId=this.eventId(event,'productId'),pharmacyId=this.eventId(event,'pharmacyId');
    await this.db.query(`INSERT INTO notifications(id,user_id,event_id,kind,title,body)
      SELECT gen_random_uuid(),a.user_id,$1,'AVAILABILITY','Товар знову в наявності',p.name || ' є в наявності: ' || ph.name || ', ' || ph.address || '.'
      FROM availability_subscriptions a JOIN products p ON p.id=a.product_id JOIN pharmacies ph ON ph.id=a.pharmacy_id JOIN stock_items s ON s.product_id=p.id AND s.pharmacy_id=ph.id
      WHERE a.product_id=$2 AND a.pharmacy_id=$3 AND a.subscribed_at<=(SELECT created_at FROM outbox_events WHERE id=$1) AND p.active AND ph.active AND s.on_hand-s.reserved>0
      ON CONFLICT(user_id,event_id) DO NOTHING`,[event.id,productId,pharmacyId]);
  }
  async deliverPromotion(event:OutboxEvent){
    const id=this.eventId(event,'promotionId'),generation=this.eventRevision(event,'generation');
    await this.db.transaction(async m=>{
      const rows:{name:string;discountBps:number;startsAt:Date;endsAt:Date;active:boolean;generation:number;now:Date}[]=await m.query('SELECT name,discount_bps "discountBps",starts_at "startsAt",ends_at "endsAt",active,notification_generation generation,clock_timestamp() now FROM promotions WHERE id=$1 FOR SHARE',[id]);
      const p=rows[0];if(!p||!p.active||p.generation!==generation||p.endsAt<=p.now)return;
      if(p.startsAt>p.now)throw new DeferredEvent(p.startsAt);
      const rate=new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(p.discountBps/100);
      await m.query(`INSERT INTO notifications(id,user_id,event_id,kind,title,body)
        SELECT gen_random_uuid(),u.id,$1,'PROMOTION','Нова акція',$2 FROM users u
        WHERE u.promotion_opt_in AND u.promotion_opt_in_since<=greatest((SELECT created_at FROM outbox_events WHERE id=$1),(SELECT starts_at FROM promotions WHERE id=$3)) ON CONFLICT(user_id,event_id) DO NOTHING`,[event.id,p.name+': знижка '+rate+'% на вибрані товари. Деталі та підсумкова ціна доступні під час оформлення.',id]);
    });
  }
  async deliverReminder(event:OutboxEvent){
    const id=this.eventId(event,'reminderId'),userId=this.eventId(event,'userId'),revision=this.eventRevision(event,'revision');
    await this.db.transaction(async m=>{
      const rows:{name:string}[]=await m.query('SELECT p.name FROM medication_reminders r JOIN products p ON p.id=r.product_id WHERE r.id=$1 AND r.user_id=$2 AND r.revision=$3 AND r.active AND p.active FOR SHARE OF r',[id,userId,revision]);
      if(!rows[0])return;
      await m.query("INSERT INTO notifications(id,user_id,event_id,kind,title,body) VALUES ($1,$2,$3,'REMINDER','Нагадування про замовлення',$4) ON CONFLICT(user_id,event_id) DO NOTHING",[randomUUID(),userId,event.id,rows[0].name+': настав запланований час перевірити потребу в повторному замовленні.']);
    });
  }

}
