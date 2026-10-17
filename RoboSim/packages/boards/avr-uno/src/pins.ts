import type { BoardPinDef, PinCapability, PinId } from '@robosim/sim-core';

export type PortName = 'B' | 'C' | 'D';

export interface McuPinMap {
  readonly id: PinId;
  readonly port: PortName;
  readonly bit: number;
  /** ADC channel for A0–A5. */
  readonly adc?: number;
  /** Output-compare channel that can drive the pin. */
  readonly oc?: { readonly timer: 0 | 1 | 2; readonly channel: 'A' | 'B' };
}

/** Arduino Uno R3 header → ATmega328P port/bit (pins_arduino.h, standard variant). */
export const UNO_MCU_PINS: readonly McuPinMap[] = [
  { id: 'D0', port: 'D', bit: 0 },
  { id: 'D1', port: 'D', bit: 1 },
  { id: 'D2', port: 'D', bit: 2 },
  { id: 'D3', port: 'D', bit: 3, oc: { timer: 2, channel: 'B' } },
  { id: 'D4', port: 'D', bit: 4 },
  { id: 'D5', port: 'D', bit: 5, oc: { timer: 0, channel: 'B' } },
  { id: 'D6', port: 'D', bit: 6, oc: { timer: 0, channel: 'A' } },
  { id: 'D7', port: 'D', bit: 7 },
  { id: 'D8', port: 'B', bit: 0 },
  { id: 'D9', port: 'B', bit: 1, oc: { timer: 1, channel: 'A' } },
  { id: 'D10', port: 'B', bit: 2, oc: { timer: 1, channel: 'B' } },
  { id: 'D11', port: 'B', bit: 3, oc: { timer: 2, channel: 'A' } },
  { id: 'D12', port: 'B', bit: 4 },
  { id: 'D13', port: 'B', bit: 5 },
  { id: 'A0', port: 'C', bit: 0, adc: 0 },
  { id: 'A1', port: 'C', bit: 1, adc: 1 },
  { id: 'A2', port: 'C', bit: 2, adc: 2 },
  { id: 'A3', port: 'C', bit: 3, adc: 3 },
  { id: 'A4', port: 'C', bit: 4, adc: 4 },
  { id: 'A5', port: 'C', bit: 5, adc: 5 },
];

const GPIO_ABS_MAX_V = 5.5; // VCC + 0.5 V
const GPIO_MAX_MA = 40;

function capabilitiesOf(p: McuPinMap): PinCapability[] {
  const caps: PinCapability[] = ['digital'];
  if (p.oc) caps.push('pwm');
  if (p.adc !== undefined) caps.push('adc');
  if (p.id === 'D0' || p.id === 'D1') caps.push('uart');
  if (p.id === 'D2' || p.id === 'D3') caps.push('interrupt');
  if (p.id === 'A4' || p.id === 'A5') caps.push('i2c');
  if (p.id === 'D10' || p.id === 'D11' || p.id === 'D12' || p.id === 'D13') caps.push('spi');
  return caps;
}

const power = (id: string, label: string, absMaxV: number, maxCurrentMa: number): BoardPinDef => ({
  id,
  label,
  capabilities: [id.startsWith('GND') ? 'ground' : 'power'],
  absMaxV,
  maxCurrentMa,
});

export const UNO_PINS: readonly BoardPinDef[] = [
  ...UNO_MCU_PINS.map((p) => ({
    id: p.id,
    label: p.oc ? `~${p.id.slice(1)}` : p.id.startsWith('D') ? p.id.slice(1) : p.id,
    capabilities: capabilitiesOf(p),
    absMaxV: GPIO_ABS_MAX_V,
    maxCurrentMa: GPIO_MAX_MA,
  })),
  power('5V', '5V', 5.5, 500),
  power('3V3', '3.3V', 3.6, 150),
  power('VIN', 'VIN', 20, 1000),
  power('GND1', 'GND', 0, 1000),
  power('GND2', 'GND', 0, 1000),
  power('GND3', 'GND', 0, 1000),
];

/** The board as a mounted body (FR-ARN-09): Uno R3 PCB outline, 25 g. */
export const UNO_BODY = {
  massG: 25,
  mounting: { lengthMm: 68.6, widthMm: 53.4, heightMm: 15 },
} as const;
