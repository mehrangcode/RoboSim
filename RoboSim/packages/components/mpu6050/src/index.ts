import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Mpu6050, type Mpu6050Props } from './model.js';

export const definition: ComponentDefinition<Mpu6050Props> = { manifest, create: () => new Mpu6050() };
export { Mpu6050, REG, type Mpu6050Props, type Mpu6050State } from './model.js';
export { manifest } from './manifest.js';
