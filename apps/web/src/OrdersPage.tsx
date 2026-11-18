import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountRequest } from './account-api';
import { money, orderRequest, statusLabel } from './orders-api';
import type { OrderData } from './orders-api';
export function OrdersPage({onAccount,onCatalog}:{onAccount:()=>void;onCatalog:()=>void}){
 const cache=useQueryClient();const account=useQuery({queryKey:['account'],queryFn:()=>accountRequest('me'),retry:false});
 const uid=account.data?.id??'';const [page,setPage]=useState(1),[confirm,setConfirm]=useState('');
 const orders=useQuery({queryKey:['orders',uid,page],enabled:!!uid,queryFn:({signal})=>orderRequest<{ownerId:string;items:OrderData[];total:number;page:number;limit:number}>('?page='+page,uid,'GET',undefined,signal),retry:false,staleTime:0,refetchOnWindowFocus:true});
 const cancel=useMutation({mutationFn:(id:string)=>orderRequest<OrderData>('/'+id+'/cancel',uid,'POST',{}),
  onSuccess:async()=>{setConfirm('');await Promise.all([cache.invalidateQueries({queryKey:['orders',uid]}),cache.invalidateQueries({queryKey:['products']}),cache.invalidateQueries({queryKey:['checkout-options',uid]})]);},
  onError:()=>{void orders.refetch();void cache.invalidateQueries({queryKey:['account']});}});
 if(account.isPending)return <p role="status">Завантажуємо кабінет…</p>;
 if(account.isError)return <section className="orders-page"><h1>Мої замовлення</h1><p role="alert">Не вдалося перевірити обліковий запис.</p><button onClick={()=>void account.refetch()}>Повторити</button></section>;
 if(!uid)return <section className="orders-page"><h1>Мої замовлення</h1><p>Увійдіть, щоб переглядати свої замовлення.</p><button onClick={onAccount}>Увійти</button></section>;
 return <section className="orders-page" aria-labelledby="orders-title"><span className="eyebrow">Ваш PharmaFlow</span><h1 id="orders-title">Мої замовлення</h1>{cancel.isError&&<p className="cart-error" role="alert">{cancel.error.message}</p>}
  {orders.isPending?<p role="status">Завантажуємо замовлення…</p>:orders.isError?<div className="empty-state" role="alert"><p>Не вдалося завантажити історію.</p><button onClick={()=>void orders.refetch()}>Повторити</button></div>:!orders.data?.items.length?<div className="empty-state"><h2>Тут будуть ваші замовлення</h2><button onClick={onCatalog}>До каталогу</button></div>:<><div className="orders-list">{orders.data.items.map(order=><article key={order.id} className="order-card"><header><div><h2>Замовлення № {order.id.slice(0,8)}</h2><p>{new Date(order.createdAt).toLocaleString('uk-UA')}</p></div><span className="order-status" data-status={order.status}>{statusLabel[order.status]??order.status}</span></header><p>{order.mode==='PICKUP'?'Самовивіз':'Кур’єрська доставка'} · {order.pharmacyName}</p><p className="cart-hint">{order.pharmacyAddress}</p>
   <ul className="order-lines">{order.items.map(i=><li key={i.productId}><span>{i.name} × {i.quantity}</span><strong>{money(i.lineTotalMinor)}</strong></li>)}</ul><div className="order-amount"><span>Доставка: {money(order.deliveryMinor)}</span><strong>Разом: {money(order.totalMinor)}</strong></div><details><summary>Дані одержувача</summary><p>{order.contact.name} · {order.contact.phone}</p><p>{order.contact.email}</p>{order.address&&<p>{order.address.city}, {order.address.street}, {order.address.building}{order.address.apartment?`, кв. ${order.address.apartment}`:''}</p>}</details>
   {['NEW','CONFIRMED','READY_FOR_PICKUP'].includes(order.status)&&(confirm===order.id?<div className="cancel-confirm"><p>Скасувати замовлення та звільнити зарезервовані товари? Кошик автоматично не відновлюється.</p><button disabled={cancel.isPending} onClick={()=>cancel.mutate(order.id)}>Так, скасувати</button><button className="secondary" disabled={cancel.isPending} onClick={()=>setConfirm('')}>Залишити замовлення</button></div>:<button className="secondary" disabled={cancel.isPending} onClick={()=>{cancel.reset();setConfirm(order.id);}}>Скасувати замовлення</button>)}
   {order.status==='CANCELLED'&&<p className="cart-hint">Резерв звільнено{order.cancelledAt?' · '+new Date(order.cancelledAt).toLocaleString('uk-UA'):''}.</p>}
  </article>)}</div>{orders.data.total>orders.data.limit&&<nav className="pagination" aria-label="Сторінки замовлень"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Назад</button><span>Сторінка {page}</span><button disabled={page*orders.data.limit>=orders.data.total} onClick={()=>setPage(p=>p+1)}>Далі</button></nav>}</>}
 </section>;
}
