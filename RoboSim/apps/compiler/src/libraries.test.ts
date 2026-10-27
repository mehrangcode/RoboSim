import { readFileSync } from 'node:fs';
import { ARDUINO_LIBRARIES } from '@robosim/shared';
import { describe, expect, it } from 'vitest';

const lock = JSON.parse(readFileSync(new URL('../toolchain.lock.json', import.meta.url), 'utf8')) as {
  libraries: { name: string; version: string }[];
};

describe('library manager list (FR-COD-07)', () => {
  it('lists exactly the pinned libraries, at their pinned versions', () => {
    const pinned = ARDUINO_LIBRARIES.filter((l) => !l.builtin).map((l) => `${l.name}@${l.version}`);
    expect(pinned.sort()).toEqual(lock.libraries.map((l) => `${l.name}@${l.version}`).sort());
  });
});
