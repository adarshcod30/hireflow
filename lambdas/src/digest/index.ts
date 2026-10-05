// Lambda entry point: wires the real AWS clients to the tested handler logic.
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { ApiClient } from '../shared/api-client';
import { log } from '../shared/log';
import { cachedSecret, requireEnv } from '../shared/secret';
import { SesMailer } from '../notifier/handler';
import { createDigestHandler } from './handler';

let wired: ReturnType<typeof createDigestHandler> | undefined;

export const handler = (): Promise<{ total: number; emailed: boolean }> => {
  if (!wired) {
    const region = process.env.AWS_REGION ?? 'ap-south-1';
    const mailer = new SesMailer(new SESv2Client({ region }));
    const from = requireEnv('NOTIFY_FROM');
    wired = createDigestHandler({
      api: new ApiClient(
        requireEnv('API_BASE_URL'),
        cachedSecret(new SecretsManagerClient({ region }), requireEnv('INTERNAL_SECRET_ARN')),
      ),
      sendEmail: ({ to, subject, text, html }) => mailer.send({ from, to, subject, text, html }),
      to: requireEnv('DIGEST_TO'),
      days: Number(process.env.DIGEST_DAYS ?? '7'),
      log,
      emit: (line) => console.log(line),
    });
  }
  return wired();
};
