import type { TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestingModule } from '../../../test/support/app.js';
import { createTestDatabase } from '../../../test/support/database.js';
import type { Database } from '../../db/client.js';
import { auditLogs, memberships, outboxEvents, users, workspaces } from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';
import { UsersService } from './users.service.js';

let database: Database;
let moduleRef: TestingModule;
let service: UsersService;
const NOW = new Date('2026-10-13T08:00:00Z');

beforeAll(async () => {
  database = await createTestDatabase();
  moduleRef = await createTestingModule(database);
  service = moduleRef.get(UsersService);
});
afterAll(async () => {
  await moduleRef.close();
  await database.close();
});

const countAll = () =>
  withSystem(database.db, async (tx) => {
    const n = async (table: typeof users | typeof workspaces | typeof memberships) =>
      (await tx.select({ n: sql<number>`count(*)::int` }).from(table))[0]?.n ?? 0;
    return { users: await n(users), workspaces: await n(workspaces), memberships: await n(memberships) };
  });

describe('ADR-007 every user owns a personal workspace', () => {
  it('creates user, personal workspace, owner membership, audit entry and outbox event atomically', async () => {
    const created = await service.createUser(
      { email: ' Sara@Example.com ', displayName: 'Sara', locale: 'fa' },
      NOW,
    );
    const state = await withSystem(database.db, async (tx) => ({
      user: (await tx.select().from(users).where(eq(users.id, created.id)))[0],
      workspace: (
        await tx.select().from(workspaces).where(eq(workspaces.id, created.personalWorkspaceId))
      )[0],
      membership: (await tx.select().from(memberships).where(eq(memberships.userId, created.id)))[0],
      audit: await tx.select().from(auditLogs).where(eq(auditLogs.targetId, created.id)),
      events: await tx.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, created.id)),
    }));
    expect(state.user).toMatchObject({
      email: 'sara@example.com',
      locale: 'fa',
      personalWorkspaceId: created.personalWorkspaceId,
      status: 'active',
    });
    expect(state.workspace).toMatchObject({ kind: 'personal', ownerUserId: created.id, name: 'Sara' });
    expect(state.membership).toMatchObject({
      workspaceId: created.personalWorkspaceId,
      role: 'org_owner',
      status: 'active',
    });
    expect(state.audit.map((a) => a.action)).toEqual(['user.created']);
    expect(state.events.map((e) => e.type)).toEqual(['iam.user_created']);
  });

  it('normalizes Iranian mobile numbers to E.164', async () => {
    const created = await service.createUser({ phone: '0912 000 1111', displayName: 'Reza' }, NOW);
    const [row] = await withSystem(database.db, (tx) =>
      tx.select({ phone: users.phone }).from(users).where(eq(users.id, created.id)),
    );
    expect(row?.phone).toBe('+989120001111');
  });

  it('rejects duplicates with a conflict and leaves no partial rows', async () => {
    await service.createUser({ email: 'dup@example.com', displayName: 'One' }, NOW);
    const before = await countAll();
    await expect(
      service.createUser({ email: 'DUP@example.com', displayName: 'Two' }, NOW),
    ).rejects.toMatchObject({
      code: 'conflict',
      params: { field: 'email' },
    });
    expect(await countAll()).toEqual(before);
  });

  it('requires an email or phone', async () => {
    await expect(service.createUser({ displayName: 'Nobody' }, NOW)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

describe('US-IAM-03 minors are protected by default', () => {
  it('AC1 a 15-year-old self-signup waits for guardian consent', async () => {
    const created = await service.createUser(
      { email: 'teen@example.com', displayName: 'Teen', dateOfBirth: '2011-05-01' },
      NOW,
    );
    expect(created).toMatchObject({ ageBand: '13_15', status: 'pending_consent' });
  });

  it('under-13 self-signup is refused and nothing is written', async () => {
    const before = await countAll();
    await expect(
      service.createUser({ email: 'kid@example.com', displayName: 'Kid', dateOfBirth: '2016-01-01' }, NOW),
    ).rejects.toMatchObject({ code: 'policy_restricted' });
    expect(await countAll()).toEqual(before);
  });

  it('under-13 accounts can be created through an organization', async () => {
    const created = await service.createUser(
      { email: 'pupil@example.com', displayName: 'Pupil', dateOfBirth: '2016-01-01', source: 'organization' },
      NOW,
    );
    expect(created).toMatchObject({ ageBand: 'u13', status: 'active' });
  });
});
