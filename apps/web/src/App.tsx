import { useState } from 'react';
import { AuthPanel } from './AuthPanel';
import { Catalog } from './Catalog';
export function App(){
 const [view,setView]=useState<'catalog'|'account'>('catalog');
 return <div className="page"><header className="header"><a className="brand" href="#catalog" onClick={()=>setView('catalog')} aria-label="PharmaFlow — головна"><span className="brand-mark" aria-hidden="true">+</span>PharmaFlow</a><nav aria-label="Основна навігація"><button className={view==='catalog'?'active':''} aria-current={view==='catalog'?'page':undefined} onClick={()=>setView('catalog')}>Каталог</button><button className={view==='account'?'active':''} aria-current={view==='account'?'page':undefined} onClick={()=>setView('account')}>Особистий кабінет</button></nav></header>
 <main className="application-main">{view==='catalog'?<Catalog/>:<section className="account-page"><span className="eyebrow">Ваш PharmaFlow</span><h1>Особистий кабінет</h1><AuthPanel/></section>}</main>
 <footer>PharmaFlow <span aria-hidden="true">/</span>Платформа аптечної мережі</footer></div>;
}
