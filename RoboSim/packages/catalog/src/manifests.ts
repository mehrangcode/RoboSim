import { manifests as batteries } from '@robosim/component-battery/manifest';
import {
  BREADBOARD_LAYOUTS,
  breadboardConnections,
  manifests as breadboards,
  type BreadboardLayout,
} from '@robosim/component-breadboard/manifest';
import { manifests as buzzerActive } from '@robosim/component-buzzer-active/manifest';
import { manifests as buzzerPassive } from '@robosim/component-buzzer-passive/manifest';
import { manifests as chassis2wd } from '@robosim/component-chassis-2wd/manifest';
import { manifests as diodes } from '@robosim/component-diode/manifest';
import { manifests as hcSr04 } from '@robosim/component-hc-sr04/manifest';
import { manifests as l298n } from '@robosim/component-l298n/manifest';
import { manifests as ldr } from '@robosim/component-ldr/manifest';
import { manifests as led } from '@robosim/component-led/manifest';
import { manifests as ledRgb } from '@robosim/component-led-rgb/manifest';
import { manifests as linearRegulators } from '@robosim/component-linear-regulator/manifest';
import { manifests as line3ch } from '@robosim/component-line-3ch/manifest';
import { manifests as lm2596 } from '@robosim/component-lm2596/manifest';
import { manifests as potentiometer } from '@robosim/component-potentiometer/manifest';
import { manifests as pushButton } from '@robosim/component-push-button/manifest';
import { manifests as relayModule } from '@robosim/component-relay-module/manifest';
import { manifests as resistor } from '@robosim/component-resistor/manifest';
import { manifests as servos } from '@robosim/component-servo/manifest';
import { manifests as sevenSegment } from '@robosim/component-seven-segment/manifest';
import { manifests as powerSwitch } from '@robosim/component-switch/manifest';
import { manifests as tcrt5000 } from '@robosim/component-tcrt5000/manifest';
import { manifests as ttMotor } from '@robosim/component-tt-motor/manifest';
import { manifests as counter4017 } from '@robosim/component-counter-4017/manifest';
import { manifests as l9110s } from '@robosim/component-l9110s/manifest';
import { manifests as logic74hc } from '@robosim/component-logic-74hc/manifest';
import { manifests as shiftRegister595 } from '@robosim/component-shift-register-595/manifest';
import { manifests as stepper28byj48 } from '@robosim/component-stepper-28byj48/manifest';
import { manifests as tb6612 } from '@robosim/component-tb6612/manifest';
import { manifests as uln2003 } from '@robosim/component-uln2003/manifest';
import { manifests as bumpSwitch } from '@robosim/component-bump-switch/manifest';
import { manifests as line5ch } from '@robosim/component-line-5ch/manifest';
import { manifests as irObstacle } from '@robosim/component-ir-obstacle/manifest';
import { manifests as pir } from '@robosim/component-pir/manifest';
import { manifests as soundSensor } from '@robosim/component-sound-sensor/manifest';
import { manifests as soilMoisture } from '@robosim/component-soil-moisture/manifest';
import { manifests as joystick } from '@robosim/component-joystick/manifest';
import { manifests as keypad } from '@robosim/component-keypad/manifest';
import { manifests as rotaryEncoder } from '@robosim/component-rotary-encoder/manifest';
import type { ComponentManifest } from '@robosim/sim-core';

/**
 * The catalogue without its models (engine-free): what editors need to list, place, wire and
 * configure parts. Same entries and order as `CATALOG` (a test keeps them in step).
 */
export const CATALOG_MANIFESTS: readonly ComponentManifest[] = [
  ...batteries,
  ...powerSwitch,
  ...lm2596,
  ...breadboards,
  ...resistor,
  ...potentiometer,
  ...diodes,
  ...linearRegulators,
  ...logic74hc,
  ...shiftRegister595,
  ...counter4017,
  ...uln2003,
  ...led,
  ...ledRgb,
  ...sevenSegment,
  ...buzzerActive,
  ...buzzerPassive,
  ...relayModule,
  ...pushButton,
  ...bumpSwitch,
  ...joystick,
  ...keypad,
  ...rotaryEncoder,
  ...ldr,
  ...soundSensor,
  ...soilMoisture,
  ...pir,
  ...tcrt5000,
  ...line3ch,
  ...line5ch,
  ...irObstacle,
  ...hcSr04,
  ...l298n,
  ...tb6612,
  ...l9110s,
  ...ttMotor,
  ...stepper28byj48,
  ...servos,
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
/**
 * Pin pairs that are one conductor inside the part: breadboard strips (as in `ComponentDefinition`)
 * and a simulated part's `bondedPins`.
 */
export function internalConnectionsOf(id: string): readonly (readonly [string, string])[] {
  const layout = BREADBOARD_LAYOUTS[id];
  if (!layout) return byId.get(id)?.bondedPins ?? [];
  let pairs = strips.get(id);
  if (!pairs) strips.set(id, (pairs = breadboardConnections(layout)));
  return pairs;
}

export type { BreadboardLayout } from '@robosim/component-breadboard/manifest';
export type { ComponentManifest, PinKind, PropSpec } from '@robosim/sim-core';
