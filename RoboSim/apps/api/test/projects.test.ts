// Projects API (API Spec §4.4): CRUD, optimistic concurrency, versions and tenant isolation over HTTP.
import { PROJECT_LIMITS, type Project, type ProjectPage, type ProjectVersionSummary } from '@robosim/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import type { Database } from '../src/db/client.js';
import { ProjectsService } from '../src/modules/projects/index.js';
import { testEnv } from './support/app.js';
import { createTestDatabase } from './support/database.js';
import { subscribe } from './support/plans.js';

let database: Database;
let app: NestFastifyApplication;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createApp(testEnv(), database);
  // These suites are about the projects API itself; Free's 3-project cap has its own suite (entitlements.test.ts).
  for (const user of ['ana@dev.local', 'lister@dev.local']) {
    await call('GET', '/projects', undefined, as(user));
    await subscribe(app, database, user, 'maker');
  }
});
afterAll(async () => {
  await app.close();
  await database.close();
});

const doc = (title = 'Blink', sketch = 'void setup() {}\nvoid loop() {}\n') => ({
  schemaVersion: 4,
  board: { id: 'avr-uno', version: '1.0.0' },
  components: [],
  wires: [],
  code: { language: 'cpp', files: [{ name: 'sketch.ino', content: sketch }] },
  libraries: [],
  meta: { title },
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (method: Method, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers,
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
const as = (user: string) => ({ 'x-dev-user': user });

async function create(
  title: string,
  user = 'ana@dev.local',
  extra: Record<string, unknown> = {},
): Promise<Project> {
  const res = await call('POST', '/projects', { document: doc(title), ...extra }, as(user));
  expect(res.statusCode).toBe(201);
  return res.json<Project>();
}

describe('create, read, save', () => {
  it('creates a project named after the document, with an ETag', async () => {
    const res = await call('POST', '/projects', { document: doc('Line follower') }, as('ana@dev.local'));
    expect(res.statusCode).toBe(201);
    const project = res.json<Project>();
    expect(project).toMatchObject({
      name: 'Line follower',
      boardId: 'avr-uno',
      language: 'cpp',
      revision: 1,
    });
    expect(res.headers.etag).toBe('"r1"');
    const read = await call('GET', `/projects/${project.id}`, undefined, as('ana@dev.local'));
    expect(read.statusCode).toBe(200);
    expect(read.json<Project>().document.meta.title).toBe('Line follower');
  });

  it('migrates older documents and rejects invalid ones with paths', async () => {
    const old = await call(
      'POST',
      '/projects',
      { document: { ...doc('Old'), schemaVersion: 1 } },
      as('ana@dev.local'),
    );
    expect(old.json<Project>().document.schemaVersion).toBe(4);
    const bad = await call(
      'POST',
      '/projects',
      { document: { ...doc(), wires: [{ id: 'w' }] } },
      as('ana@dev.local'),
    );
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 'validation_failed' });
    expect(JSON.stringify(bad.json())).toContain('wires.0');
  });

  it('saves with If-Match, and refuses stale or missing preconditions with 412', async () => {
    const project = await create('Servo');
    const url = `/projects/${project.id}/document`;
    const saved = await call('PUT', url, doc('Servo sweep'), { ...as('ana@dev.local'), 'if-match': '"r1"' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ name: 'Servo sweep', revision: 2 });
    expect(saved.headers.etag).toBe('"r2"');

    const stale = await call('PUT', url, doc('Other tab'), { ...as('ana@dev.local'), 'if-match': '"r1"' });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ code: 'precondition_failed', params: { revision: 2 } });
    expect((await call('PUT', url, doc('No etag'), as('ana@dev.local'))).statusCode).toBe(412);

    // Saving an identical document is a no-op that keeps the revision.
    const same = await call('PUT', url, doc('Servo sweep'), { ...as('ana@dev.local'), 'if-match': '"r2"' });
    expect(same.json()).toMatchObject({ revision: 2 });
  });

  it('renames and retags through PATCH, keeping meta.title in step', async () => {
    const project = await create('Knob');
    const res = await call(
      'PATCH',
      `/projects/${project.id}`,
      { name: 'Knob → LED', tags: ['Bench', 'bench'] },
      {
        ...as('ana@dev.local'),
        'if-match': '"r1"',
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<Project>()).toMatchObject({ name: 'Knob → LED', tags: ['bench'], revision: 2 });
    expect(res.json<Project>().document.meta.title).toBe('Knob → LED');
  });

  it('refuses documents over the size limit', async () => {
    const project = await create('Huge');
    const big = doc('Huge', `// ${'x'.repeat(PROJECT_LIMITS.maxDocumentBytes)}`);
    const res = await call('PUT', `/projects/${project.id}/document`, big, {
      ...as('ana@dev.local'),
      'if-match': '"r1"',
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'payload_too_large' });
  });
});

