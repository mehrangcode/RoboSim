import { UNO_PINS } from '@robosim/board-avr-uno/pins';
import {
  BOARD_PART,
  type GuidedCheck,
  type GuidedFailReason,
  type GuidedPin,
  type GuidedPinKind,
  type GuidedStep,
  type PinRef,
  type ProjectDocument,
} from '@robosim/shared';
import { CircuitNets } from './nets.js';

/**
 * Guided-project checks (FR-LRN-01, US-LRN-01) evaluated against the learner's document, the pin facts of
 * their sketch and whether a run succeeded. Pure, so the editor can re-check on every edit.
 */

/** Pin calls found in the sketch (the shape `@robosim/code-analysis` returns). */
export interface GuidedCodeFacts {
  readonly uses: readonly { readonly pin: string; readonly use: string }[];
}

export interface GuidedContext {
  readonly doc: ProjectDocument;
  /** Null while the analyser is loading or the sketch could not be analysed. */
  readonly code: GuidedCodeFacts | null;
  /** A run of this project met its success condition. */
  readonly runSucceeded: boolean;
}

export interface GuidedFailure {
  readonly reason: GuidedFailReason;
  /** Values for the hint text: part `type`, `pin`, board `boardPin`, pin `kind`, `options`, counts. */
  readonly params: Readonly<Record<string, string | number>>;
  /** Parts to highlight for "Show me". */
  readonly parts: readonly string[];
}

export interface StepResult {
  readonly pass: boolean;
  readonly failures: readonly GuidedFailure[];
}

const UART = new Set(UNO_PINS.filter((p) => p.capabilities.includes('uart')).map((p) => p.id));

/** Board pins of a kind, in board order. Digital excludes D0/D1, which the serial monitor uses. */
export function boardPinsOfKind(kind: GuidedPinKind): readonly string[] {
  return UNO_PINS.filter((p) => {
    switch (kind) {
      case 'pwm':
        return p.capabilities.includes('pwm');
      case 'digital':
        return p.capabilities.includes('digital') && !UART.has(p.id) && !p.capabilities.includes('adc');
      case 'analog':
        return p.capabilities.includes('adc');
      case 'ground':
        return p.capabilities.includes('ground');
      case '5v':
        return p.id === '5V';
    }
  }).map((p) => p.id);
}

class Checker {
  readonly #nets: CircuitNets;

  constructor(private readonly ctx: GuidedContext) {
    this.#nets = new CircuitNets(ctx.doc);
  }

