import { analyzeSketch } from '@robosim/code-analysis';
import { boardPinView } from '@robosim/circuit-canvas';
import { GUIDED_PROJECTS } from '@robosim/content/guided';
import {
  PIN_DIRECTION,
  PIN_UNWIRED,
  checkConsistency,
  type ConsistencyFinding,
} from '@robosim/safety-rules/consistency';
import type { ProjectDocument } from '@robosim/shared';
import { SCENARIOS, builtinSource } from '@robosim/sim-runtime';
import { describe, expect, it } from 'vitest';

// Corpus check for FR-SAF-08: our own finished projects must not trip the warnings, or learners would
// learn to ignore them. Infos (wired but unused) are allowed: a demo may carry parts for later steps.

const warnings = (doc: ProjectDocument): string[] =>
  checkConsistency(boardPinView(doc), analyzeSketch(doc.code.files))
    .filter((f: ConsistencyFinding) => f.ruleId === PIN_UNWIRED || f.ruleId === PIN_DIRECTION)
    .map((f) => `${f.ruleId}:${f.pinIds.join()}`);

describe('wiring ↔ sketch corpus (FR-SAF-08)', () => {
  it.each(SCENARIOS)('built-in demo %s has no unwired or direction warning', (id) => {
    expect(warnings(builtinSource(id).project)).toEqual([]);
  });

  it.each(GUIDED_PROJECTS.map((g) => [g.slug, g] as const))(
    'guided reference build %s has no unwired or direction warning',
    (_slug, g) => {
      expect(warnings(g.reference)).toEqual([]);
    },
  );
});
