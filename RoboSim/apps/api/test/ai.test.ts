// AI assistant (FR-AI-01…05, 07, 08, FR-ADM-08; API Spec §4.11; US-AI-01…04).
import { FakeProvider, ProviderError, type FakeScript, type LLMProvider } from '@robosim/ai-providers';
import {
  PROJECT_SCHEMA_VERSION,
  type AiConversationDetail,
  type AiKey,
  type AiProvider,
  type AiProviderConfig,
  type AiUsage,
  type AiUsageReport,
  type ProblemDetails,
  type ProjectDocument,
} from '@robosim/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import type { Database } from '../src/db/client.js';
import { aiConversations, aiKeys, aiMessages, staffRoles, users } from '../src/db/schema.js';
import { withSystem } from '../src/db/scope.js';
import {
  PROVIDER_FACTORY,
  type ProviderFactory,
  type ProviderFactoryHolder,
} from '../src/modules/ai/index.js';
import { testEnv } from './support/app.js';
import { createTestDatabase } from './support/database.js';
import { patchPlan } from './support/plans.js';

let database: Database;
let app: NestFastifyApplication;
let holder: ProviderFactoryHolder;
let original: ProviderFactory;

/** What the scripted model answers next; reset before each test. */
let script: FakeScript;
let lastPlatform: FakeProvider | undefined;
const VALID_KEY = 'sk-test-valid-key-0001';

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createApp(testEnv(), database);
  holder = app.get<ProviderFactoryHolder>(PROVIDER_FACTORY);
  original = holder.create;
  holder.create = ({ provider, apiKey }): LLMProvider => {
    const p = new FakeProvider((call) => script(call), {
      validKey: provider === 'platform' ? undefined : VALID_KEY,
      apiKey: apiKey ?? undefined,
    });
    if (provider === 'platform') lastPlatform = p;
    return p;
  };
});
afterAll(async () => {
  holder.create = original;
  await app.close();
  await database.close();
});
beforeEach(() => {
  script = () => [
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'there.' },
  ];
});

let seq = 0;
const person = (name: string) => `${name}.${++seq}@dev.local`;
const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, user: string, body?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { 'x-dev-user': user },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });

type Event = { event: string; data: Record<string, unknown> };
function events(body: string): Event[] {
  return body
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      return event && data ? { event, data: JSON.parse(data) as Record<string, unknown> } : undefined;
    })
    .filter((e): e is Event => e !== undefined);
}

const SKETCH = [
  'const int LEFT = A0;',
  'void setup() { pinMode(9, OUTPUT); }',
  'void loop() {',
  '  if (analogRead(LEFT) > 500) {',
  '    analogWrite(9, 0);',
  '  }',
  '}',
].join('\n');

const doc = (): ProjectDocument =>
  ({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    board: { id: 'avr-uno', version: '1.0.0' },
    components: [
      {
        id: 'r1',
        type: 'passive.resistor',
        typeVersion: '1.0.0',
        x: 0,
        y: 0,
        rotation: 0,
        flipped: false,
        props: { ohms: 220 },
      },
    ],
    wires: [
      {
        id: 'w1',
        from: { part: 'board', pin: 'D13' },
        to: { part: 'r1', pin: '1' },
        color: 'green',
        points: [],
      },
    ],
    code: { language: 'cpp', files: [{ name: 'main.ino', content: SKETCH }] },
    libraries: [],
    meta: { title: 'Line follower' },
  }) as unknown as ProjectDocument;

async function userIdOf(email: string): Promise<string> {
  await call('GET', '/ai/usage', email);
  const [row] = await withSystem(database.db, (tx) =>
    tx.select({ id: users.id }).from(users).where(eq(users.email, email)),
  );
  return row?.id ?? '';
}

async function staff(): Promise<string> {
  const email = person('admin');
  const id = await userIdOf(email);
  await withSystem(database.db, (tx) => tx.insert(staffRoles).values({ userId: id, role: 'platform_admin' }));
  return email;
}

