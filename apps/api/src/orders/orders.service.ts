import { InventoryService } from '../inventory/inventory.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { PricingService } from '../loyalty/pricing.service.js';
import { roundBps } from '../loyalty/loyalty-policy.js';
import { CartService } from '../cart/cart.service.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AdminOrdersQueryDto, CheckoutDto, OrderActionDto, QuoteDto } from './orders.dto.js';
import { InvalidOrderAction, Order } from './order-state.js';
import type { FulfillmentMode, OrderStatus } from './order-state.js';
interface CartRow { id:string; revision:number; }
interface Item { productId:string; name:string; priceMinor:number; quantity:number; active:boolean; requiresPrescription:boolean; socialEligible:boolean; }
interface Pharmacy { id:string; name:string; address:string; active:boolean; }
interface Stock { productId:string; available:number; }
interface QuoteRow { id:string; pharmacyId:string; mode:'PICKUP'|'COURIER'; cartRevision:number; fingerprint:string; expiresAt:Date; }
interface OrderRow { id:string; ownerId:string; requestHash:string; pharmacyId:string; pharmacyName:string; pharmacyAddress:string; mode:FulfillmentMode; status:OrderStatus; contact:object; address:object|null; subtotalMinor:string; deliveryMinor:number; totalMinor:string; createdAt:Date; cancelledAt:Date|null; completedAt:Date|null; discountMinor:string; bonusRateBps:number; awardedBonusMinor:string; }
const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class OrdersService {
  constructor(private readonly db:DataSource,private readonly cartService:CartService,private readonly pricing:PricingService,private readonly loyalty:LoyaltyService,private readonly inventoryService:InventoryService) {}
  private async lockUser(m:EntityManager, userId:string) {
    const users:unknown[] = await m.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    if (!users.length) throw new UnauthorizedException();
  }
  private async cart(m:EntityManager,userId:string,revision:number,lock=false) {
    const rows:CartRow[] = await m.query('SELECT id,revision FROM carts WHERE user_id=$1',[userId]);
    if (!rows[0] || rows[0].revision!==revision) throw new ConflictException('Кошик змінився. Поверніться до кошика й оновіть оформлення.');
    const items:Item[] = await m.query(`SELECT p.id "productId",p.name,p.price_minor "priceMinor",p.active,p.requires_prescription "requiresPrescription",p.social_eligible "socialEligible",ci.quantity
      FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=$1 ORDER BY p.id ${lock?'FOR SHARE OF p':''}`,[rows[0].id]);
    if (!items.length) throw new BadRequestException('Кошик порожній.');
    if (items.some(i=>!i.active)) throw new ConflictException('Один із товарів більше недоступний. Оновіть кошик.');
    return {cart:rows[0],items};
  }
  private async pharmacy(m:EntityManager,id:string,lock=false) {
    const rows:Pharmacy[] = await m.query(`SELECT id,name,address,active FROM pharmacies WHERE id=$1 ${lock?'FOR SHARE':''}`,[id]);
    if (!rows[0]?.active) throw new ConflictException('Ця аптека більше не приймає замовлення. Виберіть іншу.');
    return rows[0];
  }
  private async stock(m:EntityManager,pharmacyId:string,items:Item[],lock=false) {
    const rows:Stock[] = await m.query(`SELECT product_id "productId",(on_hand-reserved)::integer available FROM stock_items
      WHERE pharmacy_id=$1 AND product_id=ANY($2::uuid[]) ORDER BY product_id ${lock?'FOR UPDATE':''}`,[pharmacyId,items.map(i=>i.productId)]);
    return new Map(rows.map(r=>[r.productId,r.available]));
  }
  private shortages(items:Item[],stock:Map<string,number>) {
    return items.filter(i=>(stock.get(i.productId)??0)<i.quantity).map(i=>({productId:i.productId,name:i.name,requested:i.quantity,available:stock.get(i.productId)??0}));
  }
  private requireStock(items:Item[],stock:Map<string,number>) {
    const missing=this.shortages(items,stock);
    if(missing.length) throw new ConflictException('Недостатньо товарів в обраній аптеці: '+missing.map(i=>`${i.name} (доступно ${i.available} шт.)`).join(', ')+'. Резерв не створено.');
  }
  private fingerprint(cart:CartRow,items:Item[],pharmacy:Pharmacy,mode:string,price:unknown) {
    return hash({cart,items,pharmacy,mode,price});
  }
  async options(userId:string,revision:number) {
    return this.db.transaction('REPEATABLE READ',async m=>{
      const {items}=await this.cart(m,userId,revision);
      const pharmacies:Pharmacy[]=await m.query('SELECT id,name,address,active FROM pharmacies WHERE active ORDER BY name,id');
      const result=[];
      for(const ph of pharmacies) {
        const shortages=this.shortages(items,await this.stock(m,ph.id,items));
        result.push({id:ph.id,name:ph.name,address:ph.address,available:!shortages.length,shortages});
      }
      return {ownerId:userId,pharmacies:result};
    });
  }
  async quote(userId:string,data:QuoteDto) {
    return this.db.transaction(async m=>{
      await this.lockUser(m,userId);
      const {cart,items}=await this.cart(m,userId,data.revision,true);
      const ph=await this.pharmacy(m,data.pharmacyId,true);
      this.requireStock(items,await this.stock(m,ph.id,items));
      const price=await this.pricing.forUser(m,userId,items,data.mode);
      const id=randomUUID(),expiresAt=new Date(Date.now()+10*60*1000);
      // Retain quotes referenced by orders; discard only expired, unused estimates.
      await m.query('DELETE FROM order_quotes q WHERE user_id=$1 AND expires_at<now() AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.quote_id=q.id)',[userId]);
      await m.query('INSERT INTO order_quotes(id,user_id,pharmacy_id,mode,cart_revision,fingerprint,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,userId,ph.id,data.mode,cart.revision,this.fingerprint(cart,items,ph,data.mode,price),expiresAt]);
      return {ownerId:userId,id,expiresAt,mode:data.mode,revision:cart.revision,pharmacy:{id:ph.id,name:ph.name,address:ph.address},
        ...price};
    });
  }
  private async read(m:EntityManager,userId:string,id:string) {
    const rows:OrderRow[]=await m.query(`SELECT id,user_id "ownerId",request_hash "requestHash",pharmacy_id "pharmacyId",pharmacy_name "pharmacyName",pharmacy_address "pharmacyAddress",mode,status,contact,address,
      subtotal_minor "subtotalMinor",delivery_minor "deliveryMinor",total_minor "totalMinor",created_at "createdAt",cancelled_at "cancelledAt",completed_at "completedAt",discount_minor "discountMinor",bonus_rate_bps "bonusRateBps",coalesce((SELECT amount_minor FROM bonus_entries b WHERE b.order_id=orders.id),0) "awardedBonusMinor" FROM orders WHERE id=$1 AND user_id=$2`,[id,userId]);
    if(!rows[0])throw new NotFoundException('Замовлення не знайдено.');
    const {requestHash,...order}=rows[0];
    void requestHash;
    const items:(Item&{discountBps:number;discountMinor:string;discountSource:string|null;lineTotalMinor:string;lineSubtotalMinor:string})[]=await m.query('SELECT product_id "productId",name,price_minor "priceMinor",quantity,requires_prescription "requiresPrescription",discount_bps "discountBps",discount_minor "discountMinor",discount_source "discountSource",line_total_minor "lineTotalMinor",price_minor::bigint*quantity "lineSubtotalMinor" FROM order_items WHERE order_id=$1 ORDER BY product_id',[id]);
    const subtotalMinor=Number(order.subtotalMinor),discountMinor=Number(order.discountMinor),itemsTotalMinor=subtotalMinor-discountMinor;
    return {...order,allowedActions:new Order(order.status,order.mode).actions,subtotalMinor,discountMinor,itemsTotalMinor,totalMinor:Number(order.totalMinor),awardedBonusMinor:Number(order.awardedBonusMinor),expectedBonusMinor:roundBps(itemsTotalMinor,order.bonusRateBps),items:items.map(i=>({...i,discountMinor:Number(i.discountMinor),lineTotalMinor:Number(i.lineTotalMinor),lineSubtotalMinor:Number(i.lineSubtotalMinor)}))};
  }
  async create(userId:string,data:CheckoutDto) {
    const requestHash=hash({quoteId:data.quoteId.toLowerCase(),contact:{name:data.contact.name,phone:data.contact.phone,email:data.contact.email},address:data.address?{city:data.address.city,street:data.address.street,building:data.address.building,apartment:data.address.apartment??''}:null});
    return this.db.transaction(async m=>{
      await this.lockUser(m,userId);
      const previous:{id:string;requestHash:string}[]=await m.query('SELECT id,request_hash "requestHash" FROM orders WHERE user_id=$1 AND request_id=$2',[userId,data.requestId]);
      if(previous[0]) {
        if(previous[0].requestHash!==requestHash)throw new ConflictException('Цей запит уже використано для іншого замовлення.');
        return this.read(m,userId,previous[0].id);
      }
      const quotes:QuoteRow[]=await m.query('SELECT id,pharmacy_id "pharmacyId",mode,cart_revision "cartRevision",fingerprint,expires_at "expiresAt" FROM order_quotes WHERE id=$1 AND user_id=$2',[data.quoteId,userId]);
      const quote=quotes[0];
      if(!quote)throw new NotFoundException('Розрахунок не знайдено.');
      if(quote.expiresAt.getTime()<=Date.now())throw new ConflictException('Термін розрахунку минув. Оновіть підсумок і підтвердьте ще раз.');
      if(quote.mode==='COURIER'&&!data.address)throw new BadRequestException('Для кур’єра потрібна адреса доставки.');
      if(quote.mode==='PICKUP'&&data.address)throw new BadRequestException('Для самовивозу адреса доставки не потрібна.');
      const used:unknown[]=await m.query('SELECT id FROM orders WHERE quote_id=$1',[quote.id]);
      if(used.length)throw new ConflictException('За цим розрахунком уже створено замовлення. Перегляньте історію.');
      const {cart,items}=await this.cart(m,userId,quote.cartRevision,true);
      const ph=await this.pharmacy(m,quote.pharmacyId,true);
      const price=await this.pricing.forUser(m,userId,items,quote.mode);
      if(this.fingerprint(cart,items,ph,quote.mode,price)!==quote.fingerprint)throw new ConflictException('Ціна або склад замовлення змінилися. Оновіть підсумок і підтвердьте ще раз.');
      this.requireStock(items,await this.stock(m,ph.id,items,true));
      const id=randomUUID();
      await m.query(`INSERT INTO orders(id,user_id,quote_id,request_id,request_hash,pharmacy_id,pharmacy_name,pharmacy_address,mode,contact,address,subtotal_minor,delivery_minor,total_minor,discount_minor,bonus_rate_bps)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[id,userId,quote.id,data.requestId,requestHash,ph.id,ph.name,ph.address,quote.mode,JSON.stringify(data.contact),data.address?JSON.stringify(data.address):null,price.subtotalMinor,price.deliveryMinor,price.totalMinor,price.discountMinor,price.bonusRateBps]);
      for(const item of price.items) {
        await m.query('UPDATE stock_items SET reserved=reserved+$3 WHERE pharmacy_id=$1 AND product_id=$2',[ph.id,item.productId,item.quantity]);
        await m.query('INSERT INTO order_items(id,order_id,product_id,name,price_minor,quantity,requires_prescription,discount_bps,discount_minor,discount_source,line_total_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[randomUUID(),id,item.productId,item.name,item.priceMinor,item.quantity,item.requiresPrescription,item.discountBps,item.discountMinor,item.discountSource,item.lineTotalMinor]);
      }
      await m.query('DELETE FROM cart_items WHERE cart_id=$1',[cart.id]);
      await m.query('UPDATE carts SET revision=revision+1 WHERE id=$1',[cart.id]);
      return this.read(m,userId,id);
    });
  }
  async get(userId:string,id:string){return this.db.transaction('REPEATABLE READ',m=>this.read(m,userId,id));}
  async list(userId:string,page:number) {
    return this.db.transaction('REPEATABLE READ',async m=>{
      const [{total}]:{total:number}[]=await m.query('SELECT count(*)::integer total FROM orders WHERE user_id=$1',[userId]);
      const rows:{id:string}[]=await m.query('SELECT id FROM orders WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $2',[userId,(page-1)*20]);
      const items=[];for(const row of rows)items.push(await this.read(m,userId,row.id));
      return {ownerId:userId,items,total,page,limit:20};
    });
  }
  repeatPreview(userId:string,id:string){return this.cartService.repeatPreview(userId,id);}
  async repeat(userId:string,id:string,revision:number,requestId:string){return {ownerId:userId,cart:await this.cartService.repeat(userId,id,revision,requestId)};}
  private async admin(m:EntityManager,actorId:string) {
    const rows:{role:string}[]=await m.query('SELECT role FROM users WHERE id=$1 FOR SHARE',[actorId]);
    if(rows[0]?.role!=='ADMIN')throw new ForbiddenException('Потрібні права адміністратора.');
  }
  private async history(m:EntityManager,id:string) {
    return m.query('SELECT id,actor_id "actorId",action,from_status "fromStatus",to_status "toStatus",created_at "createdAt" FROM order_transitions WHERE order_id=$1 ORDER BY created_at,id',[id]);
  }
  async adminGet(actorId:string,id:string) {
    return this.db.transaction('REPEATABLE READ',async m=>{
      await this.admin(m,actorId);
      const rows:{ownerId:string}[]=await m.query('SELECT user_id "ownerId" FROM orders WHERE id=$1',[id]);
      if(!rows[0])throw new NotFoundException('Замовлення не знайдено.');
      return {ownerId:actorId,order:await this.read(m,rows[0].ownerId,id),history:await this.history(m,id)};
    });
  }
  async adminList(actorId:string,query:AdminOrdersQueryDto) {
    return this.db.transaction('REPEATABLE READ',async m=>{
      await this.admin(m,actorId);
      const statuses=query.status==='ACTIVE'?['NEW','CONFIRMED','READY_FOR_PICKUP','OUT_FOR_DELIVERY']:query.status==='ALL'?null:[query.status];
      const [{total}]:{total:number}[]=await m.query('SELECT count(*)::integer total FROM orders WHERE ($1::varchar[] IS NULL OR status=ANY($1))',[statuses]);
      const rows:{id:string;ownerId:string}[]=await m.query('SELECT id,user_id "ownerId" FROM orders WHERE ($1::varchar[] IS NULL OR status=ANY($1)) ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $2',[statuses,(query.page-1)*20]);
      const items=[];for(const row of rows)items.push(await this.read(m,row.ownerId,row.id));
      return {ownerId:actorId,items,total,page:query.page,limit:20};
    });
  }
  private async change(m:EntityManager,actorId:string,id:string,data:OrderActionDto,admin:boolean) {
    if(admin)await this.admin(m,actorId);
    // One lock protects both customer cancellation and every administrator action.
    const rows:{ownerId:string;status:OrderStatus;mode:FulfillmentMode;pharmacyId:string}[]=await m.query(`SELECT user_id "ownerId",status,mode,pharmacy_id "pharmacyId" FROM orders WHERE id=$1 ${admin?'':'AND user_id=$2'} FOR UPDATE`,admin?[id]:[id,actorId]);
    const row=rows[0];if(!row)throw new NotFoundException('Замовлення не знайдено.');
    const previous:{orderId:string;action:string;expectedStatus:string}[]=await m.query('SELECT order_id "orderId",action,expected_status "expectedStatus" FROM order_transitions WHERE actor_id=$1 AND request_id=$2',[actorId,data.requestId]);
    if(previous[0]) {
      if(previous[0].orderId!==id||previous[0].action!==data.action||previous[0].expectedStatus!==data.expectedStatus)throw new ConflictException('Цей запит уже використано для іншої дії.');
      return this.read(m,row.ownerId,id);
    }
    if(!admin&&data.action==='CANCEL'&&row.status==='CANCELLED')return this.read(m,row.ownerId,id);
    if(row.status!==data.expectedStatus)throw new ConflictException('Статус уже змінився. Оновіть замовлення та виберіть дію ще раз.');
    const order=new Order(row.status,row.mode);
    let next:OrderStatus;
    try{next=order.apply(data.action);}catch(e){if(e instanceof InvalidOrderAction)throw new ConflictException(e.message);throw e;}
    if(next==='CANCELLED'||next==='COMPLETED')await this.inventoryService.releaseOrConsume(m,id,row.pharmacyId,next==='COMPLETED');
    if(next==='COMPLETED')await this.loyalty.award(m,row.ownerId,id);
    await m.query("UPDATE orders SET status=$2::varchar,cancelled_at=CASE WHEN $2::varchar='CANCELLED' THEN clock_timestamp() ELSE NULL END,completed_at=CASE WHEN $2::varchar='COMPLETED' THEN clock_timestamp() ELSE NULL END WHERE id=$1",[id,next]);
    await m.query('INSERT INTO order_transitions(id,order_id,actor_id,request_id,expected_status,action,from_status,to_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),id,actorId,data.requestId,data.expectedStatus,data.action,row.status,next]);
    return this.read(m,row.ownerId,id);
  }
  async adminAction(actorId:string,id:string,data:OrderActionDto) {
    try {
      return await this.db.transaction(async m=>({ownerId:actorId,order:await this.change(m,actorId,id,data,true),history:await this.history(m,id)}));
    }catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('Цей запит уже використано. Оновіть список замовлень.');throw e;}
  }
  async cancel(userId:string,id:string) {
    return this.db.transaction(async m=>{
      const rows:{status:OrderStatus}[]=await m.query('SELECT status FROM orders WHERE id=$1 AND user_id=$2',[id,userId]);
      if(!rows[0])throw new NotFoundException('Замовлення не знайдено.');
      return this.change(m,userId,id,{action:'CANCEL',expectedStatus:rows[0].status,requestId:randomUUID()},false);
    });
  }
}
