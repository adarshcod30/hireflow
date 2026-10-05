// Lambda entry point: wires the real AWS clients to the tested handler logic.
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { ApiClient } from '../shared/api-client';
import { log } from '../shared/log';
import { cachedSecret, requireEnv } from '../shared/secret';
import { createNotifierHandler, SesMailer } from './handler';

let wired: ReturnType<typeof createNotifierHandler> | undefined;

export const handler = (event: SQSEvent): Promise<SQSBatchResponse> => {
  if (!wired) {
    const region = process.env.AWS_REGION ?? 'ap-south-1';
    wired = createNotifierHandler({
      api: new ApiClient(
        requireEnv('API_BASE_URL'),
        cachedSecret(new SecretsManagerClient({ region }), requireEnv('INTERNAL_SECRET_ARN')),
      ),
      mailer: new SesMailer(new SESv2Client({ region })),
      from: requireEnv('NOTIFY_FROM'),
      redirectTo: process.env.NOTIFY_REDIRECT_TO || undefined,
      log,
    });
  }
  return wired(event);
};
