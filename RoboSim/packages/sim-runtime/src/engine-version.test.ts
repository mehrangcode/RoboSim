/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_PACKAGES, ENGINE_VERSION } from './engine-version.js';

const packages = join(import.meta.dirname, '../..');
const version = (dir: string): string =>
  (JSON.parse(readFileSync(join(packages, dir, 'package.json'), 'utf8')) as { version: string }).version;

describe('engine version', () => {
  it('matches the package.json versions it names', () => {
    expect(ENGINE_PACKAGES['sim-core']).toBe(version('sim-core'));
    expect(ENGINE_PACKAGES['board-avr-uno']).toBe(version('boards/avr-uno'));
    expect(ENGINE_PACKAGES['safety-rules']).toBe(version('safety-rules'));
    expect(ENGINE_PACKAGES['sim-runtime']).toBe(version('sim-runtime'));
    for (const dir of readdirSync(join(packages, 'components')))
      expect(version(`components/${dir}`), dir).toBe(ENGINE_PACKAGES.components);
  });

  it('is one readable string', () => {
    expect(ENGINE_VERSION).toBe(
      'sim-core@0.3.0+board-avr-uno@0.2.0+components@0.2.0+safety-rules@0.2.0+sim-runtime@0.4.0',
    );
  });
});
