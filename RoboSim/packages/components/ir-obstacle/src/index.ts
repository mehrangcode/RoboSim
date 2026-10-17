import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { IrObstacle, type IrObstacleProps } from './model.js';

export const definition: ComponentDefinition<IrObstacleProps> = { manifest, create: () => new IrObstacle() };
export { IrObstacle, type IrObstacleProps, type IrObstacleState } from './model.js';
export { manifest } from './manifest.js';
