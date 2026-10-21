import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildResultSchema, problemDetailsSchema } from '@robosim/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadEnv } from '../src/config/env.js';
import type { Database } from '../src/db/client.js';
import { testEnv } from './support/app.js';
import { createTestDatabase } from './support/database.js';

let database: Database;
let cacheDir: string;
const apps: NestFastifyApplication[] = [];

async function app(overrides: Record<string, string> = {}): Promise<NestFastifyApplication> {
  const a = await createApp(testEnv({ COMPILER_CACHE_DIR: cacheDir, ...overrides }), database);
  apps.push(a);
  return a;
}

beforeAll(async () => {
  database = await createTestDatabase();
  cacheDir = await mkdtemp(join(tmpdir(), 'robosim-api-builds-'));
});
afterAll(async () => {
  for (const a of apps) await a.close();
  await database.close();
  await rm(cacheDir, { recursive: true, force: true });
});

const BLINK = 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); }\n';
const request = (content = BLINK) => ({
  board: 'avr-uno',
  files: [{ name: 'sketch.ino', content }],
  libraries: [],
});

const post = (a: NestFastifyApplication, payload: unknown, key: string | null = randomUUID(), lang = 'en') =>
  a.inject({
    method: 'POST',
    url: '/api/v1/builds',
    payload: payload as Record<string, unknown>,
    headers: { 'accept-language': lang, ...(key ? { 'idempotency-key': key } : {}) },
  });

describe('POST /builds (API Spec §4.5)', () => {
  it('compiles a sketch and serves the firmware by content address', async () => {
    const a = await app();
    const res = await post(a, request());
    expect(res.statusCode).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('20');
    const result = buildResultSchema.parse(res.json());
    expect(result).toMatchObject({ status: 'succeeded', diagnostics: [], artifact: { format: 'ihex' } });
    expect(result.artifact?.flashPct).toBeGreaterThan(0);

    const hex = await a.inject({ method: 'GET', url: result.artifact?.url ?? '' });
    expect(hex.statusCode).toBe(200);
    expect(hex.body).toMatch(/^:[0-9A-F]+\n/);
    expect(hex.headers['cache-control']).toContain('immutable');
    expect(hex.body.length).toBe(result.artifact?.sizeBytes);
  });

  it('returns a failed build as a result with diagnostics on the user line', async () => {
    const res = await post(
      await app(),
      request('void setup() {\n  pinMode(13, OUTPUT)\n}\nvoid loop() {}\n'),
    );
    expect(res.statusCode).toBe(200);
    const result = buildResultSchema.parse(res.json());
    expect(result.status).toBe('failed');
    expect(result.artifact).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({
      file: 'sketch.ino',
      line: 3,
      severity: 'error',
      explanationKey: 'missing_semicolon',
    });
  });

  it('serves repeated sources from the cache', async () => {
    const a = await app();
    await post(a, request('void setup() {}\nvoid loop() {}\n'));
    const again = buildResultSchema.parse(
      (await post(a, request('void setup() {}\nvoid loop() {}\n'))).json(),
    );
    expect(again.cacheHit).toBe(true);
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
    const first = (await post(a, request(), key)).json() as { buildId: string };
    const replay = (await post(a, request(), key)).json() as { buildId: string };
    expect(replay.buildId).toBe(first.buildId);
    const conflict = await post(a, request(`${BLINK}// changed\n`), key);
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

  it('rate-limits per client with RateLimit headers and Retry-After', async () => {
    const a = await app({ BUILD_RATE_LIMIT_PER_MIN: '2' });
    expect((await post(a, request())).statusCode).toBe(200);
    expect((await post(a, request())).statusCode).toBe(200);
    const limited = await post(a, request());
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['ratelimit-remaining']).toBe('0');
  });

  it('reports a missing toolchain as a localized 503, and the rest of the API keeps working', async () => {
    const a = await app({ COMPILER_TOOLCHAIN_DIR: join(cacheDir, 'no-toolchain') });
    const res = await post(a, request(), randomUUID(), 'fa');
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
  it('snapshots the saved project when its code is what was built', async () => {
    const a = await app();
    const created = await a.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: {
        document: {
          schemaVersion: 4,
          board: { id: 'avr-uno', version: '1.0.0' },
          components: [],
          wires: [],
          code: { language: 'cpp', files: [{ name: 'sketch.ino', content: BLINK }] },
          libraries: [],
          meta: { title: 'Blink' },
        },
      },
    });
    const projectId = created.json<{ id: string }>().id;
    const built = buildResultSchema.parse((await post(a, { ...request(), projectId })).json());
    expect(built.status).toBe('succeeded');
    await post(a, { ...request('void setup() {}\nvoid loop() {}\n'), projectId }); // unsaved edit: no version
    const versions = await a.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/versions` });
    expect(versions.json<{ items: unknown[] }>().items).toEqual([
      expect.objectContaining({ number: 1, source: 'auto_build', artifactId: built.artifact?.id }),
    ]);
  });
});
