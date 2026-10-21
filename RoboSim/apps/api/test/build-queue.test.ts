import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainError, type BuildResult, type BuildStatus } from '@robosim/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { FsArtifactStore } from '../src/modules/build-gateway/artifact-store.js';
import { DailyBuildQuota } from '../src/modules/build-gateway/build-quota.js';
import {
  InProcessBuildQueue,
  type BuildJob,
  type InProcessBuildQueueOptions,
} from '../src/modules/build-gateway/build-queue.js';

const request = { board: 'avr-uno' as const, files: [{ name: 's.ino', content: '' }], libraries: [] };
const result = (buildId: string, status: 'succeeded' | 'failed' = 'succeeded'): BuildResult => ({
  buildId,
  status,
  cacheHit: false,
  diagnostics: [],
  durationMs: 1,
});

/** A runner whose builds finish only when the test says so, recording dispatch order. */
function controlledRunner() {
  const pending = new Map<string, { resolve: (r: BuildResult) => void; reject: (e: unknown) => void }>();
  const started: string[] = [];
  const runner = (job: BuildJob) =>
    new Promise<BuildResult>((resolve, reject) => {
      started.push(job.buildId);
      pending.set(job.buildId, { resolve, reject });
    });
  const finish = async (id: string, status: 'succeeded' | 'failed' = 'succeeded') => {
    pending.get(id)?.resolve(result(id, status));
    pending.delete(id);
    await new Promise((r) => setTimeout(r, 0));
  };
  const fail = async (id: string, error: unknown) => {
    pending.get(id)?.reject(error);
    pending.delete(id);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { runner, started, finish, fail };
}

const job = (buildId: string, workspaceId: string, userId = `${workspaceId}-u`, priority = 1): BuildJob => ({
  buildId,
  owner: { userId, workspaceId },
  request,
  priority,
});

function queue(options: Partial<InProcessBuildQueueOptions> & Pick<InProcessBuildQueueOptions, 'runner'>) {
  return new InProcessBuildQueue({ slots: 1, userConcurrency: 2, ttlMs: 60_000, ...options });
}

describe('InProcessBuildQueue (TD §6 fair share)', () => {
  it('runs a job and reports queued → running → succeeded with increasing sequence numbers', async () => {
    const c = controlledRunner();
    const q = queue({ runner: c.runner, slots: 1 });
    q.submit(job('a', 'w1'));
    const second = q.submit(job('b', 'w1'));
    expect(second).toEqual({ buildId: 'b', state: 'queued', position: 1 });
    const seen: [BuildStatus['state'], number][] = [];
    q.subscribe('b', (s, seq) => seen.push([s.state, seq]));
    await c.finish('a');
    await c.finish('b');
    expect(seen.map(([s]) => s)).toEqual(['running', 'succeeded']);
    expect(seen.map(([, n]) => n)).toEqual([...seen.map(([, n]) => n)].sort((x, y) => x - y));
    expect(q.get('b')?.status.result?.status).toBe('succeeded');
  });

  it('serves workspaces round-robin, so one flooding workspace cannot starve another', async () => {
    const c = controlledRunner();
    const q = queue({ runner: c.runner, slots: 1, userConcurrency: 10 });
    for (const id of ['a1', 'a2', 'a3', 'a4']) q.submit(job(id, 'A'));
    q.submit(job('b1', 'B'));
    q.submit(job('b2', 'B'));
    expect(q.get('b1')?.status.position).toBe(2); // a2 is next, then B's turn
    for (let i = 0; i < 6; i++) await c.finish(c.started[i] as string);
    expect(c.started).toEqual(['a1', 'a2', 'b1', 'a3', 'b2', 'a4']);
  });

  it('weights turns by build.priority', async () => {
    const c = controlledRunner();
    const q = queue({ runner: c.runner, slots: 1, userConcurrency: 10 });
    q.submit(job('x0', 'X')); // occupies the slot
    for (const id of ['a1', 'a2', 'a3', 'a4']) q.submit(job(id, 'A', 'A-u', 2));
    for (const id of ['b1', 'b2']) q.submit(job(id, 'B'));
    for (let i = 0; i < 7; i++) await c.finish(c.started[i] as string);
    expect(c.started).toEqual(['x0', 'a1', 'a2', 'b1', 'a3', 'a4', 'b2']);
  });

  it('runs at most userConcurrency builds per user and lets other users use the free slots', async () => {
    const c = controlledRunner();
    const q = queue({ runner: c.runner, slots: 4, userConcurrency: 2 });
    for (const id of ['u1', 'u2', 'u3']) q.submit(job(id, 'W', 'alice'));
    q.submit(job('v1', 'W', 'bob'));
    expect(c.started).toEqual(['u1', 'u2', 'v1']);
    expect(q.get('u3')?.status.state).toBe('queued');
    await c.finish('u1');
    expect(c.started).toContain('u3');
  });

  it('updates the positions of waiting jobs as the queue moves', async () => {
    const c = controlledRunner();
    const q = queue({ runner: c.runner, slots: 1 });
    q.submit(job('a', 'W'));
    q.submit(job('b', 'W'));
    q.submit(job('c', 'W'));
    const positions: (number | undefined)[] = [];
    q.subscribe('c', (s) => positions.push(s.position));
    expect(q.get('c')?.status.position).toBe(2);
    await c.finish('a');
    await c.finish('b');
    expect(positions).toEqual([1, undefined]);
  });

  it('retries a crashed build once, then reports internal_error', async () => {
    const c = controlledRunner();
    const errors: number[] = [];
    const q = queue({ runner: c.runner, onRunnerError: (_j, _e, attempt) => errors.push(attempt) });
    q.submit(job('a', 'W'));
    await c.fail('a', new Error('sandbox died'));
    expect(q.get('a')?.status.state).toBe('running');
    await c.fail('a', new Error('sandbox died again'));
    expect(q.get('a')?.status).toEqual({ buildId: 'a', state: 'error', error: { code: 'internal_error' } });
    expect(errors).toEqual([1, 2]);
  });

  it('does not retry when the toolchain is missing', async () => {
    const c = controlledRunner();
    const q = queue({ runner: c.runner });
    q.submit(job('a', 'W'));
    await c.fail('a', new DomainError('compiler_unavailable'));
    expect(q.get('a')?.status.error).toEqual({ code: 'compiler_unavailable' });
    expect(c.started).toEqual(['a']);
  });

  it('forgets finished jobs after the TTL, but never queued or running ones', async () => {
    const c = controlledRunner();
    let now = 0;
    const q = queue({ runner: c.runner, ttlMs: 1000, now: () => now });
    q.submit(job('a', 'W'));
    q.submit(job('b', 'W'));
    now = 5000;
    expect(q.get('a')).toBeDefined();
    await c.finish('a');
    now = 5999;
    expect(q.get('a')).toBeDefined();
    now = 6000;
    expect(q.get('a')).toBeUndefined();
    expect(q.get('b')?.status.state).toBe('running');
  });
});

describe('DailyBuildQuota', () => {
  it('counts builds per key per UTC day and refills at midnight UTC', () => {
    const quota = new DailyBuildQuota(2);
    const noon = Date.UTC(2026, 9, 21, 12);
    expect(quota.take('u', noon).remaining).toBe(1);
    expect(quota.take('u', noon).allowed).toBe(true);
    const third = quota.take('u', noon);
    expect(third).toMatchObject({ allowed: false, limit: 2, remaining: 0 });
    expect(third.resetAt.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(quota.take('other', noon).allowed).toBe(true);
    expect(quota.take('u', Date.UTC(2026, 9, 22, 0, 0, 1)).allowed).toBe(true);
  });
});

describe('FsArtifactStore', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it('stores firmware by sha256 and refuses other ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'robosim-artifacts-'));
    dirs.push(dir);
    const store = new FsArtifactStore(join(dir, 'nested'));
    const sha = 'a'.repeat(64);
    expect(await store.get(sha)).toBeUndefined();
    await store.put(sha, ':00000001FF\n');
    await store.put(sha, ':00000001FF\n');
    expect(await store.get(sha)).toBe(':00000001FF\n');
    expect(await store.has('../../etc/passwd')).toBe(false);
    await expect(store.put('nope', '')).rejects.toThrow(/sha256/);
  });
});
