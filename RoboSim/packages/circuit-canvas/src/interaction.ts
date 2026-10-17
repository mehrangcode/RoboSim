import type { ComponentManifest } from '@robosim/catalog/manifests';

export type InputSpec = ComponentManifest['inputs'][number];

/** How a click on a part drives the running simulation. */
export type Interaction =
  | { readonly kind: 'momentary'; readonly input: string }
  | { readonly kind: 'toggle'; readonly input: string }
  /** Several buttons (a keypad): press each one where it is drawn (`data-input` in the art). */
  | { readonly kind: 'keys' }
  | { readonly kind: 'popover' };

/**
 * A push button is held while the pointer is down, a switch toggles on click, a keypad's keys are held
 * where they are drawn, anything else with inputs (knob, light level, distance, surfaces) opens
 * sliders. Parts without inputs: none. Art elements marked `data-input` are always momentary buttons.
 */
export function interactionOf(inputs: readonly InputSpec[]): Interaction | null {
  if (inputs.length === 0) return null;
  const [only] = inputs;
  if (inputs.length === 1 && only?.type === 'boolean')
    return { kind: only.name === 'pressed' ? 'momentary' : 'toggle', input: only.name };
  if (inputs.every((i) => i.type === 'boolean')) return { kind: 'keys' };
  return { kind: 'popover' };
}
