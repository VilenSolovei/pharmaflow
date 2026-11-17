import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CartItemDto, ReplaceCartDto } from './cart.dto.js';
interface ItemRow {productId:string;name:string;priceMinor:number;active:boolean;available:number;quantity:number;}
interface CartRow {id:string;revision:number;}
@Injectable()
export class CartService {
 constructor(private readonly db:DataSource){}
 private async describe(manager:EntityManager,items:CartItemDto[],includeInactive=true){
  if(!items.length)return [];
  const rows:Omit<ItemRow,'quantity'>[]=await manager.query(`SELECT p.id "productId",p.name,p.price_minor "priceMinor",p.active,
   CASE WHEN p.active THEN coalesce((SELECT sum(s.on_hand-s.reserved) FROM stock_items s JOIN pharmacies ph ON ph.id=s.pharmacy_id AND ph.active WHERE s.product_id=p.id),0)::integer ELSE 0 END available
   FROM products p WHERE p.id=ANY($1::uuid[]) ${includeInactive?'':'AND p.active'}`,[items.map(i=>i.productId)]);
  const map=new Map(rows.map(r=>[r.productId,r]));
  return items.map(i=>({...map.get(i.productId)??{productId:i.productId,name:'Товар недоступний',priceMinor:0,active:false,available:0},quantity:i.quantity}));
 }
 private result(items:ItemRow[],cart:CartRow|undefined,ownerId:string|null){
  return {ownerId,id:cart?.id??null,revision:cart?.revision??0,items:items.map(i=>({...i,lineTotalMinor:i.priceMinor*i.quantity})),
   totalMinor:items.reduce((sum,i)=>sum+i.priceMinor*i.quantity,0),count:items.reduce((sum,i)=>sum+i.quantity,0)};
 }
 async preview(items:CartItemDto[]){return this.result(await this.describe(this.db.manager,items,false),undefined,null);}
 private async read(manager:EntityManager,userId:string){
  const carts:CartRow[]=await manager.query('SELECT id,revision FROM carts WHERE user_id=$1',[userId]);
  const items:CartItemDto[]=carts[0]?await manager.query('SELECT product_id "productId",quantity FROM cart_items WHERE cart_id=$1 ORDER BY product_id',[carts[0].id]):[];
  return this.result(await this.describe(manager,items),carts[0],userId);
 }
 async get(userId:string){return this.db.transaction('REPEATABLE READ',m=>this.read(m,userId));}
 private async write(userId:string,change:(m:EntityManager,cart:CartRow)=>Promise<boolean>){
  return this.db.transaction(async m=>{
   const users:unknown[]=await m.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
   if(!users.length)throw new UnauthorizedException();
   await m.query('INSERT INTO carts(id,user_id) VALUES ($1,$2) ON CONFLICT(user_id) DO NOTHING',[randomUUID(),userId]);
   const carts:CartRow[]=await m.query('SELECT id,revision FROM carts WHERE user_id=$1',[userId]);
   if(await change(m,carts[0]))await m.query('UPDATE carts SET revision=revision+1 WHERE id=$1',[carts[0].id]);
   return this.read(m,userId);
  });
 }
 private async requireActive(m:EntityManager,ids:string[]){
  if(!ids.length)return;
  const rows:unknown[]=await m.query('SELECT id FROM products WHERE active AND id=ANY($1::uuid[])',[ids]);
  if(rows.length!==ids.length)throw new NotFoundException('Один із товарів більше недоступний. Оновіть кошик.');
 }
 async add(userId:string,item:CartItemDto){return this.write(userId,async(m,cart)=>{
  await this.requireActive(m,[item.productId]);
  const existing:{quantity:number}[]=await m.query('SELECT quantity FROM cart_items WHERE cart_id=$1 AND product_id=$2',[cart.id,item.productId]);
  const next=(existing[0]?.quantity??0)+item.quantity;
  if(next>99)throw new BadRequestException('Не більше 99 одиниць одного товару.');
  if(!existing.length){const rows:{count:number}[]=await m.query('SELECT count(*)::integer count FROM cart_items WHERE cart_id=$1',[cart.id]);if(rows[0].count>=100)throw new BadRequestException('У кошику може бути до 100 різних товарів.');}
  await m.query('INSERT INTO cart_items(id,cart_id,product_id,quantity) VALUES ($1,$2,$3,$4) ON CONFLICT(cart_id,product_id) DO UPDATE SET quantity=$4',[randomUUID(),cart.id,item.productId,next]);return true;
 });}
 async quantity(userId:string,productId:string,quantity:number){return this.write(userId,async(m,cart)=>{
  const rows:{count:number}[]=await m.query('WITH changed AS (UPDATE cart_items SET quantity=$3 WHERE cart_id=$1 AND product_id=$2 RETURNING id) SELECT count(*)::integer count FROM changed',[cart.id,productId,quantity]);
  if(!rows[0].count)throw new NotFoundException('Товар відсутній у кошику.');return true;
 });}
 async remove(userId:string,productId:string){return this.write(userId,async(m,cart)=>{
  const rows:{count:number}[]=await m.query('WITH removed AS (DELETE FROM cart_items WHERE cart_id=$1 AND product_id=$2 RETURNING id) SELECT count(*)::integer count FROM removed',[cart.id,productId]);return rows[0].count>0;
 });}
 async replace(userId:string,data:ReplaceCartDto){return this.write(userId,async(m,cart)=>{
  if(cart.revision!==data.revision)throw new ConflictException('Кошик змінився в іншому вікні. Перевірте його й повторіть дію.');
  await this.requireActive(m,data.items.map(i=>i.productId));
  await m.query('DELETE FROM cart_items WHERE cart_id=$1',[cart.id]);
  for(const i of data.items)await m.query('INSERT INTO cart_items(id,cart_id,product_id,quantity) VALUES ($1,$2,$3,$4)',[randomUUID(),cart.id,i.productId,i.quantity]);return true;
 });}
}
