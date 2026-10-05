import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { type Analyser, type JobContext, PermanentError } from './analysis';
import { ApiError, type InternalApi } from '../shared/api-client';
import type { Logger } from '../shared/log';

const KEY_PATTERN = /^resumes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/resume\.pdf$/;
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

interface ScreeningContext {
  applicationId: string;
  alreadyScreened: boolean;
  job: JobContext;
}

export interface ScreeningDeps {
  api: InternalApi;
  analyser: Analyser;
  readObject(bucket: string, key: string): Promise<{ bytes: Uint8Array; size: number }>;
  log: Logger;
}

interface S3Record {
  s3: { bucket: { name: string }; object: { key: string } };
}

/** S3 URL-encodes keys in event notifications, with + for spaces. */
export const decodeKey = (key: string): string => decodeURIComponent(key.replace(/\+/g, ' '));

/**
 * Triggered by SQS, which receives an event from S3 each time a resume lands.
 * Each resume is: looked up in the API, read from S3, scored by Bedrock, and the
 * result sent back to the API. Failures are reported per message, so one bad
 * message does not make SQS redeliver the good ones in the same batch.
 */
export function createScreeningHandler(deps: ScreeningDeps) {
  const { api, log } = deps;

  async function screen(bucket: string, key: string): Promise<void> {
    const match = KEY_PATTERN.exec(key);
    if (!match) {
      log('warn', 'ignoring an object that is not a resume', { key });
      return;
    }
    const applicationId = match[1];

    let context: ScreeningContext;
    try {
      context = await api.get<ScreeningContext>(`/v1/internal/applications/${applicationId}/screening-context`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        log('warn', 'resume for an unknown application, dropping it', { applicationId });
        return;
      }
      throw error;
    }
    if (context.alreadyScreened) {
      log('info', 'already screened, skipping', { applicationId });
      return;
    }

    const result = await analyse(bucket, key, context.job).catch((error: unknown) => {
      if (error instanceof PermanentError) return error;
      throw error;
    });

    if (result instanceof PermanentError) {
      log('warn', 'screening failed permanently', { applicationId, reason: result.message });
      await api.post(`/v1/internal/applications/${applicationId}/screening`, {
        outcome: 'failed',
        error: result.message,
      });
      return;
    }

    await api.post(`/v1/internal/applications/${applicationId}/screening`, {
      outcome: 'done',
      fitScore: result.fitScore,
      summary: result.summary,
      skills: result.skills,
    });
    log('info', 'screened', { applicationId, fitScore: result.fitScore });
  }

  async function analyse(bucket: string, key: string, job: JobContext) {
    const { bytes, size } = await deps.readObject(bucket, key);
    if (size > MAX_RESUME_BYTES) throw new PermanentError('The resume is larger than 5 MB');
    // A PDF starts with "%PDF-". S3 enforced the content type at upload, but that is only the client's word.
    if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
      throw new PermanentError('The file is not a PDF');
    }
    return deps.analyser.analyse(bytes, job);
  }

  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const message of event.Records) {
      try {
        const body = JSON.parse(message.body) as { Event?: string; Records?: S3Record[] };
        if (body.Event === 's3:TestEvent') continue; // S3 sends one when the notification is configured
        for (const record of body.Records ?? []) {
          await screen(record.s3.bucket.name, decodeKey(record.s3.object.key));
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          log('error', 'message body is not JSON, dropping it', { messageId: message.messageId });
          continue; // retrying cannot fix it, and it would only fill the dead-letter queue
        }
        log('error', 'screening failed, will be retried', { messageId: message.messageId, error: String(error) });
        batchItemFailures.push({ itemIdentifier: message.messageId });
      }
    }
    return { batchItemFailures };
  };
}
