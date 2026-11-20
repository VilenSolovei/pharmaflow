import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CustomerApiError, customerRequest } from './customer-api';
import type { Profile } from './customer-api';
export function ProfilePanel({uid}:{uid:string}){
 const cache=useQueryClient();const profile=useQuery({queryKey:['profile',uid],queryFn:({signal})=>customerRequest<Profile>('',uid,'GET',undefined,signal),retry:false});
 const [draft,setDraft]=useState<Profile>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const locked=useRef(false);
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const data=draft??profile.data;if(!data||locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');
  try{const result=await customerRequest<Profile>('',uid,'PATCH',{name:data.name,phone:data.phone,revision:data.revision});cache.setQueryData(['profile',uid],result);setDraft(undefined);setNotice('Контактні дані збережено.');}
  catch(e){setError(e instanceof Error?e.message:'Не вдалося зберегти профіль.');if(e instanceof CustomerApiError){if(e.status===401)void cache.invalidateQueries({queryKey:['account']});if(e.status===409)void profile.refetch();}}
  finally{locked.current=false;setBusy(false);}
 }
 const data=draft??profile.data;
 return <section className="account-card profile-panel" aria-labelledby="profile-title"><h2 id="profile-title">Мої дані</h2>{profile.isPending?<p role="status">Завантажуємо профіль…</p>:profile.isError&&!data?<div role="alert"><p>Не вдалося завантажити профіль.</p><button onClick={()=>void profile.refetch()}>Повторити</button></div>:data&&<form onSubmit={e=>void save(e)}><fieldset disabled={busy}><label>Ім’я та прізвище<input autoComplete="name" maxLength={100} value={data.name} onChange={e=>{setDraft({...data,name:e.target.value});setNotice('');}}/></label><label>Телефон профілю<input type="tel" autoComplete="tel" maxLength={30} value={data.phone} onChange={e=>{setDraft({...data,phone:e.target.value});setNotice('');}}/></label><p className="cart-hint">Ці дані підставлятимуться під час оформлення замовлення.</p><button type="submit">{busy?'Зберігаємо…':'Зберегти профіль'}</button><button type="button" className="secondary" onClick={()=>{setDraft(undefined);setError('');setNotice('');void profile.refetch();}}>Завантажити актуальні дані</button></fieldset></form>}{error&&<p className="cart-error" role="alert">{error}</p>}{notice&&<p className="cart-success" role="status">{notice}</p>}</section>;
}
