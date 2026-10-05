import { BatchResult, OutgoingMessage, QueuePort } from './queue.port';

/** In-process queue for development and tests. Tests read `sent` and can inject failures. */
export class MemoryQueue implements QueuePort {
  readonly sent: OutgoingMessage[] = [];
  failIds = new Set<string>();

  sendBatch(messages: OutgoingMessage[]): Promise<BatchResult> {
    const failedIds: string[] = [];
    for (const message of messages) {
      if (this.failIds.has(message.id)) failedIds.push(message.id);
      else this.sent.push(message);
    }
    return Promise.resolve({ failedIds });
  }
}
