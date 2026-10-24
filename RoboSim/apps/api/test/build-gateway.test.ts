import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildAcceptedSchema,
  buildResultSchema,
  buildStatusSchema,
  problemDetailsSchema,
} from '@robosim/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadEnv } from '../src/config/env.js';
import type { Database } from '../src/db/client.js';
import { testEnv } from './support/app.js';
import { patchPlan, subscribe } from './support/plans.js';
import { createTestDatabase } from './support/database.js';

let database: Database;
let cacheDir: string;
const apps: NestFastifyApplication[] = [];

async function app(overrides: Record<string, string> = {}): Promise<NestFastifyApplication> {
  const a = await createApp(
    testEnv({ COMPILER_CACHE_DIR: cacheDir, ARTIFACT_STORE_DIR: join(cacheDir, 'store'), ...overrides }),
    database,
  );
  apps.push(a);
  return a;
}

beforeAll(async () => {
  database = await createTestDatabase();
  cacheDir = await mkdtemp(join(tmpdir(), 'robosim-api-builds-'));
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});
afterAll(async () => {
  await database.close();
  await rm(cacheDir, { recursive: true, force: true });
});

const BLINK = 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); }\n';
let sketches = 0;
/** Sources nobody built yet in this file, so the request goes through the queue. */
const fresh = () => `${BLINK}// sketch ${++sketches}\n`;
const request = (content = BLINK) => ({
  board: 'avr-uno',
  files: [{ name: 'sketch.ino', content }],
  libraries: [],
});

const post = (
  a: NestFastifyApplication,
  payload: unknown,
  key: string | null = randomUUID(),
  headers: Record<string, string> = {},
) =>
  a.inject({
    method: 'POST',
    url: '/api/v1/builds',
    payload: payload as Record<string, unknown>,
    headers: { 'accept-language': 'en', ...(key ? { 'idempotency-key': key } : {}), ...headers },
  });

/** Parses an SSE body into its events. */
function sse(body: string) {
  return body
    .split('\n\n')
    .filter((block) => block.includes('data: '))
    .map((block) => {
      const field = (name: string) =>
        block
          .split('\n')
          .find((l) => l.startsWith(`${name}: `))
          ?.slice(name.length + 2) ?? '';
      return {
        id: Number(field('id')),
        event: field('event'),
        data: buildStatusSchema.parse(JSON.parse(field('data'))),
      };
    });
}

/** Follows a build to its result: `200` directly, `202` through its SSE stream. */
async function built(a: NestFastifyApplication, payload: unknown, headers: Record<string, string> = {}) {
  const res = await post(a, payload, randomUUID(), headers);
  if (res.statusCode === 200) return buildResultSchema.parse(res.json());
  expect(res.statusCode).toBe(202);
  const accepted = buildAcceptedSchema.parse(res.json());
  const stream = await a.inject({ method: 'GET', url: accepted.eventsUrl, headers });
  const final = sse(stream.body).at(-1)?.data;
  if (!final?.result) throw new Error(`build ended without a result: ${stream.body}`);
  return final.result;
}

