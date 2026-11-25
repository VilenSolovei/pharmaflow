import { OutboxService } from '../events/outbox.service.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CreatePromotionDto, LoyaltySearchDto, SocialEligibilityDto, TierDto, UpdatePromotionDto } from './loyalty.dto.js';
import { roundBps } from './loyalty-policy.js';
interface PromotionRow {id:string;name:string;discountBps:number;startsAt:Date;endsAt:Date;active:boolean;revision:number;phase:string;}
@Injectable()
export class LoyaltyService {
  constructor(private readonly db:DataSource,private readonly outbox:OutboxService){}
  private async admin(m:EntityManager,actorId:string){const rows:{role:string}[]=await m.query('SELECT role FROM users WHERE id=$1',[actorId]);if(rows[0]?.role!=='ADMIN')throw new ForbiddenException('Потрібні права адміністратора.');}
  private async lockPricing(m:EntityManager){await m.query('SELECT id FROM pricing_revision WHERE id=1 FOR UPDATE');}
  private async changed(m:EntityManager){await m.query('UPDATE pricing_revision SET revision=revision+1 WHERE id=1');}
  async award(m:EntityManager,userId:string,orderId:string){
    const rows:{subtotal:string;discount:string;rate:number}[]=await m.query('SELECT subtotal_minor subtotal,discount_minor discount,bonus_rate_bps rate FROM orders WHERE id=$1 AND user_id=$2',[orderId,userId]);
    if(!rows[0])throw new NotFoundException('Замовлення не знайдено.');
    const amount=roundBps(Number(rows[0].subtotal)-Number(rows[0].discount),rows[0].rate);
    if(!amount)return;
    await m.query('INSERT INTO loyalty_cards(user_id) VALUES ($1) ON CONFLICT(user_id) DO NOTHING',[userId]);
    const inserted:{amount:string}[]=await m.query('WITH added AS (INSERT INTO bonus_entries(id,user_id,order_id,amount_minor) VALUES ($1,$2,$3,$4) ON CONFLICT(order_id) DO NOTHING RETURNING amount_minor) SELECT amount_minor amount FROM added',[randomUUID(),userId,orderId,amount]);
    if(inserted.length)await m.query('UPDATE loyalty_cards SET balance_minor=balance_minor+$2 WHERE user_id=$1',[userId,amount]);
  }
  async card(userId:string,page:number){
    return this.db.transaction(async m=>{
      await m.query('INSERT INTO loyalty_cards(user_id) VALUES ($1) ON CONFLICT(user_id) DO NOTHING',[userId]);
      // A single statement gives a consistent balance and ledger snapshot.
      const rows:{number:string;balance:string;tier:string;total:number;items:{id:string;orderId:string;amountMinor:number;createdAt:string}[]}[]=await m.query(`SELECT c.number::text number,c.balance_minor::text balance,u.tier,
        (SELECT count(*)::integer FROM bonus_entries b WHERE b.user_id=c.user_id) total,
        coalesce((SELECT jsonb_agg(v) FROM (SELECT b.id,b.order_id "orderId",b.amount_minor::double precision "amountMinor",b.created_at "createdAt" FROM bonus_entries b WHERE b.user_id=c.user_id ORDER BY b.created_at DESC,b.id DESC LIMIT 20 OFFSET $2) v),'[]'::jsonb) items
        FROM loyalty_cards c JOIN users u ON u.id=c.user_id WHERE c.user_id=$1`,[userId,(page-1)*20]);
      const card=rows[0];return {ownerId:userId,number:'PF-'+card.number.padStart(8,'0'),balanceMinor:Number(card.balance),tier:card.tier,items:card.items,total:card.total,page,limit:20};
    });
  }
  private escaped(value:string){return '%'+value.replace(/[\\%_]/g,'\\$&')+'%';}
  async customers(actorId:string,q:LoyaltySearchDto){
    return this.db.transaction('REPEATABLE READ',async m=>{
      await this.admin(m,actorId);const term=this.escaped(q.q);
      const [{total}]:{total:number}[]=await m.query('SELECT count(*)::integer total FROM users WHERE email ILIKE $1 OR full_name ILIKE $1',[term]);
      const items=await m.query('SELECT id,email,full_name name,role,tier,tier_revision revision FROM users WHERE email ILIKE $1 OR full_name ILIKE $1 ORDER BY email,id LIMIT 20 OFFSET $2',[term,(q.page-1)*20]);
      return {ownerId:actorId,items,total,page:q.page,limit:20};
    });
  }
  async tier(actorId:string,id:string,data:TierDto){
    return this.db.transaction(async m=>{
      await this.admin(m,actorId);
      const rows:{revision:number;tier:string}[]=await m.query('SELECT tier_revision revision,tier FROM users WHERE id=$1 FOR UPDATE',[id]);
      if(!rows[0])throw new NotFoundException('Користувача не знайдено.');
      if(rows[0].revision!==data.revision)throw new ConflictException('Категорія вже змінилася. Оновіть список.');
      if(rows[0].tier!==data.tier){await this.lockPricing(m);await m.query('UPDATE users SET tier=$2,tier_revision=tier_revision+1 WHERE id=$1',[id,data.tier]);await this.changed(m);}
      return {ownerId:actorId};
    });
  }
  async products(actorId:string,q:LoyaltySearchDto){
    return this.db.transaction('REPEATABLE READ',async m=>{
      await this.admin(m,actorId);const term=this.escaped(q.q);
      const [{total}]:{total:number}[]=await m.query('SELECT count(*)::integer total FROM products WHERE active AND name ILIKE $1',[term]);
      const items=await m.query('SELECT id,name,social_eligible "socialEligible",loyalty_revision revision FROM products WHERE active AND name ILIKE $1 ORDER BY name,id LIMIT 20 OFFSET $2',[term,(q.page-1)*20]);
      return {ownerId:actorId,items,total,page:q.page,limit:20};
    });
  }
  async social(actorId:string,id:string,data:SocialEligibilityDto){
    return this.db.transaction(async m=>{
      await this.admin(m,actorId);
      const rows:{revision:number;eligible:boolean}[]=await m.query('SELECT loyalty_revision revision,social_eligible eligible FROM products WHERE id=$1 AND active FOR UPDATE',[id]);
      if(!rows[0])throw new NotFoundException('Товар не знайдено.');
      if(rows[0].revision!==data.revision)throw new ConflictException('Умови товару вже змінилися. Оновіть список.');
      if(rows[0].eligible!==data.socialEligible){await this.lockPricing(m);await m.query('UPDATE products SET social_eligible=$2,loyalty_revision=loyalty_revision+1 WHERE id=$1',[id,data.socialEligible]);await this.changed(m);}
      return {ownerId:actorId};
    });
  }
  private validatePromotion(data:CreatePromotionDto|UpdatePromotionDto){
    const from=new Date(data.startsAt).getTime(),to=new Date(data.endsAt).getTime();
    if(!Number.isFinite(from)||!Number.isFinite(to)||new Date(from).getUTCFullYear()<1||new Date(to).getUTCFullYear()<1||from>=to)throw new BadRequestException('Завершення акції має бути пізніше за її початок.');
  }
  private async requireProducts(m:EntityManager,ids:string[],active=true){const rows:unknown[]=await m.query(`SELECT id FROM products WHERE ${active?'active AND ':''}id=ANY($1::uuid[]) ORDER BY id FOR SHARE`,[ids]);if(rows.length!==ids.length)throw new NotFoundException('Один із товарів акції більше недоступний.');}
  private async promotion(m:EntityManager,id:string){
    const rows:PromotionRow[]=await m.query(`SELECT id,name,discount_bps "discountBps",starts_at "startsAt",ends_at "endsAt",active,revision,CASE WHEN NOT active THEN 'DISABLED' WHEN starts_at>clock_timestamp() THEN 'SCHEDULED' WHEN ends_at<=clock_timestamp() THEN 'EXPIRED' ELSE 'ACTIVE' END phase FROM promotions WHERE id=$1`,[id]);
    if(!rows[0])throw new NotFoundException('Акцію не знайдено.');
    const products:{id:string;name:string}[]=await m.query('SELECT p.id,p.name FROM promotion_items pi JOIN products p ON p.id=pi.product_id WHERE pi.promotion_id=$1 ORDER BY p.id',[id]);
    return {...rows[0],products};
  }
  async promotions(actorId:string,page:number){return this.db.transaction('REPEATABLE READ',async m=>{
    await this.admin(m,actorId);const [{total}]:{total:number}[]=await m.query('SELECT count(*)::integer total FROM promotions');
    const rows:{id:string}[]=await m.query('SELECT id FROM promotions ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $1',[(page-1)*20]);const items=[];for(const row of rows)items.push(await this.promotion(m,row.id));
    return {ownerId:actorId,items,total,page,limit:20};
  });}
  private async replayPromotion(m:EntityManager,actorId:string,requestId:string,fingerprint:string){
    const previous:{id:string;hash:string}[]=await m.query('SELECT id,request_hash hash FROM promotions WHERE created_by=$1 AND request_id=$2',[actorId,requestId]);
    if(!previous[0])return null;
    if(previous[0].hash!==fingerprint)throw new ConflictException('Цей запит уже використано для іншої акції.');
    return {ownerId:actorId,promotion:await this.promotion(m,previous[0].id)};
  }
  async createPromotion(actorId:string,data:CreatePromotionDto){
    this.validatePromotion(data);const ids=[...data.productIds].sort();
    const fingerprint=createHash('sha256').update(JSON.stringify({name:data.name,discountBps:data.discountBps,startsAt:new Date(data.startsAt).toISOString(),endsAt:new Date(data.endsAt).toISOString(),active:data.active,ids})).digest('hex');
    return this.db.transaction(async m=>{
      await this.admin(m,actorId);
      const replay=await this.replayPromotion(m,actorId,data.requestId,fingerprint);if(replay)return replay;
      await this.requireProducts(m,ids,data.active);await this.lockPricing(m);
      const concurrent=await this.replayPromotion(m,actorId,data.requestId,fingerprint);if(concurrent)return concurrent;
      const id=randomUUID();
      await m.query('INSERT INTO promotions(id,name,discount_bps,starts_at,ends_at,active,created_by,request_id,request_hash,notification_generation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,data.name,data.discountBps,data.startsAt,data.endsAt,data.active,actorId,data.requestId,fingerprint,data.active?1:0]);
      for(const productId of ids)await m.query('INSERT INTO promotion_items(promotion_id,product_id) VALUES ($1,$2)',[id,productId]);
      if(data.active)await this.outbox.enqueue(m,'PROMOTION_PUBLISHED',`promotion:${id}:1`,{promotionId:id,generation:1},new Date(data.startsAt));
      await this.changed(m);return {ownerId:actorId,promotion:await this.promotion(m,id)};
    });
  }
  async updatePromotion(actorId:string,id:string,data:UpdatePromotionDto){
    this.validatePromotion(data);
    return this.db.transaction(async m=>{
      await this.admin(m,actorId);await this.requireProducts(m,data.productIds,data.active);await this.lockPricing(m);
      const rows:{revision:number;active:boolean;generation:number}[]=await m.query('SELECT revision,active,notification_generation generation FROM promotions WHERE id=$1 FOR UPDATE',[id]);
      if(!rows[0])throw new NotFoundException('Акцію не знайдено.');
      if(rows[0].revision!==data.revision)throw new ConflictException('Акція вже змінилася. Оновіть список і відкрийте її ще раз.');
      const generation=data.active&&(!rows[0].active||rows[0].generation===0)?rows[0].generation+1:rows[0].generation;
      await m.query('UPDATE promotions SET name=$2,discount_bps=$3,starts_at=$4,ends_at=$5,active=$6,revision=revision+1,notification_generation=$7 WHERE id=$1',[id,data.name,data.discountBps,data.startsAt,data.endsAt,data.active,generation]);
      await m.query('DELETE FROM promotion_items WHERE promotion_id=$1',[id]);for(const productId of data.productIds)await m.query('INSERT INTO promotion_items(promotion_id,product_id) VALUES ($1,$2)',[id,productId]);
      if(data.active)await this.outbox.enqueue(m,'PROMOTION_PUBLISHED',`promotion:${id}:${generation}`,{promotionId:id,generation},new Date(data.startsAt));
      await this.changed(m);return {ownerId:actorId,promotion:await this.promotion(m,id)};
    });
  }
}
