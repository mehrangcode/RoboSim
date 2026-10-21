import { z } from 'zod';

/**
 * Project document (Technical Design §8.10): what the editors save, the build service compiles, and
 * the simulator loads. Versioned by `schemaVersion`; older documents are upgraded by pure forward
 * migrations before validation.
 *
 * Units: positions in mm, angles in degrees (editor-friendly); the loader converts them.
 */

export const PROJECT_SCHEMA_VERSION = 3;

const id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, 'ids start with a letter: letters, digits, _ or -');
const finite = z.number().finite();

/** The board itself is addressed as part `board` (header pins: D13, A0, 5V, GND1…). */
export const BOARD_PART = 'board';

export const pinRefSchema = z.strictObject({ part: z.string().min(1), pin: z.string().min(1) });
export type PinRef = z.infer<typeof pinRefSchema>;

const mountSchema = z.strictObject({ x: finite, y: finite, z: finite, yaw: finite });

export const componentInstanceSchema = z.strictObject({
  id: id.refine((v) => v !== BOARD_PART, `'${BOARD_PART}' is reserved for the board`),
  type: z.string().min(1),
  typeVersion: z.string().min(1),
  x: finite,
  y: finite,
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flipped: z.boolean(),
  props: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])),
  /** Interaction state at power-on (a switch left ON, a knob position); not part of the input log. */
  inputs: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
  /** Pose on the robot chassis (mm, degrees), robot frame: +x forward, +y left. */
  mount: mountSchema.optional(),
  /** Legs plugged into another part's holes (a breadboard): own pin → that part's pin. Since v2. */
  seats: z.record(z.string().min(1), pinRefSchema).optional(),
});
export type ComponentInstance = z.infer<typeof componentInstanceSchema>;

export const wireSchema = z.strictObject({
  id,
  from: pinRefSchema,
  to: pinRefSchema,
  color: z.string().min(1),
  points: z.array(z.tuple([finite, finite])),
});
export type Wire = z.infer<typeof wireSchema>;

const goal = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('reachZone'), zone: z.string().min(1) }),
  z.strictObject({ type: z.literal('laps'), count: z.number().int().positive() }),
  z.strictObject({ type: z.literal('checkpointsInOrder'), zones: z.array(z.string().min(1)).min(1) }),
  z.strictObject({
    type: z.literal('serialMatches'),
    pattern: z.string().min(1).max(200),
    ignoreCase: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('pinState'),
    pin: z.string().min(1),
    level: z.union([z.literal(0), z.literal(1)]),
    forS: z.number().nonnegative().optional(),
  }),
  z.strictObject({ type: z.literal('pushOut'), object: z.string().min(1), zone: z.string().min(1) }),
  z.strictObject({ type: z.literal('timeLimit'), seconds: z.number().positive() }),
  z.strictObject({ type: z.literal('noCollision'), tolerance: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('onLineRatio'), min: z.number().min(0).max(1) }),
  z.strictObject({ type: z.literal('stayInZone'), zone: z.string().min(1) }),
]);

export type ConditionDoc =
  z.infer<typeof goal> | { all: ConditionDoc[] } | { any: ConditionDoc[] } | { not: ConditionDoc };

export const conditionSchema: z.ZodType<ConditionDoc> = z.lazy(() =>
  z.union([
    goal,
    z.strictObject({ all: z.array(conditionSchema).min(1) }),
    z.strictObject({ any: z.array(conditionSchema).min(1) }),
    z.strictObject({ not: conditionSchema }),
  ]),
);

const weight = z.number().nonnegative();
export const successConditionsSchema = z.strictObject({
  id,
  condition: conditionSchema,
  score: z
    .array(
      z.discriminatedUnion('type', [
        z.strictObject({ type: z.literal('laps'), weight }),
        z.strictObject({ type: z.literal('checkpoints'), weight }),
        z.strictObject({ type: z.literal('timeBonus'), under: z.number().positive(), weight }),
        z.strictObject({ type: z.literal('onLineRatio'), weight }),
        z.strictObject({ type: z.literal('noCollision'), weight }),
      ]),
    )
    .optional(),
});

