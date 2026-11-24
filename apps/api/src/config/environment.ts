function requiredString(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required. Copy .env.example to .env and configure it.`);
  }
  return value;
}

function port(values: Record<string, unknown>, name: string, fallback?: number): number {
  const value = values[name] ?? fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be a valid port.`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be between 1 and 65535.`);
  }
  return parsed;
}

export function validateEnvironment(values: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = values.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(String(nodeEnv))) {
    throw new Error('NODE_ENV must be development, test or production.');
  }

  const origin = String(values.APP_ORIGIN ?? 'http://127.0.0.1:5173');
  const url = new URL(origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || (nodeEnv === 'production' && url.protocol !== 'https:')) {
    throw new Error('APP_ORIGIN must be an origin URL; HTTPS is required in production.');
  }
  const workerEnabled=String(values.NOTIFICATION_WORKER_ENABLED??(nodeEnv==='test'?'false':'true'));
  if(!['true','false'].includes(workerEnabled))throw new Error('NOTIFICATION_WORKER_ENABLED must be true or false.');
  const pollMs=Number(values.NOTIFICATION_POLL_MS??5000);
  if(!Number.isInteger(pollMs)||pollMs<50||pollMs>60000)throw new Error('NOTIFICATION_POLL_MS must be between 50 and 60000.');
  return {
    ...values,
    NOTIFICATION_WORKER_ENABLED: workerEnabled==='true',
    NOTIFICATION_POLL_MS: pollMs,
    APP_ORIGIN: origin,
    NODE_ENV: nodeEnv,
    API_PORT: port(values, 'API_PORT', 3000),
    DB_HOST: requiredString(values, 'DB_HOST'),
    DB_PORT: port(values, 'DB_PORT'),
    DB_USER: requiredString(values, 'DB_USER'),
    DB_PASSWORD: requiredString(values, 'DB_PASSWORD'),
    DB_NAME: requiredString(values, 'DB_NAME'),
  };
}
