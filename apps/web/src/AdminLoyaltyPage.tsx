import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountRequest } from './account-api';
import { adminLoyaltyRequest, LoyaltyApiError, percent, tierLabel } from './loyalty-api';
import type { LoyaltyCustomer, LoyaltyList, LoyaltyProduct, Promotion } from './loyalty-api';
import { PromotionEditor } from './PromotionEditor';
export function AdminLoyaltyPage(){
 const account=useQuery({queryKey:['account'],queryFn:()=>accountRequest('me'),retry:false,refetchOnWindowFocus:true});
 if(account.isPending)return <p role="status">Перевіряємо доступ…</p>;
 if(account.isError)return <section className="orders-page"><h1>Лояльність та акції</h1><p role="alert">Не вдалося перевірити доступ.</p><button onClick={()=>void account.refetch()}>Повторити</button></section>;
 if(account.data?.role!=='ADMIN')return <section className="orders-page"><h1>Лояльність та акції</h1><p role="alert">Цей розділ доступний адміністратору.</p></section>;
 return <AdminLoyalty key={account.data.id} uid={account.data.id}/>;
}
function AdminLoyalty({uid}:{uid:string}){
 const [tab,setTab]=useState<'customers'|'products'|'promotions'>('customers');
 return <section className="orders-page loyalty-admin"><span className="eyebrow">Керування пропозиціями</span><h1>Лояльність та акції</h1><nav className="loyalty-tabs" aria-label="Керування лояльністю"><button className={tab==='customers'?'active':''} onClick={()=>setTab('customers')}>Клієнти</button><button className={tab==='products'?'active':''} onClick={()=>setTab('products')}>Соціальні товари</button><button className={tab==='promotions'?'active':''} onClick={()=>setTab('promotions')}>Акції</button></nav>{tab==='customers'?<Customers uid={uid}/>:tab==='products'?<SocialProducts uid={uid}/>:<Promotions uid={uid}/>}</section>;
}
function Search({label,onSearch}:{label:string;onSearch:(q:string)=>void}){
 const [value,setValue]=useState('');
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();onSearch(value.trim());}
 return <form className="loyalty-search" onSubmit={submit}><label>{label}<input maxLength={160} value={value} onChange={e=>setValue(e.target.value)}/></label><button>Знайти</button></form>;
}
function Pager({page,total,limit,onPage}:{page:number;total:number;limit:number;onPage:(n:number)=>void}){return total>limit?<nav className="pagination" aria-label="Сторінки керування лояльністю"><button disabled={page<=1} onClick={()=>onPage(page-1)}>Назад</button><span>{page}</span><button disabled={page*limit>=total} onClick={()=>onPage(page+1)}>Далі</button></nav>:null;}
function Customers({uid}:{uid:string}){
 const cache=useQueryClient(),[q,setQ]=useState(''),[page,setPage]=useState(1);
 const list=useQuery({queryKey:['loyalty-customers',uid,q,page],queryFn:({signal})=>adminLoyaltyRequest<LoyaltyList<LoyaltyCustomer>>('/customers?q='+encodeURIComponent(q)+'&page='+page,uid,'GET',undefined,signal),retry:false});
 return <section className="account-card"><h2>Категорії клієнтів</h2><Search label="Пошук клієнта за email або ім’ям" onSearch={v=>{setQ(v);setPage(1);}}/>{list.isPending?<p role="status">Завантажуємо клієнтів…</p>:list.isError?<div role="alert"><p>Не вдалося завантажити клієнтів.</p><button onClick={()=>void list.refetch()}>Повторити</button></div>:list.data&&<><div className="loyalty-management-list">{list.data.items.map(item=><CustomerRow key={item.id+':'+item.revision} item={item} uid={uid} onSaved={()=>{void cache.invalidateQueries({queryKey:['loyalty-customers',uid]});void cache.invalidateQueries({queryKey:['loyalty']});void cache.invalidateQueries({queryKey:['account']});void cache.invalidateQueries({queryKey:['profile']});}}/>)}</div>{!list.data.total&&<p>Клієнтів не знайдено.</p>}<Pager page={page} total={list.data.total} limit={list.data.limit} onPage={setPage}/></>}</section>;
}
function CustomerRow({item,uid,onSaved}:{item:LoyaltyCustomer;uid:string;onSaved:()=>void}){
 const cache=useQueryClient(),[tier,setTier]=useState(item.tier);
 const save=useMutation({mutationFn:()=>adminLoyaltyRequest('/customers/'+item.id,uid,'PATCH',{tier,revision:item.revision}),onSuccess:onSaved,onError:e=>{if(e instanceof LoyaltyApiError&&(e.status===401||e.status===403))void cache.invalidateQueries({queryKey:['account']});}});
 return <article className="loyalty-customer-row"><div><strong>{item.name||item.email}</strong>{item.name&&<span>{item.email}</span>}<small>{tierLabel[item.tier]} категорія</small></div><label>Категорія для {item.email}<select value={tier} disabled={save.isPending} onChange={e=>setTier(e.target.value)}>{Object.entries(tierLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button disabled={save.isPending||tier===item.tier} onClick={()=>save.mutate()}>Зберегти категорію</button>{save.isError&&<p className="cart-error" role="alert">{save.error.message}</p>}{save.isError&&<button className="secondary" onClick={onSaved}>Оновити список</button>}</article>;
}
function SocialProducts({uid}:{uid:string}){
 const cache=useQueryClient(),[q,setQ]=useState(''),[page,setPage]=useState(1);
 const list=useQuery({queryKey:['loyalty-products',uid,q,page],queryFn:({signal})=>adminLoyaltyRequest<LoyaltyList<LoyaltyProduct>>('/products?q='+encodeURIComponent(q)+'&page='+page,uid,'GET',undefined,signal),retry:false});
 const save=useMutation({mutationFn:(item:LoyaltyProduct)=>adminLoyaltyRequest('/products/'+item.id,uid,'PATCH',{socialEligible:!item.socialEligible,revision:item.revision}),onSuccess:()=>cache.invalidateQueries({queryKey:['loyalty-products',uid]}),onError:()=>{void cache.invalidateQueries({queryKey:['account']});}});
 return <section className="account-card"><h2>Товари із соціальною знижкою</h2><p className="cart-hint">Позначка надає клієнтам соціальної категорії знижку 10% на цей товар.</p><Search label="Пошук товару для соціальної знижки" onSearch={v=>{setQ(v);setPage(1);}}/>{save.isError&&<p className="cart-error" role="alert">{save.error.message} <button className="secondary" onClick={()=>void list.refetch()}>Оновити список</button></p>}{list.isPending?<p role="status">Завантажуємо товари…</p>:list.isError?<div role="alert"><p>Не вдалося завантажити товари.</p><button onClick={()=>void list.refetch()}>Повторити</button></div>:list.data&&<><div className="social-product-list">{list.data.items.map(item=><label key={item.id}><input type="checkbox" checked={item.socialEligible} disabled={save.isPending} onChange={()=>save.mutate(item)}/><span>{item.name}<small>{item.socialEligible?'Соціальна знижка увімкнена':'Без соціальної знижки'}</small></span></label>)}</div>{!list.data.total&&<p>Товарів не знайдено.</p>}<Pager page={page} total={list.data.total} limit={list.data.limit} onPage={setPage}/></>}</section>;
}
function Promotions({uid}:{uid:string}){
 const cache=useQueryClient(),[page,setPage]=useState(1),[editor,setEditor]=useState<{key:string;item?:Promotion}>();
 const list=useQuery({queryKey:['promotions',uid,page],queryFn:({signal})=>adminLoyaltyRequest<LoyaltyList<Promotion>>('/promotions?page='+page,uid,'GET',undefined,signal),retry:false,staleTime:0});
 return <section className="account-card"><div className="account-section-heading"><h2>Акції</h2><button disabled={!!editor} onClick={()=>setEditor({key:crypto.randomUUID()})}>Створити акцію</button></div>{editor&&<PromotionEditor key={editor.key} uid={uid} requestId={editor.key} initial={editor.item} onClose={()=>setEditor(undefined)} onSaved={()=>{setEditor(undefined);setPage(1);void cache.invalidateQueries({queryKey:['promotions',uid]});}}/>}{list.isPending?<p role="status">Завантажуємо акції…</p>:list.isError?<div role="alert"><p>Не вдалося завантажити акції.</p><button onClick={()=>void list.refetch()}>Повторити</button></div>:list.data&&<><div className="promotion-list">{list.data.items.map(item=><article className="promotion-card" key={item.id}><header><h3>{item.name}</h3><strong>−{percent(item.discountBps)}</strong></header><p>{new Date(item.startsAt).toLocaleString('uk-UA')} — {new Date(item.endsAt).toLocaleString('uk-UA')}</p><p className="cart-hint">{({DISABLED:'Вимкнено',SCHEDULED:'Заплановано',EXPIRED:'Завершено',ACTIVE:'Діє зараз'})[item.phase]}</p><ul>{item.products.map(p=><li key={p.id}>{p.name}</li>)}</ul><button className="secondary" disabled={!!editor} onClick={()=>setEditor({key:crypto.randomUUID(),item})}>Редагувати акцію</button></article>)}</div>{!list.data.total&&<p className="cart-hint">Акцій поки немає.</p>}<Pager page={page} total={list.data.total} limit={list.data.limit} onPage={setPage}/></>}</section>;
}
