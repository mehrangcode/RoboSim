import { z } from 'zod';

/**
 * Guided projects (FR-LRN-01, US-LRN-01, API Spec §4.6): step-by-step builds whose steps are checked live
 * against the learner's project. Checks are declarative data so content can later be authored in the CMS
 * (FR-ADM-04) without code; the browser evaluates them, the server only stores progress.
 */

export const localizedTextSchema = z.strictObject({ en: z.string().min(1), fa: z.string().min(1) });
export type LocalizedText = z.infer<typeof localizedTextSchema>;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'invalid slug');
const stepId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/, 'invalid step id');
const partType = z.string().min(1).max(64);
const pinName = z.string().min(1).max(32);

/** A pin of any part of a catalogue type (learners pick their own part ids). */
export const guidedPinSchema = z.strictObject({ type: partType, pin: pinName });
export type GuidedPin = z.infer<typeof guidedPinSchema>;

/** Board pin groups a part pin can be asked to reach. */
export const GUIDED_PIN_KINDS = ['pwm', 'digital', 'analog', 'ground', '5v'] as const;
export type GuidedPinKind = (typeof GUIDED_PIN_KINDS)[number];

/**
 * Sketch calls a code check can ask for (subset of the code-analysis pin uses): `servo` is
 * `Servo.attach(pin)`, `dht` a `DHT name(pin, type)` sensor object.
 */
export const GUIDED_CODE_USES = [
  'pinMode',
  'digitalWrite',
  'digitalRead',
  'analogWrite',
  'analogRead',
  'servo',
  'dht',
] as const;
export type GuidedCodeUse = (typeof GUIDED_CODE_USES)[number];

export const guidedCheckSchema = z.discriminatedUnion('kind', [
  /**
   * At least `count` parts of `type`; with `onRobot`, each of them mounted on the chassis; with
   * `onServo`, mounted on a servo horn (implies `onRobot`).
   */
  z.strictObject({
    kind: z.literal('part'),
    type: partType,
    count: z.number().int().min(1).max(8).default(1),
    onRobot: z.boolean().default(false),
    onServo: z.boolean().default(false),
  }),
  /** Some part of `type` has `prop` set to `equals`. */
  z.strictObject({
    kind: z.literal('prop'),
    type: partType,
    prop: z.string().min(1).max(32),
    equals: z.union([z.string(), z.number(), z.boolean()]),
  }),
  /** The two pins are on one net (wire, breadboard strip or the board's joined GND pins). */
  z.strictObject({ kind: z.literal('connected'), a: guidedPinSchema, b: guidedPinSchema }),
  /** The pin reaches a board pin of `pinKind` (e.g. ENA on a PWM pin). */
  z.strictObject({ kind: z.literal('boardPin'), pin: guidedPinSchema, pinKind: z.enum(GUIDED_PIN_KINDS) }),
  /** The sketch makes a `use` call on the board pin that `at` is wired to. */
  z.strictObject({ kind: z.literal('code'), use: z.enum(GUIDED_CODE_USES), at: guidedPinSchema }),
  /** A run of this project met its success condition. */
  z.strictObject({ kind: z.literal('run') }),
]);
export type GuidedCheck = z.output<typeof guidedCheckSchema>;
export type GuidedCheckInput = z.input<typeof guidedCheckSchema>;

/** Why a check fails; each reason has a generic hint (i18n `guided:reason.*`) a step may override. */
export const GUIDED_FAIL_REASONS = [
  'missingPart',
  'notOnRobot',
  'notOnServo',
  'propMismatch',
  'notConnected',
  'notOnBoard',
  'wrongPinKind',
  'codeMissing',
  'codeUnavailable',
  'notRun',
] as const;
export type GuidedFailReason = (typeof GUIDED_FAIL_REASONS)[number];

export const guidedStepSchema = z.strictObject({
  id: stepId,
  title: localizedTextSchema,
  /** Markdown subset: paragraphs, **bold**, *italic*, `code`, lists, images `![alt](asset:name)`. */
  body: localizedTextSchema,
  /** None: a reading step the learner confirms with "Next". */
  checks: z.array(guidedCheckSchema).max(16).default([]),
  /** Step-specific hints that replace the generic one for a reason. */
  hints: z.partialRecord(z.enum(GUIDED_FAIL_REASONS), localizedTextSchema).default({}),
  /** Code shown behind "Reveal solution" (code steps). */
  solution: z.string().max(4000).optional(),
});
export type GuidedStep = z.output<typeof guidedStepSchema>;
export type GuidedStepInput = z.input<typeof guidedStepSchema>;

/** `<slug>@<version>`: what progress is recorded against (API Spec `contentVersionId`). */
export const contentVersionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}@[1-9][0-9]{0,5}$/);
export const contentVersionId = (slugValue: string, version: number): string => `${slugValue}@${version}`;

export const guidedSummarySchema = z.strictObject({
  slug,
  version: z.number().int().min(1),
  contentVersionId: contentVersionIdSchema,
  title: localizedTextSchema,
  summary: localizedTextSchema,
  minutes: z.number().int().min(1),
  /** Part of Free's `learning.guided_projects: first`; the rest need `all`. */
  free: z.boolean(),
  stepCount: z.number().int().min(1),
  /** Arena the robot runs in; null for bench projects (no robot). */
  arenaId: z.string().nullable(),
  /** Inline SVG for the card. */
  cover: z.string().optional(),
  /** The caller's plan does not include it: only the summary is returned. */
  locked: z.boolean(),
});
export type GuidedSummary = z.infer<typeof guidedSummarySchema>;

export const guidedProjectSchema = guidedSummarySchema.extend({
  steps: z.array(guidedStepSchema).min(1).max(40),
  /** Project document the learner starts from (validated with `parseProjectDocument`). */
  starter: z.unknown(),
  /** Inline SVG images referenced from step bodies as `asset:<name>`. */
  assets: z.record(z.string(), z.string()).default({}),
});
export type GuidedProject = z.output<typeof guidedProjectSchema>;

/** `GET /guided-projects/:slug`: the full project, or its summary when locked. */
export type GuidedProjectResponse = GuidedProject | GuidedSummary;
export const isGuidedProjectBody = (r: GuidedProjectResponse): r is GuidedProject => 'steps' in r;

export const guidedProgressSchema = z.strictObject({
  contentVersionId: contentVersionIdSchema,
  projectId: z.string().uuid().nullable(),
  /** Ids of steps the learner has completed at least once. */
  completedSteps: z.array(stepId).max(40),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type GuidedProgress = z.infer<typeof guidedProgressSchema>;

export const putGuidedProgressSchema = z.strictObject({
  projectId: z.string().uuid().nullable().optional(),
  completedSteps: z.array(stepId).max(40),
  /** Marks the project complete; completion is never undone. */
  completed: z.boolean().default(false),
});
export type PutGuidedProgressInput = z.input<typeof putGuidedProgressSchema>;

/** Link from a project document to the guided project it was started from. */
export const guidedRefSchema = z.strictObject({ slug, version: z.number().int().min(1) });
export type GuidedRef = z.infer<typeof guidedRefSchema>;
