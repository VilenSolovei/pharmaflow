import { createContext, useContext, useSyncExternalStore } from 'react';
export interface DraftItem {productId:string;quantity:number;}
export interface CartItem extends DraftItem {name:string;priceMinor:number;lineTotalMinor:number;active:boolean;available:number;}
export interface CartData {ownerId:string|null;id:string|null;revision:number;items:CartItem[];totalMinor:number;count:number;}
export interface CartContextValue {
 data?:CartData;pending:boolean;failed:boolean;busy:boolean;authenticated:boolean;error:string;notice:string;
 draft:DraftItem[];draftData?:CartData;hasGuestDraft:boolean;
 add:(id:string)=>Promise<void>;quantity:(id:string,n:number)=>Promise<void>;remove:(id:string)=>Promise<void>;
 importGuest:()=>Promise<void>;repeatOrder:(orderId:string,revision:number,requestId:string)=>Promise<void>;refresh:()=>void;
}
export const CartContext=createContext<CartContextValue|null>(null);
export const guestKey='pharmaflow.cart.v1';
const eventName='pharmaflow-cart-change';
function snapshot():string{try{return localStorage.getItem(guestKey)??'[]';}catch{return '[]';}}
function subscribe(fn:()=>void){const changed=(e:StorageEvent)=>{if(e.key===guestKey||e.key===null)fn();};window.addEventListener('storage',changed);window.addEventListener(eventName,fn);return()=>{window.removeEventListener('storage',changed);window.removeEventListener(eventName,fn);};}
export function readDraft(raw=snapshot()):DraftItem[]{
 try{const value:unknown=JSON.parse(raw);if(!Array.isArray(value)||value.length>100)return [];
 const seen=new Set<string>();const result:DraftItem[]=[];
 for(const row of value){if(typeof row!=='object'||row===null)return [];const v=row as Partial<DraftItem>;
 if(typeof v.productId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.productId)||!Number.isInteger(v.quantity)||v.quantity!<1||v.quantity!>99||seen.has(v.productId.toLowerCase()))return [];
 seen.add(v.productId.toLowerCase());result.push({productId:v.productId.toLowerCase(),quantity:v.quantity!});}return result;
 }catch{return [];}
}
export function writeDraft(items:DraftItem[]){try{localStorage.setItem(guestKey,JSON.stringify(items));}catch{throw Error('Браузер не дозволяє зберегти кошик. Перевірте налаштування сховища.');}window.dispatchEvent(new Event(eventName));}
export function useGuestDraft(){const raw=useSyncExternalStore(subscribe,snapshot,()=> '[]');return {raw,items:readDraft(raw)};}
export async function withDraftLock<T>(action:()=>Promise<T>):Promise<T>{
 if(navigator.locks)return navigator.locks.request('pharmaflow-guest-cart',action);
 return action();
}
export function useCart(){const value=useContext(CartContext);if(!value)throw Error('CartProvider is required');return value;}
export class CartApiError extends Error {constructor(public status:number,message:string){super(message);}}
export async function cartRequest(path:string,method='GET',body?:object,ownerId?:string,signal?:AbortSignal):Promise<CartData>{
 let response:Response;
 try{response=await fetch('/api/cart'+path,{method,signal:signal??AbortSignal.timeout(10000),credentials:'same-origin',headers:{...(method!=='GET'?{'Content-Type':'application/json','X-PharmaFlow-Request':'1'}:{}),...(ownerId?{'X-PharmaFlow-User':ownerId}:{})},body:body?JSON.stringify(body):undefined});}catch(e){if(e instanceof Error&&e.name==='AbortError')throw e;throw Error('Не вдалося з’єднатися із сервером. Спробуйте ще раз.',{cause:e});}
 const data=await response.json().catch(()=>({message:'Сервіс тимчасово недоступний.'}));
 if(!response.ok)throw new CartApiError(response.status,typeof data.message==='string'?data.message:'Не вдалося змінити кошик. Перевірте кількість товару.');
 if(!Array.isArray(data.items)||typeof data.totalMinor!=='number')throw Error('Сервер повернув неправильну відповідь. Спробуйте ще раз.');
 if(ownerId&&data.ownerId!==ownerId)throw new CartApiError(409,'Обліковий запис змінився. Оновіть сторінку.');
 return data as CartData;
}
