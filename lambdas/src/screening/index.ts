// Lambda entry point: wires the real AWS clients to the tested handler logic.
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { ApiClient } from '../shared/api-client';
import { log } from '../shared/log';
import { cachedSecret, requireEnv } from '../shared/secret';
import { BedrockAnalyser } from './analysis';
import { createScreeningHandler } from './handler';

let wired: ReturnType<typeof createScreeningHandler> | undefined;

// Built on first use and kept for the life of the container
export const handler = (event: SQSEvent): Promise<SQSBatchResponse> => {
  if (!wired) {
    const region = process.env.AWS_REGION ?? 'ap-south-1';
    const s3 = new S3Client({ region });
    wired = createScreeningHandler({
      api: new ApiClient(
        requireEnv('API_BASE_URL'),
        cachedSecret(new SecretsManagerClient({ region }), requireEnv('INTERNAL_SECRET_ARN')),
      ),
      analyser: new BedrockAnalyser(
        new BedrockRuntimeClient({ region }),
        process.env.BEDROCK_MODEL_ID ?? 'apac.amazon.nova-lite-v1:0',
      ),
      async readObject(bucket, key) {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!out.Body) throw new Error(`Object ${key} has no body`);
        return { bytes: await out.Body.transformToByteArray(), size: out.ContentLength ?? 0 };
      },
      log,
    });
  }
  return wired(event);
};
