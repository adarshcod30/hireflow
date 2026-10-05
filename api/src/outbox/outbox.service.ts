import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { QUEUE } from '../queue/queue.port';
import type { QueuePort } from '../queue/queue.port';

export const TOPIC_STATUS_CHANGED = 'application.status_changed';

interface OutboxRow {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

/**
 * Transactional outbox.
 *
 * A domain change and the message announcing it must succeed or fail together.
 * Writing to the database and then to a queue cannot do that (one can succeed
 * while the other fails). So the message is first written to the `outbox` table
 * in the SAME transaction as the change, and a relay publishes unsent rows
 * afterwards. Delivery is at-least-once; consumers deduplicate on the outbox id.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private running = false;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Call inside the transaction that makes the change. */
  async enqueue(manager: EntityManager, topic: string, payload: Record<string, unknown>): Promise<void> {
    await manager.query(`INSERT INTO outbox (topic, payload) VALUES ($1, $2::jsonb)`, [topic, JSON.stringify(payload)]);
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async scheduledRelay(): Promise<void> {
    if (!this.config.outboxRelayEnabled || this.running) return;
    this.running = true;
    try {
      await this.relayOnce();
    } catch (error) {
      this.logger.error({ err: error }, 'outbox relay failed');
    } finally {
      this.running = false;
    }
  }

  /** Publish one batch. Returns how many rows were sent. Safe to run on several instances at once. */
  async relayOnce(): Promise<number> {
    return this.db.transaction(async (manager) => {
      // SKIP LOCKED: a second relay takes different rows instead of waiting or double-sending
      const rows: OutboxRow[] = await manager.query(
        `SELECT id, topic, payload, created_at FROM outbox
         WHERE published_at IS NULL
         ORDER BY id
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [this.config.outboxBatchSize],
      );
      if (rows.length === 0) return 0;

      const { failedIds } = await this.queue.sendBatch(
        rows.map((r) => ({
          id: r.id,
          body: JSON.stringify({
            outboxId: r.id,
            topic: r.topic,
            payload: r.payload,
            createdAt: r.created_at,
          }),
        })),
      );
      const failed = new Set(failedIds);
      const sentIds = rows.filter((r) => !failed.has(r.id)).map((r) => r.id);

      if (sentIds.length > 0) {
        await manager.query(`UPDATE outbox SET published_at = now() WHERE id = ANY($1::bigint[])`, [sentIds]);
      }
      if (failed.size > 0) {
        await manager.query(
          `UPDATE outbox SET attempts = attempts + 1, last_error = 'queue rejected the message' WHERE id = ANY($1::bigint[])`,
          [[...failed]],
        );
        this.logger.warn({ failed: failed.size }, 'some outbox messages were not accepted and will be retried');
      }
      return sentIds.length;
    });
  }
}