describe('chat', () => {
  it('streams an answer, stores the conversation and meters platform credits (US-AI-03 AC1)', async () => {
    const sara = person('sara');
    const before = (await call('GET', '/ai/usage', sara)).json<AiUsage>();
    expect(before).toMatchObject({
      allowance: 20_000,
      used: 0,
      remaining: 20_000,
      rateLimit: { perMinute: 10, perDay: 200 },
      historyDays: 90,
    });

    const res = await call('POST', '/ai/chat', sara, {
      message: 'Why does my robot not move?',
      locale: 'en',
      context: { document: doc() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const evs = events(res.body);
    expect(evs.map((e) => e.event)).toEqual(['start', 'delta', 'delta', 'usage', 'done']);
    expect(evs[0]?.data).toMatchObject({ provider: 'platform', model: 'fake-1' });
    const usage = evs[3]?.data as { tokensIn: number; tokensOut: number; remaining: number };
    expect(usage.remaining).toBe(20_000 - usage.tokensIn - usage.tokensOut);

    const after = (await call('GET', '/ai/usage', sara)).json<AiUsage>();
    expect(after.used).toBe(usage.tokensIn + usage.tokensOut);

    const conversationId = evs[0]?.data.conversationId as string;
    const list = (await call('GET', '/ai/conversations', sara)).json<{
      items: { id: string; title: string }[];
    }>();
    expect(list.items).toEqual([
      expect.objectContaining({ id: conversationId, title: 'Why does my robot not move?' }),
    ]);
    const detail = (
      await call('GET', `/ai/conversations/${conversationId}`, sara)
    ).json<AiConversationDetail>();
    expect(detail.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Why does my robot not move?'],
      ['assistant', 'Hello there.'],
    ]);

    // A follow-up carries the history to the model.
    await call('POST', '/ai/chat', sara, { message: 'And now?', conversationId, context: {} });
    expect(lastPlatform?.calls[0]?.messages.map((m) => m.content)).toEqual([
      'Why does my robot not move?',
      'Hello there.',
      'And now?',
    ]);

    // Someone else cannot read it.
    expect((await call('GET', `/ai/conversations/${conversationId}`, person('other'))).statusCode).toBe(404);
  });

  it('sends the project as quoted data with numbered lines, in the UI language (US-AI-01)', async () => {
    await call('POST', '/ai/chat', person('ali'), {
      message: 'چرا ربات من خط را دنبال نمی‌کند؟',
      locale: 'fa',
      context: {
        document: doc(),
        serialTail: ['L=812'],
        findings: [{ rule: 'SAF-FLOATING-INPUT', severity: 'warning', message: 'A0 floats' }],
        nets: [['board:D13', 'r1:1']],
      },
    });
    const sent = lastPlatform?.calls[0];
    expect(sent?.system).toContain('Answer in Persian.');
    expect(sent?.system).toContain('<project_data>');
    expect(sent?.system).toContain('   4|   if (analogRead(LEFT) > 500) {');
    expect(sent?.system).toContain('board:D13 = r1:1');
    expect(sent?.system).toContain('[warning] SAF-FLOATING-INPUT: A0 floats');
    expect(sent?.tools?.map((t) => t.name)).toEqual(['propose_code_patch', 'propose_circuit_change']);
  });

  it('turns tool calls into validated proposals and explains the ones that do not fit (FR-AI-05)', async () => {
    script = () => [
      { type: 'text', text: 'The condition is inverted.' },
      {
        type: 'tool_call',
        id: 'a',
        name: 'propose_code_patch',
        args: { summary: 'Invert', file: 'main.ino', edits: [{ find: '> 500', replace: '< 500' }] },
      },
      {
        type: 'tool_call',
        id: 'b',
        name: 'propose_circuit_change',
        args: {
          summary: 'LED',
          changes: [{ op: 'set_prop', id: 'r1', prop: 'ohms', value: 330, from: null, type: '' }],
        },
      },
      {
        type: 'tool_call',
        id: 'c',
        name: 'propose_circuit_change',
        args: {
          summary: 'x',
          changes: [{ op: 'add_wire', from: { part: 'board', pin: 'D99' }, to: { part: 'r1', pin: '2' } }],
        },
      },
    ];
    const res = await call('POST', '/ai/chat', person('pat'), {
      message: 'fix it',
      locale: 'en',
      context: { document: doc() },
    });
    const evs = events(res.body);
    const proposals = evs.filter((e) => e.event === 'proposal').map((e) => e.data);
    expect(proposals[0]).toMatchObject({ kind: 'code_patch', file: 'main.ino', summary: 'Invert' });
    expect(proposals[0]?.unifiedDiff).toContain(
      '-  if (analogRead(LEFT) > 500) {\n+  if (analogRead(LEFT) < 500) {',
    );
    expect(proposals[1]).toMatchObject({
      kind: 'circuit_change',
      changes: [{ op: 'set_prop', id: 'r1', prop: 'ohms', value: 330 }],
    });
    expect(
      evs.some((e) => e.event === 'delta' && String(e.data.text).includes('the board has no pin D99')),
    ).toBe(true);

    const detail = (
      await call('GET', `/ai/conversations/${String(evs[0]?.data.conversationId)}`, person('nobody'))
    ).statusCode;
    expect(detail).toBe(404);
  });

  it('stops a harmful answer with the output filter and refuses a harmful question (FR-AI-07)', async () => {
    script = () => [
      { type: 'text', text: 'Here is how to build a pipe ' },
      { type: 'text', text: 'bomb with the Uno' },
    ];
    const kim = person('kim');
    const res = await call('POST', '/ai/chat', kim, { message: 'help', locale: 'en', context: {} });
    const evs = events(res.body);
    expect(evs.map((e) => e.event)).toEqual(['start', 'delta', 'filtered', 'usage', 'done']);
    const detail = (
      await call('GET', `/ai/conversations/${String(evs[0]?.data.conversationId)}`, kim)
    ).json<AiConversationDetail>();
    expect(detail.messages[1]).toMatchObject({
      filtered: true,
      content: expect.stringContaining('safety filter'),
    });

    const asked = await call('POST', '/ai/chat', kim, { message: 'ساخت بمب با آردوینو', context: {} });
    expect(asked.statusCode).toBe(403);
    expect(asked.json<ProblemDetails>().params).toMatchObject({
      reason: 'content_filtered',
      category: 'weapons',
    });
  });

  it('reports a provider failure as an error event without charging', async () => {
    script = () => Promise.reject(new ProviderError('model not found', 404));
    const max = person('max');
    const evs = events((await call('POST', '/ai/chat', max, { message: 'hi', context: {} })).body);
    expect(evs.map((e) => [e.event, e.data.code])).toEqual([
      ['start', undefined],
      ['error', 'provider_error'],
    ]);
    expect((await call('GET', '/ai/usage', max)).json<AiUsage>().used).toBe(0);
  });

  it('limits requests per minute with Retry-After (US-AI-03 AC2)', async () => {
    const rex = person('rex');
    for (let i = 0; i < 10; i++)
      expect((await call('POST', '/ai/chat', rex, { message: `q${i}`, context: {} })).statusCode).toBe(200);
    const res = await call('POST', '/ai/chat', rex, { message: 'one more', context: {} });
    expect(res.statusCode).toBe(429);
    expect(res.json<ProblemDetails>().code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('refuses at zero credits with ai_credits_exhausted', async () => {
    const restore = await patchPlan(app, database, 'free', { 'ai.platform_credits_monthly': 0 });
    try {
      const res = await call('POST', '/ai/chat', person('zed'), { message: 'hi', context: {} });
      expect(res.statusCode).toBe(429);
      expect(res.json<ProblemDetails>()).toMatchObject({
        code: 'ai_credits_exhausted',
        params: { allowance: 0, suggestedPlan: 'maker' },
      });
    } finally {
      await restore();
    }
  });

  it('deletes a conversation from history and storage (US-AI-03 AC3)', async () => {
    const amy = person('amy');
    const evs = events((await call('POST', '/ai/chat', amy, { message: 'hi', context: {} })).body);
    const id = String(evs[0]?.data.conversationId);
    expect((await call('DELETE', `/ai/conversations/${id}`, amy)).statusCode).toBe(204);
    expect((await call('GET', '/ai/conversations', amy)).json<{ items: unknown[] }>().items).toEqual([]);
    const left = await withSystem(database.db, async (tx) => [
      ...(await tx.select().from(aiConversations).where(eq(aiConversations.id, id))),
      ...(await tx.select().from(aiMessages).where(eq(aiMessages.conversationId, id))),
    ]);
    expect(left).toEqual([]);
  });

  it('checks the project belongs to the caller and validates the document', async () => {
    expect(
      (
        await call('POST', '/ai/chat', person('a'), {
          message: 'x',
          projectId: '01900000-0000-7000-8000-000000000000',
          context: {},
        })
      ).statusCode,
    ).toBe(404);
    const bad = await call('POST', '/ai/chat', person('b'), {
      message: 'x',
      context: { document: { schemaVersion: 1 } },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('providers and keys', () => {
  it('lists only the platform until staff enable a provider with a legal reference', async () => {
    const lee = person('lee');
    const before = (await call('GET', '/ai/providers', lee)).json<{ providers: AiProvider[] }>();
    expect(before.providers.map((p) => p.id)).toEqual(['platform']);

    const admin = await staff();
    const refused = await call('PUT', '/admin/ai/providers/openai', admin, { enabled: true });
    expect(refused.statusCode).toBe(400);
    const enabled = await call('PUT', '/admin/ai/providers/openai', admin, {
      enabled: true,
      legalRef: 'LEGAL-2026-14',
      defaultModel: 'gpt-x',
    });
    expect(enabled.json<AiProviderConfig>()).toMatchObject({
      enabled: true,
      legalRef: 'LEGAL-2026-14',
      check: { ok: true },
    });
    expect(enabled.json<AiProviderConfig>().legalApprovedAt).not.toBeNull();
    expect((await call('GET', '/admin/ai/providers', lee)).statusCode).toBe(403);

    const after = (await call('GET', '/ai/providers', lee)).json<{ providers: AiProvider[] }>();
    // Free has no BYOK.
    expect(after.providers[1]).toMatchObject({ id: 'openai', usable: false, blockedBy: 'byok_not_in_plan' });
  });

  it('tests a key, stores it encrypted and never returns it (US-AI-04)', async () => {
    const admin = await staff();
    await call('PUT', '/admin/ai/providers/anthropic', admin, {
      enabled: true,
      legalRef: 'LEGAL-1',
      defaultModel: 'claude-x',
    });
    const restore = await patchPlan(app, database, 'free', { 'ai.byok': true });
    try {
      const ali = person('ali');
      const bad = await call('PUT', '/ai/keys/anthropic', ali, { key: 'sk-wrong-key-9999' });
      expect(bad.json<AiKey>()).toMatchObject({
        status: 'invalid',
        last4: '9999',
        error: 'Incorrect API key provided.',
      });

      const good = await call('PUT', '/ai/keys/anthropic', ali, { key: VALID_KEY });
      expect(good.json<AiKey>()).toMatchObject({
        status: 'active',
        last4: '0001',
        scope: 'user',
        error: null,
      });
      const providers = await call('GET', '/ai/providers', ali);
      expect(
        providers.json<{ providers: AiProvider[] }>().providers.find((p) => p.id === 'anthropic'),
      ).toMatchObject({ usable: true, blockedBy: null });

      const chat = await call('POST', '/ai/chat', ali, { message: 'hi', provider: 'anthropic', context: {} });
      expect(events(chat.body)[0]?.data).toMatchObject({ provider: 'anthropic', model: 'claude-x' });
      // BYOK answers do not use platform credits.
      expect((await call('GET', '/ai/usage', ali)).json<AiUsage>().used).toBe(0);

      for (const res of [bad, good, providers, chat]) expect(res.body).not.toContain(VALID_KEY);
      const [stored] = await withSystem(database.db, (tx) =>
        tx.select().from(aiKeys).where(eq(aiKeys.keyLast4, '0001')),
      );
      expect(stored?.ciphertext).not.toContain(VALID_KEY);
      expect(stored?.wrappedDek).toMatch(/^v1:/);

      expect((await call('DELETE', '/ai/keys/anthropic', ali)).statusCode).toBe(204);
      expect(
        (
          await call('POST', '/ai/chat', ali, { message: 'hi', provider: 'anthropic', context: {} })
        ).json<ProblemDetails>().params,
      ).toMatchObject({
        reason: 'key_missing',
      });
    } finally {
      await restore();
    }
  });

  it('keeps minors on the platform model with 30-day history', async () => {
    const teen = person('teen');
    const id = await userIdOf(teen);
    await withSystem(database.db, (tx) => tx.update(users).set({ ageBand: '16_17' }).where(eq(users.id, id)));
    expect((await call('GET', '/ai/usage', teen)).json<AiUsage>().historyDays).toBe(30);
    const res = await call('POST', '/ai/chat', teen, { message: 'hi', provider: 'openai', context: {} });
    expect(res.json<ProblemDetails>()).toMatchObject({
      code: 'policy_restricted',
      params: { reason: 'minor_platform_only' },
    });
    const evs = events((await call('POST', '/ai/chat', teen, { message: 'hi', context: {} })).body);
    const [conv] = await withSystem(database.db, (tx) =>
      tx
        .select()
        .from(aiConversations)
        .where(eq(aiConversations.id, String(evs[0]?.data.conversationId))),
    );
    const daysLeft = ((conv?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(29.9);
    expect(daysLeft).toBeLessThan(30.1);
  });
});

describe('back office', () => {
  it('reports usage per provider and model with cost from prices', async () => {
    const admin = await staff();
    await call('PUT', '/admin/ai/providers/platform', admin, {
      enabled: true,
      priceInIrr: 1_000_000,
      priceOutIrr: 2_000_000,
    });
    const report = (await call('GET', '/admin/ai/usage?days=1', admin)).json<AiUsageReport>();
    const platform = report.rows.find((r) => r.provider === 'platform');
    expect(platform?.requests).toBeGreaterThan(0);
    expect(platform?.costIrr).toBe(platform ? platform.tokensIn + 2 * platform.tokensOut : -1);
  });

  it('switches the platform model off', async () => {
    const admin = await staff();
    await call('PUT', '/admin/ai/providers/platform', admin, { enabled: false });
    try {
      const res = await call('POST', '/ai/chat', person('off'), { message: 'hi', context: {} });
      expect(res.json<ProblemDetails>().params).toMatchObject({ reason: 'provider_disabled' });
    } finally {
      await call('PUT', '/admin/ai/providers/platform', admin, { enabled: true });
    }
  });
});
