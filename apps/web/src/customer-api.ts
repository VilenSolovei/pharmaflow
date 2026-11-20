export interface Profile {ownerId:string;email:string;name:string;phone:string;role:string;tier:string;revision:number;}
export interface Prescription {id:string;ownerId:string;number:string;issuedOn:string;medication:string;notes:string;revision:number;createdAt:string;updatedAt:string;}
export interface PrescriptionFields {number:string;issuedOn:string;medication:string;notes:string;}
export class CustomerApiError extends Error {constructor(public status:number,message:string){super(message);}}
export async function customerRequest<T>(path:string,uid:string,method='GET',body?:object,signal?:AbortSignal):Promise<T>{
 let response:Response;
 try{response=await fetch('/api/account'+path,{method,credentials:'same-origin',signal:signal??AbortSignal.timeout(15000),headers:{'X-PharmaFlow-User':uid,...(method!=='GET'?{'Content-Type':'application/json','X-PharmaFlow-Request':'1'}:{})},body:body?JSON.stringify(body):undefined});}
 catch(e){if(e instanceof Error&&e.name==='AbortError')throw e;throw Error('Не вдалося отримати відповідь сервера. Перевірте з’єднання та спробуйте ще раз.',{cause:e});}
 if(response.status===204)return undefined as T;
 const data=await response.json().catch(()=>({message:'Сервіс тимчасово недоступний.'}));
 if(!response.ok)throw new CustomerApiError(response.status,typeof data.message==='string'?data.message:'Перевірте заповнені поля.');
 if(data.ownerId!==uid)throw new CustomerApiError(409,'Обліковий запис змінився. Оновіть сторінку.');
 return data as T;
}
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const dateLabel=(value:string)=>value.split('-').reverse().join('.');
