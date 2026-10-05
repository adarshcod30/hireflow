import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AuthSupportModule } from './common/auth.module';
import { rateLimit } from './common/rate-limit';
import { APP_CONFIG } from './config/app-config';
import type { AppConfig } from './config/app-config';
import { AppConfigModule } from './config/config.module';
import { buildDataSourceOptions } from './database/data-source';
import { ApplicationsModule } from './applications/applications.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { JobsModule } from './jobs/jobs.module';
import { OutboxModule } from './outbox/outbox.module';
import { StatsModule } from './stats/stats.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

const SAFE_REQUEST_ID = /^[\w.-]{1,64}$/;

@Module({
  imports: [
    // Loads .env in development. Tests set their own environment and skip the file.
    ConfigModule.forRoot({ ignoreEnvFile: process.env.NODE_ENV === 'test' }),
    AppConfigModule,

    // One JSON log line per request, carrying a request id and never a credential
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-application-token"]',
            'req.headers["x-hireflow-signature"]',
          ],
          autoLogging: { ignore: (req) => req.url === '/health' },
          serializers: {
            req: (req: { id: string; method: string; url: string; headers: Record<string, unknown> }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
              headers: req.headers,
            }),
            res: (res: { statusCode: number }) => ({
              statusCode: res.statusCode,
            }),
          },
          customLogLevel: (_req, res, err) =>
            err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        },
      }),
    }),

    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildDataSourceOptions(config.databaseUrl, config.databaseSsl),
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.jwtExpiresIn as unknown as number,
        },
      }),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: rateLimit('RATE_LIMIT_DEFAULT', 120),
        },
      ],
    }),

    StorageModule,
    AuthSupportModule,
    OutboxModule,
    UsersModule,
    JobsModule,
    ApplicationsModule,
    InternalModule,
    StatsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
