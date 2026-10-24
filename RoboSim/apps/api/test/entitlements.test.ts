// Plans & entitlements (FR-BIL-04/05, FR-ADM-02/06, PRD §3; API Spec §4.1, §4.9, §4.12): the resolver, its
// enforcement on projects, the back office, and version retention.
import {
  DEFAULT_PLAN_ENTITLEMENTS,
  type AdminPlanList,
  type AdminWorkspace,
  type AdminWorkspaceList,
  type MeEntitlements,
  type PlanList,
  type Project,
  type ProjectPage,
  type ProblemDetails,
  type SharedProjectList,
} from '@robosim/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import type { Database } from '../src/db/client.js';
import { auditLogs, projectVersions, staffRoles, users } from '../src/db/schema.js';
import { withScope, withSystem } from '../src/db/scope.js';
import { EntitlementsService } from '../src/modules/entitlements/index.js';
import { VersionRetention } from '../src/modules/projects/index.js';
import { testEnv } from './support/app.js';
import { createTestDatabase } from './support/database.js';

let database: Database;
let app: NestFastifyApplication;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createApp(testEnv(), database);
});
afterAll(async () => {
  await app.close();
  await database.close();
});

const doc = (title = 'Blink', parts: string[] = []) => ({
  schemaVersion: 4,
  board: { id: 'avr-uno', version: '1.0.0' },
  components: parts.map((type, i) => ({
    id: `p${i}`,
    type,
    typeVersion: '1.0.0',
    x: i * 100,
    y: 0,
    rotation: 0,
    flipped: false,
    props: {},
  })),
  wires: [],
  code: { language: 'cpp', files: [{ name: 'sketch.ino', content: 'void setup() {}\nvoid loop() {}\n' }] },
  libraries: [],
  meta: { title },
});

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
let seq = 0;
const person = (name: string) => `${name}.${++seq}@dev.local`;
const call = (
  method: Method,
  url: string,
  user?: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(user ? { 'x-dev-user': user } : {}), ...headers },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });

async function create(user: string, title: string, parts: string[] = []): Promise<Project> {
  const res = await call('POST', '/projects', user, { document: doc(title, parts) });
  expect(res.statusCode).toBe(201);
  return res.json<Project>();
}

async function userId(email: string): Promise<{ id: string; workspaceId: string }> {
  await call('GET', '/projects', email);
  const [row] = await withSystem(database.db, (tx) =>
    tx.select({ id: users.id, ws: users.personalWorkspaceId }).from(users).where(eq(users.email, email)),
  );
  return { id: row?.id ?? '', workspaceId: row?.ws ?? '' };
}

async function staff(
  role: 'platform_admin' | 'finance' | 'support_agent' = 'platform_admin',
): Promise<string> {
  const email = person(role);
  const { id } = await userId(email);
  await withSystem(database.db, (tx) => tx.insert(staffRoles).values({ userId: id, role }));
  return email;
}

async function setPlan(admin: string, workspaceId: string, plan: string, periodEnd: string | null = null) {
  const res = await call('PUT', `/admin/workspaces/${workspaceId}/subscription`, admin, {
    plan,
    periodEnd,
    reason: 'test',
  });
  expect(res.statusCode).toBe(200);
  return res.json<AdminWorkspace>();
}

const save = (user: string, p: { id: string; revision: number }, document: unknown) =>
  call('PUT', `/projects/${p.id}/document`, user, document, { 'if-match': `"r${p.revision}"` });

describe('GET /plans and /me/entitlements', () => {
  it('lists the public plans with their entitlements', async () => {
    const res = await call('GET', '/plans');
    expect(res.statusCode).toBe(200);
    const { items } = res.json<PlanList>();
    expect(items.map((p) => p.code)).toEqual(['free', 'maker']);
    expect(items[0]?.entitlements).toEqual(DEFAULT_PLAN_ENTITLEMENTS.free);
    expect(items[1]?.entitlements).toEqual(DEFAULT_PLAN_ENTITLEMENTS.maker);
    expect(items[0]?.priceIrr).toBeNull();
  });

  it('puts every account on Free and reports its use', async () => {
    const ana = person('ana');
    await create(ana, 'One');
    const res = await call('GET', '/me/entitlements', ana);
    expect(res.statusCode).toBe(200);
    const me = res.json<MeEntitlements>();
    expect(me.plan).toEqual({
      code: 'free',
      version: 1,
      status: 'active',
      trialEndsAt: null,
      periodEnd: null,
    });
    expect(me.features['export.pdf']).toBe(false);
    expect(me.quotas['projects.cloud_max']).toEqual({ limit: 3, used: 1 });
    expect(me.quotas['build.daily_quota']).toMatchObject({ limit: 30, used: 0 });
    expect(me.quotas['build.daily_quota']?.resetsAt).toMatch(/T20:30:00\.000Z$/);
    expect(me.settings['components.tier']).toBe('basic');
    expect(me.restrictions).toEqual({ ageBand: 'adult', policy: null });
  });

  it('needs a session', async () => {
    const guest = await createApp(testEnv({ DEV_IDENTITY: 'false' }), database);
    try {
      expect((await guest.inject({ method: 'GET', url: '/api/v1/me/entitlements' })).statusCode).toBe(401);
      expect((await guest.inject({ method: 'GET', url: '/api/v1/plans' })).statusCode).toBe(200);
    } finally {
      await guest.close();
    }
  });
});

