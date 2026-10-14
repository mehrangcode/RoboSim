import type { TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestingModule } from '../../../test/support/app.js';
import { createTestDatabase } from '../../../test/support/database.js';
import type { Database } from '../../db/client.js';
import { outboxEvents } from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';
import { MAX_ATTEMPTS, OutboxRelay, type EventPublisher, type PublishedEvent } from './outbox.relay.js';
import { OutboxService } from './outbox.service.js';

let database: Database;
let moduleRef: TestingModule;

beforeEach(async () => {
  database = await createTestDatabase();
  moduleRef = await createTestingModule(database);
});
afterAll(async () => {
  await moduleRef?.close();
  await database?.close();
});

async function enqueue(types: string[]) {
  const outbox = moduleRef.get(OutboxService);
  await withSystem(database.db, async (tx) => {
    for (const type of types)
      await outbox.enqueue(tx, { aggregateKind: 'test', aggregateId: type, type, payload: { type } });
  });
}

class RecordingPublisher implements EventPublisher {
  readonly seen: PublishedEvent[] = [];
  constructor(private readonly failOn = new Set<string>()) {}
  async publish(event: PublishedEvent) {
    if (this.failOn.has(event.type)) throw new Error(`broker rejected ${event.type}`);
    this.seen.push(event);
  }
}

describe('Technical Design §7.2 transactional outbox relay', () => {
  it('publishes committed events in order and marks them published', async () => {
    await enqueue(['a', 'b', 'c']);
    const publisher = new RecordingPublisher();
    const relay = moduleRef.get(OutboxRelay);
    expect(await relay.relayBatch(publisher)).toEqual({ published: 3, failed: 0 });
    expect(publisher.seen.map((e) => e.type)).toEqual(['a', 'b', 'c']);
    expect(await relay.pendingCount()).toBe(0);
    expect(await relay.relayBatch(publisher)).toEqual({ published: 0, failed: 0 });
  });

  it('does not publish events from rolled-back transactions', async () => {
    const outbox = moduleRef.get(OutboxService);
    await expect(
      withSystem(database.db, async (tx) => {
        await outbox.enqueue(tx, { aggregateKind: 'test', aggregateId: 'x', type: 'ghost', payload: {} });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');
    expect(await moduleRef.get(OutboxRelay).pendingCount()).toBe(0);
  });

  it('keeps failed events for retry, records the error, and stops after MAX_ATTEMPTS', async () => {
    await enqueue(['ok', 'poison']);
    const relay = moduleRef.get(OutboxRelay);
    const publisher = new RecordingPublisher(new Set(['poison']));
    expect(await relay.relayBatch(publisher)).toEqual({ published: 1, failed: 1 });
    const [row] = await withSystem(database.db, (tx) =>
      tx.select().from(outboxEvents).where(eq(outboxEvents.type, 'poison')),
    );
    expect(row).toMatchObject({ attempts: 1, lastError: 'broker rejected poison', publishedAt: null });

    for (let i = 1; i < MAX_ATTEMPTS; i++) await relay.relayBatch(publisher);
    expect(await relay.relayBatch(publisher)).toEqual({ published: 0, failed: 0 });
  });

  it('respects the batch size', async () => {
    await enqueue(['1', '2', '3', '4', '5']);
    const publisher = new RecordingPublisher();
    expect(await moduleRef.get(OutboxRelay).relayBatch(publisher, 2)).toEqual({ published: 2, failed: 0 });
    expect(await moduleRef.get(OutboxRelay).pendingCount()).toBe(3);
  });
});
