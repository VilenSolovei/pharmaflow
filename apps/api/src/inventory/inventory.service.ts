import { ConflictException, Injectable, Module } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { OutboxModule, OutboxService } from '../events/outbox.service.js';
@Injectable()
export class InventoryService {
  constructor(private readonly outbox:OutboxService){}
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
