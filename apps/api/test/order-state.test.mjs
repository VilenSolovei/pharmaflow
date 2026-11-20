import test from 'node:test';
import assert from 'node:assert/strict';
import {Order,InvalidOrderAction,orderActions,orderStatuses} from '../dist/orders/order-state.js';
const expected={
 PICKUP:{NEW:{CONFIRM:'CONFIRMED',CANCEL:'CANCELLED'},CONFIRMED:{PREPARE_PICKUP:'READY_FOR_PICKUP',CANCEL:'CANCELLED'},READY_FOR_PICKUP:{COMPLETE:'COMPLETED',CANCEL:'CANCELLED'},OUT_FOR_DELIVERY:{},COMPLETED:{},CANCELLED:{}},
 COURIER:{NEW:{CONFIRM:'CONFIRMED',CANCEL:'CANCELLED'},CONFIRMED:{DISPATCH:'OUT_FOR_DELIVERY',CANCEL:'CANCELLED'},READY_FOR_PICKUP:{},OUT_FOR_DELIVERY:{COMPLETE:'COMPLETED'},COMPLETED:{},CANCELLED:{}}
};
for(const mode of ['PICKUP','COURIER'])for(const status of orderStatuses)test(`State ${mode}/${status}`,()=>{
 const order=new Order(status,mode);assert.deepEqual(order.actions.sort(),Object.keys(expected[mode][status]).sort());
 for(const action of orderActions){
  const subject=new Order(status,mode),next=expected[mode][status][action];
  if(next){assert.equal(subject.apply(action),next);assert.equal(subject.status,next);assert.deepEqual(subject.actions.sort(),Object.keys(expected[mode][next]).sort());}
  else {assert.throws(()=>subject.apply(action),InvalidOrderAction);assert.equal(subject.status,status);}
 }
 assert.throws(()=>order.apply('INVALID'),InvalidOrderAction);
});
test('State contexts remain independent',()=>{const one=new Order('NEW','PICKUP'),two=new Order('NEW','COURIER');one.apply('CONFIRM');assert.equal(two.status,'NEW');one.apply('PREPARE_PICKUP');two.apply('CONFIRM');assert.equal(one.status,'READY_FOR_PICKUP');assert.deepEqual(two.actions.sort(),['CANCEL','DISPATCH']);});
