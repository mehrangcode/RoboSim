import { analyzeSketch } from '@robosim/code-analysis';
import { evaluateGuide } from '@robosim/circuit-canvas/guided';
import { GUIDED_PROJECTS, guidedProject, type GuidedContent } from '@robosim/content/guided';
import { GUIDED_HEX, GUIDED_SKETCHES, type GuidedSketchId } from '@robosim/content/guided/firmware';
import { parseProjectDocument, type ProjectDocument } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from './engine-version.js';
import { grade } from './grade.js';

/** Guided projects (FR-LRN-01): the reference builds pass every step and meet their challenge. */
const FIRMWARE: Record<string, GuidedSketchId> = {
  'line-follower': 'lineFollower',
  'obstacle-avoider': 'obstacleAvoider',
};

const check = (c: GuidedContent, doc: ProjectDocument, runSucceeded: boolean, confirmed: string[] = []) =>
  evaluateGuide(
    guidedProject(c).steps,
    { doc, code: analyzeSketch(doc.code.files), runSucceeded },
    new Set(confirmed),
  );

describe.each(GUIDED_PROJECTS.map((c) => [c.slug, c] as const))('guided project %s', (slug, c) => {
  it('has valid documents linked back to the project', () => {
    for (const doc of [c.starter, c.reference]) {
      expect(parseProjectDocument(doc)).toEqual(doc);
      expect(doc.guided).toEqual({ slug, version: c.version });
    }
  });

  it('references only images it ships', () => {
    const used = guidedProject(c).steps.flatMap((s) =>
      [s.body.en, s.body.fa].flatMap((b) => [...b.matchAll(/\(asset:([a-z0-9-]+)\)/g)].map((m) => m[1])),
    );
    for (const name of used) expect(c.assets).toHaveProperty(name as string);
  });

  it('starts at the introduction, then asks for the motor driver', () => {
    expect(check(c, c.starter, false).current).toBe(0);
    const next = check(c, c.starter, false, ['intro']);
    expect(c.steps[next.current]?.id).toBe('driver');
  });

  it('passes every step on the reference build once the run succeeds', () => {
    const before = check(c, c.reference, false, ['intro']);
    expect(c.steps[before.current]?.id).toBe('run');
    expect(check(c, c.reference, true, ['intro']).complete).toBe(true);
  });

  it('flags the starter sketch’s blank pins on the reference circuit', () => {
    const blank = { ...c.reference, code: c.starter.code };
    const state = check(c, blank, false, ['intro']);
    expect(c.steps[state.current]?.id).toBe('code');
    expect(state.results[state.current]?.failures.every((f) => f.reason === 'codeMissing')).toBe(true);
  });

  it('meets the challenge with the reference sketch', () => {
    const id = FIRMWARE[slug] as GuidedSketchId;
    expect(c.reference.code.files[0]?.content).toBe(`${GUIDED_SKETCHES[id].trim()}\n`);
    const r = grade({
      log: {
        engineVersion: ENGINE_VERSION,
        scenario: null,
        project: c.reference,
        firmware: { format: 'ihex', text: GUIDED_HEX[id], sha256: `demo:${id}` },
        seed: 1,
        entries: [],
      },
      maxSimSeconds: 120,
    });
    expect(r.outcome).toBe('success');
    expect(r.staticFindings).toEqual([]);
    expect(r.damaged).toEqual({ parts: [], pins: [] });
  }, 120_000);
});
