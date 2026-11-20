import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCart } from './cart-store';
import type { CartData } from './cart-store';
import { money, orderRequest } from './orders-api';
interface RepeatPreview extends CartData {ownerId:string;sourceOrderId:string;replacesCount:number;canRepeat:boolean;}
export function RepeatOrderPanel({uid,orderId,onClose,onCart}:{uid:string;orderId:string;onClose:()=>void;onCart:()=>void}){
 const cart=useCart();const requestId=useRef(crypto.randomUUID()),locked=useRef(false);const [error,setError]=useState('');
 const preview=useQuery({queryKey:['repeat-preview',uid,orderId],queryFn:({signal})=>orderRequest<RepeatPreview>('/'+orderId+'/repeat-preview',uid,'POST',{},signal),retry:false,staleTime:0,refetchOnWindowFocus:false});
 async function confirm(){if(!preview.data||locked.current)return;locked.current=true;setError('');
  try{await cart.repeatOrder(orderId,preview.data.revision,requestId.current);onCart();}
  catch(e){setError(e instanceof Error?e.message:'Не вдалося перенести товари.');}
  finally{locked.current=false;}
 }
 const data=preview.data;
 return <section className="repeat-preview" aria-labelledby="repeat-title"><h2 id="repeat-title">Повторити замовлення</h2>{preview.isPending?<p role="status">Перевіряємо актуальні товари…</p>:preview.isError?<p role="alert" className="cart-error">{preview.error.message}</p>:data&&<><p>Ці товари замінять поточний кошик облікового запису ({data.replacesCount} шт.).</p><ul className="order-lines">{data.items.map(i=><li key={i.productId}><span>{i.name} × {i.quantity}<small>{!i.active?'Товар більше недоступний':i.available<i.quantity?`Зараз доступно ${i.available} шт.`:`Доступно в мережі: ${i.available} шт.`}</small></span><strong>{money(i.lineTotalMinor)}</strong></li>)}</ul><p>Поточна сума товарів: <strong>{money(data.totalMinor)}</strong></p><p className="cart-hint">Перенесення не створює замовлення й не резервує товари. Під час оформлення ще раз перевіримо ціни та наявність.</p>{!data.canRepeat&&<p role="alert" className="cart-error">Частина товарів більше недоступна. Перейдіть до каталогу, щоб підібрати товари.</p>}</>}{error&&<p role="alert" className="cart-error">{error}</p>}<div className="cart-actions"><button disabled={cart.busy||preview.isFetching||preview.isError||!data?.canRepeat} onClick={()=>void confirm()}>Замінити кошик цими товарами</button><button className="secondary" disabled={cart.busy||preview.isFetching} onClick={()=>{requestId.current=crypto.randomUUID();setError('');void preview.refetch();}}>Оновити попередній перегляд</button><button className="secondary" disabled={cart.busy} onClick={onClose}>Залишити поточний кошик</button></div></section>;
}
