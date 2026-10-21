import { DomainError, type BuildRequest, type BuildResult, type BuildStatus } from '@robosim/shared';

/** Who a build belongs to: fair share is per workspace, concurrency per user, visibility per user. */
export interface BuildOwner {
  readonly userId: string;
  readonly workspaceId: string;
}

export interface BuildJob {
  readonly buildId: string;
  readonly owner: BuildOwner;
  readonly request: BuildRequest;
  /** `build.priority` entitlement: the workspace's DRR weight (≥ 1). */
  readonly priority: number;
}

/** Compiles one job; throws on a service failure (a compile error is a result). */
export type BuildRunner = (job: BuildJob) => Promise<BuildResult>;

export type BuildListener = (status: BuildStatus, seq: number) => void;

/**
 * The build queue port (Technical Design §6). The in-process adapter serves development and tests; a Redis-backed
 * adapter with the same contract arrives with the platform deployment track.
 */
export interface BuildQueue {
  /** Queues a job and returns its status right after (queued with a position, or already running). */
  submit(job: BuildJob): BuildStatus;
  /** The job's owner and latest status with its event sequence, until it expires after finishing. */
  get(buildId: string): { owner: BuildOwner; status: BuildStatus; seq: number } | undefined;
  /** Status changes of one job; returns the unsubscribe function. */
  subscribe(buildId: string, listener: BuildListener): () => void;
}

export interface InProcessBuildQueueOptions {
  readonly runner: BuildRunner;
  /** Builds running at once in this process. */
  readonly slots: number;
  /** Builds running at once per user (TD §6: 2). */
  readonly userConcurrency: number;
  /** How long a finished job stays readable. */
  readonly ttlMs: number;
  readonly now?: () => number;
  readonly onRunnerError?: (job: BuildJob, error: unknown, attempt: number) => void;
}

interface Record {
  readonly job: BuildJob;
  status: BuildStatus;
  seq: number;
  readonly listeners: Set<BuildListener>;
  expiresAt?: number;
}

interface WorkspaceQueue {
  weight: number;
  deficit: number;
  jobs: Record[];
}

/** Deficit-round-robin state: workspaces with queued jobs in ring order, and whose turn it is. */
interface Drr {
  ring: string[];
  queues: Map<string, WorkspaceQueue>;
  cursor: number;
  /** The workspace at `cursor` already got its quantum for this turn. */
  inTurn: boolean;
}

/**
 * Next job by deficit round robin across workspace queues (each job costs 1, a workspace earns its weight per turn,
 * unspent credit is capped at one quantum). `eligible` skips jobs whose user is at the concurrency limit. Mutates
 * `drr`; returns undefined when nothing eligible is queued.
 */
function drrNext(drr: Drr, eligible: (r: Record) => boolean): Record | undefined {
  for (let visits = 0; drr.ring.length > 0 && visits <= drr.ring.length * 2; visits++) {
    drr.cursor %= drr.ring.length;
    const ws = drr.ring[drr.cursor] as string;
    const q = drr.queues.get(ws) as WorkspaceQueue;
    if (!drr.inTurn) {
      q.deficit = Math.min(q.deficit + q.weight, q.weight);
      drr.inTurn = true;
    }
    if (q.deficit >= 1) {
      const index = q.jobs.findIndex(eligible);
      if (index >= 0) {
        const [picked] = q.jobs.splice(index, 1);
        q.deficit -= 1;
        if (q.jobs.length === 0) {
          // An emptied queue leaves the ring and forfeits its credit (classic DRR).
          drr.queues.delete(ws);
          drr.ring.splice(drr.cursor, 1);
          drr.inTurn = false;
        }
        return picked;
      }
    }
    drr.cursor++;
    drr.inTurn = false;
  }
  return undefined;
}

const cloneDrr = (drr: Drr): Drr => ({
  ring: [...drr.ring],
  queues: new Map([...drr.queues].map(([k, q]) => [k, { ...q, jobs: [...q.jobs] }])),
  cursor: drr.cursor,
  inTurn: drr.inTurn,
});

/**
 * In-process build queue: fair share across workspaces by deficit round robin weighted by `build.priority`, at most
 * `userConcurrency` running builds per user, `slots` per process. A runner failure is retried once (TD §6: "retry
 * once on a fresh sandbox"), then the job ends in `error: internal_error`; a missing toolchain ends it at once in
 * `error: compiler_unavailable`. Jobs live in memory, so a restart forgets them (clients see 404 and rebuild).
 */
