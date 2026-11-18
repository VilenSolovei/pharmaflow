import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CheckoutDto, QuoteDto } from './orders.dto.js';
interface CartRow { id:string; revision:number; }
interface Item { productId:string; name:string; priceMinor:number; quantity:number; active:boolean; requiresPrescription:boolean; }
interface Pharmacy { id:string; name:string; address:string; active:boolean; }
interface Stock { productId:string; available:number; }
interface QuoteRow { id:string; pharmacyId:string; mode:'PICKUP'|'COURIER'; cartRevision:number; fingerprint:string; expiresAt:Date; }
interface OrderRow { id:string; ownerId:string; requestHash:string; pharmacyId:string; pharmacyName:string; pharmacyAddress:string; mode:string; status:string; contact:object; address:object|null; subtotalMinor:string; deliveryMinor:number; totalMinor:string; createdAt:Date; cancelledAt:Date|null; }
const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class OrdersService {
  constructor(private readonly db:DataSource) {}
  private async lockUser(m:EntityManager, userId:string) {
    const users:unknown[] = await m.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    if (!users.length) throw new UnauthorizedException();
  }
  private async cart(m:EntityManager,userId:string,revision:number,lock=false) {
    const rows:CartRow[] = await m.query('SELECT id,revision FROM carts WHERE user_id=$1',[userId]);
    if (!rows[0] || rows[0].revision!==revision) throw new ConflictException('Кошик змінився. Поверніться до кошика й оновіть оформлення.');
    const items:Item[] = await m.query(`SELECT p.id "productId",p.name,p.price_minor "priceMinor",p.active,p.requires_prescription "requiresPrescription",ci.quantity
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
  private price(items:Item[],mode:string) {
    const subtotalMinor=items.reduce((sum,i)=>sum+i.priceMinor*i.quantity,0);
    const deliveryMinor=mode==='COURIER'?6000:0;
    return {subtotalMinor,deliveryMinor,totalMinor:subtotalMinor+deliveryMinor};
  }
  private fingerprint(cart:CartRow,items:Item[],pharmacy:Pharmacy,mode:string) {
    return hash({cart,items,pharmacy,mode,price:this.price(items,mode)});
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
      const id=randomUUID(),expiresAt=new Date(Date.now()+10*60*1000);
      // Retain quotes referenced by orders; discard only expired, unused estimates.
      await m.query('DELETE FROM order_quotes q WHERE user_id=$1 AND expires_at<now() AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.quote_id=q.id)',[userId]);
      await m.query('INSERT INTO order_quotes(id,user_id,pharmacy_id,mode,cart_revision,fingerprint,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,userId,ph.id,data.mode,cart.revision,this.fingerprint(cart,items,ph,data.mode),expiresAt]);
      return {ownerId:userId,id,expiresAt,mode:data.mode,revision:cart.revision,pharmacy:{id:ph.id,name:ph.name,address:ph.address},
        items:items.map(i=>({productId:i.productId,name:i.name,priceMinor:i.priceMinor,quantity:i.quantity,lineTotalMinor:i.priceMinor*i.quantity,requiresPrescription:i.requiresPrescription})),...this.price(items,data.mode)};
    });
  }
  private async read(m:EntityManager,userId:string,id:string) {
    const rows:OrderRow[]=await m.query(`SELECT id,user_id "ownerId",request_hash "requestHash",pharmacy_id "pharmacyId",pharmacy_name "pharmacyName",pharmacy_address "pharmacyAddress",mode,status,contact,address,
      subtotal_minor "subtotalMinor",delivery_minor "deliveryMinor",total_minor "totalMinor",created_at "createdAt",cancelled_at "cancelledAt" FROM orders WHERE id=$1 AND user_id=$2`,[id,userId]);
    if(!rows[0])throw new NotFoundException('Замовлення не знайдено.');
    const {requestHash,...order}=rows[0];
    void requestHash;
    const items:Item[]=await m.query('SELECT product_id "productId",name,price_minor "priceMinor",quantity,requires_prescription "requiresPrescription" FROM order_items WHERE order_id=$1 ORDER BY product_id',[id]);
    return {...order,subtotalMinor:Number(order.subtotalMinor),totalMinor:Number(order.totalMinor),items:items.map(i=>({...i,lineTotalMinor:i.priceMinor*i.quantity}))};
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
      if(this.fingerprint(cart,items,ph,quote.mode)!==quote.fingerprint)throw new ConflictException('Ціна або склад замовлення змінилися. Оновіть підсумок і підтвердьте ще раз.');
      this.requireStock(items,await this.stock(m,ph.id,items,true));
      const id=randomUUID(),price=this.price(items,quote.mode);
      await m.query(`INSERT INTO orders(id,user_id,quote_id,request_id,request_hash,pharmacy_id,pharmacy_name,pharmacy_address,mode,contact,address,subtotal_minor,delivery_minor,total_minor)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[id,userId,quote.id,data.requestId,requestHash,ph.id,ph.name,ph.address,quote.mode,JSON.stringify(data.contact),data.address?JSON.stringify(data.address):null,price.subtotalMinor,price.deliveryMinor,price.totalMinor]);
      for(const item of items) {
        await m.query('UPDATE stock_items SET reserved=reserved+$3 WHERE pharmacy_id=$1 AND product_id=$2',[ph.id,item.productId,item.quantity]);
        await m.query('INSERT INTO order_items(id,order_id,product_id,name,price_minor,quantity,requires_prescription) VALUES ($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),id,item.productId,item.name,item.priceMinor,item.quantity,item.requiresPrescription]);
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
  async cancel(userId:string,id:string) {
    return this.db.transaction(async m=>{
      await this.lockUser(m,userId);
      const rows:{status:string;pharmacyId:string}[]=await m.query('SELECT status,pharmacy_id "pharmacyId" FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);
      const order=rows[0];if(!order)throw new NotFoundException('Замовлення не знайдено.');
      if(order.status==='CANCELLED')return this.read(m,userId,id);
      if(!['NEW','CONFIRMED','READY_FOR_PICKUP'].includes(order.status))throw new ConflictException('Замовлення вже не можна скасувати.');
      const items:Item[]=await m.query('SELECT product_id "productId",quantity FROM order_items WHERE order_id=$1 ORDER BY product_id',[id]);
      // The same product order is used by checkout and cancellation to avoid lock cycles.
      const stock:{id:string}[]=await m.query('SELECT id FROM stock_items WHERE pharmacy_id=$1 AND product_id=ANY($2::uuid[]) ORDER BY product_id FOR UPDATE',[order.pharmacyId,items.map(i=>i.productId)]);
      if(stock.length!==items.length)throw new ConflictException('Не вдалося звільнити резерв. Оновіть сторінку й повторіть дію.');
      for(const item of items)await m.query('UPDATE stock_items SET reserved=reserved-$3 WHERE pharmacy_id=$1 AND product_id=$2',[order.pharmacyId,item.productId,item.quantity]);
      await m.query("UPDATE orders SET status='CANCELLED',cancelled_at=now() WHERE id=$1",[id]);
      return this.read(m,userId,id);
    });
  }
}
