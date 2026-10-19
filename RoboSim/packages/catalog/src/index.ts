import { definitions as batteries } from '@robosim/component-battery';
import { definitions as breadboards } from '@robosim/component-breadboard';
import { definition as buzzerActive } from '@robosim/component-buzzer-active';
import { definition as buzzerPassive } from '@robosim/component-buzzer-passive';
import { definition as chassis2wd } from '@robosim/component-chassis-2wd';
import { definitions as diodes } from '@robosim/component-diode';
import { definition as hcSr04 } from '@robosim/component-hc-sr04';
import { definition as l298n } from '@robosim/component-l298n';
import { definition as ldr } from '@robosim/component-ldr';
import { definition as led } from '@robosim/component-led';
import { definition as ledRgb } from '@robosim/component-led-rgb';
import { definitions as linearRegulators } from '@robosim/component-linear-regulator';
import { definition as line3ch } from '@robosim/component-line-3ch';
import { definition as lm2596 } from '@robosim/component-lm2596';
import { definition as potentiometer } from '@robosim/component-potentiometer';
import { definition as pushButton } from '@robosim/component-push-button';
import { definition as relayModule } from '@robosim/component-relay-module';
import { definition as resistor } from '@robosim/component-resistor';
import { definitions as servos } from '@robosim/component-servo';
import { definition as sevenSegment } from '@robosim/component-seven-segment';
import { definition as powerSwitch } from '@robosim/component-switch';
import { definition as tcrt5000 } from '@robosim/component-tcrt5000';
import { definition as ttMotor } from '@robosim/component-tt-motor';
import { definition as counter4017 } from '@robosim/component-counter-4017';
import { definition as l9110s } from '@robosim/component-l9110s';
import { definitions as logic74hc } from '@robosim/component-logic-74hc';
import { definition as shiftRegister595 } from '@robosim/component-shift-register-595';
import { definition as stepper28byj48 } from '@robosim/component-stepper-28byj48';
import { definition as tb6612 } from '@robosim/component-tb6612';
import { definition as uln2003 } from '@robosim/component-uln2003';
import { definition as bumpSwitch } from '@robosim/component-bump-switch';
import { definition as line5ch } from '@robosim/component-line-5ch';
import { definition as irObstacle } from '@robosim/component-ir-obstacle';
import { definition as pir } from '@robosim/component-pir';
import { definition as soundSensor } from '@robosim/component-sound-sensor';
import { definition as soilMoisture } from '@robosim/component-soil-moisture';
import { definition as joystick } from '@robosim/component-joystick';
import { definition as keypad } from '@robosim/component-keypad';
import { definition as rotaryEncoder } from '@robosim/component-rotary-encoder';
import { definitions as capacitors } from '@robosim/component-capacitor';
import { definition as ne555 } from '@robosim/component-ne555';
import { definitions as transistors } from '@robosim/component-transistor';
import { definition as irf520Module } from '@robosim/component-irf520-module';
import { definition as oledSsd1306 } from '@robosim/component-oled-ssd1306';
import { definition as lcd1602I2c } from '@robosim/component-lcd1602-i2c';
import { definition as mpu6050 } from '@robosim/component-mpu6050';
import { definition as bmp280 } from '@robosim/component-bmp280';
import { definition as vl53l0x } from '@robosim/component-vl53l0x';
import { definition as dht11 } from '@robosim/component-dht11';
import { definition as ds18b20 } from '@robosim/component-ds18b20';
import { definition as ws2812Strip } from '@robosim/component-ws2812-strip';
import type { ComponentDefinition } from '@robosim/sim-core';

/**
 * Every component the engine can simulate, in palette order. The web worker and the grader resolve
 * project parts by manifest id through this registry, so both always run the same models.
 */
export const CATALOG: readonly ComponentDefinition[] = [
  ...batteries,
  powerSwitch,
  lm2596,
  ...breadboards,
  resistor,
  potentiometer,
  ...capacitors,
  ...diodes,
  ...transistors,
  ...linearRegulators,
  ...logic74hc,
  shiftRegister595,
  counter4017,
  ne555,
  uln2003,
  led,
  ledRgb,
  ws2812Strip,
  sevenSegment,
  lcd1602I2c,
  oledSsd1306,
  buzzerActive,
  buzzerPassive,
  relayModule,
  pushButton,
  bumpSwitch,
  joystick,
  keypad,
  rotaryEncoder,
  ldr,
  soundSensor,
  soilMoisture,
  pir,
  tcrt5000,
  line3ch,
  line5ch,
  irObstacle,
  hcSr04,
  vl53l0x,
  mpu6050,
  bmp280,
  dht11,
  ds18b20,
  l298n,
  tb6612,
  l9110s,
  irf520Module,
  ttMotor,
  stepper28byj48,
  ...servos,
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
