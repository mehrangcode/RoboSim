import { blankProject } from '@robosim/circuit-canvas';
import {
  contentVersionId,
  guidedStepSchema,
  type GuidedProgress,
  type GuidedProject,
  type GuidedProjectResponse,
  type GuidedStepInput,
  type GuidedSummary,
  type PutGuidedProgressInput,
} from '@robosim/shared';
import type { LearningClient } from '../lib/learning-api.js';

const text = (en: string, fa: string) => ({ en, fa });

const STEPS: GuidedStepInput[] = [
  {
    id: 'intro',
    title: text('Meet your robot', 'با ربات آشنا شو'),
    body: text('Read **this** first.', 'اول **این** را بخوان.'),
  },
  {
    id: 'speed',
    title: text('Speed pin on PWM', 'پایهٔ سرعت روی PWM'),
    body: text('Connect IN1 to a PWM pin.', 'IN1 را به یک پایهٔ PWM وصل کن.'),
    checks: [{ kind: 'boardPin', pin: { type: 'driver.l298n', pin: 'in1' }, pinKind: 'pwm' }],
  },
  {
    id: 'run',
    title: text('Run a lap', 'یک دور بزن'),
    body: text('Press **Run**.', '**اجرا** را بزن.'),
    checks: [{ kind: 'run' }],
  },
];

/** A three-step guided project like the real ones: read, wire IN1 to PWM (US-LRN-01 AC1), run. */
export function fakeGuided(slug = 'line-follower', free = true): GuidedProject {
  return {
    slug,
    version: 1,
    contentVersionId: contentVersionId(slug, 1),
    title: text(`Robot ${slug}`, `ربات ${slug}`),
    summary: text('Build a robot.', 'یک ربات بساز.'),
    minutes: 30,
    free,
    stepCount: STEPS.length,
    arenaId: 'oval',
    locked: false,
    steps: STEPS.map((s) => guidedStepSchema.parse(s)),
    starter: {
      ...blankProject(`Robot ${slug}`, 'void setup() {}\nvoid loop() {}\n'),
      guided: { slug, version: 1 },
    },
    assets: {},
  };
}

const summaryOf = (
  { steps: _s, starter: _d, assets: _a, ...summary }: GuidedProject,
  locked: boolean,
): GuidedSummary => ({
  ...summary,
  locked,
});

/** In-memory guided projects: `locked` slugs answer with their summary only; progress writes are recorded. */
export class FakeLearning implements LearningClient {
  projects: GuidedProject[] = [fakeGuided('line-follower'), fakeGuided('obstacle-avoider', false)];
  locked = new Set<string>(['obstacle-avoider']);
  rows: GuidedProgress[] = [];
  readonly puts: { id: string; input: PutGuidedProgressInput }[] = [];

  list = () => Promise.resolve(this.projects.map((p) => summaryOf(p, this.locked.has(p.slug))));
  get = (slug: string): Promise<GuidedProjectResponse> => {
    const p = this.projects.find((x) => x.slug === slug);
    if (!p) return Promise.reject(new Error('not found'));
    return Promise.resolve(this.locked.has(slug) ? summaryOf(p, true) : p);
  };
  progress = () => Promise.resolve(this.rows);
  putProgress = (id: string, input: PutGuidedProgressInput) => {
    this.puts.push({ id, input });
    const before = this.rows.find((r) => r.contentVersionId === id);
    const row: GuidedProgress = {
      contentVersionId: id,
      projectId: input.projectId ?? before?.projectId ?? null,
      completedSteps: [...new Set([...(before?.completedSteps ?? []), ...input.completedSteps])],
      completedAt: before?.completedAt ?? (input.completed ? '2026-10-26T10:00:00.000Z' : null),
      updatedAt: '2026-10-26T10:00:00.000Z',
    };
    this.rows = [...this.rows.filter((r) => r !== before), row];
    return Promise.resolve(row);
  };
}
