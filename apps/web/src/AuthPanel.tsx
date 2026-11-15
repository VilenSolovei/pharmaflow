import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
interface User { id: string; email: string; role: string; tier: string; }
async function request(path: string, body?: object): Promise<User | null> {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-PharmaFlow-Request': '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (path === 'me' && response.status === 401) return null;
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Перевірте email і пароль. Пароль має містити щонайменше 12 символів.');
  return data as User;
}
export function AuthPanel() {
  const cache = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const account = useQuery({ queryKey: ['account'], queryFn: () => request('me'), retry: false });
  const auth = useMutation({
    mutationFn: async () => {
      if (mode === 'register') await request('register', { email, password });
      return request('login', { email, password });
    },
    onSuccess: user => { setPassword(''); cache.setQueryData(['account'], user); },
  });
  const logout = useMutation({ mutationFn: () => request('logout', {}),
    onSuccess: () => { cache.setQueryData(['account'], null); auth.reset(); } });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); auth.mutate(); }
  if (account.isPending) return <p role="status">Завантажуємо кабінет…</p>;
  if (account.isError) return <div className="auth-panel"><p role="alert">Не вдалося завантажити кабінет.</p><button onClick={() => void account.refetch()}>Повторити</button></div>;
  if (account.data) return <section className="auth-panel" aria-labelledby="account-heading">
    <h2 id="account-heading">Особистий кабінет</h2>
    <p className="account-email">{account.data.email}</p>
    <p>{account.data.role === 'ADMIN' ? 'Адміністратор' : 'Клієнт'} · {account.data.tier === 'STANDARD' ? 'Звичайна категорія' : account.data.tier}</p>
    <button onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? 'Виходимо…' : 'Вийти'}</button>
    {logout.isError && <p role="alert">Не вдалося вийти. Спробуйте ще раз.</p>}
  </section>;
  return <section className="auth-panel" aria-labelledby="auth-heading">
    <h2 id="auth-heading">{mode === 'login' ? 'Вхід до кабінету' : 'Створити обліковий запис'}</h2>
    <form onSubmit={submit}>
      <label htmlFor="auth-email">Email</label>
      <input id="auth-email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={auth.isPending} onChange={e => setEmail(e.target.value)} />
      <label htmlFor="auth-password">Пароль</label>
      <input id="auth-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 12 : 1} maxLength={128} value={password} disabled={auth.isPending} onChange={e => setPassword(e.target.value)} aria-describedby={mode === 'register' ? 'password-hint' : undefined} />
      {mode === 'register' && <small id="password-hint">Від 12 до 128 символів.</small>}
      {auth.isError && <p role="alert">{auth.error.message}</p>}
      <button type="submit" disabled={auth.isPending}>{auth.isPending ? 'Зачекайте…' : mode === 'login' ? 'Увійти' : 'Зареєструватися'}</button>
    </form>
    <button className="text-button" disabled={auth.isPending} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setPassword(''); auth.reset(); }}>
      {mode === 'login' ? 'Створити обліковий запис' : 'Уже є обліковий запис? Увійти'}
    </button>
  </section>;
}
