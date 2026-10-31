// Guided projects (FR-LRN-01, US-LRN-01; API Spec §4.6): content shaped by plan, and learners' progress.
import type { GuidedProgress, GuidedProject, GuidedSummary, ProblemDetails } from '@robosim/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import type { Database } from '../src/db/client.js';
import { guidedProgress } from '../src/db/schema.js';
import { withScope } from '../src/db/scope.js';
import { testEnv } from './support/app.js';
import { createTestDatabase } from './support/database.js';
import { subscribe } from './support/plans.js';

let database: Database;
let app: NestFastifyApplication;
let guests: NestFastifyApplication;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createApp(testEnv(), database);
  guests = await createApp(testEnv({ DEV_IDENTITY: 'false' }), database);
});
afterAll(async () => {
  await guests.close();
  await app.close();
  await database.close();
});

let seq = 0;
const person = (name: string) => `${name}.${++seq}@dev.local`;
const call = (method: 'GET' | 'PUT', url: string, user?: string, body?: unknown) =>
  (user ? app : guests).inject({
    method,
    url: `/api/v1${url}`,
    headers: user ? { 'x-dev-user': user } : {},
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });

const LF = 'line-follower@1';
const OA = 'obstacle-avoider@1';

describe('guided projects catalogue', () => {
  it('shows guests and Free users the free projects in full and the paid robots as teasers', async () => {
    for (const user of [undefined, person('free')]) {
      const list = await call('GET', '/guided-projects', user);
      expect(list.statusCode).toBe(200);
      expect(list.json<GuidedSummary[]>().map((p) => [p.slug, p.locked, p.free])).toEqual([
        ['blink-traffic-light', false, true],
        ['button-counter', false, true],
        ['dimmer-knob', false, true],
        ['servo-sweep', false, true],
        ['weather-station', false, true],
        ['line-follower', false, true],
        ['square-track', true, false],
        ['mind-the-gap', true, false],
        ['pid-line-follower', true, false],
        ['obstacle-avoider', true, false],
        ['scanning-avoider', true, false],
        ['maze-explorer', true, false],
        ['sumo-bot', true, false],
      ]);

      const open = await call('GET', '/guided-projects/line-follower', user);
      const body = open.json<GuidedProject>();
      expect(body.contentVersionId).toBe(LF);
      expect(body.steps[0]?.id).toBe('intro');
      expect(body.starter).toMatchObject({ guided: { slug: 'line-follower', version: 1 } });

      const teaser = await call('GET', '/guided-projects/obstacle-avoider', user);
      expect(teaser.statusCode).toBe(200);
      expect(teaser.json()).toMatchObject({ slug: 'obstacle-avoider', locked: true });
      expect(teaser.json()).not.toHaveProperty('steps');
      expect(teaser.json()).not.toHaveProperty('starter');
    }
  });

  it('opens every project on Maker', async () => {
    const maker = person('maker');
    await call('GET', '/progress/guided', maker);
    await subscribe(app, database, maker, 'maker');
    const list = await call('GET', '/guided-projects', maker);
    expect(list.json<GuidedSummary[]>().every((p) => !p.locked)).toBe(true);
    expect((await call('GET', '/guided-projects/obstacle-avoider', maker)).json()).toHaveProperty('steps');
  });

  it('answers 404 for an unknown project', async () => {
    expect((await call('GET', '/guided-projects/nope')).statusCode).toBe(404);
  });
});

describe('guided progress (US-LRN-01 AC2)', () => {
  it('adds completed steps, keeps them, and records completion once', async () => {
    const sara = person('sara');
    expect((await call('GET', '/progress/guided', sara)).json()).toEqual([]);

    const first = await call('PUT', `/progress/guided/${LF}`, sara, { completedSteps: ['intro', 'driver'] });
    expect(first.statusCode).toBe(200);
    expect(first.json<GuidedProgress>()).toMatchObject({
      contentVersionId: LF,
      projectId: null,
      completedSteps: ['intro', 'driver'],
      completedAt: null,
    });

    // A later write (another device, or guest progress merged on sign-in) only adds steps.
    const more = await call('PUT', `/progress/guided/${LF}`, sara, { completedSteps: ['jumpers'] });
    expect(more.json<GuidedProgress>().completedSteps).toEqual(['intro', 'driver', 'jumpers']);

    const early = await call('PUT', `/progress/guided/${LF}`, sara, { completedSteps: [], completed: true });
    expect(early.statusCode).toBe(400);

    const project = await call('GET', '/guided-projects/line-follower', sara);
    const all = project.json<GuidedProject>().steps.map((s) => s.id);
    const projectId = '0192a4a0-0000-7000-8000-000000000001';
    const done = await call('PUT', `/progress/guided/${LF}`, sara, {
      completedSteps: all,
      completed: true,
      projectId,
    });
    const completedAt = done.json<GuidedProgress>().completedAt;
    expect(completedAt).not.toBeNull();
    expect(done.json<GuidedProgress>()).toMatchObject({ completedSteps: all, projectId });

    const again = await call('PUT', `/progress/guided/${LF}`, sara, { completedSteps: all, completed: true });
    expect(again.json<GuidedProgress>()).toMatchObject({ completedAt, projectId });
    expect((await call('GET', '/progress/guided', sara)).json<GuidedProgress[]>()).toHaveLength(1);
  });

  it('refuses unknown content, unknown steps and projects outside the plan', async () => {
    const ali = person('ali');
    expect(
      (await call('PUT', '/progress/guided/line-follower@9', ali, { completedSteps: [] })).statusCode,
    ).toBe(404);
    expect((await call('PUT', '/progress/guided/Bad Id', ali, { completedSteps: [] })).statusCode).toBe(400);
    const step = await call('PUT', `/progress/guided/${LF}`, ali, { completedSteps: ['nope'] });
    expect(step.statusCode).toBe(400);
    const locked = await call('PUT', `/progress/guided/${OA}`, ali, { completedSteps: ['intro'] });
    expect(locked.statusCode).toBe(403);
    expect(locked.json<ProblemDetails>().code).toBe('entitlement_required');
  });

  it('needs a signed-in learner', async () => {
    expect((await call('GET', '/progress/guided')).statusCode).toBe(401);
    expect((await call('PUT', `/progress/guided/${LF}`, undefined, { completedSteps: [] })).statusCode).toBe(
      401,
    );
  });

  it('keeps each learner’s progress to themselves (RLS)', async () => {
    const a = person('a');
    const b = person('b');
    await call('PUT', `/progress/guided/${LF}`, a, { completedSteps: ['intro'] });
    await call('GET', '/progress/guided', b);
    expect((await call('GET', '/progress/guided', b)).json()).toEqual([]);
    const ids = await withScope(database.db, { userId: '00000000-0000-7000-8000-000000000000' }, (tx) =>
      tx.select().from(guidedProgress),
    );
    expect(ids).toEqual([]);
  });
});
