import { AdminCatalogPage } from './AdminCatalogPage';
import { NotificationsPage } from './NotificationsPage';
import { notificationRequest } from './notifications-api';
import type { NotificationProduct } from './notifications-api';
import { AdminLoyaltyPage } from './AdminLoyaltyPage';
import { AdminOrdersPage } from './AdminOrdersPage';
import { useQuery } from '@tanstack/react-query';
import { accountRequest } from './account-api';
import { CheckoutPage } from './CheckoutPage';
import { OrdersPage } from './OrdersPage';
import { CartProvider } from './CartProvider';
import { CartPage } from './CartPage';
import { useCart } from './cart-store';
import { useState } from 'react';
import { AccountPage } from './AccountPage';
import { Catalog } from './Catalog';
function Application(){
 const cart=useCart();
 const account=useQuery({queryKey:['account'],queryFn:()=>accountRequest('me'),retry:false});
 const uid=account.data?.id??'';
 const notificationCount=useQuery({queryKey:['notification-count',uid],enabled:!!uid,queryFn:({signal})=>notificationRequest<{ownerId:string;unreadCount:number}>('/summary',uid,'GET',undefined,signal),retry:false,refetchInterval:10000});
 const [notificationProduct,setNotificationProduct]=useState<NotificationProduct>();
 const [view,setView]=useState<'catalog'|'account'|'cart'|'checkout'|'orders'|'admin'|'loyalty-admin'|'notifications'|'catalog-admin'>('catalog');
 return <div className="page"><header className="header"><a className="brand" href="#catalog" onClick={()=>setView('catalog')} aria-label="PharmaFlow — головна"><span className="brand-mark" aria-hidden="true">+</span>PharmaFlow</a><nav aria-label="Основна навігація"><button className={view==='catalog'?'active':''} aria-current={view==='catalog'?'page':undefined} onClick={()=>setView('catalog')}>Каталог</button><button className={view==='account'?'active':''} aria-current={view==='account'?'page':undefined} onClick={()=>setView('account')}>Особистий кабінет</button><button className={view==='cart'?'active':''} aria-current={view==='cart'?'page':undefined} onClick={()=>setView('cart')}>Кошик ({cart.data?.count??0})</button><button className={view==='orders'?'active':''} aria-current={view==='orders'?'page':undefined} onClick={()=>setView('orders')}>Мої замовлення</button>{account.data?.role==='ADMIN'&&<button className={view==='admin'?'active':''} aria-current={view==='admin'?'page':undefined} onClick={()=>setView('admin')}>Обробка замовлень</button>}{account.data?.role==='ADMIN'&&<button className={view==='loyalty-admin'?'active':''} aria-current={view==='loyalty-admin'?'page':undefined} onClick={()=>setView('loyalty-admin')}>Лояльність та акції</button>}{account.data?.role==='ADMIN'&&<button className={view==='catalog-admin'?'active':''} aria-current={view==='catalog-admin'?'page':undefined} onClick={()=>setView('catalog-admin')}>Каталог та залишки</button>}<button className={view==='notifications'?'active':''} aria-current={view==='notifications'?'page':undefined} onClick={()=>{setNotificationProduct(undefined);setView('notifications');}}>Сповіщення ({notificationCount.data?.unreadCount??0})</button></nav></header>
 <main className="application-main">{cart.hasGuestDraft&&view!=='cart'&&<div className="guest-notice">У браузері є товари з гостьового кошика. <button className="link-button" onClick={()=>setView('cart')}>Переглянути кошик</button></div>}{view==='catalog'?<Catalog onNotify={product=>{setNotificationProduct(product);setView('notifications');}}/>:view==='cart'?<CartPage onCatalog={()=>setView('catalog')} onAccount={()=>setView('account')} onCheckout={()=>setView('checkout')}/>:view==='checkout'?<CheckoutPage key={cart.data?.ownerId??'guest'} onCart={()=>setView('cart')} onAccount={()=>setView('account')} onOrders={()=>setView('orders')}/>:view==='orders'?<OrdersPage key={account.data?.id??'guest'} onAccount={()=>setView('account')} onCatalog={()=>setView('catalog')} onCart={()=>setView('cart')}/>:view==='admin'?<AdminOrdersPage key={account.data?.id??'guest'}/>:view==='loyalty-admin'?<AdminLoyaltyPage key={account.data?.id??'guest'}/>:view==='catalog-admin'?<AdminCatalogPage key={account.data?.id??'guest'}/>:view==='notifications'?<NotificationsPage initialProduct={notificationProduct} onAccount={()=>setView('account')}/>:<section className="account-page"><span className="eyebrow">Ваш PharmaFlow</span><h1>Особистий кабінет</h1><AccountPage onNotifications={()=>{setNotificationProduct(undefined);setView('notifications');}}/></section>}</main>
 <footer>PharmaFlow <span aria-hidden="true">/</span>Платформа аптечної мережі</footer></div>;
}

export function App(){return <CartProvider><Application/></CartProvider>;}
