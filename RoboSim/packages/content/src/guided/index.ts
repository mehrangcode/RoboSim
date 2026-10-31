import { contentVersionId, guidedStepSchema, type GuidedProject, type GuidedSummary } from '@robosim/shared';
import { blinkTrafficLight } from './blink-traffic-light.js';
import { buttonCounter } from './button-counter.js';
import { dimmerKnob } from './dimmer-knob.js';
import { lineFollower } from './line-follower.js';
import { mazeExplorer } from './maze-explorer.js';
import { mindTheGap } from './mind-the-gap.js';
import { obstacleAvoider } from './obstacle-avoider.js';
import { pidLineFollower } from './pid-line-follower.js';
import { scanningAvoider } from './scanning-avoider.js';
import { servoSweep } from './servo-sweep.js';
import { squareTrack } from './square-track.js';
import { sumoBot } from './sumo-bot.js';
import { weatherStation } from './weather-station.js';
import type { GuidedContent } from './types.js';

export type { GuidedContent, GuidedInput } from './types.js';

/**
 * Built-in guided projects (FR-LRN-01), in learn order: free bench projects first, then the robots.
 * Kept off the package root so the web bundle never carries paid content: browsers get it from the API, which applies the plan.
 */
export const GUIDED_PROJECTS: readonly GuidedContent[] = [
  blinkTrafficLight,
  buttonCounter,
  dimmerKnob,
  servoSweep,
  weatherStation,
  lineFollower,
  squareTrack,
  mindTheGap,
  pidLineFollower,
  obstacleAvoider,
  scanningAvoider,
  mazeExplorer,
  sumoBot,
];

export const findGuided = (slug: string): GuidedContent | undefined =>
  GUIDED_PROJECTS.find((p) => p.slug === slug);

export function guidedSummary(c: GuidedContent, locked: boolean): GuidedSummary {
  return {
    slug: c.slug,
    version: c.version,
    contentVersionId: contentVersionId(c.slug, c.version),
    title: c.title,
    summary: c.summary,
    minutes: c.minutes,
    free: c.free,
    stepCount: c.steps.length,
    arenaId: c.arenaId,
    cover: c.cover,
    locked,
  };
}

export function guidedProject(c: GuidedContent): GuidedProject {
  return {
    ...guidedSummary(c, false),
    steps: c.steps.map((s) => guidedStepSchema.parse(s)),
    starter: c.starter,
    assets: { ...c.assets },
  };
}
