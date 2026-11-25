import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { PremiumPolicy, roundBps, SocialPolicy, StandardPolicy } from './loyalty-policy.js';
import type { ClientTier, LoyaltyPolicy } from './loyalty-policy.js';
export interface PricingItem {productId:string;name:string;priceMinor:number;quantity:number;socialEligible:boolean;requiresPrescription:boolean;}
export interface PromotionRate {id:string;name:string;productId:string;discountBps:number;}
@Injectable()
export class PricingService {
  private readonly policies:Record<ClientTier,LoyaltyPolicy>={STANDARD:new StandardPolicy(),SOCIAL:new SocialPolicy(),PREMIUM:new PremiumPolicy()};
  calculate(items:PricingItem[],tier:ClientTier,promotions:PromotionRate[],mode:'PICKUP'|'COURIER') {
    if(!Object.hasOwn(this.policies,tier))throw Error('Unknown client tier.');
    const policy=this.policies[tier];
    const lines=items.map(item=>{
      if(!Number.isSafeInteger(item.priceMinor)||item.priceMinor<0||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99)throw Error('Invalid pricing item.');
      const lineSubtotalMinor=item.priceMinor*item.quantity;
      let discountBps=policy.discountBps(item),discountSource:string|null=discountBps?(tier==='SOCIAL'?'Соціальна знижка':'Преміум-знижка'):null;
      const applicable=promotions.filter(p=>p.productId===item.productId).sort((a,b)=>b.discountBps-a.discountBps||a.id.localeCompare(b.id));
      if(applicable[0]&&applicable[0].discountBps>discountBps){discountBps=applicable[0].discountBps;discountSource='Акція: '+applicable[0].name;}
      const discountMinor=roundBps(lineSubtotalMinor,discountBps);
      return {productId:item.productId,name:item.name,priceMinor:item.priceMinor,quantity:item.quantity,requiresPrescription:item.requiresPrescription,lineSubtotalMinor,discountBps,discountMinor,discountSource,lineTotalMinor:lineSubtotalMinor-discountMinor};
    });
    const subtotalMinor=lines.reduce((sum,i)=>sum+i.lineSubtotalMinor,0),discountMinor=lines.reduce((sum,i)=>sum+i.discountMinor,0),itemsTotalMinor=subtotalMinor-discountMinor,deliveryMinor=mode==='COURIER'?6000:0;
    if(!Number.isSafeInteger(subtotalMinor)||!Number.isSafeInteger(itemsTotalMinor+deliveryMinor))throw Error('Order amount is too large.');
    return {tier,bonusRateBps:policy.bonusRateBps,items:lines,subtotalMinor,discountMinor,itemsTotalMinor,deliveryMinor,totalMinor:itemsTotalMinor+deliveryMinor,expectedBonusMinor:roundBps(itemsTotalMinor,policy.bonusRateBps)};
  }
  async forUser(m:EntityManager,userId:string,items:PricingItem[],mode:'PICKUP'|'COURIER') {
    // Administrators take an exclusive lock on this row before changing pricing rules.
    const [{revision}]:{revision:number}[]=await m.query('SELECT revision FROM pricing_revision WHERE id=1 FOR SHARE');
    const users:{tier:ClientTier}[]=await m.query('SELECT tier FROM users WHERE id=$1',[userId]);if(!users[0])throw new UnauthorizedException();
    const promotions:PromotionRate[]=await m.query(`SELECT p.id,p.name,pi.product_id "productId",p.discount_bps "discountBps" FROM promotions p JOIN promotion_items pi ON pi.promotion_id=p.id
      WHERE p.active AND p.starts_at<=$1 AND p.ends_at>$1 AND pi.product_id=ANY($2::uuid[]) ORDER BY p.id,pi.product_id`,[new Date(),items.map(i=>i.productId)]);
    return {...this.calculate(items,users[0].tier,promotions,mode),pricingRevision:revision};
  }
}