describe('list, delete, restore, duplicate', () => {
  it('pages through projects with cursors, search and tags', async () => {
    const user = 'lister@dev.local';
    for (const t of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
      await create(t, user, { tags: t === 'Beta' ? ['robot'] : [] });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await call(
        'GET',
        `/projects?sort=name&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        undefined,
        as(user),
      );
      const page: ProjectPage = res.json();
      seen.push(...page.items.map((p) => p.name));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma']);

    const recent = (await call('GET', '/projects?limit=3', undefined, as(user))).json<ProjectPage>();
    expect(recent.items.map((p) => p.name)).toEqual(['Epsilon', 'Delta', 'Gamma']);
    const next = (
      await call('GET', `/projects?limit=3&cursor=${recent.nextCursor}`, undefined, as(user))
    ).json<ProjectPage>();
    expect(next.items.map((p) => p.name)).toEqual(['Beta', 'Alpha']);

    expect(
      (await call('GET', '/projects?q=ps', undefined, as(user))).json<ProjectPage>().items.map((p) => p.name),
    ).toEqual(['Epsilon']);
    expect((await call('GET', '/projects?q=%25', undefined, as(user))).json<ProjectPage>().items).toEqual([]);
    expect(
      (await call('GET', '/projects?tag=robot', undefined, as(user)))
        .json<ProjectPage>()
        .items.map((p) => p.name),
    ).toEqual(['Beta']);
    expect((await call('GET', '/projects?cursor=garbage', undefined, as(user))).statusCode).toBe(400);
  });

  it('soft-deletes into the trash and restores', async () => {
    const user = 'trash@dev.local';
    const project = await create('Doomed', user);
    expect((await call('DELETE', `/projects/${project.id}`, undefined, as(user))).statusCode).toBe(204);
    expect((await call('GET', `/projects/${project.id}`, undefined, as(user))).statusCode).toBe(404);
    expect((await call('GET', '/projects', undefined, as(user))).json<ProjectPage>().items).toEqual([]);
    const trash = (await call('GET', '/projects?deleted=true', undefined, as(user))).json<ProjectPage>();
    expect(trash.items.map((p) => p.name)).toEqual(['Doomed']);
    expect(trash.items[0]?.deletedAt).not.toBeNull();

    const restored = await call('POST', `/projects/${project.id}/restore`, undefined, as(user));
    expect(restored.statusCode).toBe(200);
    expect(restored.json<Project>().deletedAt).toBeNull();
    expect((await call('POST', `/projects/${project.id}/restore`, undefined, as(user))).statusCode).toBe(404);
  });

  it('does not restore after the trash period', async () => {
    const user = 'expired@dev.local';
    const project = await create('Old trash', user);
    await call('DELETE', `/projects/${project.id}`, undefined, as(user));
    const service = app.get(ProjectsService);
    const caller = await callerOf(user);
    const later = new Date(Date.now() + (PROJECT_LIMITS.trashDays + 1) * 86_400_000);
    await expect(service.restore(caller, project.id, later)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('duplicates the working document under a new name', async () => {
    const project = await create('Original');
    const res = await call('POST', `/projects/${project.id}/duplicate`, undefined, as('ana@dev.local'));
    expect(res.statusCode).toBe(201);
    const copy = res.json<Project>();
    expect(copy.id).not.toBe(project.id);
    expect(copy).toMatchObject({ name: 'Original (copy)', revision: 1 });
    expect(copy.document.code).toEqual(project.document.code);
  });
});

describe('versions (FR-PRJ-03)', () => {
  it('checkpoints, lists newest first, and restores as a new version', async () => {
    const user = 'versions@dev.local';
    const project = await create('V1', user);
    const v1 = await call('POST', `/projects/${project.id}/versions`, { label: 'first' }, as(user));
    expect(v1.statusCode).toBe(201);
    expect(v1.json()).toMatchObject({ number: 1, label: 'first', source: 'manual' });

    await call('PUT', `/projects/${project.id}/document`, doc('V2', '// v2\n'), {
      ...as(user),
      'if-match': '"r1"',
    });
    await call('POST', `/projects/${project.id}/versions`, { label: 'second' }, as(user));

    const list = (await call('GET', `/projects/${project.id}/versions`, undefined, as(user))).json<{
      items: ProjectVersionSummary[];
    }>();
    expect(list.items.map((v) => v.label)).toEqual(['second', 'first']);
    const first = list.items[1];
    if (!first) throw new Error('missing version');
    const full = await call('GET', `/projects/${project.id}/versions/${first.id}`, undefined, as(user));
    expect(full.json<{ document: { meta: { title: string } } }>().document.meta.title).toBe('V1');

    const restored = await call('POST', `/projects/${project.id}/versions/${first.id}/restore`, undefined, {
      ...as(user),
      'if-match': '"r2"',
    });
    expect(restored.statusCode).toBe(200);
    // The project keeps its current name; the restored content comes back.
    expect(restored.json<Project>()).toMatchObject({ name: 'V2', revision: 3 });
    expect(restored.json<Project>().document.code).toEqual(project.document.code);
    const after = (await call('GET', `/projects/${project.id}/versions`, undefined, as(user))).json<{
      items: ProjectVersionSummary[];
    }>();
    expect(after.items[0]).toMatchObject({ number: 3, source: 'restore', label: 'v1' });
  });

  it('snapshots successful builds only when the built files are the saved code, once per document', async () => {
    const user = 'builder@dev.local';
    const project = await create('Build me', user);
    const service = app.get(ProjectsService);
    const caller = await callerOf(user);
    const files = project.document.code.files;
    expect(
      await service.snapshotBuild(
        caller,
        project.id,
        [{ name: 'sketch.ino', content: 'unsaved' }],
        'a'.repeat(64),
      ),
    ).toBe(false);
    expect(await service.snapshotBuild(caller, project.id, files, 'b'.repeat(64))).toBe(true);
    expect(await service.snapshotBuild(caller, project.id, files, 'b'.repeat(64))).toBe(true);
    const list = await service.listVersions(caller, project.id);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ source: 'auto_build', artifactId: 'b'.repeat(64) });
    // Unknown and foreign projects are ignored, never thrown.
    expect(await service.snapshotBuild(caller, '01900000-0000-7000-8000-000000000000', files, 'c')).toBe(
      false,
    );
  });
});

describe('identity and tenant isolation (NFR-TEN-01)', () => {
  it("cannot read, save, list or version another user's project", async () => {
    const project = await create('Private', 'owner@dev.local');
    const intruder = as('intruder@dev.local');
    expect((await call('GET', `/projects/${project.id}`, undefined, intruder)).statusCode).toBe(404);
    expect(
      (
        await call('PUT', `/projects/${project.id}/document`, doc('Pwned'), {
          ...intruder,
          'if-match': '"r1"',
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('GET', `/projects/${project.id}/versions`, undefined, intruder)).statusCode).toBe(404);
    expect((await call('DELETE', `/projects/${project.id}`, undefined, intruder)).statusCode).toBe(404);
    expect((await call('GET', '/projects', undefined, intruder)).json<ProjectPage>().items).toEqual([]);
  });

  it('refuses a workspace the caller is not a member of', async () => {
    const owner = await callerOf('owner@dev.local');
    const res = await call('GET', '/projects', undefined, {
      ...as('intruder@dev.local'),
      'x-workspace-id': owner.workspaceId,
    });
    expect(res.statusCode).toBe(403);
    expect((await call('GET', '/projects', undefined, { 'x-workspace-id': 'nope' })).statusCode).toBe(400);
  });

  it('RLS hides foreign projects and versions even from unfiltered queries', async () => {
    const project = await create('Raw', 'owner@dev.local');
    await call('POST', `/projects/${project.id}/versions`, { label: 'x' }, as('owner@dev.local'));
    const intruder = await callerOf('intruder@dev.local');
    const { projects, projectVersions } = await import('../src/db/schema.js');
    const { withScope } = await import('../src/db/scope.js');
    const seen = await withScope(database.db, intruder, async (tx) => ({
      projects: await tx.select({ id: projects.id }).from(projects),
      versions: await tx.select({ id: projectVersions.id }).from(projectVersions),
    }));
    expect(seen.projects.map((r) => r.id)).not.toContain(project.id);
    expect(seen.versions).toEqual([]);
  });

  it('answers 401 when the development identity is off', async () => {
    const strict = await createApp(testEnv({ DEV_IDENTITY: 'false' }), database);
    try {
      const res = await strict.inject({ method: 'GET', url: '/api/v1/projects' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'unauthenticated' });
    } finally {
      await strict.close();
    }
  });

  it('cannot be enabled in staging or production', async () => {
    const { loadEnv } = await import('../src/config/env.js');
    expect(() =>
      loadEnv({
        APP_ENV: 'staging',
        DATABASE_URL: 'postgres://x',
        COMPILER_RUNTIME: 'local',
        DEV_IDENTITY: 'true',
      }),
    ).toThrow(/DEV_IDENTITY/);
    expect(testEnv().devIdentity).toBe(true);
  });
});

/** The caller a dev user maps to, read through the API (their personal workspace). */
async function callerOf(user: string): Promise<{ userId: string; workspaceId: string }> {
  const project = await create(`probe ${user}`, user);
  const { projects } = await import('../src/db/schema.js');
  const { withSystem } = await import('../src/db/scope.js');
  const { eq } = await import('drizzle-orm');
  const [row] = await withSystem(database.db, (tx) =>
    tx
      .select({ userId: projects.ownerUserId, workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, project.id)),
  );
  if (!row) throw new Error(`no project for ${user}`);
  return row;
}
