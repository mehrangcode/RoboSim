/**
 * Engine identity recorded with every run and input log (Technical Design §5.9): the versions of the
 * packages whose behaviour decides simulation results. `engine-version.test.ts` keeps it in sync
 * with their package.json files (every component package must share the `components` version).
 */
export const ENGINE_PACKAGES = {
  'sim-core': '0.1.0',
  'board-avr-uno': '0.1.0',
  components: '0.1.0',
  'safety-rules': '0.1.0',
  'sim-runtime': '0.2.0',
} as const;

export const ENGINE_VERSION = Object.entries(ENGINE_PACKAGES)
  .map(([name, version]) => `${name}@${version}`)
  .join('+');
