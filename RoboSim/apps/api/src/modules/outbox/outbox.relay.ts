import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../db/client.js';
import { outboxEvents } from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';

export interface PublishedEvent {
  id: string;
  aggregateKind: string;
  aggregateId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

/** Destination of relayed events: BullMQ in P1; tests use an in-memory publisher. Must be idempotent by `id`. */
export interface EventPublisher {
  publish(event: PublishedEvent): Promise<void>;
}

export const MAX_ATTEMPTS = 10;

/**
 * Moves committed outbox rows to the publisher. `FOR UPDATE SKIP LOCKED` lets several relay instances run
 * concurrently without double-publishing; failed events are retried up to MAX_ATTEMPTS.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async relayBatch(
    publisher: EventPublisher,
    batchSize = 100,
  ): Promise<{ published: number; failed: number }> {
    return withSystem(this.database.db, async (tx) => {
      const batch = await tx
        .select()
        .from(outboxEvents)
        .where(sql`${outboxEvents.publishedAt} is null and ${outboxEvents.attempts} < ${MAX_ATTEMPTS}`)
        .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
        .limit(batchSize)
        .for('update', { skipLocked: true });
      let published = 0;
      let failed = 0;
      for (const event of batch) {
        try {
          await publisher.publish(event);
          await tx
            .update(outboxEvents)
            .set({ publishedAt: new Date(), lastError: null })
            .where(eq(outboxEvents.id, event.id));
          published++;
        } catch (error) {
          failed++;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Outbox event ${event.id} (${event.type}) failed: ${message}`);
          await tx
            .update(outboxEvents)
            .set({ attempts: sql`${outboxEvents.attempts} + 1`, lastError: message.slice(0, 2000) })
            .where(eq(outboxEvents.id, event.id));
        }
      }
      return { published, failed };
    });
  }

  async pendingCount(): Promise<number> {
    const [row] = await this.database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt));
    return row?.n ?? 0;
  }
}
