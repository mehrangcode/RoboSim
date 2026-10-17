import type {
  BodySnapshot,
  ComponentIO,
  ComponentModel,
  Fault,
  MnaStamper,
  ModelContext,
} from '@robosim/sim-core';
import { chassisGeometry, type Chassis2wdProps, type ChassisGeometry } from './geometry.js';

export { chassisGeometry, type Chassis2wdProps, type ChassisGeometry, type MountSlot } from './geometry.js';

export interface Chassis2wdState {
  readonly geometry: ChassisGeometry;
  /** Robot pose from the world, or null on the bench. */
  readonly pose: BodySnapshot | null;
}

/**
 * Two-wheel differential chassis with rear caster. Purely mechanical: no circuit stamp. The world
 * model (slice 4) creates the rigid body from {@link chassisGeometry} and drives the wheels from the
 * TT motors mounted in the motor slots.
 */
export class Chassis2wd implements ComponentModel<Chassis2wdProps, Chassis2wdState> {
  readonly type = 'mechanical.chassis-2wd';
  private geometry: ChassisGeometry | null = null;
  private pose: BodySnapshot | null = null;

  init(_ctx: ModelContext, props: Chassis2wdProps): void {
    this.geometry = chassisGeometry(props);
  }

  stamp(_s: MnaStamper): void {}

  step(_dt: number, io: ComponentIO): void {
    this.pose = io.world?.bodies()[0] ?? null;
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): Chassis2wdState {
    if (!this.geometry) throw new Error('mechanical.chassis-2wd: snapshot before init');
    return { geometry: this.geometry, pose: this.pose };
  }
}