describe('POST /builds (API Spec §4.5)', () => {
  it('queues new sources (202 + Location), streams progress and serves the firmware', async () => {
    const a = await app();
    const res = await post(a, request(fresh()));
    expect(res.statusCode).toBe(202);
    expect(res.headers['ratelimit-limit']).toBe('20');
    const accepted = buildAcceptedSchema.parse(res.json());
    expect(['queued', 'running']).toContain(accepted.state);
    expect(res.headers.location).toBe(`/api/v1/builds/${accepted.buildId}`);
    expect(accepted.eventsUrl).toBe(`/api/v1/builds/${accepted.buildId}/events`);

    const stream = await a.inject({ method: 'GET', url: accepted.eventsUrl });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(stream.headers['cache-control']).toBe('no-store');
    expect(stream.body.startsWith('retry: 2000\n\n')).toBe(true);
    const events = sse(stream.body);
    expect(events.at(-1)?.event).toBe('succeeded');
    expect(events.map((e) => e.id)).toEqual([...events.map((e) => e.id)].sort((x, y) => x - y));
    const result = events.at(-1)?.data.result;
    expect(result).toMatchObject({ buildId: accepted.buildId, status: 'succeeded', cacheHit: false });
    expect(result?.artifact?.flashPct).toBeGreaterThan(0);

    const status = await a.inject({ method: 'GET', url: accepted.statusUrl });
    expect(buildStatusSchema.parse(status.json())).toMatchObject({ state: 'succeeded', result });

    const hex = await a.inject({ method: 'GET', url: result?.artifact?.url ?? '' });
    expect(hex.statusCode).toBe(200);
    expect(hex.body).toMatch(/^:[0-9A-F]+\n/);
    expect(hex.headers['cache-control']).toContain('immutable');
    expect(hex.body.length).toBe(result?.artifact?.sizeBytes);
  });

  it('reconnecting to a finished build replays only its final status', async () => {
    const a = await app();
    const accepted = buildAcceptedSchema.parse((await post(a, request(fresh()))).json());
    await a.inject({ method: 'GET', url: accepted.eventsUrl });
    const again = sse((await a.inject({ method: 'GET', url: accepted.eventsUrl })).body);
    expect(again.map((e) => e.event)).toEqual(['succeeded']);
  });

  it('ends a compile error with a failed event carrying diagnostics on the user line', async () => {
    const result = await built(
      await app(),
      request('void setup() {\n  pinMode(13, OUTPUT)\n}\nvoid loop() {}\n'),
    );
    expect(result.status).toBe('failed');
    expect(result.artifact).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({
      file: 'sketch.ino',
      line: 3,
      severity: 'error',
      explanationKey: 'missing_semicolon',
    });
  });

  it('answers cached sources at once with 200', async () => {
    const a = await app();
    const content = fresh();
    expect((await built(a, request(content))).cacheHit).toBe(false);
    const again = await post(a, request(`${content}   `));
    expect(again.statusCode).toBe(200);
    expect(buildResultSchema.parse(again.json())).toMatchObject({ cacheHit: true, status: 'succeeded' });
  });

  it('requires a UUID Idempotency-Key', async () => {
    const res = await post(await app(), request(), null);
    expect(res.statusCode).toBe(400);
    expect(problemDetailsSchema.parse(res.json()).params).toEqual({
      errors: [{ path: 'Idempotency-Key', message: 'a UUID Idempotency-Key header is required' }],
    });
  });

  it('replays the original response for a reused key and rejects a reused key with another body', async () => {
    const a = await app();
    const key = randomUUID();
    const content = fresh();
    const first = await post(a, request(content), key);
    const replay = await post(a, request(content), key);
    expect(replay.statusCode).toBe(first.statusCode);
    expect(replay.headers.location).toBe(first.headers.location);
    expect(replay.json<{ buildId: string }>().buildId).toBe(first.json<{ buildId: string }>().buildId);
    const conflict = await post(a, request(`${content}// changed\n`), key);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'idempotency_conflict' });
  });

  it('validates the request against the shared schema', async () => {
    const a = await app();
    const badName = await post(a, { board: 'avr-uno', files: [{ name: '../x.ino', content: '' }] });
    expect(badName.statusCode).toBe(400);
    expect(JSON.stringify(badName.json())).toContain('files.0.name');
    const tooBig = await post(a, request('x'.repeat(110 * 1024)));
    expect(tooBig.statusCode).toBe(400);
    const badBoard = await post(a, { ...request(), board: 'esp32' });
    expect(badBoard.statusCode).toBe(400);
  });

  it('rate-limits per user with RateLimit headers and Retry-After', async () => {
    const a = await app({ BUILD_RATE_LIMIT_PER_MIN: '2' });
    expect((await post(a, request())).statusCode).toBeLessThan(300);
    expect((await post(a, request())).statusCode).toBeLessThan(300);
    const limited = await post(a, request());
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['ratelimit-remaining']).toBe('0');
    // Another user has their own window.
    expect(
      (await post(a, request(), randomUUID(), { 'x-dev-user': 'other@dev.local' })).statusCode,
    ).toBeLessThan(300);
  });

  it("counts queued builds against the plan's daily quota (00:00 Tehran); cache hits stay free", async () => {
    const a = await app({ DEV_IDENTITY_EMAIL: 'quota@dev.local' });
    const restore = await patchPlan(a, database, 'free', { 'build.daily_quota': 1 });
    try {
      await built(a, request(fresh()));
      const over = await post(a, request(fresh()));
      expect(over.statusCode).toBe(429);
      const problem = problemDetailsSchema.parse(over.json());
      expect(problem.code).toBe('build_quota_exceeded');
      expect(problem.params).toEqual({
        limit: 1,
        resetAt: expect.stringMatching(/T20:30:00\.000Z$/) as string,
        suggestedPlan: 'maker',
      });
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      expect((await post(a, request(BLINK))).statusCode).toBe(200);
      // A Maker subscription lifts the limit at once.
      await subscribe(a, database, 'quota@dev.local', 'maker');
      expect((await post(a, request(fresh()))).statusCode).toBe(202);
    } finally {
      await restore();
    }
  });

  it("hides one user's builds from another", async () => {
    const a = await app();
    const accepted = buildAcceptedSchema.parse((await post(a, request(fresh()))).json());
    const other = { 'x-dev-user': 'someone-else@dev.local' };
    expect((await a.inject({ method: 'GET', url: accepted.statusUrl, headers: other })).statusCode).toBe(404);
    expect((await a.inject({ method: 'GET', url: accepted.eventsUrl, headers: other })).statusCode).toBe(404);
    await a.inject({ method: 'GET', url: accepted.eventsUrl });
    expect((await a.inject({ method: 'GET', url: '/api/v1/builds/nope' })).statusCode).toBe(404);
  });

  it('lets guests build, scoped by client address, at the guest rate limit', async () => {
    const a = await app({ DEV_IDENTITY: 'false', BUILD_GUEST_RATE_LIMIT_PER_MIN: '1' });
    const res = await post(a, request(fresh()));
    expect(res.statusCode).toBe(202);
    expect(res.headers['ratelimit-limit']).toBe('1');
    const accepted = buildAcceptedSchema.parse(res.json());
    expect(sse((await a.inject({ method: 'GET', url: accepted.eventsUrl })).body).at(-1)?.event).toBe(
      'succeeded',
    );
    expect((await post(a, request())).statusCode).toBe(429);
  });

  it('reports a missing toolchain as a localized 503, and the rest of the API keeps working', async () => {
    const a = await app({ COMPILER_TOOLCHAIN_DIR: join(cacheDir, 'no-toolchain') });
    const res = await post(a, request(), randomUUID(), { 'accept-language': 'fa' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      code: 'compiler_unavailable',
      title: 'کامپایلر در حال حاضر در دسترس نیست',
    });
    expect((await a.inject({ method: 'GET', url: '/api/v1/health/live' })).statusCode).toBe(200);
  });

  it('404s an unknown or malformed artifact id', async () => {
    const a = await app();
    expect((await a.inject({ method: 'GET', url: `/api/v1/artifacts/${'0'.repeat(64)}` })).statusCode).toBe(
      404,
    );
    expect((await a.inject({ method: 'GET', url: '/api/v1/artifacts/..%2F..%2Fetc' })).statusCode).toBe(404);
  });
});

