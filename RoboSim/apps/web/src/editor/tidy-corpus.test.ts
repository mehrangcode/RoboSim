import { netSignature, tidyWires, wireHints } from '@robosim/circuit-canvas';
import { GUIDED_PROJECTS } from '@robosim/content/guided';
import type { ProjectDocument } from '@robosim/shared';
import { SCENARIOS, builtinSource } from '@robosim/sim-runtime';
import { describe, expect, it } from 'vitest';

// Tidy invariant on our own circuits (FR-CIR-11, Release Plan IT-7 exit): the netlist is identical before
// and after Tidy on every built-in demo and guided reference, and Tidy settles in one pass.

const corpus: [string, ProjectDocument][] = [
  ...SCENARIOS.map((id): [string, ProjectDocument] => [`demo ${id}`, builtinSource(id).project]),
  ...GUIDED_PROJECTS.map((g): [string, ProjectDocument] => [`guided ${g.slug}`, g.reference]),
];

describe('tidy corpus (FR-CIR-11)', () => {
  it.each(corpus)('%s keeps its netlist, parts and wire ends', (_name, doc) => {
    for (const recolourSignals of [false, true]) {
      const out = tidyWires(doc, { recolour: true, reroute: true, recolourSignals });
      expect(netSignature(out)).toBe(netSignature(doc));
      expect(out.components).toEqual(doc.components);
      expect(out.wires.map((w) => [w.id, w.from, w.to])).toEqual(doc.wires.map((w) => [w.id, w.from, w.to]));
      expect(tidyWires(out, { recolour: true, reroute: true, recolourSignals })).toBe(out);
      expect(wireHints(out).filter((h) => h.id === 'LINT-WIRE-COLOR')).toEqual([]);
    }
  });
});