export const projectDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    board: z.strictObject({
      id: z.string().min(1),
      version: z.string().min(1),
      /** Pose on the robot chassis, like a component's `mount`. Since v3. */
      mount: mountSchema.optional(),
    }),
    components: z.array(componentInstanceSchema),
    wires: z.array(wireSchema),
    code: z.strictObject({
      language: z.enum(['cpp', 'blocks']),
      files: z.array(z.strictObject({ name: z.string().min(1), content: z.string() })),
      blocksXml: z.string().optional(),
    }),
    libraries: z.array(z.strictObject({ name: z.string().min(1), version: z.string().min(1) })),
    /** Bench projects have no arena. */
    arena: z
      .strictObject({
        arenaVersionId: z.string().min(1),
        startPose: z.strictObject({ x: finite, y: finite, heading: finite }),
      })
      .optional(),
    successConditions: successConditionsSchema.optional(),
    meta: z.strictObject({ title: z.string().min(1).max(200), description: z.string().max(5000).optional() }),
  })
  .superRefine((doc, ctx) => {
    const unique = (ids: readonly string[], what: string, path: string) => {
      const seen = new Set<string>();
      ids.forEach((v, i) => {
        if (seen.has(v))
          ctx.addIssue({ code: 'custom', message: `duplicate ${what} id '${v}'`, path: [path, i, 'id'] });
        seen.add(v);
      });
    };
    unique(
      doc.components.map((c) => c.id),
      'component',
      'components',
    );
    unique(
      doc.wires.map((w) => w.id),
      'wire',
      'wires',
    );
    const parts = new Set([BOARD_PART, ...doc.components.map((c) => c.id)]);
    doc.wires.forEach((w, i) => {
      for (const end of ['from', 'to'] as const)
        if (!parts.has(w[end].part))
          ctx.addIssue({
            code: 'custom',
            message: `unknown part '${w[end].part}'`,
            path: ['wires', i, end, 'part'],
          });
    });
    doc.components.forEach((c, i) => {
      for (const [pin, hole] of Object.entries(c.seats ?? {})) {
        if (!parts.has(hole.part) || hole.part === BOARD_PART || hole.part === c.id)
          ctx.addIssue({
            code: 'custom',
            message: `pin '${pin}' cannot be seated in part '${hole.part}'`,
            path: ['components', i, 'seats', pin, 'part'],
          });
      }
    });
    if (doc.successConditions && !doc.arena) {
      const needsArena = JSON.stringify(doc.successConditions.condition).match(
        /"type":"(reachZone|laps|checkpointsInOrder|pushOut|stayInZone|noCollision|onLineRatio)"/,
      );
      if (needsArena)
        ctx.addIssue({
          code: 'custom',
          message: `condition '${needsArena[1]}' needs an arena`,
          path: ['successConditions'],
        });
    }
  });

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;

/** Upgrades a document of version `n` to `n + 1`. Pure; add one per schema change. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;
export const PROJECT_MIGRATIONS: Readonly<Record<number, Migration>> = {
  /** v2 adds optional `components[].seats`; v1 documents are valid as they are. */
  1: (doc) => doc,
  /** v3 adds optional `board.mount`; v2 documents are valid as they are. */
  2: (doc) => doc,
};

export class ProjectDocumentError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid project document: ${issues.join('; ')}`);
    this.name = 'ProjectDocumentError';
  }
}

/** Applies forward migrations until `doc.schemaVersion === target`. */
export function migrateDocument(
  input: unknown,
  target: number = PROJECT_SCHEMA_VERSION,
  migrations: Readonly<Record<number, Migration>> = PROJECT_MIGRATIONS,
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new ProjectDocumentError(['document must be an object']);
  let doc = input as Record<string, unknown>;
  let version = doc['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new ProjectDocumentError(['schemaVersion must be a positive integer']);
  if (version > target)
    throw new ProjectDocumentError([`schemaVersion ${version} is newer than this app supports (${target})`]);
  while (version < target) {
    const migrate = migrations[version];
    if (!migrate) throw new ProjectDocumentError([`no migration from schemaVersion ${version}`]);
    doc = { ...migrate(doc), schemaVersion: version + 1 };
    version += 1;
  }
  return doc;
}

/** Migrates to the current schema version, then validates. Throws {@link ProjectDocumentError}. */
export function parseProjectDocument(input: unknown): ProjectDocument {
  const result = projectDocumentSchema.safeParse(migrateDocument(input));
  if (!result.success)
    throw new ProjectDocumentError(
      result.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`),
    );
  return result.data;
}
