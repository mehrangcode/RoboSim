import { z } from 'zod';
import { errorCodeSchema } from './errors.js';

/** Build service contract (API Spec §4.5, Technical Design §6). Shared by the API, the compiler and the web client. */

export const BUILD_LIMITS = {
  maxFiles: 20,
  maxTotalBytes: 100 * 1024,
  /** Wall-clock budget for one build, preprocessing to HEX. */
  timeoutMs: 30_000,
} as const;

/** Sketch file names: flat, no paths, Arduino sketch extensions only. */
export const BUILD_FILE_NAME = /^[A-Za-z0-9_-]+\.(ino|h|hpp|c|cpp)$/;

export const BUILD_BOARDS = ['avr-uno'] as const;
export const buildBoardSchema = z.enum(BUILD_BOARDS);
export type BuildBoard = z.infer<typeof buildBoardSchema>;

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

export const buildFileSchema = z.strictObject({
  name: z.string().regex(BUILD_FILE_NAME, 'invalid file name'),
  // Security §5: null bytes are rejected (they truncate paths and confuse tools).
  content: z.string().refine((c) => !c.includes('\0'), 'null bytes are not allowed'),
});

export const buildLibrarySchema = z.strictObject({
  name: z.string().min(1).max(64),
  version: z.string().min(1).max(32),
});
export type BuildLibrary = z.infer<typeof buildLibrarySchema>;

export const buildRequestSchema = z
  .strictObject({
    board: buildBoardSchema,
    files: z.array(buildFileSchema).min(1).max(BUILD_LIMITS.maxFiles),
    libraries: z.array(buildLibrarySchema).max(32).default([]),
    projectId: z.string().optional(),
  })
  .superRefine((req, ctx) => {
    const names = new Set<string>();
    for (const [i, f] of req.files.entries()) {
      // Names are case-insensitive on some hosts; two files differing only in case would collide.
      const key = f.name.toLowerCase();
      if (names.has(key))
        ctx.addIssue({ code: 'custom', path: ['files', i, 'name'], message: 'duplicate file name' });
      names.add(key);
    }
    if (!req.files.some((f) => f.name.endsWith('.ino')))
      ctx.addIssue({ code: 'custom', path: ['files'], message: 'a sketch needs at least one .ino file' });
    const total = req.files.reduce((n, f) => n + utf8Bytes(f.name) + utf8Bytes(f.content), 0);
    if (total > BUILD_LIMITS.maxTotalBytes)
      ctx.addIssue({
        code: 'custom',
        path: ['files'],
        message: `sources exceed ${BUILD_LIMITS.maxTotalBytes} bytes`,
      });
  });
export type BuildRequest = z.infer<typeof buildRequestSchema>;
export type BuildRequestInput = z.input<typeof buildRequestSchema>;

export const diagnosticSeveritySchema = z.enum(['error', 'warning', 'note']);
export type DiagnosticSeverity = z.infer<typeof diagnosticSeveritySchema>;

export const buildDiagnosticSchema = z.strictObject({
  /** User file name, `''` for diagnostics without a source location (linker, size). */
  file: z.string(),
  /** 1-based; 0 when unknown. */
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  severity: diagnosticSeveritySchema,
  message: z.string(),
  /** i18n key under `build:explain.*` (FR-COD-03). */
  explanationKey: z.string().optional(),
});
export type BuildDiagnostic = z.infer<typeof buildDiagnosticSchema>;

export const buildArtifactSchema = z.strictObject({
  id: z.string(),
  format: z.enum(['ihex', 'uf2']),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  flashPct: z.number().nonnegative(),
  ramPct: z.number().nonnegative(),
  url: z.string(),
});
export type BuildArtifact = z.infer<typeof buildArtifactSchema>;

export const buildResultSchema = z.strictObject({
  buildId: z.string(),
  status: z.enum(['succeeded', 'failed']),
  cacheHit: z.boolean(),
  artifact: buildArtifactSchema.optional(),
  diagnostics: z.array(buildDiagnosticSchema),
  durationMs: z.number().nonnegative(),
});
export type BuildResult = z.infer<typeof buildResultSchema>;

export const BUILD_JOB_STATES = ['queued', 'running', 'succeeded', 'failed', 'error'] as const;
export const buildJobStateSchema = z.enum(BUILD_JOB_STATES);
export type BuildJobState = z.infer<typeof buildJobStateSchema>;

/**
 * A queued build as `GET /builds/:id` returns it, and the `data` of every SSE event on `/builds/:id/events` (the
 * event name is `state`). `position` is set while queued, `result` once the build `succeeded` or `failed` (a compile
 * error is a result), `error` when the service could not build at all.
 */
export const buildStatusSchema = z.strictObject({
  buildId: z.string(),
  state: buildJobStateSchema,
  position: z.number().int().positive().optional(),
  result: buildResultSchema.optional(),
  error: z.strictObject({ code: errorCodeSchema }).optional(),
});
export type BuildStatus = z.infer<typeof buildStatusSchema>;

/**
 * `202 Accepted` from `POST /builds` when the sources are not in the cache: the job's status (usually `queued` with
 * its position) plus where to follow it, `statusUrl` (poll) and `eventsUrl` (SSE). A cache hit answers
 * `200 BuildResult` instead.
 */
export const buildAcceptedSchema = buildStatusSchema.extend({ statusUrl: z.string(), eventsUrl: z.string() });
export type BuildAccepted = z.infer<typeof buildAcceptedSchema>;

export const isTerminalBuildState = (state: BuildJobState): boolean =>
  state === 'succeeded' || state === 'failed' || state === 'error';
