import { customerRequest } from './customer-api';
import type { Profile } from './customer-api';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCart } from './cart-store';
import { accountRequest } from './account-api';
import { money, orderRequest, OrderApiError } from './orders-api';
import type { CheckoutPayload, OrderData, PharmacyOption, QuoteData } from './orders-api';
export function CheckoutPage({onCart,onAccount,onOrders}:{onCart:()=>void;onAccount:()=>void;onOrders:()=>void}){
 const cart=useCart(),cache=useQueryClient();const uid=cart.data?.ownerId??'';
 const account=useQuery({queryKey:['account'],queryFn:()=>accountRequest('me'),retry:false});
 const profile=useQuery({queryKey:['profile',uid],enabled:!!uid,queryFn:({signal})=>customerRequest<Profile>('',uid,'GET',undefined,signal),retry:false});
 const revision=cart.data?.revision??0;
 const [mode,setMode]=useState<'PICKUP'|'COURIER'>('PICKUP');const [pharmacyId,setPharmacy]=useState('');
 const [name,setName]=useState<string>(),[phone,setPhone]=useState<string>(),[email,setEmail]=useState(account.data?.email??'');
 const [city,setCity]=useState(''),[street,setStreet]=useState(''),[building,setBuilding]=useState(''),[apartment,setApartment]=useState('');
 const [quote,setQuote]=useState<QuoteData>();const [created,setCreated]=useState<OrderData>();
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const locked=useRef(false);
 const intent=useRef<CheckoutPayload|undefined>(undefined);const [uncertain,setUncertain]=useState(false);
 const options=useQuery({queryKey:['checkout-options',uid,revision],enabled:!!uid&&!!cart.data?.count&&!created,
  queryFn:({signal})=>orderRequest<{ownerId:string;pharmacies:PharmacyOption[]}>('/options',uid,'POST',{revision},signal),retry:false,staleTime:0});
 const currentQuote=quote?.revision===revision&&quote?.mode===mode&&quote?.pharmacy.id===pharmacyId?quote:undefined;
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(locked.current||!uid)return;locked.current=true;setBusy(true);setError('');
  try{
   if(!currentQuote&&!intent.current){
    const result=await orderRequest<QuoteData>('/quote',uid,'POST',{revision,pharmacyId,mode});
    setQuote(result);return;
   }
   if(!intent.current){
    if(!currentQuote)throw Error('Оновіть підсумок замовлення.');
    intent.current={quoteId:currentQuote.id,requestId:crypto.randomUUID(),contact:{name:(name??profile.data?.name??'').trim(),phone:(phone??profile.data?.phone??'').trim(),email:(email||account.data?.email||'').trim()},
     ...(mode==='COURIER'?{address:{city:city.trim(),street:street.trim(),building:building.trim(),...(apartment.trim()?{apartment:apartment.trim()}:{})}}:{})};
   }
   const result=await orderRequest<OrderData>('',uid,'POST',intent.current);
   setCreated(result);setUncertain(false);intent.current=undefined;
   await Promise.all([cache.invalidateQueries({queryKey:['cart',uid]}),cache.invalidateQueries({queryKey:['orders',uid]}),cache.invalidateQueries({queryKey:['products']}),cache.invalidateQueries({queryKey:['checkout-options',uid]})]);
  }catch(e){
   setError(e instanceof Error?e.message:'Не вдалося оформити замовлення.');
   if(e instanceof OrderApiError){
    intent.current=undefined;setUncertain(false);setQuote(undefined);
    if(e.status===401||e.status===409)cart.refresh();
    void cache.invalidateQueries({queryKey:['checkout-options',uid]});
   }else if(intent.current)setUncertain(true);
  }finally{locked.current=false;setBusy(false);}
 }
 if(created)return <section className="checkout-page order-confirmation"><span className="eyebrow">Замовлення прийнято</span><h1>Товари зарезервовано</h1><p role="status">Замовлення № {created.id.slice(0,8)} створено. Його можна переглянути у ваших замовленнях.</p><div className="checkout-card"><h2>{created.mode==='PICKUP'?'Самовивіз':'Кур’єрська доставка'}</h2><p>{created.pharmacyName} · {created.pharmacyAddress}</p><p>До сплати при отриманні: <strong>{money(created.totalMinor)}</strong></p></div><button onClick={onOrders}>Мої замовлення</button></section>;
 if(cart.pending)return <p role="status">Завантажуємо кошик…</p>;
 if(cart.failed)return <section className="checkout-page"><h1>Оформлення замовлення</h1><p role="alert">Не вдалося завантажити кошик.</p><button onClick={cart.refresh}>Повторити</button></section>;
 if(!uid)return <section className="checkout-page"><h1>Оформлення замовлення</h1><p>Увійдіть і перенесіть товари до кошика облікового запису, щоб оформити замовлення.</p><button onClick={onAccount}>Увійти до кабінету</button></section>;
 if(!cart.data?.count)return <section className="checkout-page"><h1>Кошик порожній</h1><button onClick={onCart}>До кошика</button><button className="secondary" onClick={onOrders}>Перевірити мої замовлення</button></section>;
 const frozen=busy||uncertain;
 return <section className="checkout-page" aria-labelledby="checkout-title"><button className="link-button" disabled={frozen} onClick={onCart}>← До кошика</button><span className="eyebrow">Наступний крок</span><h1 id="checkout-title">Оформлення замовлення</h1><p className="cart-hint">Усі товари комплектуються з однієї аптеки. Резерв створиться після вашого підтвердження.</p>
  <form onSubmit={e=>void submit(e)} className="checkout-layout"><div className="checkout-fields"><fieldset className="checkout-card" disabled={frozen}><legend>1. Спосіб отримання</legend><div className="fulfillment-options"><label><input type="radio" name="fulfillment" checked={mode==='PICKUP'} onChange={()=>{setMode('PICKUP');setQuote(undefined);}}/>Самовивіз <small>Безкоштовно</small></label><label><input type="radio" name="fulfillment" checked={mode==='COURIER'} onChange={()=>{setMode('COURIER');setQuote(undefined);}}/>Кур’єр <small>60 грн</small></label></div></fieldset>
  <fieldset className="checkout-card" disabled={frozen}><legend>2. Аптека</legend>{options.isPending?<p role="status">Перевіряємо наявність…</p>:options.isError?<div role="alert"><p>Не вдалося завантажити аптеки. Кошик збережено.</p><button type="button" onClick={()=>{cart.refresh();void options.refetch();}}>Повторити</button></div>:<div className="checkout-pharmacies">{options.data?.pharmacies.map(ph=><label key={ph.id} data-available={ph.available}><input type="radio" name="pharmacy" value={ph.id} required disabled={!ph.available} checked={pharmacyId===ph.id} onChange={()=>{setPharmacy(ph.id);setQuote(undefined);}}/><span><strong>{ph.name}</strong><span>{ph.address}</span><small>{ph.available?'Усі товари є в наявності':ph.shortages.map(i=>`${i.name}: доступно ${i.available} із ${i.requested} шт.`).join('; ')}</small></span></label>)}{options.data&&!options.data.pharmacies.some(ph=>ph.available)&&<p role="alert">Жодна аптека не має всього кошика. Змініть кількість або склад товарів у кошику.</p>}</div>}</fieldset>
  <fieldset className="checkout-card contact-fields" disabled={frozen}><legend>3. Контактні дані</legend><label>Ім’я одержувача<input autoComplete="name" required minLength={2} maxLength={100} value={name??profile.data?.name??''} onChange={e=>setName(e.target.value)}/></label><label>Телефон<input type="tel" autoComplete="tel" required minLength={7} maxLength={30} value={phone??profile.data?.phone??''} onChange={e=>setPhone(e.target.value)}/></label><label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label></fieldset>
  {mode==='COURIER'&&<fieldset className="checkout-card contact-fields" disabled={frozen}><legend>4. Адреса доставки</legend><label>Місто<input autoComplete="address-level2" required minLength={2} maxLength={100} value={city} onChange={e=>setCity(e.target.value)}/></label><label>Вулиця<input autoComplete="address-line1" required minLength={2} maxLength={200} value={street} onChange={e=>setStreet(e.target.value)}/></label><div className="address-row"><label>Будинок<input required maxLength={30} value={building} onChange={e=>setBuilding(e.target.value)}/></label><label>Квартира<input maxLength={30} value={apartment} onChange={e=>setApartment(e.target.value)}/></label></div></fieldset>}</div>
  <aside className="cart-summary checkout-summary"><h2>{currentQuote?'Перевірте замовлення':'Ваше замовлення'}</h2><ul>{(currentQuote?.items??cart.data.items).map(i=><li key={i.productId}><span>{i.name} × {i.quantity}</span><strong>{money(i.lineTotalMinor)}</strong></li>)}</ul>
   <p>Товари <strong>{money(currentQuote?.subtotalMinor??cart.data.totalMinor)}</strong></p><p>Доставка <strong>{money(currentQuote?.deliveryMinor??(mode==='COURIER'?6000:0))}</strong></p><p className="order-total">До сплати <strong>{money(currentQuote?.totalMinor??cart.data.totalMinor+(mode==='COURIER'?6000:0))}</strong></p><p className="cart-hint">Оплата при отриманні.</p>
   {currentQuote&&<div className="quote-note"><p>{currentQuote.pharmacy.name}<br/>{currentQuote.pharmacy.address}</p><p>Підсумок дійсний до {new Date(currentQuote.expiresAt).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}. Після зміни ціни знадобиться повторне підтвердження.</p>{currentQuote.items.some(i=>i.requiresPrescription)&&<p>Для рецептурних товарів підготуйте рецепт для перевірки фармацевтом.</p>}</div>}
   {error&&<p role="alert" className="cart-error">{error}</p>}{uncertain&&<p className="cart-hint">Відповідь не отримано. Повторний запит перевірить це саме замовлення. Ви також можете переглянути історію.</p>}
   <button type="submit" disabled={busy||cart.busy||cart.pending||cart.failed||options.isError||options.isPending||!pharmacyId}>{busy?'Зачекайте…':uncertain?'Повторити підтвердження':currentQuote?'Підтвердити замовлення':'Перевірити підсумок'}</button>
   {currentQuote&&!frozen&&<button type="button" className="secondary" onClick={()=>{setQuote(undefined);}}>Оновити підсумок</button>}{uncertain&&<button type="button" className="secondary" onClick={onOrders}>Перевірити історію</button>}
  </aside></form></section>;
}
