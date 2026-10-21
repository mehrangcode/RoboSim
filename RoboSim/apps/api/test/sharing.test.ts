// Sharing (FR-PRJ-04, US-PRJ-03; API Spec §4.4; Security §4.3): links, remix, people shares and their RLS.
import type {
  DevMail,
  Project,
  ProjectPage,
  ProjectSharing,
  SharedLink,
  SharedProjectList,
} from '@robosim/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import type { Database } from '../src/db/client.js';
import { projects, projectShares, users } from '../src/db/schema.js';
import { withScope, withSystem } from '../src/db/scope.js';
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

const doc = (title = 'Line follower') => ({
  schemaVersion: 4,
  board: { id: 'avr-uno', version: '1.0.0' },
  components: [],
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

async function project(owner: string, title = 'Line follower'): Promise<Project> {
  const res = await call('POST', '/projects', owner, { document: doc(title) });
  expect(res.statusCode).toBe(201);
  return res.json<Project>();
}

/** Makes sure the account exists (the development identity creates it on first use). */
async function signUp(user: string): Promise<string> {
  const res = await call('GET', '/projects', user);
  expect(res.statusCode).toBe(200);
  const [row] = await withSystem(database.db, (tx) =>
    tx.select({ id: users.id }).from(users).where(eq(users.email, user)),
  );
  return row?.id ?? '';
}

const tokenOf = (sharing: ProjectSharing) => sharing.link?.url.split('/s/')[1] ?? '';

describe('share links (US-PRJ-03)', () => {
  it('opens a read-only copy for anyone with the link, without changing the revision', async () => {
    const ana = person('ana');
    const p = await project(ana);
    const res = await call('POST', `/projects/${p.id}/share-link`, ana, { remixable: false });
    expect(res.statusCode).toBe(200);
    const sharing = res.json<ProjectSharing>();
    expect(sharing.link?.url).toMatch(/^http:\/\/localhost:5173\/s\/[\w-]{43}$/);

    const open = await app.inject({ method: 'GET', url: `/api/v1/shared/${tokenOf(sharing)}` });
    expect(open.statusCode).toBe(200);
    expect(open.json<SharedLink>()).toMatchObject({
      project: { id: p.id, name: 'Line follower', document: { meta: { title: 'Line follower' } } },
      ownerName: ana.split('@')[0],
      remixable: false,
    });
    expect((await call('GET', `/projects/${p.id}`, ana)).json<Project>().revision).toBe(p.revision);
  });

  it('keeps the same link until it is regenerated or turned off', async () => {
    const ana = person('ana');
    const p = await project(ana);
    const first = (
      await call('POST', `/projects/${p.id}/share-link`, ana, { remixable: false })
    ).json<ProjectSharing>();
    const again = (
      await call('POST', `/projects/${p.id}/share-link`, ana, { remixable: true })
    ).json<ProjectSharing>();
    expect(again.link).toEqual({ url: first.link?.url, remixable: true });
    expect((await call('GET', `/projects/${p.id}/shares`, ana)).json<ProjectSharing>().link?.url).toBe(
      first.link?.url,
    );

    const fresh = (
      await call('POST', `/projects/${p.id}/share-link`, ana, { remixable: true, regenerate: true })
    ).json<ProjectSharing>();
    expect(fresh.link?.url).not.toBe(first.link?.url);
    expect((await call('GET', `/shared/${tokenOf(first)}`)).statusCode).toBe(404);

    const off = await call('DELETE', `/projects/${p.id}/share-link`, ana);
    expect(off.json<ProjectSharing>().link).toBeNull();
    expect((await call('GET', `/shared/${tokenOf(fresh)}`)).statusCode).toBe(404);
  });

  it('stores only a hash of the token', async () => {
    const ana = person('ana');
    const p = await project(ana);
    const sharing = (
      await call('POST', `/projects/${p.id}/share-link`, ana, { remixable: false })
    ).json<ProjectSharing>();
    const [row] = await withSystem(database.db, (tx) =>
      tx.select().from(projects).where(eq(projects.id, p.id)),
    );
    expect(row?.shareTokenHash).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(tokenOf(sharing));
  });

  it('stops working when the project is deleted, and answers malformed tokens with 404', async () => {
    const ana = person('ana');
    const p = await project(ana);
    const sharing = (
      await call('POST', `/projects/${p.id}/share-link`, ana, { remixable: false })
    ).json<ProjectSharing>();
    expect((await call('DELETE', `/projects/${p.id}`, ana)).statusCode).toBe(204);
    expect((await call('GET', `/shared/${tokenOf(sharing)}`)).statusCode).toBe(404);
    expect((await call('GET', '/shared/not-a-token')).statusCode).toBe(404);
  });

  it('remixes into the visitor’s own workspace with attribution, only when allowed', async () => {
    const ana = person('ana');
    const bob = person('bob');
    const p = await project(ana, 'Sumo bot');
    const closed = (
      await call('POST', `/projects/${p.id}/share-link`, ana, { remixable: false })
    ).json<ProjectSharing>();
    const refused = await call('POST', `/shared/${tokenOf(closed)}/remix`, bob);
    expect(refused.json()).toMatchObject({ code: 'forbidden' });

    const open = (
      await call('POST', `/projects/${p.id}/share-link`, ana, { remixable: true })
    ).json<ProjectSharing>();
    const res = await call('POST', `/shared/${tokenOf(open)}/remix`, bob);
    expect(res.statusCode).toBe(201);
    const remix = res.json<Project>();
    expect(remix).toMatchObject({
      name: 'Sumo bot',
      access: 'owner',
      ownerName: bob.split('@')[0],
      remixedFrom: { projectId: p.id, name: 'Sumo bot', author: ana.split('@')[0] },
    });
    expect((await call('GET', '/projects', bob)).json<ProjectPage>().items.map((i) => i.id)).toContain(
      remix.id,
    );
  });

  it('needs an account to remix', async () => {
    const strict = await createApp(testEnv({ DEV_IDENTITY: 'false' }), database);
    try {
      const ana = person('ana');
      const p = await project(ana);
      const sharing = (
        await call('POST', `/projects/${p.id}/share-link`, ana, { remixable: true })
      ).json<ProjectSharing>();
      expect(
        (await strict.inject({ method: 'GET', url: `/api/v1/shared/${tokenOf(sharing)}` })).statusCode,
      ).toBe(200);
      const res = await strict.inject({ method: 'POST', url: `/api/v1/shared/${tokenOf(sharing)}/remix` });
      expect(res.json()).toMatchObject({ code: 'unauthenticated' });
    } finally {
      await strict.close();
    }
  });
});

describe('sharing with people (FR-PRJ-04, Security §4.3)', () => {
  it('a viewer reads, lists and copies but cannot change, delete or manage the project', async () => {
    const ana = person('ana');
    const bob = person('bob');
    await signUp(bob);
    const p = await project(ana);
    const shared = await call('PUT', `/projects/${p.id}/shares`, ana, {
      email: bob.toUpperCase(),
      role: 'view',
    });
    expect(shared.json<ProjectSharing>().people).toEqual([
      expect.objectContaining({ email: bob, displayName: bob.split('@')[0], role: 'view' }),
    ]);

    const seen = (await call('GET', `/projects/${p.id}`, bob)).json<Project>();
    expect(seen).toMatchObject({ id: p.id, access: 'view', ownerName: ana.split('@')[0] });
    expect((await call('GET', '/projects', bob)).json<ProjectPage>().items.map((i) => i.id)).not.toContain(
      p.id,
    );
    expect((await call('GET', '/projects/shared', bob)).json<SharedProjectList>().items).toEqual([
      expect.objectContaining({ id: p.id, role: 'view', ownerName: ana.split('@')[0] }),
    ]);
    expect((await call('GET', `/projects/${p.id}/versions`, bob)).statusCode).toBe(200);

    const etag = { 'if-match': `"r${p.revision}"` };
    for (const [method, url, body] of [
      ['PUT', `/projects/${p.id}/document`, doc('Mine now')],
      ['PATCH', `/projects/${p.id}`, { name: 'Mine now' }],
      ['POST', `/projects/${p.id}/versions`, { label: 'x' }],
      ['DELETE', `/projects/${p.id}`, undefined],
      ['GET', `/projects/${p.id}/shares`, undefined],
      ['POST', `/projects/${p.id}/share-link`, { remixable: true }],
    ] as const) {
      const res = await call(method, url, bob, body, etag);
      expect(res.json(), `${method} ${url}`).toMatchObject({ code: 'forbidden' });
    }

    const copy = await call('POST', `/projects/${p.id}/duplicate`, bob);
    expect(copy.json<Project>()).toMatchObject({
      name: 'Line follower',
      access: 'owner',
      remixedFrom: { projectId: p.id, author: ana.split('@')[0] },
    });
  });

  it('an editor saves and takes versions, but cannot delete, tag or reshare', async () => {
    const ana = person('ana');
    const bob = person('bob');
    await signUp(bob);
    const p = await project(ana);
    await call('PUT', `/projects/${p.id}/shares`, ana, { email: bob, role: 'view' });
    await call('PUT', `/projects/${p.id}/shares`, ana, { email: bob, role: 'edit' });

    const save = await call('PUT', `/projects/${p.id}/document`, bob, doc('Faster follower'), {
      'if-match': `"r${p.revision}"`,
    });
    expect(save.statusCode).toBe(200);
    expect((await call('GET', `/projects/${p.id}`, ana)).json<Project>().name).toBe('Faster follower');
    expect((await call('POST', `/projects/${p.id}/versions`, bob, { label: 'by bob' })).statusCode).toBe(201);
    expect((await call('GET', `/projects/${p.id}`, bob)).json<Project>().access).toBe('edit');

    const rev = (await call('GET', `/projects/${p.id}`, bob)).json<Project>().revision;
    const tag = await call('PATCH', `/projects/${p.id}`, bob, { tags: ['x'] }, { 'if-match': `"r${rev}"` });
    expect(tag.json()).toMatchObject({ code: 'forbidden' });
    expect((await call('DELETE', `/projects/${p.id}`, bob)).json()).toMatchObject({ code: 'forbidden' });
    expect(
      (await call('PUT', `/projects/${p.id}/shares`, bob, { email: ana, role: 'edit' })).json(),
    ).toMatchObject({
      code: 'forbidden',
    });
  });

  it('is invisible to everyone else', async () => {
    const ana = person('ana');
    const carol = person('carol');
    const p = await project(ana);
    for (const url of [`/projects/${p.id}`, `/projects/${p.id}/shares`, `/projects/${p.id}/versions`])
      expect((await call('GET', url, carol)).statusCode, url).toBe(404);
  });

  it('emails the person once, in their language', async () => {
    const ana = person('ana');
    const bob = person('bob');
    await signUp(bob);
    await withSystem(database.db, (tx) => tx.update(users).set({ locale: 'fa' }).where(eq(users.email, bob)));
    const p = await project(ana, 'Maze');
    await call('PUT', `/projects/${p.id}/shares`, ana, { email: bob, role: 'edit' });
    await call('PUT', `/projects/${p.id}/shares`, ana, { email: bob, role: 'view' });
    const mail = (await call('GET', `/dev/mail?to=${encodeURIComponent(bob)}`)).json<{ items: DevMail[] }>()
      .items;
    expect(mail).toHaveLength(1);
    expect(mail[0]?.subject).toBe(`${ana.split('@')[0]} پروژهٔ «Maze» را با شما به اشتراک گذاشت`);
    expect(mail[0]?.link).toBe(`http://localhost:5173/editor/${p.id}`);
  });

  it('refuses unknown emails and the owner themself', async () => {
    const ana = person('ana');
    const p = await project(ana);
    expect(
      (
        await call('PUT', `/projects/${p.id}/shares`, ana, { email: 'ghost@nowhere.example', role: 'view' })
      ).json(),
    ).toMatchObject({
      code: 'not_found',
      params: { field: 'email' },
    });
    expect(
      (await call('PUT', `/projects/${p.id}/shares`, ana, { email: ana, role: 'view' })).json(),
    ).toMatchObject({
      code: 'validation_failed',
    });
  });

  it('the owner can remove a person, and a person can leave', async () => {
    const ana = person('ana');
    const bob = person('bob');
    const carol = person('carol');
    const bobId = await signUp(bob);
    const carolId = await signUp(carol);
    const p = await project(ana);
    await call('PUT', `/projects/${p.id}/shares`, ana, { email: bob, role: 'view' });
    await call('PUT', `/projects/${p.id}/shares`, ana, { email: carol, role: 'edit' });

    expect((await call('DELETE', `/projects/${p.id}/shares/${carolId}`, bob)).statusCode).toBe(404);
    expect((await call('DELETE', `/projects/${p.id}/shares/${bobId}`, bob)).statusCode).toBe(204);
    expect((await call('GET', `/projects/${p.id}`, bob)).statusCode).toBe(404);
    expect((await call('DELETE', `/projects/${p.id}/shares/${carolId}`, ana)).statusCode).toBe(204);
    expect((await call('GET', '/projects/shared', carol)).json<SharedProjectList>().items).toEqual([]);
  });

  it('a deleted project disappears from "Shared with me"', async () => {
    const ana = person('ana');
    const bob = person('bob');
    await signUp(bob);
    const p = await project(ana);
    await call('PUT', `/projects/${p.id}/shares`, ana, { email: bob, role: 'edit' });
    await call('DELETE', `/projects/${p.id}`, ana);
    expect((await call('GET', '/projects/shared', bob)).json<SharedProjectList>().items).toEqual([]);
    expect((await call('GET', `/projects/${p.id}`, bob)).statusCode).toBe(404);
  });
});

describe('RLS backs the sharing rules (ADR-007)', () => {
  it('an editor cannot soft-delete through SQL, nor grant themself access to other projects', async () => {
    const ana = person('ana');
    const bob = person('bob');
    const bobId = await signUp(bob);
    const p = await project(ana);
    const other = await project(ana, 'Private');
    await call('PUT', `/projects/${p.id}/shares`, ana, { email: bob, role: 'edit' });
    const [bobRow] = await withSystem(database.db, (tx) =>
      tx.select({ ws: users.personalWorkspaceId }).from(users).where(eq(users.id, bobId)),
    );
    const scope = { userId: bobId, workspaceId: bobRow?.ws ?? '' };

    await expect(
      withScope(database.db, scope, (tx) =>
        tx.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, p.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withScope(database.db, scope, (tx) =>
        tx.insert(projectShares).values({
          projectId: other.id,
          principalKind: 'user',
          principalId: bobId,
          role: 'edit',
          workspaceId: scope.workspaceId,
        }),
      ),
    ).rejects.toThrow();
    const visible = await withScope(database.db, scope, (tx) =>
      tx
        .select({ id: projects.id })
        .from(projects)
        .where(sql`${projects.id} in (${p.id}, ${other.id})`),
    );
    expect(visible.map((r) => r.id)).toEqual([p.id]);
  });

  it('refuses the development link secret outside local and test', async () => {
    const { loadEnv } = await import('../src/config/env.js');
    expect(() =>
      loadEnv({ APP_ENV: 'staging', DATABASE_URL: 'postgres://x', COMPILER_RUNTIME: 'local' }),
    ).toThrow(/SHARE_LINK_SECRET/);
  });
});
