import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountRequest } from './account-api';
import { AvailabilityPanel } from './AvailabilityPanel';
import { RemindersPanel } from './RemindersPanel';
import { notificationRequest } from './notifications-api';
import type { NotificationList, NotificationPreferences, NotificationProduct } from './notifications-api';
export function NotificationsPage({initialProduct,onAccount}:{initialProduct?:NotificationProduct;onAccount:()=>void}){
 const account=useQuery({queryKey:['account'],queryFn:()=>accountRequest('me'),retry:false});
 if(account.isPending)return <p role="status">Перевіряємо обліковий запис…</p>;
 if(account.isError)return <section className="orders-page"><h1>Сповіщення</h1><p role="alert">Не вдалося перевірити обліковий запис.</p><button onClick={()=>void account.refetch()}>Повторити</button></section>;
 if(!account.data)return <section className="orders-page"><h1>Сповіщення</h1><p>Увійдіть, щоб керувати підписками й нагадуваннями.</p><button onClick={onAccount}>Увійти до кабінету</button></section>;
 return <Notifications key={account.data.id+':'+(initialProduct?.id??'')} uid={account.data.id} initialProduct={initialProduct}/>;
}
function Notifications({uid,initialProduct}:{uid:string;initialProduct?:NotificationProduct}){
 const [tab,setTab]=useState<'inbox'|'availability'|'reminders'>(initialProduct?'availability':'inbox');
 return <section className="orders-page notifications-page"><span className="eyebrow">Ваш PharmaFlow</span><h1>Сповіщення</h1><nav className="loyalty-tabs" aria-label="Розділи сповіщень"><button className={tab==='inbox'?'active':''} onClick={()=>setTab('inbox')}>Повідомлення</button><button className={tab==='availability'?'active':''} onClick={()=>setTab('availability')}>Наявність товарів</button><button className={tab==='reminders'?'active':''} onClick={()=>setTab('reminders')}>Нагадування</button></nav>{tab==='inbox'?<><NotificationSettings uid={uid}/><Inbox uid={uid}/></>:tab==='availability'?<AvailabilityPanel uid={uid} initialProduct={initialProduct}/>:<RemindersPanel uid={uid}/>}</section>;
}
function NotificationSettings({uid}:{uid:string}){
 const cache=useQueryClient();const settings=useQuery({queryKey:['notification-preferences',uid],queryFn:({signal})=>notificationRequest<NotificationPreferences>('/preferences',uid,'GET',undefined,signal),retry:false});
 const save=useMutation({mutationFn:()=>notificationRequest<NotificationPreferences>('/preferences',uid,'PATCH',{promotionOptIn:!settings.data!.promotionOptIn,revision:settings.data!.revision}),onSuccess:data=>cache.setQueryData(['notification-preferences',uid],data),onError:()=>{void settings.refetch();}});
 return <section className="account-card notification-settings"><h2>Повідомлення про акції</h2>{settings.isPending?<p role="status">Завантажуємо налаштування…</p>:settings.isError?<div role="alert"><p>Не вдалося завантажити налаштування.</p><button onClick={()=>void settings.refetch()}>Повторити</button></div>:<label className="inline-check"><input type="checkbox" checked={settings.data?.promotionOptIn??false} disabled={save.isPending} onChange={()=>save.mutate()}/>Хочу отримувати повідомлення про нові акції</label>}{save.isError&&<p role="alert" className="cart-error">{save.error.message}</p>}<p className="cart-hint">Повідомлення зберігаються в цьому розділі.</p></section>;
}
function Inbox({uid}:{uid:string}){
 const cache=useQueryClient(),[page,setPage]=useState(1),[unread,setUnread]=useState(false);
 const list=useQuery({queryKey:['notifications',uid,page,unread],queryFn:({signal})=>notificationRequest<NotificationList>('?page='+page+'&unreadOnly='+unread,uid,'GET',undefined,signal),retry:false,staleTime:0,refetchInterval:5000,refetchOnWindowFocus:true});
 useEffect(()=>{if(list.data)cache.setQueryData(['notification-count',uid],{ownerId:uid,unreadCount:list.data.unreadCount});},[cache,list.data,uid]);
 async function refresh(){await Promise.all([cache.invalidateQueries({queryKey:['notifications',uid]}),cache.invalidateQueries({queryKey:['notification-count',uid]})]);}
 const mark=useMutation({mutationFn:({id,read}:{id:string;read:boolean})=>notificationRequest('/'+id+'/read',uid,'PATCH',{read}),onSuccess:refresh});
 const all=useMutation({mutationFn:()=>notificationRequest('/read-all',uid,'POST',{}),onSuccess:refresh});
 return <section className="account-card inbox-panel"><div className="account-section-heading"><h2>Ваші повідомлення</h2><button className="secondary" disabled={all.isPending||mark.isPending||!list.data?.unreadCount} onClick={()=>all.mutate()}>Позначити всі прочитаними</button></div><div className="inbox-toolbar"><label className="inline-check"><input type="checkbox" checked={unread} onChange={e=>{setUnread(e.target.checked);setPage(1);}}/>Лише непрочитані</label><button className="secondary" onClick={()=>void refresh()}>Оновити повідомлення</button></div>{(mark.isError||all.isError)&&<p role="alert" className="cart-error">{mark.error?.message??all.error?.message}</p>}{list.isPending?<p role="status">Завантажуємо повідомлення…</p>:list.isError?<div className="empty-state" role="alert"><p>Не вдалося завантажити повідомлення.</p><button onClick={()=>void list.refetch()}>Повторити</button></div>:list.data?.items.length?<><div className="notification-list">{list.data.items.map(n=><article key={n.id} data-unread={!n.readAt}><header><div><span className="notification-kind">{({AVAILABILITY:'Наявність',REMINDER:'Нагадування',PROMOTION:'Акція'})[n.kind]}</span><h3>{n.title}</h3></div><time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString('uk-UA')}</time></header><p>{n.body}</p><button className="secondary" disabled={mark.isPending||all.isPending} onClick={()=>mark.mutate({id:n.id,read:!n.readAt})}>{n.readAt?'Позначити непрочитаним':'Позначити прочитаним'}</button></article>)}</div>{list.data.total>list.data.limit&&<nav className="pagination" aria-label="Сторінки повідомлень"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page}</span><button disabled={page*list.data.limit>=list.data.total} onClick={()=>setPage(p=>p+1)}>Далі</button></nav>}</>:<p className="account-empty">{unread?'Непрочитаних повідомлень немає.':'Повідомлень поки немає.'}</p>}</section>;
}
