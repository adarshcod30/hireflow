import { type SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import type { InternalApi } from '../shared/api-client';
import type { Logger } from '../shared/log';
import { oneLine, renderEmail } from './templates';

export interface Mailer {
  send(input: { from: string; to: string; subject: string; text: string; html: string }): Promise<void>;
}

export interface NotifierDeps {
  api: InternalApi;
  mailer: Mailer;
  from: string;
  /** While SES is in sandbox only verified addresses can receive mail: send everything here instead. */
  redirectTo?: string;
  log: Logger;
}

interface OutboxMessage {
  outboxId: string;
  topic: string;
  payload: Record<string, unknown> & { candidateEmail?: string };
}

// SES refusals that no retry can fix. The claim is kept so the same message never tries again.
const PERMANENT_SES_ERRORS = new Set([
  'MessageRejected',
  'AccountSuspendedException',
  'MailFromDomainNotVerifiedException',
]);

/**
 * Sends the emails the outbox relay publishes.
 *
 * SQS delivers at least once, so the same message can arrive twice. Before
 * sending, the worker CLAIMS the outbox id in the API's database: a primary key
 * lets exactly one caller win. If sending then fails, the claim is released so
 * the redelivered message can try again. The result is effectively-once email.
 */
export function createNotifierHandler(deps: NotifierDeps) {
  const { api, from, redirectTo, log } = deps;

  async function notify(message: OutboxMessage): Promise<void> {
    const email = renderEmail(message.topic, message.payload);
    if (!email) {
      log('info', 'no email for this topic', { topic: message.topic, outboxId: message.outboxId });
      return;
    }
    const candidate = message.payload.candidateEmail;
    if (!candidate) {
      log('warn', 'message has no recipient', { outboxId: message.outboxId });
      return;
    }

    const { claimed } = await api.post<{ claimed: boolean }>('/v1/internal/notifications/claim', {
      outboxId: message.outboxId,
    });
    if (!claimed) {
      log('info', 'already handled, skipping', { outboxId: message.outboxId });
      return;
    }

    const to = redirectTo ?? candidate;
    const subject = redirectTo ? `[to ${oneLine(candidate)}] ${email.subject}` : email.subject;
    try {
      await deps.mailer.send({ from, to, subject: oneLine(subject), text: email.text, html: email.html });
      log('info', 'email sent', { outboxId: message.outboxId, topic: message.topic });
    } catch (error) {
      const name = (error as { name?: string }).name ?? '';
      if (PERMANENT_SES_ERRORS.has(name)) {
        log('warn', 'SES refused the email permanently', { outboxId: message.outboxId, reason: name });
        return; // keep the claim: never retry
      }
      await api.delete(`/v1/internal/notifications/claim/${message.outboxId}`);
      throw error;
    }
  }

  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      try {
        await notify(JSON.parse(record.body) as OutboxMessage);
      } catch (error) {
        if (error instanceof SyntaxError) {
          log('error', 'message body is not JSON, dropping it', { messageId: record.messageId });
          continue;
        }
        log('error', 'notification failed, will be retried', { messageId: record.messageId, error: String(error) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

export class SesMailer implements Mailer {
  constructor(private readonly client: Pick<SESv2Client, 'send'>) {}

  async send({ from, to, subject, text, html }: Parameters<Mailer['send']>[0]): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Text: { Data: text, Charset: 'UTF-8' }, Html: { Data: html, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  }
}
