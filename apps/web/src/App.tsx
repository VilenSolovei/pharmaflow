import { AdminOrdersPage } from './AdminOrdersPage';
import { useQuery } from '@tanstack/react-query';
import { accountRequest } from './account-api';
import { CheckoutPage } from './CheckoutPage';
import { OrdersPage } from './OrdersPage';
import { CartProvider } from './CartProvider';
import { CartPage } from './CartPage';
import { useCart } from './cart-store';
import { useState } from 'react';
import { AuthPanel } from './AuthPanel';
import { Catalog } from './Catalog';
function Application(){
 const cart=useCart();
 const account=useQuery({queryKey:['account'],queryFn:()=>accountRequest('me'),retry:false});
 const [view,setView]=useState<'catalog'|'account'|'cart'|'checkout'|'orders'|'admin'>('catalog');
 return <div className="page"><header className="header"><a className="brand" href="#catalog" onClick={()=>setView('catalog')} aria-label="PharmaFlow — головна"><span className="brand-mark" aria-hidden="true">+</span>PharmaFlow</a><nav aria-label="Основна навігація"><button className={view==='catalog'?'active':''} aria-current={view==='catalog'?'page':undefined} onClick={()=>setView('catalog')}>Каталог</button><button className={view==='account'?'active':''} aria-current={view==='account'?'page':undefined} onClick={()=>setView('account')}>Особистий кабінет</button><button className={view==='cart'?'active':''} aria-current={view==='cart'?'page':undefined} onClick={()=>setView('cart')}>Кошик ({cart.data?.count??0})</button><button className={view==='orders'?'active':''} aria-current={view==='orders'?'page':undefined} onClick={()=>setView('orders')}>Мої замовлення</button>{account.data?.role==='ADMIN'&&<button className={view==='admin'?'active':''} aria-current={view==='admin'?'page':undefined} onClick={()=>setView('admin')}>Обробка замовлень</button>}</nav></header>
 <main className="application-main">{cart.hasGuestDraft&&view!=='cart'&&<div className="guest-notice">У браузері є товари з гостьового кошика. <button className="link-button" onClick={()=>setView('cart')}>Переглянути кошик</button></div>}{view==='catalog'?<Catalog/>:view==='cart'?<CartPage onCatalog={()=>setView('catalog')} onAccount={()=>setView('account')} onCheckout={()=>setView('checkout')}/>:view==='checkout'?<CheckoutPage key={cart.data?.ownerId??'guest'} onCart={()=>setView('cart')} onAccount={()=>setView('account')} onOrders={()=>setView('orders')}/>:view==='orders'?<OrdersPage onAccount={()=>setView('account')} onCatalog={()=>setView('catalog')}/>:view==='admin'?<AdminOrdersPage key={account.data?.id??'guest'}/>:<section className="account-page"><span className="eyebrow">Ваш PharmaFlow</span><h1>Особистий кабінет</h1><AuthPanel/></section>}</main>
 <footer>PharmaFlow <span aria-hidden="true">/</span>Платформа аптечної мережі</footer></div>;
}

export function App(){return <CartProvider><Application/></CartProvider>;}
