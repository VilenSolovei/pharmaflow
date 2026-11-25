export const orderStatuses=['NEW','CONFIRMED','READY_FOR_PICKUP','OUT_FOR_DELIVERY','COMPLETED','CANCELLED'] as const;
export const orderActions=['CONFIRM','PREPARE_PICKUP','DISPATCH','COMPLETE','CANCEL'] as const;
export type OrderStatus=typeof orderStatuses[number];
export type OrderAction=typeof orderActions[number];
export type FulfillmentMode='PICKUP'|'COURIER';
export class InvalidOrderAction extends Error {}
export abstract class OrderState {
  abstract readonly status:OrderStatus;
  protected abstract transitions(mode:FulfillmentMode):Partial<Record<OrderAction,OrderStatus>>;
  actions(mode:FulfillmentMode):OrderAction[]{return Object.keys(this.transitions(mode)) as OrderAction[];}
  apply(action:OrderAction,mode:FulfillmentMode):OrderStatus{
    const next=this.transitions(mode)[action];
    if(!next)throw new InvalidOrderAction('Ця дія недоступна для поточного стану та способу отримання.');
    return next;
  }
}
export class NewOrderState extends OrderState {
  readonly status='NEW';
  protected transitions(){return {CONFIRM:'CONFIRMED',CANCEL:'CANCELLED'} as const;}
}
export class ConfirmedOrderState extends OrderState {
  readonly status='CONFIRMED';
  protected transitions(mode:FulfillmentMode):Partial<Record<OrderAction,OrderStatus>>{
    return mode==='PICKUP'?{PREPARE_PICKUP:'READY_FOR_PICKUP',CANCEL:'CANCELLED'}:{DISPATCH:'OUT_FOR_DELIVERY',CANCEL:'CANCELLED'};
  }
}
export class ReadyForPickupState extends OrderState {
  readonly status='READY_FOR_PICKUP';
  protected transitions(mode:FulfillmentMode):Partial<Record<OrderAction,OrderStatus>>{return mode==='PICKUP'?{COMPLETE:'COMPLETED',CANCEL:'CANCELLED'}:{};}
}
export class OutForDeliveryState extends OrderState {
  readonly status='OUT_FOR_DELIVERY';
  protected transitions(mode:FulfillmentMode):Partial<Record<OrderAction,OrderStatus>>{return mode==='COURIER'?{COMPLETE:'COMPLETED'}:{};}
}
export class CompletedOrderState extends OrderState {
  readonly status='COMPLETED';
  protected transitions(){return {};}
}
export class CancelledOrderState extends OrderState {
  readonly status='CANCELLED';
  protected transitions(){return {};}
}
const states:Record<OrderStatus,OrderState>={NEW:new NewOrderState(),CONFIRMED:new ConfirmedOrderState(),READY_FOR_PICKUP:new ReadyForPickupState(),OUT_FOR_DELIVERY:new OutForDeliveryState(),COMPLETED:new CompletedOrderState(),CANCELLED:new CancelledOrderState()};
// Each order owns its current State reference; shared State objects are immutable.
export class Order {
  private state:OrderState;
  constructor(status:OrderStatus,readonly mode:FulfillmentMode){
    if(!Object.hasOwn(states,status)||!['PICKUP','COURIER'].includes(mode))throw new InvalidOrderAction('Невідомий стан замовлення.');
    this.state=states[status];
  }
  get status():OrderStatus{return this.state.status;}
  get actions():OrderAction[]{return this.state.actions(this.mode);}
  apply(action:OrderAction):OrderStatus{this.state=states[this.state.apply(action,this.mode)];return this.status;}
}
