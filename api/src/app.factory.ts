import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from './config/app-config';

/**
 * Everything that makes the app behave like production, in one place, so the
 * real server and the end-to-end tests configure it identically.
 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));

  // Behind a reverse proxy the client address is in X-Forwarded-For
  const http = app.getHttpAdapter().getInstance() as {
    set(key: string, value: unknown): void;
  };
  if (config.trustProxy > 0) http.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.enableCors({
    origin: config.webOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Application-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  // Health checks stay at /health so a load balancer does not need to know the version
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // drop unknown properties
      forbidNonWhitelisted: true, // and refuse the request that sent them
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  if (config.enableDocs) {
    const doc = new DocumentBuilder()
      .setTitle('HireFlow API')
      .setDescription('Recruiting pipeline: jobs, applications, resume screening, notifications')
      .setVersion('1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  }
}
