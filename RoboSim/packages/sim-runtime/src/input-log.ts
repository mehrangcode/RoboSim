import type { SliceContext, SliceObserver } from '@robosim/sim-core';
import type { InputLogEntry, RunSource } from './protocol.js';
import { inputValueIssue } from './project-loader.js';
import { buildRun, type Scenario } from './scenarios.js';

const utf8 = new TextEncoder();

/** An input as the UI sends it; the logger stamps the slice. */
export type LiveInput = {
  [K in InputLogEntry['kind']]: Omit<Extract<InputLogEntry, { kind: K }>, 'slice'>;
}[InputLogEntry['kind']];

export class InputLogError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid input log: ${issues.join('; ')}`);
    this.name = 'InputLogError';
  }
}

/**
 * Every problem of a replayed log for this scenario — slice order, parts, input names, value types
 * and ranges — so a bad log is refused before slice 0, not when the run reaches the bad entry.
 */
function replayIssues(scenario: Scenario, entries: readonly InputLogEntry[]): string[] {
  const parts = new Map(scenario.scene.parts.map((p) => [p.id, p]));
  const issues: string[] = [];
  entries.forEach((e, i) => {
    const at = `entry ${i} (slice ${e.slice})`;
    if (i > 0 && e.slice < (entries[i - 1]?.slice ?? 0)) issues.push(`${at}: not in slice order`);
    if (e.kind === 'serial') {
      if (!scenario.circuit.sim.mcu) issues.push(`${at}: serial input but the scenario has no MCU`);
      return;
    }
    const part = parts.get(e.componentId);
    const issue = part ? inputValueIssue(part.inputs, e.name, e.value) : `no component '${e.componentId}'`;
    if (issue) issues.push(`${at}: ${part ? `component '${e.componentId}' ` : ''}${issue}`);
  });
  return issues;
}

/** Applies one user interaction to the running scenario. */
export function applyInput(scenario: Scenario, entry: InputLogEntry): void {
  const sim = scenario.circuit.sim;
  if (entry.kind === 'component') sim.input(entry.componentId, entry.name, entry.value);
  else {
    const mcu = sim.mcu;
    if (!mcu) throw new Error('scenario has no MCU to receive serial input');
    mcu.uart(0).write(utf8.encode(entry.text));
  }
}

/**
 * Input log of one run (Technical Design §5.1, §5.9). Live inputs are applied between slices, when
 * the simulation sits at slice N; replay applies them after slice N's observers ran — the same
 * point in the loop — so a replayed run is identical to the live one.
 *
 * Attach it as the last observer so replayed inputs see the same state live inputs did.
 */
export class InputLogger implements SliceObserver {
  private readonly log: InputLogEntry[];
  private next = 0;

  constructor(
    private readonly scenario: Scenario,
    replay: readonly InputLogEntry[] = [],
  ) {
    const issues = replayIssues(scenario, replay);
    if (issues.length > 0) throw new InputLogError(issues);
    this.log = [...replay];
    this.applyDue(scenario.circuit.sim.slice);
  }

  /** Every input of the run so far, plus replayed inputs still to come, in slice order. */
  get entries(): readonly InputLogEntry[] {
    return this.log;
  }

  /** Replayed inputs not yet applied. */
  get pending(): number {
    return this.log.length - this.next;
  }

  /**
   * Applies a live input now. Every logged input up to the current slice has been applied already,
   * so it goes right before the replayed inputs still to come.
   */
  live(input: LiveInput): void {
    const entry: InputLogEntry = { ...input, slice: this.scenario.circuit.sim.slice };
    applyInput(this.scenario, entry);
    this.log.splice(this.next++, 0, entry);
  }

  afterSlice(ctx: SliceContext): void {
    this.applyDue(ctx.slice);
  }

  private applyDue(slice: number): void {
    while (this.next < this.log.length && (this.log[this.next]?.slice ?? 0) <= slice) {
      const entry = this.log[this.next++];
      if (entry) applyInput(this.scenario, entry);
    }
  }
}

/** Runs a scenario with an input log and no wall clock — the grader's loop (Technical Design §5.3). */
export class HeadlessRun {
  readonly scenario: Scenario;
  readonly logger: InputLogger;

  constructor(source: RunSource, seed: number, entries: readonly InputLogEntry[]) {
    this.scenario = buildRun(source, seed);
    this.logger = new InputLogger(this.scenario, entries);
    this.scenario.circuit.sim.addObserver(this.logger);
  }

  runTo(slice: number): void {
    const sim = this.scenario.circuit.sim;
    if (slice < sim.slice) throw new RangeError(`Cannot run back from slice ${sim.slice} to ${slice}`);
    sim.run(slice - sim.slice);
  }
}