describe('build runtime configuration', () => {
  it('refuses the local runtime in staging and production', () => {
    expect(() => loadEnv({ APP_ENV: 'staging', DATABASE_DRIVER: 'pglite' })).toThrow(/COMPILER_RUNTIME/);
  });
});

describe('automatic versions on successful builds (FR-PRJ-03)', () => {
  const project = async (a: NestFastifyApplication, content: string) =>
    (
      await a.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          document: {
            schemaVersion: 4,
            board: { id: 'avr-uno', version: '1.0.0' },
            components: [],
            wires: [],
            code: { language: 'cpp', files: [{ name: 'sketch.ino', content }] },
            libraries: [],
            meta: { title: 'Blink' },
          },
        },
      })
    ).json<{ id: string }>().id;
  const versions = async (a: NestFastifyApplication, projectId: string) =>
    (await a.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/versions` })).json<{
      items: unknown[];
    }>().items;

  it('snapshots the saved project when a queued build of its code succeeds', async () => {
    const a = await app();
    const content = fresh();
    const projectId = await project(a, content);
    const result = await built(a, { ...request(content), projectId });
    expect(result).toMatchObject({ status: 'succeeded', cacheHit: false });
    await built(a, { ...request(fresh()), projectId }); // unsaved edit: no version
    await vi.waitFor(async () =>
      expect(await versions(a, projectId)).toEqual([
        expect.objectContaining({ number: 1, source: 'auto_build', artifactId: result.artifact?.id }),
      ]),
    );
  });

  it('snapshots on a cache hit too', async () => {
    const a = await app();
    const content = fresh();
    await built(a, request(content));
    const projectId = await project(a, content);
    expect((await built(a, { ...request(content), projectId })).cacheHit).toBe(true);
    expect(await versions(a, projectId)).toEqual([
      expect.objectContaining({ number: 1, source: 'auto_build' }),
    ]);
  });
});
