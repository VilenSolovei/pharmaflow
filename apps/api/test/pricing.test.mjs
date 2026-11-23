import test from 'node:test';
import assert from 'node:assert/strict';
import {PricingService} from '../dist/loyalty/pricing.service.js';
import {roundBps} from '../dist/loyalty/loyalty-policy.js';
const pricing=new PricingService();
const item=(id,price=10000,quantity=1,socialEligible=false)=>({productId:id,name:id,priceMinor:price,quantity,socialEligible,requiresPrescription:false});
const promo=(id,productId,discountBps)=>({id,name:id,productId,discountBps});
test('standard, social eligibility and premium use independent strategies',()=>{
 const items=[item('eligible',10000,2,true),item('ordinary',5000,1)];
 const standard=pricing.calculate(items,'STANDARD',[],'PICKUP');assert.equal(standard.discountMinor,0);assert.equal(standard.expectedBonusMinor,500);
 const social=pricing.calculate(items,'SOCIAL',[],'COURIER');assert.equal(social.discountMinor,2000);assert.equal(social.totalMinor,29000);assert.equal(social.expectedBonusMinor,460);
 const premium=pricing.calculate(items,'PREMIUM',[],'PICKUP');assert.equal(premium.discountMinor,1250);assert.equal(premium.expectedBonusMinor,713);
 assert.equal(pricing.calculate(items,'STANDARD',[],'PICKUP').discountMinor,0);
});
test('best discount wins without stacking; equal promotions are deterministic',()=>{
 const items=[item('one',10000,1,true)],promos=[promo('b','one',2000),promo('a','one',2000),promo('unrelated','two',10000)];
 const result=pricing.calculate(items,'SOCIAL',promos,'PICKUP');assert.equal(result.totalMinor,8000);assert.equal(result.items[0].discountSource,'Акція: a');
 assert.equal(pricing.calculate(items,'SOCIAL',[promo('a','one',500)],'PICKUP').items[0].discountSource,'Соціальна знижка');
});
test('round half up per line, then compute bonuses on discounted goods only',()=>{
 const result=pricing.calculate([item('one',5,3,true)],'SOCIAL',[],'COURIER');assert.equal(result.items[0].discountMinor,2);assert.equal(result.totalMinor,6013);assert.equal(result.expectedBonusMinor,0);
 assert.equal(roundBps(25,200),1);assert.equal(roundBps(24,200),0);assert.equal(roundBps(Number.MAX_SAFE_INTEGER,10000),Number.MAX_SAFE_INTEGER);
});
test('100% promotion discounts goods while retaining courier fee and zero bonus',()=>{
 const result=pricing.calculate([item('one')],'PREMIUM',[promo('free','one',10000)],'COURIER');assert.equal(result.totalMinor,6000);assert.equal(result.expectedBonusMinor,0);
});
test('invalid money, quantities and client tiers are rejected',()=>{
 for(const value of [-1,0.5,NaN,Infinity])assert.throws(()=>pricing.calculate([item('one',value)],'STANDARD',[],'PICKUP'));
 for(const quantity of [0,100,1.5])assert.throws(()=>pricing.calculate([item('one',1,quantity)],'STANDARD',[],'PICKUP'));
 assert.throws(()=>pricing.calculate([item('one')],'__proto__',[],'PICKUP'));assert.throws(()=>roundBps(1,10001));
});
