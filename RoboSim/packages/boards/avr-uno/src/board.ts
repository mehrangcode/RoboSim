import type { Board, FirmwareImage, McuCore, PinElectrical } from '@robosim/sim-core';
import { AvrUnoCore, UNO_CLOCK_HZ } from './core.js';
import { UNO_PINS } from './pins.js';

/** ATmega328P GPIO at 5 V (datasheet §29): VIL ≤ 0.3·VCC, VIH ≥ 0.6·VCC, pull-up 20–50 kΩ, ~25 Ω driver. */
export const UNO_ELECTRICAL: PinElectrical = {
  vcc: 5,
  outputResistance: 25,
  pullupResistance: 35_000,
  vil: 1.5,
  vih: 3,
};

export const avrUno: Board = {
  id: 'avr-uno',
  fqbn: 'arduino:avr:uno',
  clockHz: UNO_CLOCK_HZ,
  pins: UNO_PINS,
  electrical: UNO_ELECTRICAL,
  power: {
    rails: [
      { id: '5V', volts: 5, maxCurrentMa: 500 }, // USB polyfuse
      { id: '3V3', volts: 3.3, maxCurrentMa: 150 }, // LP2985
      { id: 'VIN', volts: 9, maxCurrentMa: 1000 },
    ],
    regulator: { minInV: 7, maxInV: 12, dropoutV: 1.2 }, // NCP1117 recommended input window
    mcuPackageMaxCurrentMa: 200,
  },
  upload: { protocol: 'stk500v1', baud: 115_200, signature: [0x1e, 0x95, 0x0f], flashBytes: 32_256 },
  createCore(fw: FirmwareImage): McuCore {
    return AvrUnoCore.fromFirmware(fw);
  },
};
