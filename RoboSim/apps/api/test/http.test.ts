import { problemDetailsSchema } from '@robosim/shared';
import { Body, Controller, Module, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/bootstrap.js';
import type { Database } from '../src/db/client.js';
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

const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers });

describe('health endpoints', () => {
  it('live and ready report ok', async () => {
    for (const path of ['/api/v1/health/live', '/api/v1/health/ready']) {
      const res = await get(path);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    }
  });
});

describe('API Spec §1 conventions', () => {
  it('generates a request id and echoes it back', async () => {
    const res = await get('/api/v1/health/live');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('propagates a well-formed upstream request id and replaces a malicious one', async () => {
    expect(
      (await get('/api/v1/health/live', { 'x-request-id': 'ingress-abc-12345' })).headers['x-request-id'],
    ).toBe('ingress-abc-12345');
    const injected = await get('/api/v1/health/live', { 'x-request-id': 'bad\nid <script>' });
    expect(injected.headers['x-request-id']).not.toContain('script');
  });

  it('sets baseline security headers', async () => {
    const res = await get('/api/v1/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('API Spec §3 problem details', () => {
  it('unknown routes return a localized RFC 9457 document (FA)', async () => {
    const res = await get('/api/v1/nope?x=1', { 'accept-language': 'fa-IR,fa;q=0.9' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = problemDetailsSchema.parse(res.json());
    expect(body).toMatchObject({
      code: 'not_found',
      status: 404,
      title: 'پیدا نشد',
      instance: '/api/v1/nope',
    });
    expect(body.requestId).toBe(res.headers['x-request-id']);
  });

  it('defaults to English titles', async () => {
    const res = await get('/api/v1/nope');
    expect(res.json()).toMatchObject({ code: 'not_found', title: 'Not found' });
  });
});

describe('feature flags endpoint (FR-ADM-09)', () => {
  it('returns evaluated flags', async () => {
    const res = await get('/api/v1/feature-flags');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ flags: {} });
  });
});

describe('validation with Zod via Standard Schema', () => {
  const echoSchema = z.object({ name: z.string().min(2) });

  @Controller('echo')
  class EchoController {
    @Post()
    echo(@Body({ schema: echoSchema }) body: z.infer<typeof echoSchema>) {
      return body;
    }
  }
  @Module({ controllers: [EchoController] })
  class EchoModule {}

  let echoApp: NestFastifyApplication;
  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const original = AppModule.register.bind(AppModule);
    // Mount a probe controller on the real pipeline (filters, pipes, hooks).
    AppModule.register = (env, db) => {
      const mod = original(env, db);
      return { ...mod, imports: [...(mod.imports ?? []), EchoModule] };
    };
    try {
      echoApp = await createApp(testEnv(), database);
    } finally {
      AppModule.register = original;
    }
  });
  afterAll(() => echoApp.close());

  it('accepts valid bodies', async () => {
    const res = await echoApp.inject({ method: 'POST', url: '/api/v1/echo', payload: { name: 'Sara' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ name: 'Sara' });
  });

  it('maps schema failures to validation_failed with field paths', async () => {
    const res = await echoApp.inject({ method: 'POST', url: '/api/v1/echo', payload: { name: 'x' } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toMatchObject({ code: 'validation_failed' });
    expect(body.params.errors[0].path).toBe('name');
  });

  it('maps malformed JSON to validation_failed', async () => {
    const res = await echoApp.inject({
      method: 'POST',
      url: '/api/v1/echo',
      payload: '{oops',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation_failed' });
  });
});

describe('readiness reflects dependency health', () => {
  it('returns 503 maintenance when the database is unavailable', async () => {
    const broken = await createTestDatabase();
    const brokenApp = await createApp(testEnv(), broken);
    await broken.close();
    const res = await brokenApp.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'maintenance', params: { dependency: 'database' } });
    expect((await brokenApp.inject({ method: 'GET', url: '/api/v1/health/live' })).statusCode).toBe(200);
    await brokenApp.close();
  });
});
