// NFR-TEN-01: tenant isolation is enforced by PostgreSQL RLS, independently of application code.
import { uuidv7 } from '@robosim/shared';
import { eq, sql } from 'drizzle-orm';
import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.js';
import { auditLogs, memberships, outboxEvents, users, workspaces } from '../src/db/schema.js';
import { withScope, withSystem } from '../src/db/scope.js';
import { UsersService, type CreatedUser } from '../src/modules/iam/index.js';
import { WorkspacesService } from '../src/modules/org/index.js';
import { createTestingModule } from './support/app.js';
import { createTestDatabase } from './support/database.js';
import { dbError } from './support/db-error.js';

let database: Database;
let moduleRef: TestingModule;
let alice: CreatedUser;
let bob: CreatedUser;

const scopeOf = (u: CreatedUser) => ({ userId: u.id, workspaceId: u.personalWorkspaceId });

beforeAll(async () => {
  database = await createTestDatabase();
  moduleRef = await createTestingModule(database);
  const usersService = moduleRef.get(UsersService);
  alice = await usersService.createUser({ email: 'alice@example.com', displayName: 'Alice' });
  bob = await usersService.createUser({ phone: '09121234567', displayName: 'Bob' });
});
afterAll(async () => {
  await moduleRef.close();
  await database.close();
});

describe('NFR-TEN-01 reads are confined to the caller', () => {
  it('a user sees only their own workspaces', async () => {
    const mine = await moduleRef.get(WorkspacesService).listMine(scopeOf(alice));
    expect(mine.map((w) => w.id)).toEqual([alice.personalWorkspaceId]);
  });

  it("another tenant's workspace is not found, even by id", async () => {
    await expect(
      moduleRef.get(WorkspacesService).get(scopeOf(alice), bob.personalWorkspaceId),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('raw queries without filters return only visible rows', async () => {
    const visible = await withScope(database.db, scopeOf(alice), async (tx) => ({
      users: await tx.select({ id: users.id }).from(users),
      workspaces: await tx.select({ id: workspaces.id }).from(workspaces),
      memberships: await tx.select({ userId: memberships.userId }).from(memberships),
      audit: await tx.select({ workspaceId: auditLogs.workspaceId }).from(auditLogs),
    }));
    expect(visible.users.map((r) => r.id)).toEqual([alice.id]);
    expect(visible.workspaces.map((r) => r.id)).toEqual([alice.personalWorkspaceId]);
    expect(visible.memberships.map((r) => r.userId)).toEqual([alice.id]);
    expect(visible.audit.every((r) => r.workspaceId === alice.personalWorkspaceId)).toBe(true);
  });

  it('an empty scope sees nothing', async () => {
    const count = await withScope(database.db, {}, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(workspaces),
    );
    expect(count[0]?.n).toBe(0);
  });
});

describe('NFR-TEN-01 writes cannot cross tenants', () => {
  it('cannot add a membership to another workspace', async () => {
    await expect(
      dbError(
        withScope(database.db, scopeOf(alice), (tx) =>
          tx
            .insert(memberships)
            .values({ workspaceId: bob.personalWorkspaceId, userId: alice.id, role: 'org_admin' }),
        ),
      ),
    ).resolves.toMatch(/row-level security/);
  });

  it("updates to another tenant's rows affect nothing", async () => {
    const updated = await withScope(database.db, scopeOf(alice), (tx) =>
      tx
        .update(workspaces)
        .set({ name: 'pwned' })
        .where(eq(workspaces.id, bob.personalWorkspaceId))
        .returning({ id: workspaces.id }),
    );
    expect(updated).toEqual([]);
    const [row] = await withSystem(database.db, (tx) =>
      tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, bob.personalWorkspaceId)),
    );
    expect(row?.name).toBe('Bob');
  });

  it('cannot create a workspace outside the active scope', async () => {
    await expect(
      dbError(
        withScope(database.db, scopeOf(alice), (tx) =>
          tx.insert(workspaces).values({
            id: uuidv7(),
            kind: 'organization',
            name: 'x',
            slug: `x-${uuidv7()}`,
            ownerUserId: alice.id,
          }),
        ),
      ),
    ).resolves.toMatch(/row-level security/);
  });

  it("cannot rewrite another user's row", async () => {
    const updated = await withScope(database.db, scopeOf(alice), (tx) =>
      tx.update(users).set({ displayName: 'pwned' }).where(eq(users.id, bob.id)).returning({ id: users.id }),
    );
    expect(updated).toEqual([]);
  });
});

describe('Security §12 audit log is append-only', () => {
  it('the application role cannot update or delete audit records', async () => {
    await expect(
      dbError(
        withScope(database.db, scopeOf(alice), (tx) => tx.update(auditLogs).set({ action: 'tampered' })),
      ),
    ).resolves.toMatch(/permission denied/);
    await expect(
      dbError(withScope(database.db, scopeOf(alice), (tx) => tx.delete(auditLogs))),
    ).resolves.toMatch(/permission denied/);
  });

  it('even the owning role cannot modify history (trigger)', async () => {
    expect(
      await dbError(withSystem(database.db, (tx) => tx.update(auditLogs).set({ action: 'tampered' }))),
    ).toMatch(/append-only/);
    expect(await dbError(withSystem(database.db, (tx) => tx.delete(auditLogs)))).toMatch(/append-only/);
  });

  it('cannot write audit entries for another workspace', async () => {
    await expect(
      dbError(
        withScope(database.db, scopeOf(alice), (tx) =>
          tx.insert(auditLogs).values({
            actorKind: 'user',
            workspaceId: bob.personalWorkspaceId,
            action: 'x',
            targetKind: 'x',
          }),
        ),
      ),
    ).resolves.toMatch(/row-level security/);
  });
});

describe('internal tables', () => {
  it('the application role can enqueue but not read the outbox', async () => {
    expect(
      await dbError(withScope(database.db, scopeOf(alice), (tx) => tx.select().from(outboxEvents))),
    ).toMatch(/permission denied/);
  });

  it('rejects non-UUID scope values before touching the database', async () => {
    await expect(
      withScope(database.db, { userId: "x'; drop table users; --" }, async () => 1),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});