  #parts(type: string): readonly string[] {
    return this.ctx.doc.components.filter((c) => c.type === type).map((c) => c.id);
  }

  #pins(sel: GuidedPin): PinRef[] {
    return sel.type === BOARD_PART
      ? [{ part: BOARD_PART, pin: sel.pin }]
      : this.#parts(sel.type).map((part) => ({ part, pin: sel.pin }));
  }

  #boardPinsAt(pin: PinRef): string[] {
    return this.#nets
      .connectedTo(pin)
      .filter((p) => p.part === BOARD_PART)
      .map((p) => p.pin);
  }

  #missing(type: string, count = 1): GuidedFailure {
    return { reason: 'missingPart', params: { type, count, have: this.#parts(type).length }, parts: [] };
  }

  check(c: GuidedCheck): GuidedFailure | null {
    switch (c.kind) {
      case 'part': {
        const parts = this.#parts(c.type);
        if (parts.length < c.count) return this.#missing(c.type, c.count);
        if (!c.onRobot) return null;
        const off = this.ctx.doc.components.filter((p) => p.type === c.type && !p.mount).map((p) => p.id);
        // Enough mounted ones is fine; extra loose copies do not matter.
        return parts.length - off.length >= c.count
          ? null
          : { reason: 'notOnRobot', params: { type: c.type }, parts: off };
      }
      case 'prop': {
        const parts = this.ctx.doc.components.filter((p) => p.type === c.type);
        if (!parts.length) return this.#missing(c.type);
        return parts.some((p) => p.props[c.prop] === c.equals)
          ? null
          : {
              reason: 'propMismatch',
              params: { type: c.type, prop: c.prop, value: String(c.equals) },
              parts: parts.map((p) => p.id),
            };
      }
      case 'connected': {
        for (const sel of [c.a, c.b])
          if (sel.type !== BOARD_PART && !this.#parts(sel.type).length) return this.#missing(sel.type);
        const as = this.#pins(c.a);
        const bs = this.#pins(c.b);
        return as.some((a) => bs.some((b) => this.#nets.sameNet(a, b)))
          ? null
          : {
              reason: 'notConnected',
              params: { type: c.a.type, pin: c.a.pin, otherType: c.b.type, otherPin: c.b.pin },
              parts: [...as, ...bs].map((p) => p.part).filter((p) => p !== BOARD_PART),
            };
      }
      case 'boardPin': {
        const pins = this.#pins(c.pin);
        if (!pins.length) return this.#missing(c.pin.type);
        const allowed = boardPinsOfKind(c.pinKind);
        const reached = pins.flatMap((p) => this.#boardPinsAt(p));
        if (reached.some((b) => allowed.includes(b))) return null;
        const parts = pins.map((p) => p.part);
        const params = { type: c.pin.type, pin: c.pin.pin, kind: c.pinKind, options: allowed.join(', ') };
        return reached.length
          ? { reason: 'wrongPinKind', params: { ...params, boardPin: reached[0] as string }, parts }
          : { reason: 'notOnBoard', params, parts };
      }
      case 'code': {
        const pins = this.#pins(c.at);
        if (!pins.length) return this.#missing(c.at.type);
        const reached = pins.flatMap((p) => this.#boardPinsAt(p));
        const parts = pins.map((p) => p.part);
        if (!reached.length)
          return { reason: 'notOnBoard', params: { type: c.at.type, pin: c.at.pin }, parts };
        if (!this.ctx.code) return { reason: 'codeUnavailable', params: {}, parts: [] };
        const ok = this.ctx.code.uses.some((u) => u.use === c.use && reached.includes(u.pin));
        return ok
          ? null
          : {
              reason: 'codeMissing',
              params: { use: c.use, boardPin: reached[0] as string, type: c.at.type, pin: c.at.pin },
              parts,
            };
      }
      case 'run':
        return this.ctx.runSucceeded ? null : { reason: 'notRun', params: {}, parts: [] };
    }
  }
}

/** Every failing check of a step (empty = passes). A reading step (no checks) never passes on its own. */
export function evaluateStep(step: GuidedStep, ctx: GuidedContext, checker = new Checker(ctx)): StepResult {
  const failures = step.checks.flatMap((c) => checker.check(c) ?? []);
  return { pass: step.checks.length > 0 && failures.length === 0, failures };
}

/**
 * Step states, in order: steps run one at a time. `done` passes now (or, for reading steps, was
 * confirmed); the first step that does not is `active`, or `attention` when it was completed before
 * and has since been undone; later steps are `locked` (or `upcoming-done` if completed earlier).
 */
export type StepStatus = 'done' | 'active' | 'attention' | 'locked' | 'upcomingDone';

export interface GuideState {
  readonly results: readonly StepResult[];
  readonly statuses: readonly StepStatus[];
  /** Index of the step to work on; `steps.length` when everything is done. */
  readonly current: number;
  readonly complete: boolean;
  /** Steps that pass (or were confirmed) up to the current one: what progress should record. */
  readonly completedIds: readonly string[];
}

export function evaluateGuide(
  steps: readonly GuidedStep[],
  ctx: GuidedContext,
  everCompleted: ReadonlySet<string>,
): GuideState {
  const checker = new Checker(ctx);
  const results = steps.map((s) => evaluateStep(s, ctx, checker));
  const passes = steps.map((s, i) =>
    s.checks.length ? (results[i] as StepResult).pass : everCompleted.has(s.id),
  );
  const firstOpen = passes.indexOf(false);
  const current = firstOpen < 0 ? steps.length : firstOpen;
  const statuses = steps.map((s, i): StepStatus => {
    if (i < current) return 'done';
    if (i === current) return everCompleted.has(s.id) ? 'attention' : 'active';
    return everCompleted.has(s.id) ? 'upcomingDone' : 'locked';
  });
  const completedIds = new Set(everCompleted);
  steps.slice(0, current).forEach((s) => completedIds.add(s.id));
  return {
    results,
    statuses,
    current,
    complete: current === steps.length,
    completedIds: steps.map((s) => s.id).filter((id) => completedIds.has(id)),
  };
}
