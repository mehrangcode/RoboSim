import type { ComponentManifest } from '@robosim/catalog/manifests';

export type InputSpec = ComponentManifest['inputs'][number];

/** How a click on a part drives the running simulation. */
export type Interaction =
  | { readonly kind: 'momentary'; readonly input: string }
  | { readonly kind: 'toggle'; readonly input: string }
  | { readonly kind: 'popover' };

/**
 * A push button is held while the pointer is down, a switch toggles on click, anything else with
 * inputs (knob, light level, distance, surfaces) opens sliders. Parts without inputs: none.
 */
export function interactionOf(inputs: readonly InputSpec[]): Interaction | null {
  if (inputs.length === 0) return null;
  const [only] = inputs;
  if (inputs.length === 1 && only?.type === 'boolean')
    return { kind: only.name === 'pressed' ? 'momentary' : 'toggle', input: only.name };
  return { kind: 'popover' };
}
