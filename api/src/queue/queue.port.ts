export const QUEUE = Symbol('QUEUE');

export interface OutgoingMessage {
  /** Unique within one batch. The outbox row id is used. */
  id: string;
  body: string;
}

export interface BatchResult {
  failedIds: string[];
}

/** Where the outbox relay sends messages. SQS in production, memory in tests. */
export interface QueuePort {
  sendBatch(messages: OutgoingMessage[]): Promise<BatchResult>;
}
