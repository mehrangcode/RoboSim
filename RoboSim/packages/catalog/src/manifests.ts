import { manifests as batteries } from '@robosim/component-battery/manifest';
import {
  BREADBOARD_LAYOUTS,
  breadboardConnections,
  manifests as breadboards,
  type BreadboardLayout,
} from '@robosim/component-breadboard/manifest';
import { manifests as buzzerActive } from '@robosim/component-buzzer-active/manifest';
import { manifests as chassis2wd } from '@robosim/component-chassis-2wd/manifest';
import { manifests as hcSr04 } from '@robosim/component-hc-sr04/manifest';
import { manifests as l298n } from '@robosim/component-l298n/manifest';
import { manifests as ldr } from '@robosim/component-ldr/manifest';
import { manifests as led } from '@robosim/component-led/manifest';
import { manifests as line3ch } from '@robosim/component-line-3ch/manifest';
import { manifests as potentiometer } from '@robosim/component-potentiometer/manifest';
import { manifests as pushButton } from '@robosim/component-push-button/manifest';
import { manifests as resistor } from '@robosim/component-resistor/manifest';
import { manifests as sg90Servo } from '@robosim/component-sg90-servo/manifest';
import { manifests as powerSwitch } from '@robosim/component-switch/manifest';
import { manifests as tcrt5000 } from '@robosim/component-tcrt5000/manifest';
import { manifests as ttMotor } from '@robosim/component-tt-motor/manifest';
import type { ComponentManifest } from '@robosim/sim-core';

/**
 * The catalogue without its models (engine-free): what editors need to list, place, wire and
 * configure parts. Same entries and order as `CATALOG` (a test keeps them in step).
 */
export const CATALOG_MANIFESTS: readonly ComponentManifest[] = [
  ...batteries,
  ...powerSwitch,
  ...breadboards,
  ...resistor,
  ...potentiometer,
  ...led,
  ...buzzerActive,
  ...pushButton,
  ...ldr,
  ...tcrt5000,
  ...line3ch,
  ...hcSr04,
  ...l298n,
  ...ttMotor,
  ...sg90Servo,
  ...chassis2wd,
];

const byId = new Map(CATALOG_MANIFESTS.map((m) => [m.id, m]));

export function findManifest(id: string): ComponentManifest | undefined {
  return byId.get(id);
}

/** Hole layout of a breadboard type, undefined for every other part. */
export function breadboardLayout(id: string): BreadboardLayout | undefined {
  return BREADBOARD_LAYOUTS[id];
}

const strips = new Map<string, readonly (readonly [string, string])[]>();
/** Pin pairs that are one conductor inside the part (breadboard strips), as in `ComponentDefinition`. */
export function internalConnectionsOf(id: string): readonly (readonly [string, string])[] {
  const layout = BREADBOARD_LAYOUTS[id];
  if (!layout) return [];
  let pairs = strips.get(id);
  if (!pairs) strips.set(id, (pairs = breadboardConnections(layout)));
  return pairs;
}

export type { BreadboardLayout } from '@robosim/component-breadboard/manifest';
export type { ComponentManifest, PinKind, PropSpec } from '@robosim/sim-core';
