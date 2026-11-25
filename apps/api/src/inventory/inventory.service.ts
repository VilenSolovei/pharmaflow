import { ConflictException, Injectable, Module, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { OutboxModule, OutboxService } from '../events/outbox.service.js';
@Injectable()
export class InventoryService {
  constructor(private readonly outbox:OutboxService){}
  async adjust(m:EntityManager,actorId:string,data:{productId:string;pharmacyId:string;expectedOnHand:number;expectedReserved:number;onHand:number;reason:string;requestId:string}){
    for(const [table,id] of [['products',data.productId],['pharmacies',data.pharmacyId]]){
      if(!(await m.query(`SELECT id FROM ${table} WHERE id=$1 AND active FOR SHARE`,[id])).length)throw new NotFoundException('Товар або аптека неактивні чи більше недоступні.');
    }
    await m.query('INSERT INTO stock_items(id,product_id,pharmacy_id,on_hand,reserved) VALUES ($1,$2,$3,0,0) ON CONFLICT(product_id,pharmacy_id) DO NOTHING',[randomUUID(),data.productId,data.pharmacyId]);
    const [before]:{onHand:number;reserved:number}[]=await m.query('SELECT on_hand "onHand",reserved FROM stock_items WHERE product_id=$1 AND pharmacy_id=$2 FOR UPDATE',[data.productId,data.pharmacyId]);
    if(before.onHand!==data.expectedOnHand||before.reserved!==data.expectedReserved)throw new ConflictException('Залишок або резерв уже змінився. Оновіть список перед коригуванням.');
    if(data.onHand<before.reserved)throw new ConflictException('Фактичний залишок не може бути меншим за активний резерв.');
    await m.query('UPDATE stock_items SET on_hand=$3 WHERE product_id=$1 AND pharmacy_id=$2',[data.productId,data.pharmacyId,data.onHand]);
    const adjustmentId=randomUUID();
    await m.query('INSERT INTO stock_adjustments(id,actor_id,request_id,product_id,pharmacy_id,before_on_hand,after_on_hand,reserved,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[adjustmentId,actorId,data.requestId,data.productId,data.pharmacyId,before.onHand,data.onHand,before.reserved,data.reason]);
    if(before.onHand-before.reserved===0&&data.onHand-before.reserved>0)await this.outbox.enqueue(m,'STOCK_AVAILABLE','adjust:'+adjustmentId,{productId:data.productId,pharmacyId:data.pharmacyId});
    return {productId:data.productId,pharmacyId:data.pharmacyId,onHand:data.onHand,reserved:before.reserved,available:data.onHand-before.reserved,adjustmentId};
  }
  async releaseOrConsume(m:EntityManager,orderId:string,pharmacyId:string,complete:boolean){
    const items:{productId:string;quantity:number}[]=await m.query('SELECT product_id "productId",quantity FROM order_items WHERE order_id=$1 ORDER BY product_id',[orderId]);
    const stock:{productId:string;reserved:number;onHand:number}[]=await m.query('SELECT product_id "productId",reserved,on_hand "onHand" FROM stock_items WHERE pharmacy_id=$1 AND product_id=ANY($2::uuid[]) ORDER BY product_id FOR UPDATE',[pharmacyId,items.map(i=>i.productId)]);
    const byProduct=new Map(stock.map(i=>[i.productId,i]));
    if(!items.length||items.some(i=>{const row=byProduct.get(i.productId);return !row||row.reserved<i.quantity||(complete&&row.onHand<i.quantity);}))throw new ConflictException('Залишки не узгоджені з резервом. Зміни не виконано; перевірте залишки аптеки.');
    for(const item of items){
      const before=byProduct.get(item.productId)!;
      await m.query(`UPDATE stock_items SET reserved=reserved-$3${complete?',on_hand=on_hand-$3':''} WHERE pharmacy_id=$1 AND product_id=$2`,[pharmacyId,item.productId,item.quantity]);
      if(!complete&&before.onHand-before.reserved===0)await this.outbox.enqueue(m,'STOCK_AVAILABLE',`cancel:${orderId}:${item.productId}`,{productId:item.productId,pharmacyId});
    }
  }
}
@Module({imports:[OutboxModule],providers:[InventoryService],exports:[InventoryService]})
export class InventoryModule {}
