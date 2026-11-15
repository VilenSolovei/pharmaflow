import { AuthPanel } from './AuthPanel';
import { useQuery } from '@tanstack/react-query';

async function checkConnection(signal: AbortSignal) {
  const response = await fetch('/api/health', { signal });
  if (!response.ok) throw new Error('Service is unavailable');
  const data: { status?: string; checks?: { database?: string } } = await response.json();
  if (data.status !== 'ok' || data.checks?.database !== 'up') {
    throw new Error('Service is unavailable');
  }
  return data;
}

export function App() {
  const connection = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => checkConnection(signal),
  });
  const state = connection.isFetching ? 'loading' : connection.isError ? 'error' : 'ready';
  const message = {
    loading: 'Перевіряємо підключення…',
    error: 'Сервіс тимчасово недоступний',
    ready: 'Підключення встановлено',
  }[state];

  return (
    <div className="page">
      <header className="header">
        <a className="brand" href="/" aria-label="PharmaFlow — головна">
          <span className="brand-mark" aria-hidden="true">+</span>
          PharmaFlow
        </a>
        <span className="header-caption">Турбота поруч</span>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <span className="eyebrow">Ваша аптечна мережа</span>
          <h1 id="page-title">Pharma<span>Flow</span></h1>
          <p className="description">
            Платформа керування мережею аптек та онлайн-замовленнями.
          </p>

          <AuthPanel />
          <div className="connection" data-state={state}>
            <div className="connection-heading">
              <span className="status-dot" aria-hidden="true" />
              <p role="status" aria-live="polite">{message}</p>
            </div>
            <p className="connection-caption">
              Перевірка доступності платформи.
            </p>
            {connection.isError && (
              <button disabled={connection.isFetching} onClick={() => void connection.refetch()}>
                Спробувати ще раз <span aria-hidden="true">↗</span>
              </button>
            )}
          </div>
        </section>
        <div className="decoration" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="large-cross">+</span>
          <span className="small-cross">+</span>
        </div>
      </main>

      <footer>PharmaFlow <span aria-hidden="true">/</span> Простір для турботи про здоров’я</footer>
    </div>
  );
}
