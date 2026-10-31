import type { GuidedStepInput, LocalizedText, ProjectDocument } from '@robosim/shared';

/** A component input change at a simulation slice (1 slice = 1 ms), as the sim input log records it. */
export interface GuidedInput {
  readonly slice: number;
  readonly componentId: string;
  readonly name: string;
  readonly value: number | boolean;
}

/** A guided project as authored (FR-LRN-01); the API turns it into the `GuidedProject` contract. */
export interface GuidedContent {
  readonly slug: string;
  /** Bumped when steps change, so progress recorded against the old steps stays separate. */
  readonly version: number;
  /** Part of Free's `learning.guided_projects: first`. */
  readonly free: boolean;
  readonly minutes: number;
  /** Arena the robot runs in; null for bench projects (no robot, no arena). */
  readonly arenaId: string | null;
  /** Inline SVG for the catalogue card. */
  readonly cover: string;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly steps: readonly GuidedStepInput[];
  /** What the learner starts from. */
  readonly starter: ProjectDocument;
  /** The finished build with the solution sketch: every step passes on it and it meets the challenge. */
  readonly reference: ProjectDocument;
  /**
   * Scripted inputs (button presses, knob turns, sensor readings) the reference run gets in tests, the way a
   * learner would set them while it runs. Bench projects whose goal needs interaction use it.
   */
  readonly referenceInputs?: readonly GuidedInput[];
  /** Inline SVG images, referenced from step bodies as `asset:<name>`. */
  readonly assets: Readonly<Record<string, string>>;
}