describe('projects.cloud_max (PRD §3)', () => {
  it('refuses a fourth cloud project on Free, also as a copy or a restore', async () => {
    const ana = person('ana');
    const [first] = [await create(ana, 'A'), await create(ana, 'B'), await create(ana, 'C')];
    const fourth = await call('POST', '/projects', ana, { document: doc('D') });
    expect(fourth.statusCode).toBe(403);
    expect(fourth.json<ProblemDetails>()).toMatchObject({
      code: 'quota_exceeded',
      params: { quota: 'projects.cloud_max', limit: 3, suggestedPlan: 'maker' },
    });
    expect((await call('POST', `/projects/${first?.id}/duplicate`, ana)).statusCode).toBe(403);

    expect((await call('DELETE', `/projects/${first?.id}`, ana)).statusCode).toBe(204);
    await create(ana, 'D');
    const restore = await call('POST', `/projects/${first?.id}/restore`, ana);
    expect(restore.json<ProblemDetails>().code).toBe('quota_exceeded');
  });

  it('keeps the most recently updated projects editable after a downgrade; the others are read-only', async () => {
    const admin = await staff();
    const bo = person('bo');
    const { workspaceId } = await userId(bo);
    await setPlan(admin, workspaceId, 'maker');
    const made: Project[] = [];
    for (const t of ['P1', 'P2', 'P3', 'P4', 'P5']) made.push(await create(bo, t));
    await setPlan(admin, workspaceId, 'free');

    const list = (await call('GET', '/projects?sort=name', bo)).json<ProjectPage>().items;
    expect(list.map((p) => [p.name, p.locked])).toEqual([
      ['P1', true],
      ['P2', true],
      ['P3', false],
      ['P4', false],
      ['P5', false],
    ]);
    const p1 = made[0] as Project;
    const opened = (await call('GET', `/projects/${p1.id}`, bo)).json<Project>();
    expect(opened.locked).toBe(true);

    // Read-only: no save, rename, checkpoint; still runnable (read) and deletable.
    const refused = await save(bo, p1, doc('P1 changed'));
    expect(refused.statusCode).toBe(403);
    expect(refused.json<ProblemDetails>().params).toMatchObject({
      quota: 'projects.cloud_max',
      locked: true,
    });
    expect(
      (await call('PATCH', `/projects/${p1.id}`, bo, { name: 'x' }, { 'if-match': `"r${p1.revision}"` }))
        .statusCode,
    ).toBe(403);
    expect((await call('POST', `/projects/${p1.id}/versions`, bo, { label: 'cp' })).statusCode).toBe(403);

    // Deleting an editable project frees a slot: the most recent locked one becomes editable.
    const p5 = made[4] as Project;
    expect((await call('DELETE', `/projects/${p5.id}`, bo)).statusCode).toBe(204);
    const p2 = (await call('GET', `/projects/${made[1]?.id}`, bo)).json<Project>();
    expect(p2.locked).toBe(false);
    expect((await save(bo, p2, doc('P2 changed'))).statusCode).toBe(200);
    expect((await call('GET', `/projects/${p1.id}`, bo)).json<Project>().locked).toBe(true);
  });

  it("applies the owner's cap to people the project is shared with", async () => {
    const admin = await staff();
    const owner = person('owner');
    const editor = person('editor');
    const { workspaceId } = await userId(owner);
    await userId(editor);
    await setPlan(admin, workspaceId, 'maker');
    const oldest = await create(owner, 'Oldest');
    for (const t of ['B', 'C', 'D']) await create(owner, t);
    expect(
      (await call('PUT', `/projects/${oldest.id}/shares`, owner, { email: editor, role: 'edit' })).statusCode,
    ).toBe(200);
    await setPlan(admin, workspaceId, 'free');

    const shared = (await call('GET', '/projects/shared', editor)).json<SharedProjectList>().items;
    expect(shared.map((p) => [p.name, p.locked])).toEqual([['Oldest', true]]);
    const asEditor = (await call('GET', `/projects/${oldest.id}`, editor)).json<Project>();
    expect(asEditor).toMatchObject({ access: 'edit', locked: true });
    expect((await save(editor, asEditor, doc('Edited'))).statusCode).toBe(403);
  });
});

