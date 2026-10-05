import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { MemoryQueue } from '../queue/memory.queue';
import { QUEUE } from '../queue/queue.port';
import { SqsQueue } from '../queue/sqs.queue';
import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import { STORAGE } from './storage.port';

/** Chooses the real AWS adapters or the local stand-ins from configuration. */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.storageDriver === 's3'
          ? new S3Storage(new S3Client({ region: config.awsRegion }), config.resumeBucket)
          : new LocalStorage(),
    },
    {
      provide: QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.queueDriver === 'sqs'
          ? new SqsQueue(new SQSClient({ region: config.awsRegion }), config.notificationsQueueUrl)
          : new MemoryQueue(),
    },
  ],
  exports: [STORAGE, QUEUE],
})
export class StorageModule {}