export class InProcessBuildQueue implements BuildQueue {
  private readonly jobs = new Map<string, Record>();
  private readonly drr: Drr = { ring: [], queues: new Map(), cursor: 0, inTurn: false };
  private readonly runningPerUser = new Map<string, number>();
  private running = 0;
  private readonly now: () => number;

  constructor(private readonly options: InProcessBuildQueueOptions) {
    this.now = options.now ?? Date.now;
  }

  submit(job: BuildJob): BuildStatus {
    this.evict();
    const record: Record = {
      job,
      status: { buildId: job.buildId, state: 'queued', position: 1 },
      seq: 0,
      listeners: new Set(),
    };
    this.jobs.set(job.buildId, record);
    const ws = job.owner.workspaceId;
    let q = this.drr.queues.get(ws);
    if (!q) {
      q = { weight: 1, deficit: 0, jobs: [] };
      this.drr.queues.set(ws, q);
      this.drr.ring.push(ws);
    }
    q.weight = Math.max(1, Math.floor(job.priority));
    q.jobs.push(record);
    this.pump();
    this.refreshPositions();
    return record.status;
  }

  get(buildId: string): { owner: BuildOwner; status: BuildStatus; seq: number } | undefined {
    this.evict();
    const r = this.jobs.get(buildId);
    return r && { owner: r.job.owner, status: r.status, seq: r.seq };
  }

  subscribe(buildId: string, listener: BuildListener): () => void {
    const r = this.jobs.get(buildId);
    if (!r) return () => {};
    r.listeners.add(listener);
    return () => r.listeners.delete(listener);
  }

  /** Queued and running counts, for logs and tests. */
  get depth(): { queued: number; running: number } {
    let queued = 0;
    for (const q of this.drr.queues.values()) queued += q.jobs.length;
    return { queued, running: this.running };
  }

  private canRun = (r: Record): boolean =>
    (this.runningPerUser.get(r.job.owner.userId) ?? 0) < this.options.userConcurrency;

  private pump(): void {
    while (this.running < this.options.slots) {
      const next = drrNext(this.drr, this.canRun);
      if (!next) return;
      void this.start(next);
    }
  }

  private async start(r: Record): Promise<void> {
    const user = r.job.owner.userId;
    this.running++;
    this.runningPerUser.set(user, (this.runningPerUser.get(user) ?? 0) + 1);
    this.update(r, { buildId: r.job.buildId, state: 'running' });
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          const result = await this.options.runner(r.job);
          this.update(r, { buildId: r.job.buildId, state: result.status, result });
          break;
        } catch (e) {
          this.options.onRunnerError?.(r.job, e, attempt);
          const unavailable = e instanceof DomainError && e.code === 'compiler_unavailable';
          if (unavailable || attempt >= 2) {
            const code = unavailable ? 'compiler_unavailable' : 'internal_error';
            this.update(r, { buildId: r.job.buildId, state: 'error', error: { code } });
            break;
          }
        }
      }
    } finally {
      this.running--;
      const left = (this.runningPerUser.get(user) ?? 1) - 1;
      if (left > 0) this.runningPerUser.set(user, left);
      else this.runningPerUser.delete(user);
      r.expiresAt = this.now() + this.options.ttlMs;
      this.pump();
      this.refreshPositions();
    }
  }

  /** Positions are the order DRR would dispatch the queued jobs in now (ignoring per-user limits): an estimate. */
  private refreshPositions(): void {
    const sim = cloneDrr(this.drr);
    for (let position = 1; ; position++) {
      const r = drrNext(sim, () => true);
      if (!r) return;
      if (r.status.state === 'queued' && r.status.position !== position)
        this.update(r, { buildId: r.job.buildId, state: 'queued', position });
    }
  }

  private update(r: Record, status: BuildStatus): void {
    r.status = status;
    r.seq++;
    for (const listener of [...r.listeners]) listener(status, r.seq);
  }

  private evict(): void {
    const now = this.now();
    for (const [id, r] of this.jobs)
      if (r.expiresAt !== undefined && r.expiresAt <= now) this.jobs.delete(id);
  }
}
