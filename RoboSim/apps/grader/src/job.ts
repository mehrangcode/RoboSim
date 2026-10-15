import { MAX_SIM_SECONDS, SCENARIOS, type GradeJob } from '@robosim/sim-runtime';
import { z } from 'zod';

const entry = z.discriminatedUnion('kind', [
  z.strictObject({
    slice: z.int().nonnegative(),
    kind: z.literal('component'),
    componentId: z.string().min(1),
    name: z.string().min(1),
    value: z.union([z.number(), z.boolean()]),
  }),
  z.strictObject({ slice: z.int().nonnegative(), kind: z.literal('serial'), text: z.string() }),
]);

/** An exported input log (Lab "Export input log"); the project document is validated by the loader. */
const inputLog = z.strictObject({
  engineVersion: z.string().min(1),
  scenario: z.enum(SCENARIOS).nullable(),
  project: z.record(z.string(), z.unknown()),
  firmware: z.strictObject({ format: z.literal('ihex'), text: z.string().min(1), sha256: z.string().min(1) }),
  seed: z.int().min(0).max(0xffff_ffff),
  entries: z.array(entry),
  endSlice: z.int().nonnegative().optional(),
});

const maxSimSeconds = z.number().positive().max(MAX_SIM_SECONDS);

export const gradeJobSchema = z.strictObject({ log: inputLog, maxSimSeconds });

/**
 * Accepts a grade job, or a bare input log graded for `defaultMaxSimSeconds`. Throws a `ZodError`
 * listing every problem.
 */
export function parseGradeJob(json: unknown, defaultMaxSimSeconds = MAX_SIM_SECONDS): GradeJob {
  const job =
    json !== null && typeof json === 'object' && 'entries' in json
      ? { log: json, maxSimSeconds: defaultMaxSimSeconds }
      : json;
  // `project` stays opaque here: the loader validates and migrates it (any schemaVersion it knows).
  return gradeJobSchema.parse(job) as unknown as GradeJob;
}
