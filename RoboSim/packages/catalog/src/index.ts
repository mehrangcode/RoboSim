import { definitions as batteries } from '@robosim/component-battery';
import { definitions as breadboards } from '@robosim/component-breadboard';
import { definition as buzzerActive } from '@robosim/component-buzzer-active';
import { definition as chassis2wd } from '@robosim/component-chassis-2wd';
import { definition as hcSr04 } from '@robosim/component-hc-sr04';
import { definition as l298n } from '@robosim/component-l298n';
import { definition as ldr } from '@robosim/component-ldr';
import { definition as led } from '@robosim/component-led';
import { definition as line3ch } from '@robosim/component-line-3ch';
import { definition as potentiometer } from '@robosim/component-potentiometer';
import { definition as pushButton } from '@robosim/component-push-button';
import { definition as resistor } from '@robosim/component-resistor';
import { definition as sg90Servo } from '@robosim/component-sg90-servo';
import { definition as powerSwitch } from '@robosim/component-switch';
import { definition as tcrt5000 } from '@robosim/component-tcrt5000';
import { definition as ttMotor } from '@robosim/component-tt-motor';
import type { ComponentDefinition } from '@robosim/sim-core';

/**
 * Every component the engine can simulate, in palette order. The web worker and the grader resolve
 * project parts by manifest id through this registry, so both always run the same models.
 */
export const CATALOG: readonly ComponentDefinition[] = [
  ...batteries,
  powerSwitch,
  ...breadboards,
  resistor,
  potentiometer,
  led,
  buzzerActive,
  pushButton,
  ldr,
  tcrt5000,
  line3ch,
  hcSr04,
  l298n,
  ttMotor,
  sg90Servo,
  chassis2wd,
] as readonly ComponentDefinition[];

const byId = new Map<string, ComponentDefinition>();
for (const def of CATALOG) {
  if (byId.has(def.manifest.id)) throw new Error(`Duplicate component id '${def.manifest.id}' in catalog`);
  byId.set(def.manifest.id, def);
}

export function findDefinition(id: string): ComponentDefinition {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown component type '${id}'`);
  return def;
}

/** Component ids available in a release phase (cumulative), e.g. everything shipping by P1. */
export function catalogFor(phase: 'P1' | 'P2' | 'P3' | 'P4'): readonly ComponentDefinition[] {
  const order = ['P1', 'P2', 'P3', 'P4'];
  return CATALOG.filter((d) => order.indexOf(d.manifest.phase) <= order.indexOf(phase));
}
