import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accountRequest } from './account-api';
import { CartApiError, CartContext, cartRequest, readDraft, useGuestDraft, withDraftLock, writeDraft } from './cart-store';
export function CartProvider({children}:{children:ReactNode}){
 const cache=useQueryClient();const guest=useGuestDraft();const [busy,setBusy]=useState(false);const locked=useRef(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const account=useQuery({queryKey:['account'],queryFn:()=>accountRequest('me'),retry:false,refetchOnWindowFocus:true});
 const uid=account.data?.id;
 const server=useQuery({queryKey:['cart',uid],enabled:!!uid,queryFn:({signal})=>cartRequest('','GET',undefined,uid,signal),retry:false,refetchOnWindowFocus:true});
 const preview=useQuery({queryKey:['guest-cart',guest.raw],enabled:guest.items.length>0&&!account.isPending&&!account.isError,queryFn:({signal})=>cartRequest('/preview','POST',{items:guest.items},undefined,signal),retry:1});
 const empty={ownerId:null,id:null,revision:0,items:[],totalMinor:0,count:0};
 const data=uid?server.data:guest.items.length?preview.data:empty;
 const pending=account.isPending||(uid?server.isPending:guest.items.length>0&&preview.isPending);
 const failed=account.isError||(uid?server.isError:guest.items.length>0&&preview.isError);
 async function perform(action:()=>Promise<void>){
  if(locked.current)return;
  locked.current=true;setBusy(true);setError('');setNotice('');
  try{if(account.isPending||account.isError)throw Error('Спочатку дочекайтеся перевірки облікового запису.');await action();}
  catch(e){setError(e instanceof Error?e.message:'Не вдалося змінити кошик.');if(e instanceof CartApiError){if(e.status===401)await cache.invalidateQueries({queryKey:['account']});if(uid)await cache.invalidateQueries({queryKey:['cart',uid]});}throw e;}
  finally{locked.current=false;setBusy(false);}
 }
 async function add(id:string){return perform(async()=>{
  if(uid){const result=await cartRequest('/items','POST',{productId:id,quantity:1},uid);cache.setQueryData(['cart',uid],result);}
  else await withDraftLock(async()=>{const items=readDraft();const existing=items.find(i=>i.productId===id);
   if(existing&&existing.quantity>=99)throw Error('Не більше 99 одиниць одного товару.');
   if(!existing&&items.length>=100)throw Error('У кошику може бути до 100 різних товарів.');
   const next=existing?items.map(i=>i.productId===id?{...i,quantity:i.quantity+1}:i):[...items,{productId:id,quantity:1}];
   const result=await cartRequest('/preview','POST',{items:next});if(!result.items.find(i=>i.productId===id)?.active)throw Error('Цей товар більше недоступний.');
   writeDraft(next);cache.setQueryData(['guest-cart',JSON.stringify(next)],result);
  });setNotice('Товар додано до кошика.');
 });}
 async function quantity(id:string,n:number){return perform(async()=>{
  if(!Number.isInteger(n)||n<1||n>99)throw Error('Кількість має бути від 1 до 99.');
  if(uid)cache.setQueryData(['cart',uid],await cartRequest('/items/'+id,'PATCH',{quantity:n},uid));
  else await withDraftLock(async()=>{writeDraft(readDraft().map(i=>i.productId===id?{...i,quantity:n}:i));});
 });}
 async function remove(id:string){return perform(async()=>{
  if(uid)cache.setQueryData(['cart',uid],await cartRequest('/items/'+id,'DELETE',undefined,uid));
  else await withDraftLock(async()=>{writeDraft(readDraft().filter(i=>i.productId!==id));});
 });}
 async function importGuest(){return perform(()=>withDraftLock(async()=>{
  if(!uid||!server.data)throw Error('Спочатку завантажте кошик облікового запису.');
  const items=readDraft();if(!items.length)return;
  const signature=JSON.stringify(items);
  const result=await cartRequest('','PUT',{items,revision:server.data.revision},uid);
  cache.setQueryData(['cart',uid],result);
  if(JSON.stringify(readDraft())===signature)writeDraft([]);
  setNotice('Товари з браузера перенесено до кошика облікового запису.');
 }));}
 function refresh(){setError('');void cache.invalidateQueries({queryKey:['account']});if(uid)void server.refetch();if(guest.items.length)void preview.refetch();}
 return <CartContext.Provider value={{data,pending,failed,busy,authenticated:!!uid,error,notice,draft:guest.items,draftData:preview.data,hasGuestDraft:!!uid&&guest.items.length>0,add,quantity,remove,importGuest,refresh}}>{children}</CartContext.Provider>;
}
