import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.factory';
import { APP_CONFIG, loadConfig } from '../../src/config/app-config';
import type { AppConfig } from '../../src/config/app-config';
import { MemoryQueue } from '../../src/queue/memory.queue';
import { QUEUE } from '../../src/queue/queue.port';
import { sign, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../../src/common/signing';
import { adminUrl, TEMPLATE_DB, urlFor } from './admin-url';

export interface TestApp {
  app: INestApplication;
  db: DataSource;
  queue: MemoryQueue;
  config: AppConfig;
  close(): Promise<void>;
}

/**
 * Boot the real application against its own private copy of the migrated
 * database. Every test file gets one, so files run in parallel without sharing data.
 */
export async function createTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const dbName = `hireflow_t_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName} TEMPLATE ${TEMPLATE_DB}`);
  await admin.end();

  process.env.DATABASE_URL = urlFor(dbName);
  const config = { ...loadConfig(), ...overrides };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app, config);
  await app.init();
  // Supertest attaches a listener per request; a test file makes hundreds
  (app.getHttpServer() as { setMaxListeners(n: number): void }).setMaxListeners(0);

  return {
    app,
    db: app.get(DataSource),
    queue: app.get<MemoryQueue>(QUEUE),
    config,
    async close() {
      await app.close();
      const cleanup = new Client({ connectionString: adminUrl() });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

/** Headers an internal caller (a Lambda worker) would send. */
export function signedHeaders(
  secret: string,
  method: string,
  path: string,
  body = '',
  timestamp = String(Math.floor(Date.now() / 1000)),
): Record<string, string> {
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: sign(secret, timestamp, method, path, body),
  };
}
