import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { SevenSegment, type SevenSegmentProps } from './model.js';

export const definition: ComponentDefinition<SevenSegmentProps> = {
  manifest,
  create: () => new SevenSegment(),
};
export {
  SEGMENTS,
  SevenSegment,
  type Segment,
  type SegmentColor,
  type SevenSegmentProps,
  type SevenSegmentState,
} from './model.js';
export { manifest } from './manifest.js';
