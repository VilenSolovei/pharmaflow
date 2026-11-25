export interface NotificationProduct {id:string;name:string;}
export interface NotificationItem {id:string;kind:'AVAILABILITY'|'REMINDER'|'PROMOTION';title:string;body:string;readAt:string|null;createdAt:string;}
export interface NotificationList {ownerId:string;items:NotificationItem[];total:number;unreadCount:number;page:number;limit:number;}
export interface NotificationPreferences {ownerId:string;promotionOptIn:boolean;revision:number;}
export interface AvailabilitySubscription {id:string;productId:string;productName:string;pharmacyId:string;pharmacyName:string;address:string;enabled:boolean;}
export interface MedicationReminder {id:string;productId:string;productName:string;productActive:boolean;nextAt:string;intervalDays:number;active:boolean;revision:number;}
export class NotificationApiError extends Error {constructor(public status:number,message:string){super(message);}}
export async function notificationRequest<T>(path:string,uid:string,method='GET',body?:object,signal?:AbortSignal):Promise<T>{
 let response:Response;
 try{response=await fetch('/api/notifications'+path,{method,credentials:'same-origin',signal:signal??AbortSignal.timeout(15000),headers:{'X-PharmaFlow-User':uid,...(method!=='GET'?{'Content-Type':'application/json','X-PharmaFlow-Request':'1'}:{})},body:body?JSON.stringify(body):undefined});}
 catch(e){if(e instanceof Error&&e.name==='AbortError')throw e;throw Error('Не вдалося отримати відповідь сервера. Перевірте з’єднання та повторіть дію.',{cause:e});}
 const data=await response.json().catch(()=>({message:'Сервіс тимчасово недоступний.'}));
 if(!response.ok)throw new NotificationApiError(response.status,typeof data.message==='string'?data.message:'Перевірте поля форми.');
 if(data.ownerId!==uid)throw new NotificationApiError(409,'Обліковий запис змінився. Оновіть сторінку.');return data as T;
}
export async function notificationPublic<T>(path:string,signal?:AbortSignal):Promise<T>{const r=await fetch('/api/'+path,{signal});if(!r.ok)throw Error('Не вдалося завантажити товари або аптеки.');return r.json();}
