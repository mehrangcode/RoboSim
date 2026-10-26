// Sketch sets compiled into committed Intel HEX by `pnpm firmware:gen`; the firmware drift test checks each.
// Plain data modules, imported from source so this app does not depend on the engine build.
import { CONFORMANCE_SKETCHES } from '../../../packages/boards/avr-uno/test/conformance/sketches.ts';
import { GUIDED_SKETCHES } from '../../../packages/content/src/guided/sketches.ts';
import { FIRMWARE_SKETCHES } from '../../../packages/sim-runtime/src/firmware/sketches.ts';

export interface FirmwareSet {
  readonly name: string;
  readonly sketches: Readonly<Record<string, string>>;
  /** Generated module, relative to the repository root. */
  readonly target: string;
  /** Id type and export name in the generated module. */
  readonly idType: string;
  readonly exportName: string;
}

export const FIRMWARE_SETS: readonly FirmwareSet[] = [
  {
    name: 'built-in demos',
    sketches: FIRMWARE_SKETCHES,
    target: 'packages/sim-runtime/src/firmware/generated.ts',
    idType: 'FirmwareId',
    exportName: 'FIRMWARE_HEX',
  },
  {
    name: 'Uno peripheral conformance',
    sketches: CONFORMANCE_SKETCHES,
    target: 'packages/boards/avr-uno/test/conformance/generated.ts',
    idType: 'ConformanceSketchId',
    exportName: 'CONFORMANCE_HEX',
  },
  {
    name: 'guided-project solutions',
    sketches: GUIDED_SKETCHES,
    target: 'packages/content/src/guided/generated.ts',
    idType: 'GuidedSketchId',
    exportName: 'GUIDED_HEX',
  },
];
