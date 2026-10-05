import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { BatchResult, OutgoingMessage, QueuePort } from './queue.port';

const SQS_BATCH_LIMIT = 10;

export class SqsQueue implements QueuePort {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async sendBatch(messages: OutgoingMessage[]): Promise<BatchResult> {
    const failedIds: string[] = [];
    for (let i = 0; i < messages.length; i += SQS_BATCH_LIMIT) {
      const chunk = messages.slice(i, i + SQS_BATCH_LIMIT);
      try {
        const result = await this.client.send(
          new SendMessageBatchCommand({
            QueueUrl: this.queueUrl,
            Entries: chunk.map((m) => ({ Id: m.id, MessageBody: m.body })),
          }),
        );
        for (const failed of result.Failed ?? []) if (failed.Id) failedIds.push(failed.Id);
      } catch {
        // The whole call failed: every message in the chunk is retried later
        failedIds.push(...chunk.map((m) => m.id));
      }
    }
    return { failedIds };
  }
}