describe('components.tier (FR-BIL-05)', () => {
  it('refuses to save pro parts on Free and names them; basic parts are fine', async () => {
    const cy = person('cy');
    const ok = await create(cy, 'Basic parts', ['led', 'resistor']);
    const res = await save(
      cy,
      ok,
      doc('Pro parts', ['led', 'sensor.mpu6050', 'display.oled-ssd1306', 'sensor.mpu6050']),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json<ProblemDetails>()).toMatchObject({
      code: 'entitlement_required',
      params: {
        entitlement: 'components.tier',
        suggestedPlan: 'maker',
        parts: ['sensor.mpu6050', 'display.oled-ssd1306'],
      },
    });
    expect(
      (await call('POST', '/projects', cy, { document: doc('New', ['sensor.mpu6050']) })).statusCode,
    ).toBe(403);
  });

  it('lets Maker save them, and an override grants them too', async () => {
    const admin = await staff('support_agent');
    const dee = person('dee');
    const { workspaceId } = await userId(dee);
    const grant = await call('POST', `/admin/workspaces/${workspaceId}/overrides`, admin, {
      key: 'components.tier',
      value: 'all',
      reason: 'beta tester',
    });
    expect(grant.statusCode).toBe(201);
    expect(grant.json<AdminWorkspace>().effective['components.tier']).toBe('all');
    await create(dee, 'Pro', ['sensor.mpu6050']);
  });
});

