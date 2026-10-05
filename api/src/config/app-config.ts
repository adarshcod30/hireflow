// Typed configuration, read once from the environment.
//
// Production is strict: a missing or weak secret stops the process at start-up
// with every problem listed, instead of surfacing on the first request.

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  trustProxy: number;
  enableDocs: boolean;

  databaseUrl: string;
  databaseSsl: boolean;

  jwtSecret: string;
  jwtExpiresIn: string;
  bcryptRounds: number;
  internalHmacSecret: string;

  webOrigins: string[];

  storageDriver: 'local' | 's3';
  queueDriver: 'memory' | 'sqs';
  awsRegion: string;
  resumeBucket: string;
  notificationsQueueUrl: string;

  outboxRelayEnabled: boolean;
  outboxBatchSize: number;
}

const PLACEHOLDER = /(change[_-]?me|your[_-]|example|secret[_-]?key|password)/i;

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (
    ['development', 'test', 'production'].includes(env.NODE_ENV ?? '') ? env.NODE_ENV : 'development'
  ) as AppConfig['nodeEnv'];
  const production = nodeEnv === 'production';

  const config: AppConfig = {
    nodeEnv,
    port: int(env.PORT, 3000),
    logLevel: env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    trustProxy: int(env.TRUST_PROXY, 0),
    enableDocs: bool(env.ENABLE_DOCS, !production),

    databaseUrl: env.DATABASE_URL ?? '',
    databaseSsl: bool(env.DATABASE_SSL, production),

    jwtSecret: env.JWT_SECRET ?? '',
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '15m',
    // 12 is the production cost; tests use 4 so a login takes microseconds, not 250 ms
    bcryptRounds: int(env.BCRYPT_ROUNDS, nodeEnv === 'test' ? 4 : 12),
    internalHmacSecret: env.INTERNAL_HMAC_SECRET ?? '',

    webOrigins: (env.WEB_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),

    storageDriver: (env.STORAGE_DRIVER ?? (production ? 's3' : 'local')) as AppConfig['storageDriver'],
    queueDriver: (env.QUEUE_DRIVER ?? (production ? 'sqs' : 'memory')) as AppConfig['queueDriver'],
    awsRegion: env.AWS_REGION ?? 'ap-south-1',
    resumeBucket: env.RESUME_BUCKET ?? '',
    notificationsQueueUrl: env.NOTIFICATIONS_QUEUE_URL ?? '',

    outboxRelayEnabled: bool(env.OUTBOX_RELAY_ENABLED, production),
    outboxBatchSize: int(env.OUTBOX_BATCH_SIZE, 25),
  };

  if (!['local', 's3'].includes(config.storageDriver)) {
    throw new Error(`STORAGE_DRIVER must be local or s3, got ${config.storageDriver}`);
  }
  if (!['memory', 'sqs'].includes(config.queueDriver)) {
    throw new Error(`QUEUE_DRIVER must be memory or sqs, got ${config.queueDriver}`);
  }

  const problems: string[] = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is not set');

  if (production) {
    for (const [name, value] of [
      ['JWT_SECRET', config.jwtSecret],
      ['INTERNAL_HMAC_SECRET', config.internalHmacSecret],
    ] as const) {
      if (value.length < 32 || PLACEHOLDER.test(value)) {
        problems.push(`${name} must be at least 32 random characters and not a placeholder`);
      }
    }
    if (config.jwtSecret && config.jwtSecret === config.internalHmacSecret) {
      problems.push('JWT_SECRET and INTERNAL_HMAC_SECRET must be different values');
    }
    if (config.storageDriver === 's3' && !config.resumeBucket) problems.push('RESUME_BUCKET is not set');
    if (config.queueDriver === 'sqs' && !config.notificationsQueueUrl) {
      problems.push('NOTIFICATIONS_QUEUE_URL is not set');
    }
    if (config.webOrigins.some((o) => o === '*')) problems.push('WEB_ORIGINS must not contain *');
  } else {
    // Outside production a missing secret gets a random per-process value
    config.jwtSecret ||= `dev-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.padEnd(
      40,
      'x',
    );
    config.internalHmacSecret ||= `dev-hmac-${Math.random().toString(36).slice(2)}`.padEnd(40, 'y');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return config;
}
