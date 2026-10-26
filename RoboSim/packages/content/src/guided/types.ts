import type { GuidedStepInput, LocalizedText, ProjectDocument } from '@robosim/shared';

/** A guided project as authored (FR-LRN-01); the API turns it into the `GuidedProject` contract. */
export interface GuidedContent {
  readonly slug: string;
  /** Bumped when steps change, so progress recorded against the old steps stays separate. */
  readonly version: number;
  /** Part of Free's `learning.guided_projects: first`. */
  readonly free: boolean;
  readonly minutes: number;
  readonly arenaId: string;
  /** Inline SVG for the catalogue card. */
  readonly cover: string;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly steps: readonly GuidedStepInput[];
  /** What the learner starts from. */
  readonly starter: ProjectDocument;
  /** The finished build with the solution sketch: every step passes on it and it meets the challenge. */
  readonly reference: ProjectDocument;
  /** Inline SVG images, referenced from step bodies as `asset:<name>`. */
  readonly assets: Readonly<Record<string, string>>;
}