describe('back office (FR-ADM-02, FR-ADM-06)', () => {
  it('is for staff only, with per-role permissions', async () => {
    const user = person('user');
    await userId(user);
    expect((await call('GET', '/admin/plans', user)).statusCode).toBe(403);
    const support = await staff('support_agent');
    expect((await call('GET', '/admin/me', support)).json()).toMatchObject({ roles: ['support_agent'] });
    expect((await call('GET', '/admin/plans', support)).statusCode).toBe(200);
    const target = (await userId(person('target'))).workspaceId;
    expect(
      (
        await call('PUT', `/admin/workspaces/${target}/subscription`, support, {
          plan: 'maker',
          reason: 'nope',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('finds workspaces, sets a plan until a date, and audits it', async () => {
    const finance = await staff('finance');
    const eve = person('eve');
    const { workspaceId } = await userId(eve);
    const found = (
      await call('GET', `/admin/workspaces?q=${encodeURIComponent(eve)}`, finance)
    ).json<AdminWorkspaceList>();
    expect(found.items).toHaveLength(1);
    expect(found.items[0]?.subscription.plan).toBe('free');

    const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const ws = await setPlan(finance, workspaceId, 'maker', until);
    expect(ws.subscription).toMatchObject({
      plan: 'maker',
      status: 'active',
      periodEnd: until,
      source: 'manual',
    });
    expect(ws.effective['projects.cloud_max']).toBeNull();
    const me = (await call('GET', '/me/entitlements', eve)).json<MeEntitlements>();
    expect(me.plan).toMatchObject({ code: 'maker', periodEnd: until });

    const [audit] = await withSystem(database.db, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'subscription.changed'), eq(auditLogs.targetId, workspaceId))),
    );
    expect(audit).toMatchObject({ actorKind: 'staff', after: { plan: 'maker', reason: 'test' } });
  });

  it('falls back to Free when the period has ended', async () => {
    const admin = await staff();
    const fay = person('fay');
    const { workspaceId } = await userId(fay);
    await setPlan(admin, workspaceId, 'maker', new Date(Date.now() + 60_000).toISOString());
    await withSystem(database.db, (tx) =>
      tx.execute(
        sql`update subscriptions set current_period_end = now() - interval '1 day' where workspace_id = ${workspaceId}`,
      ),
    );
    app.get(EntitlementsService).invalidate(workspaceId); // the clock passing the end, without the 60 s cache
    const ws = (await call('GET', `/admin/workspaces/${workspaceId}`, admin)).json<AdminWorkspace>();
    expect(ws.subscription).toMatchObject({ plan: 'free', status: 'expired' });
  });

  it('adds overrides on top of the plan and removes them', async () => {
    const admin = await staff();
    const gus = person('gus');
    const { workspaceId } = await userId(gus);
    const added = await call('POST', `/admin/workspaces/${workspaceId}/overrides`, admin, {
      key: 'projects.cloud_max',
      value: 2,
      reason: 'school project',
    });
    const ws = added.json<AdminWorkspace>();
    expect(ws.effective['projects.cloud_max']).toBe(5);
    expect(ws.overrides).toHaveLength(1);
    const bad = await call('POST', `/admin/workspaces/${workspaceId}/overrides`, admin, {
      key: 'projects.cloud_max',
      value: 'lots',
      reason: 'nope',
    });
    expect(bad.statusCode).toBe(400);
    const removed = await call(
      'DELETE',
      `/admin/workspaces/${workspaceId}/overrides/${ws.overrides[0]?.id}`,
      admin,
    );
    expect(removed.json<AdminWorkspace>().effective['projects.cloud_max']).toBe(3);
  });

  it('publishes a plan version that applies to Free at once', async () => {
    const admin = await staff();
    const plans = (await call('GET', '/admin/plans', admin)).json<AdminPlanList>();
    const free = plans.items.find((p) => p.code === 'free');
    const current = free?.versions[0];
    expect(current).toMatchObject({ version: 1, effectiveTo: null });
    const res = await call('POST', '/admin/plans/free/versions', admin, {
      interval: 'month',
      priceIrr: 0,
      entitlements: { ...current?.entitlements, 'build.daily_quota': 40 },
    });
    expect(res.statusCode).toBe(201);
    const versions = res.json<{ versions: { version: number; effectiveTo: string | null }[] }>().versions;
    expect(versions.map((v) => [v.version, v.effectiveTo === null])).toEqual([
      [2, true],
      [1, false],
    ]);
    const hal = person('hal');
    expect(
      (await call('GET', '/me/entitlements', hal)).json<MeEntitlements>().quotas['build.daily_quota']?.limit,
    ).toBe(40);
    // Put Free back for the other suites.
    await call('POST', '/admin/plans/free/versions', admin, {
      interval: 'month',
      priceIrr: 0,
      entitlements: current?.entitlements,
    });
  });
});

describe('version retention (FR-PRJ-03)', () => {
  it('purges old automatic versions past the plan retention, keeping checkpoints and the latest', async () => {
    const ivy = person('ivy');
    const p = await create(ivy, 'Versions');
    const { id: uid, workspaceId } = await userId(ivy);
    const old = new Date(Date.now() - 10 * 86_400_000);
    await withSystem(database.db, (tx) =>
      tx.insert(projectVersions).values(
        (['auto_build', 'manual', 'restore', 'auto_build', 'auto_build'] as const).map((source, i) => ({
          projectId: p.id,
          workspaceId,
          number: i + 1,
          source,
          label: source === 'manual' ? 'my checkpoint' : null,
          document: p.document,
          documentSha256: 'x',
          createdBy: uid,
          createdAt: i < 4 ? old : new Date(),
        })),
      ),
    );
    const retention = app.get(VersionRetention);
    const dry = await retention.purge({ dryRun: true });
    expect(dry).toMatchObject({ dryRun: true });
    expect(dry.versions).toBeGreaterThanOrEqual(3);
    const numbers = async () =>
      (
        await withScope(database.db, { userId: uid, workspaceId }, (tx) =>
          tx
            .select({ n: projectVersions.number })
            .from(projectVersions)
            .where(eq(projectVersions.projectId, p.id)),
        )
      )
        .map((r) => r.n)
        .sort();
    expect(await numbers()).toEqual([1, 2, 3, 4, 5]);
    await retention.purge();
    expect(await numbers()).toEqual([2, 5]);
  });
});

describe('row-level security', () => {
  it('shows a workspace only its own subscription and overrides', async () => {
    const admin = await staff();
    const a = await userId(person('rls-a'));
    const b = await userId(person('rls-b'));
    await setPlan(admin, a.workspaceId, 'maker');
    await call('POST', `/admin/workspaces/${a.workspaceId}/overrides`, admin, {
      key: 'export.pdf',
      value: true,
      reason: 'test',
    });
    const seen = await withScope(database.db, { userId: b.id, workspaceId: b.workspaceId }, async (tx) => ({
      subs: await tx.execute(sql`select * from subscriptions`),
      overrides: await tx.execute(sql`select * from entitlement_overrides`),
    }));
    const rows = (r: unknown) => (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows);
    expect(rows(seen.subs)).toHaveLength(0);
    expect(rows(seen.overrides)).toHaveLength(0);
    const own = await withScope(database.db, { userId: a.id, workspaceId: a.workspaceId }, (tx) =>
      tx.execute(sql`select * from subscriptions`),
    );
    expect(rows(own)).toHaveLength(1);
  });
});
