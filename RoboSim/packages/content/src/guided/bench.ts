import { PROJECT_SCHEMA_VERSION, type GuidedRef, type ProjectDocument } from '@robosim/shared';
import type { ChallengeSpec } from '@robosim/sim-core';

/*
 * Bench guided projects: an Arduino Uno on the desk, no robot and no arena. Their run step passes when the
 * project's success conditions are met (serial output or a pin level), so the starter carries the challenge.
 */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** An empty bench: just the Uno at the canvas origin, the starter sketch and the bench challenge. */
export function benchBase(
  guided: GuidedRef,
  title: string,
  sketch: string,
  challenge: ChallengeSpec,
): ProjectDocument {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    board: { id: 'avr-uno', version: '1.0.0' },
    components: [],
    wires: [],
    code: { language: 'cpp', files: [{ name: 'sketch.ino', content: sketch.trim() + '\n' }] },
    libraries: [],
    successConditions: clone(challenge) as ProjectDocument['successConditions'],
    guided,
    meta: { title },
  };
}
