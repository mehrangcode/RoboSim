import { uuidv7 } from '@robosim/shared';
import { Injectable } from '@nestjs/common';
import type { Tx } from '../../db/client.js';
import { outboxEvents } from '../../db/schema.js';

export interface DomainEvent {
  aggregateKind: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
}

/** Enqueues domain events in the same transaction as the state change (transactional outbox). */
@Injectable()
export class OutboxService {
  async enqueue(tx: Tx, event: DomainEvent): Promise<string> {
    const id = uuidv7();
    await tx.insert(outboxEvents).values({ id, ...event });
    return id;
  }
}
