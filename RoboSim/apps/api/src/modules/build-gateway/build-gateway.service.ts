import { Compiler, DEFAULT_CACHE_DIR, ToolchainError } from '@robosim/compiler';
import { DomainError, uuidv7, type BuildRequest, type BuildResult } from '@robosim/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';

export const ARTIFACT_PATH = '/api/v1/artifacts';

/**
 * Build gateway (Technical Design §6), thin vertical: synchronous builds through the local sandboxed compiler.
 * Queueing, SSE progress, object storage and quotas arrive with Redis/MinIO.
 */
@Injectable()
export class BuildGatewayService {
  private readonly logger = new Logger(BuildGatewayService.name);
  private compiler: Promise<Compiler> | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async build(request: BuildRequest): Promise<BuildResult> {
    const compiler = await this.ready();
    const out = await compiler.build(request);
    const size = out.artifact?.size;
    return {
      buildId: uuidv7(),
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

  /** Firmware by content address, or undefined. */
  async artifact(id: string): Promise<string | undefined> {
    return (await this.ready()).readArtifact(id);
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
