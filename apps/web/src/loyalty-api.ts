export const tierLabel:Record<string,string>={STANDARD:'Звичайна',SOCIAL:'Соціальна',PREMIUM:'Преміум'};
export const bonus=(minor:number)=>new Intl.NumberFormat('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(minor/100);
export const percent=(bps:number)=>new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(bps/100)+'%';
export class LoyaltyApiError extends Error {constructor(public status:number,message:string){super(message);}}
export interface LoyaltyCard {ownerId:string;number:string;balanceMinor:number;tier:string;items:{id:string;orderId:string;amountMinor:number;createdAt:string}[];total:number;page:number;limit:number;}
export interface LoyaltyCustomer {id:string;name:string;email:string;role:string;tier:string;revision:number;}
export interface LoyaltyProduct {id:string;name:string;socialEligible:boolean;revision:number;}
export interface Promotion {id:string;name:string;discountBps:number;startsAt:string;endsAt:string;active:boolean;revision:number;phase:'DISABLED'|'SCHEDULED'|'EXPIRED'|'ACTIVE';products:{id:string;name:string}[];}
export interface LoyaltyList<T> {ownerId:string;items:T[];total:number;page:number;limit:number;}
export async function loyaltyRequest<T>(path:string,uid:string,method='GET',body?:object,signal?:AbortSignal,admin=false):Promise<T>{
 let response:Response;
 try{response=await fetch((admin?'/api/admin/loyalty':'/api/loyalty')+path,{method,credentials:'same-origin',signal:signal??AbortSignal.timeout(15000),headers:{'X-PharmaFlow-User':uid,...(method!=='GET'?{'Content-Type':'application/json','X-PharmaFlow-Request':'1'}:{})},body:body?JSON.stringify(body):undefined});}
 catch(e){if(e instanceof Error&&e.name==='AbortError')throw e;throw Error('Не вдалося отримати відповідь сервера. Перевірте з’єднання та повторіть дію.',{cause:e});}
 const data=await response.json().catch(()=>({message:'Сервіс тимчасово недоступний.'}));
 if(!response.ok)throw new LoyaltyApiError(response.status,typeof data.message==='string'?data.message:'Перевірте поля форми.');
 if(data.ownerId!==uid)throw new LoyaltyApiError(409,'Обліковий запис змінився. Оновіть сторінку.');
 return data as T;
}
export function adminLoyaltyRequest<T>(path:string,uid:string,method='GET',body?:object,signal?:AbortSignal){return loyaltyRequest<T>(path,uid,method,body,signal,true);}
