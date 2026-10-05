import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.factory';
import { APP_CONFIG } from './config/app-config';
import type { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  // rawBody: the internal endpoints verify an HMAC over the exact bytes received
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  await app.listen(config.port, '0.0.0.0');
  app.get(Logger).log(`HireFlow API listening on port ${config.port} (${config.nodeEnv})`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
