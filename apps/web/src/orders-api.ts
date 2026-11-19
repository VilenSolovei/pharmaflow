export type OrderAction='CONFIRM'|'PREPARE_PICKUP'|'DISPATCH'|'COMPLETE'|'CANCEL';
export const money=(value:number)=>new Intl.NumberFormat('uk-UA',{style:'currency',currency:'UAH'}).format(value/100);
export interface OrderItem {productId:string;name:string;priceMinor:number;quantity:number;lineTotalMinor:number;requiresPrescription:boolean;}
export interface OrderContact {name:string;phone:string;email:string;}
export interface PostalAddress {city:string;street:string;building:string;apartment?:string;}
export interface OrderData {id:string;ownerId:string;pharmacyId:string;pharmacyName:string;pharmacyAddress:string;mode:'PICKUP'|'COURIER';status:string;contact:OrderContact;address:PostalAddress|null;subtotalMinor:number;deliveryMinor:number;totalMinor:number;createdAt:string;cancelledAt:string|null;completedAt:string|null;allowedActions:OrderAction[];items:OrderItem[];}
export interface QuoteData {id:string;ownerId:string;expiresAt:string;mode:'PICKUP'|'COURIER';revision:number;pharmacy:{id:string;name:string;address:string;};items:OrderItem[];subtotalMinor:number;deliveryMinor:number;totalMinor:number;}
export interface PharmacyOption {id:string;name:string;address:string;available:boolean;shortages:{name:string;requested:number;available:number;}[];}
export interface CheckoutPayload {quoteId:string;requestId:string;contact:OrderContact;address?:PostalAddress;}
export class OrderApiError extends Error {constructor(public status:number,message:string){super(message);}}
export async function orderRequest<T extends {ownerId:string}>(path:string,uid:string,method='GET',body?:object,signal?:AbortSignal,admin=false):Promise<T>{
 let response:Response;
 try {response=await fetch((admin?'/api/admin/orders':'/api/orders')+path,{method,credentials:'same-origin',signal:signal??AbortSignal.timeout(15000),headers:{'X-PharmaFlow-User':uid,...(method!=='GET'?{'Content-Type':'application/json','X-PharmaFlow-Request':'1'}:{})},body:body?JSON.stringify(body):undefined});}
 catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw Error('Не вдалося отримати відповідь сервера. Повторіть запит або перевірте історію замовлень.',{cause:error});}
 const data=await response.json().catch(()=>({message:'Сервіс тимчасово недоступний.'}));
 if(!response.ok)throw new OrderApiError(response.status,typeof data.message==='string'?data.message:'Перевірте контактні дані та адресу доставки.');
 if(data.ownerId!==uid)throw new OrderApiError(409,'Обліковий запис змінився. Оновіть сторінку.');
 return data as T;
}
export const statusLabel:Record<string,string>={NEW:'Нове',CONFIRMED:'Підтверджене',READY_FOR_PICKUP:'Готове до видачі',OUT_FOR_DELIVERY:'Передано кур’єру',COMPLETED:'Завершене',CANCELLED:'Скасоване'};

export function adminOrderRequest<T extends {ownerId:string}>(path:string,uid:string,method='GET',body?:object,signal?:AbortSignal){
 return orderRequest<T>(path,uid,method,body,signal,true);
}
export interface OrderTransition {id:string;actorId:string;action:OrderAction;fromStatus:string;toStatus:string;createdAt:string;}
export interface AdminOrderResult {ownerId:string;order:OrderData;history:OrderTransition[];}
export const actionLabel:Record<OrderAction,string>={CONFIRM:'Підтвердити',PREPARE_PICKUP:'Готове до видачі',DISPATCH:'Передати кур’єру',COMPLETE:'Завершити замовлення',CANCEL:'Скасувати замовлення'};
