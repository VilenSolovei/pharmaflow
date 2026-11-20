import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accountRequest } from './account-api';
import { actionLabel, adminOrderRequest, money, OrderApiError, statusLabel } from './orders-api';
import type { AdminOrderResult, OrderAction, OrderData } from './orders-api';
interface ActionIntent {orderId:string;action:OrderAction;expectedStatus:string;requestId:string;}
export function AdminOrdersPage(){
 const account=useQuery({queryKey:['account'],queryFn:()=>accountRequest('me'),retry:false,refetchOnWindowFocus:true});
 if(account.isPending)return <p role="status">Перевіряємо доступ…</p>;
 if(account.isError)return <section className="orders-page"><h1>Обробка замовлень</h1><p role="alert">Не вдалося перевірити доступ.</p><button onClick={()=>void account.refetch()}>Повторити</button></section>;
 if(account.data?.role!=='ADMIN')return <section className="orders-page"><h1>Обробка замовлень</h1><p role="alert">Цей розділ доступний адміністратору.</p></section>;
 return <AdminOrders uid={account.data.id}/>;
}
function AdminOrders({uid}:{uid:string}){
 const cache=useQueryClient();const [status,setStatus]=useState('ACTIVE'),[page,setPage]=useState(1),[selected,setSelected]=useState('');
 const [confirmation,setConfirmation]=useState<ActionIntent>();const [uncertain,setUncertain]=useState<ActionIntent>();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const locked=useRef(false);
 const list=useQuery({queryKey:['admin-orders',uid,status,page],queryFn:({signal})=>adminOrderRequest<{ownerId:string;items:OrderData[];total:number;page:number;limit:number}>('?status='+status+'&page='+page,uid,'GET',undefined,signal),retry:false,staleTime:0,refetchOnWindowFocus:true});
 const detail=useQuery({queryKey:['admin-order',uid,selected],enabled:!!selected,queryFn:({signal})=>adminOrderRequest<AdminOrderResult>('/'+selected,uid,'GET',undefined,signal),retry:false,staleTime:0,refetchOnWindowFocus:true});
 async function refresh(){await Promise.all([cache.invalidateQueries({queryKey:['admin-orders',uid]}),cache.invalidateQueries({queryKey:['admin-order',uid]}),cache.invalidateQueries({queryKey:['orders']}),cache.invalidateQueries({queryKey:['products']}),cache.invalidateQueries({queryKey:['product']}),cache.invalidateQueries({queryKey:['checkout-options']})]);}
 async function act(intent:ActionIntent){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await adminOrderRequest<AdminOrderResult>('/'+intent.orderId+'/actions',uid,'POST',{action:intent.action,expectedStatus:intent.expectedStatus,requestId:intent.requestId});
   cache.setQueryData(['admin-order',uid,intent.orderId],result);setUncertain(undefined);setConfirmation(undefined);setNotice('Статус змінено: '+(statusLabel[result.order.status]??result.order.status)+'.');await refresh();
  }catch(e){
   setError(e instanceof Error?e.message:'Не вдалося змінити замовлення.');
   if(e instanceof OrderApiError){setUncertain(undefined);setConfirmation(undefined);await refresh();if(e.status===401||e.status===403||e.status===409)void cache.invalidateQueries({queryKey:['account']});}
   else setUncertain(intent);
  }finally{locked.current=false;setBusy(false);}
 }
 function choose(order:OrderData,action:OrderAction){setError('');setNotice('');const intent={orderId:order.id,action,expectedStatus:order.status,requestId:crypto.randomUUID()};if(action==='CANCEL'||action==='COMPLETE'||action==='DISPATCH')setConfirmation(intent);else void act(intent);}
 const order=detail.data?.order;
 return <section className="orders-page admin-orders" aria-labelledby="admin-orders-title"><span className="eyebrow">Керування аптекою</span><h1 id="admin-orders-title">Обробка замовлень</h1><p className="cart-hint">Перевіряйте склад і дані одержувача перед видачею або передачею кур’єру.</p>
  <div className="admin-toolbar"><div className="admin-filter"><label htmlFor="admin-status">Показати</label><select id="admin-status" value={status} disabled={busy||!!uncertain} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="ACTIVE">Активні</option><option value="ALL">Усі замовлення</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><button className="secondary" disabled={busy} onClick={()=>void refresh()}>Оновити список</button></div>
  {error&&<p className="cart-error" role="alert">{error}</p>}{notice&&<p className="cart-success" role="status">{notice}</p>}
  {uncertain&&<div className="action-confirm"><p>Відповідь не отримано. Повторіть ту саму дію, щоб перевірити результат без повторного списання товарів.</p><button disabled={busy} onClick={()=>void act(uncertain)}>Повторити дію</button><button className="secondary" disabled={busy} onClick={()=>void refresh()}>Перевірити статус</button></div>}
  <div className="admin-orders-layout"><div className="admin-order-list">{list.isPending?<p role="status">Завантажуємо замовлення…</p>:list.isError?<div className="empty-state" role="alert"><p>Не вдалося завантажити список.</p><button onClick={()=>void list.refetch()}>Повторити</button></div>:!list.data?.items.length?<p className="empty-state">За цим фільтром замовлень немає.</p>:list.data.items.map(item=><button key={item.id} className={'order-list-button '+(selected===item.id?'selected':'')} disabled={busy||!!uncertain} onClick={()=>{setSelected(item.id);setConfirmation(undefined);setError('');setNotice('');}} aria-pressed={selected===item.id}><span><strong>№ {item.id.slice(0,8)}</strong><small>{new Date(item.createdAt).toLocaleString('uk-UA')}</small></span><span className="order-status" data-status={item.status}>{statusLabel[item.status]}</span><span>{item.pharmacyName} · {item.mode==='PICKUP'?'Самовивіз':'Кур’єр'}</span><strong>{money(item.totalMinor)}</strong></button>)}
   {list.data&&list.data.total>list.data.limit&&<nav className="pagination" aria-label="Сторінки обробки замовлень"><button disabled={page<=1||busy||!!uncertain} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page}</span><button disabled={page*list.data.limit>=list.data.total||busy||!!uncertain} onClick={()=>setPage(p=>p+1)}>Далі</button></nav>}
  </div><div className="admin-order-detail">{!selected?<p className="empty-state">Оберіть замовлення для обробки.</p>:detail.isPending?<p role="status">Завантажуємо деталі…</p>:detail.isError?<div className="empty-state" role="alert"><p>Не вдалося завантажити замовлення.</p><button onClick={()=>void detail.refetch()}>Повторити</button></div>:order&&<article className="order-card"><header><div><h2>Замовлення № {order.id.slice(0,8)}</h2><p>{new Date(order.createdAt).toLocaleString('uk-UA')}</p></div><span className="order-status" data-status={order.status}>{statusLabel[order.status]}</span></header>
   <p>{order.pharmacyName} · {order.mode==='PICKUP'?'Самовивіз':'Кур’єрська доставка'}</p><p className="cart-hint">{order.pharmacyAddress}</p><ul className="order-lines">{order.items.map(i=><li key={i.productId}><span>{i.name} × {i.quantity}{i.requiresPrescription&&<small className="prescription-check">За рецептом — перевірте перед видачею</small>}</span><strong>{money(i.lineTotalMinor)}</strong></li>)}</ul>
   <div className="order-amount"><span>Доставка: {money(order.deliveryMinor)}</span><strong>Разом: {money(order.totalMinor)}</strong></div><section className="recipient-details"><h3>Одержувач</h3><p>{order.contact.name}</p><p>{order.contact.phone} · {order.contact.email}</p>{order.address&&<p>{order.address.city}, {order.address.street}, {order.address.building}{order.address.apartment?`, кв. ${order.address.apartment}`:''}</p>}</section>
   <div className="order-actions">{order.allowedActions.map(action=><button key={action} className={action==='CANCEL'?'secondary':''} disabled={busy||!!uncertain||!!confirmation} onClick={()=>choose(order,action)}>{actionLabel[action]}</button>)}</div>
   {confirmation&&confirmation.orderId===order.id&&<div className="action-confirm"><p>{confirmation.action==='COMPLETE'?'Завершити замовлення? Товари буде списано із залишку аптеки.':confirmation.action==='DISPATCH'?'Підтвердити передачу кур’єру? Після передачі скасування буде недоступне.':'Скасувати замовлення та звільнити резерв?'}</p><button disabled={busy} onClick={()=>void act(confirmation)}>Підтвердити дію</button><button className="secondary" disabled={busy} onClick={()=>setConfirmation(undefined)}>Назад</button></div>}
   {!order.allowedActions.length&&<p className="cart-hint">{order.status==='COMPLETED'?'Замовлення виконано. Товари списано.':'Замовлення скасовано. Резерв звільнено.'}</p>}
   <section className="transition-history"><h3>Історія обробки</h3>{detail.data?.history.length?<ol>{detail.data.history.map(event=><li key={event.id}><span>{statusLabel[event.fromStatus]} → {statusLabel[event.toStatus]}</span><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('uk-UA')}</time></li>)}</ol>:<p className="cart-hint">Статус ще не змінювали.</p>}</section>
  </article>}</div></div>
 </section>;
}
