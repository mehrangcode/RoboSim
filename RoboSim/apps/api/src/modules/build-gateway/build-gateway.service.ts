import { dirname, join } from 'node:path';
import { Compiler, DEFAULT_CACHE_DIR, ToolchainError, type CompileOutput } from '@robosim/compiler';
import {
  DomainError,
  isTerminalBuildState,
  uuidv7,
  type BuildRequest,
  type BuildResult,
  type BuildStatus,
} from '@robosim/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { FsArtifactStore, type ArtifactStore } from './artifact-store.js';
import {
  InProcessBuildQueue,
  type BuildJob,
  type BuildListener,
  type BuildOwner,
  type BuildQueue,
} from './build-queue.js';

export const ARTIFACT_PATH = '/api/v1/artifacts';
export const BUILDS_PATH = '/api/v1/builds';

/** Finished jobs stay readable (status, SSE) this long; the result itself stays in the compiler cache. */
const JOB_TTL_MS = 60 * 60 * 1000;

/**
 * Build gateway (Technical Design §6): cache hits answer at once; misses go through the fair-share queue to the
 * local sandboxed compiler, and their firmware lands in the artifact store. Queue and store are ports with
 * in-process / filesystem adapters until Redis and object storage arrive with the deployment track.
 */
@Injectable()
export class BuildGatewayService {
  private readonly logger = new Logger(BuildGatewayService.name);
  private compiler: Promise<Compiler> | undefined;
  private readonly queue: BuildQueue;
  private readonly store: ArtifactStore;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.store = new FsArtifactStore(env.ARTIFACT_STORE_DIR ?? join(dirname(DEFAULT_CACHE_DIR), 'artifacts'));
    this.queue = new InProcessBuildQueue({
      runner: (job) => this.compile(job),
      slots: env.COMPILER_MAX_CONCURRENCY,
      userConcurrency: env.BUILD_USER_CONCURRENCY,
      ttlMs: JOB_TTL_MS,
      onRunnerError: (job, e, attempt) =>
        this.logger.error(`build ${job.buildId} attempt ${attempt} failed: ${(e as Error).message}`),
    });
  }

  /** The stored result for these sources, or undefined; throws `compiler_unavailable` without a toolchain. */
  async cached(request: BuildRequest): Promise<BuildResult | undefined> {
    const out = await (await this.ready()).cached(request);
    return out && this.publish(uuidv7(), out);
  }

  submit(owner: BuildOwner, request: BuildRequest): BuildStatus {
    // `build.priority` is 1 for everyone until plan entitlements land (P2).
    return this.queue.submit({ buildId: uuidv7(), owner, request, priority: 1 });
  }

  /** The job's latest status and event sequence, if `owner` submitted it; otherwise undefined (callers 404). */
  status(buildId: string, owner: BuildOwner): { status: BuildStatus; seq: number } | undefined {
    const job = this.queue.get(buildId);
    if (!job || job.owner.userId !== owner.userId) return undefined;
    return { status: job.status, seq: job.seq };
  }

  subscribe(buildId: string, listener: BuildListener): () => void {
    return this.queue.subscribe(buildId, listener);
  }

  /** Calls `fn` once with the job's final status. */
  onFinished(buildId: string, fn: (status: BuildStatus) => void): void {
    const off = this.queue.subscribe(buildId, (status) => {
      if (!isTerminalBuildState(status.state)) return;
      off();
      fn(status);
    });
  }

  /** Firmware by content address, or undefined. */
  artifact(id: string): Promise<string | undefined> {
    return this.store.get(id);
  }

  private async compile(job: BuildJob): Promise<BuildResult> {
    const out = await (await this.ready()).build(job.request);
    return this.publish(job.buildId, out);
  }

  /** Maps a compiler output to the API result, making sure its firmware is in the artifact store first. */
  private async publish(buildId: string, out: CompileOutput): Promise<BuildResult> {
    const size = out.artifact?.size;
    if (out.artifact && !(await this.store.has(out.artifact.sha256))) {
      const hex = await (await this.ready()).readArtifact(out.artifact.sha256);
      if (hex === undefined) throw new Error(`compiler artifact ${out.artifact.sha256} is missing`);
      await this.store.put(out.artifact.sha256, hex);
    }
    return {
      buildId,
      status: out.status,
      cacheHit: out.cacheHit,
      ...(out.artifact && size
        ? {
            artifact: {
              id: out.artifact.sha256,
              format: 'ihex' as const,
              sha256: out.artifact.sha256,
              sizeBytes: out.artifact.sizeBytes,
              flashPct: size.flashPct,
              ramPct: size.ramPct,
              url: `${ARTIFACT_PATH}/${out.artifact.sha256}`,
            },
          }
        : {}),
      diagnostics: [...out.diagnostics],
      durationMs: Math.round(out.durationMs),
    };
  }

  /** The compiler starts on first use, so the API boots (and its other routes work) without a toolchain. */
  private async ready(): Promise<Compiler> {
    this.compiler ??= Compiler.create({
      ...(this.env.COMPILER_TOOLCHAIN_DIR ? { toolchainDir: this.env.COMPILER_TOOLCHAIN_DIR } : {}),
      cacheDir: this.env.COMPILER_CACHE_DIR ?? DEFAULT_CACHE_DIR,
      sandbox: true,
      maxConcurrency: this.env.COMPILER_MAX_CONCURRENCY,
    });
    try {
      return await this.compiler;
    } catch (e) {
      this.compiler = undefined; // retry on the next request (e.g. after `pnpm compiler:setup`)
      this.logger.error(`compiler unavailable: ${(e as Error).message}`);
      if (e instanceof ToolchainError) throw new DomainError('compiler_unavailable');
      throw e;
    }
  }
}
