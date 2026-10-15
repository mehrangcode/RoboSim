import type { BuildRequest } from '@robosim/shared';

/** The build request for a built-in demo sketch, exactly as its project document stores the code. */
export function demoBuildRequest(sketch: string): BuildRequest {
  return { board: 'avr-uno', files: [{ name: 'sketch.ino', content: `${sketch.trim()}\n` }], libraries: [] };
}
