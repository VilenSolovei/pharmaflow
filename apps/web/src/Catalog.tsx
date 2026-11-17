import { useCart } from './cart-store';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
interface Option { id:string; name:string; }
interface Pharmacy extends Option { address:string; distanceKm?:number; available?:number; }
interface Product { id:string; name:string; description:string; type:string; priceMinor:number; requiresPrescription:boolean; category:string; manufacturer:string; available:number; pharmacies?:Pharmacy[]; }
const money=(n:number)=>new Intl.NumberFormat('uk-UA',{style:'currency',currency:'UAH'}).format(n/100);
const types:Record<string,string>={MEDICINE:'Лікарський засіб',VITAMIN:'Вітаміни',MEDICAL_DEVICE:'Медичний виріб'};
async function get<T>(url:string,signal?:AbortSignal):Promise<T>{const r=await fetch('/api/'+url,{signal});if(!r.ok)throw Error('Не вдалося завантажити дані. Перевірте фільтри або спробуйте ще раз.');return r.json();}
function ProductDetails({id,onClose}:{id:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const product=useQuery({queryKey:['product',id],queryFn:({signal})=>get<Product>('products/'+id,signal)});
 useEffect(()=>{const d=dialog.current;const previous=document.activeElement;d?.showModal();return()=>{d?.close();if(previous instanceof HTMLElement)previous.focus();};},[]);
 return <dialog ref={dialog} className="product-dialog" onCancel={e=>{e.preventDefault();onClose();}} aria-labelledby="detail-title">
  <button className="dialog-close" onClick={onClose} aria-label="Закрити деталі">×</button>
  <h2 id="detail-title">{product.data?.name ?? 'Деталі товару'}</h2>
  {product.isPending?<p role="status">Завантажуємо…</p>:product.isError?<p role="alert">{product.error.message}</p>:<>
   <p>{product.data.manufacturer} · {product.data.category}</p><strong className="detail-price">{money(product.data.priceMinor)}</strong>
   {product.data.description && <p>{product.data.description}</p>}<p>{product.data.requiresPrescription?'Рецептурний товар':'Без рецепта'}</p>
   <h3>Наявність в аптеках</h3><ul className="pharmacy-list">{product.data.pharmacies?.map(p=><li key={p.id}><strong>{p.name}</strong><span>{p.address}</span><span>{p.available ? `Доступно: ${p.available} шт.`:'Немає в наявності'}</span></li>)}</ul>
  </>}
 </dialog>;
}
export function Catalog(){
 const cart=useCart();
 const [filters,setFilters]=useState<Record<string,string>>({});const [search,setSearch]=useState('');const [page,setPage]=useState(1);const [detail,setDetail]=useState<string|null>(null);
 const [locationMessage,setLocationMessage]=useState('');const [locating,setLocating]=useState(false);const cache=useQueryClient();
 const lookup=useQuery({queryKey:['catalog-filters'],queryFn:({signal})=>get<{categories:Option[];manufacturers:Option[]}>('catalog/filters',signal)});
 const pharmacies=useQuery({queryKey:['pharmacies'],queryFn:({signal})=>get<Pharmacy[]>('pharmacies',signal)});
 const params=new URLSearchParams({...filters,page:String(page),limit:'6'});
 const products=useQuery({queryKey:['products',params.toString()],queryFn:({signal})=>get<{items:Product[];total:number;page:number;limit:number}>('products?'+params,signal)});
 function update(key:string,value:string){setPage(1);setFilters(old=>{const next={...old};if(value)next[key]=value;else delete next[key];return next;});}
 function locate(){
  if(!navigator.geolocation){setLocationMessage('Цей браузер не підтримує геолокацію. Оберіть аптеку зі списку.');return;}
  setLocating(true);setLocationMessage('');
  navigator.geolocation.getCurrentPosition(async pos=>{try{
   const p=await get<Pharmacy[]>(`pharmacies?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}`);
   cache.setQueryData(['pharmacies'],p);if(p[0])update('pharmacyId',p[0].id);setLocationMessage(p[0]?'Обрано найближчу аптеку за прямою відстанню.':'Немає доступних аптек.');
  }catch{setLocationMessage('Не вдалося знайти аптеки. Спробуйте ще раз.');}finally{setLocating(false);}},()=>{setLocating(false);setLocationMessage('Доступ до геолокації не надано. Оберіть аптеку зі списку.');},{timeout:8000});
 }
 return <section className="catalog" aria-labelledby="catalog-title">
  <div className="catalog-heading"><div><span className="eyebrow">Знайти потрібне</span><h1 id="catalog-title">Каталог товарів</h1><p>Ліки, вітаміни та медичні вироби у вашій аптечній мережі.</p></div></div>
  <form className="search-bar" onSubmit={e=>{e.preventDefault();update('q',search.trim());}}><label className="sr-only" htmlFor="catalog-search">Пошук товарів</label><input id="catalog-search" value={search} onChange={e=>setSearch(e.target.value)} maxLength={80} placeholder="Назва товару, категорія або виробник"/><button type="submit">Знайти</button></form>
  {cart.error&&<p role="alert" className="cart-error">{cart.error}</p>}{cart.notice&&<p role="status" className="cart-success">{cart.notice}</p>}
  <div className="catalog-layout"><aside className="filters" aria-label="Фільтри каталогу"><h2>Фільтри</h2>
   <label>Категорія<select aria-label="Категорія" value={filters.categoryId??''} onChange={e=>update('categoryId',e.target.value)}><option value="">Усі категорії</option>{lookup.data?.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label>Виробник<select aria-label="Виробник" value={filters.manufacturerId??''} onChange={e=>update('manufacturerId',e.target.value)}><option value="">Усі виробники</option>{lookup.data?.manufacturers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label>Тип товару<select aria-label="Тип товару" value={filters.type??''} onChange={e=>update('type',e.target.value)}><option value="">Усі типи</option>{Object.entries(types).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <fieldset><legend>Ціна, грн</legend><div className="price-range"><label>Від<input type="number" min="0" max="9999999.99" step="0.01" value={filters.minPrice??''} onChange={e=>update('minPrice',e.target.value)}/></label><label>До<input type="number" min="0" max="9999999.99" step="0.01" value={filters.maxPrice??''} onChange={e=>update('maxPrice',e.target.value)}/></label></div></fieldset>
   <label>Рецептурність<select aria-label="Рецептурність" value={filters.requiresPrescription??''} onChange={e=>update('requiresPrescription',e.target.value)}><option value="">Усі товари</option><option value="false">Без рецепта</option><option value="true">За рецептом</option></select></label>
   <label>Аптека<select aria-label="Аптека" value={filters.pharmacyId??''} onChange={e=>update('pharmacyId',e.target.value)}><option value="">Усі аптеки</option>{pharmacies.data?.map(p=><option key={p.id} value={p.id}>{p.name}{p.distanceKm!==undefined?` · ${p.distanceKm} км`:''}</option>)}</select></label>
   <button className="secondary" onClick={locate} disabled={locating}>{locating?'Шукаємо…':'Поруч зі мною'}</button>{locationMessage&&<p className="hint" role="status">{locationMessage}</p>}
   <label className="checkbox"><input type="checkbox" checked={filters.inStock==='true'} onChange={e=>update('inStock',e.target.checked?'true':'')}/> Лише в наявності</label>
   <button className="reset" onClick={()=>{setFilters({});setSearch('');setPage(1);setLocationMessage('');}}>Скинути фільтри</button>
   {(lookup.isError||pharmacies.isError)&&<p role="alert">Не вдалося завантажити довідники. <button onClick={()=>{void lookup.refetch();void pharmacies.refetch();}}>Повторити</button></p>}
  </aside><div className="catalog-results">
   <div className="results-toolbar"><span role="status">{products.data?`Знайдено: ${products.data.total}`:'Завантажуємо товари…'}</span><label>Сортування<select aria-label="Сортування" value={filters.sort??'name'} onChange={e=>update('sort',e.target.value)}><option value="name">За назвою</option><option value="price_asc">Спочатку дешевші</option><option value="price_desc">Спочатку дорожчі</option></select></label></div>
   {products.isPending?<div className="empty-state" role="status">Завантажуємо каталог…</div>:products.isError?<div className="empty-state" role="alert"><p>{products.error.message}</p><button onClick={()=>void products.refetch()}>Повторити</button></div>:products.data.items.length===0?<div className="empty-state"><h2>Товарів не знайдено</h2><p>Спробуйте змінити запит або фільтри.</p></div>:<div className="product-grid">{products.data.items.map(p=><article className="product-card" key={p.id}>
    <div className={'product-symbol '+p.type.toLowerCase()} aria-hidden="true">{p.type==='MEDICINE'?'Rx':p.type==='VITAMIN'?'V+':'+'}</div><span className="product-type">{types[p.type]}</span><h2>{p.name}</h2><p className="manufacturer">{p.manufacturer}</p><p className="stock" data-available={p.available>0}>{p.available>0?'Є в наявності':'Немає в наявності'}</p><span className="prescription">{p.requiresPrescription?'За рецептом':'Без рецепта'}</span><div className="product-bottom"><strong>{money(p.priceMinor)}</strong><button disabled={cart.busy||cart.pending||cart.failed||p.available===0} onClick={()=>void cart.add(p.id).catch(()=>{})} aria-label={'До кошика: '+p.name}>До кошика</button><button onClick={()=>setDetail(p.id)} aria-label={'Деталі: '+p.name}>Деталі</button></div>
   </article>)}</div>}
   {products.data&&products.data.total>6&&<nav className="pagination" aria-label="Сторінки каталогу"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Назад</button><span>Сторінка {page} з {Math.ceil(products.data.total/6)}</span><button disabled={page*6>=products.data.total} onClick={()=>setPage(p=>p+1)}>Далі</button></nav>}
  </div></div>{detail&&<ProductDetails id={detail} onClose={()=>setDetail(null)}/>}
 </section>;
}
