import {
  dmath,
  toWorld,
  type ComponentIO,
  type ComponentModel,
  type Damageable,
  type Fault,
  type MnaStamper,
  type ModelContext,
  type NetId,
} from '@robosim/sim-core';

export interface BumpSwitchProps {
  /** How far the lever reaches past the switch body (mm). */
  readonly leverMm: number;
}

export interface BumpSwitchState {
  readonly pressed: boolean;
  /** Pressed by a wall or obstacle in the arena (not by the user). */
  readonly bumped: boolean;
  readonly mounted: boolean;
  readonly contactMa: number;
  readonly damaged: boolean;
}

/** KW12-3 microswitch: 12.8 mm body, contacts ≈ 50 mΩ, rated 5 A. */
const BODY_HALF_MM = 6.5;
const LEVER_HALF_WIDTH_MM = 4;
const CONTACT_OHMS = 0.05;
const MAX_A = 5;

/**
 * Lever microswitch for bumpers and limit stops (Technical Design §5.5): COM–NO closes while pressed,
 * COM–NC while released. On a robot the lever is three short ray casts ahead of the switch: a wall or
 * obstacle within the lever's reach presses it (before the chassis touches). On the bench it is a
 * button.
 */
export class BumpSwitch implements ComponentModel<BumpSwitchProps, BumpSwitchState>, Damageable {
  readonly type = 'sensor.bump-switch';
  private id = '';
  private com: NetId = 0;
  private no: NetId = 0;
  private nc: NetId = 0;
  private leverMm = 12;
  private held = false;
  private bumped = false;
  private mounted = false;
  private stamped: boolean | null = null;
  private contactA = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true; // welded contacts: stuck in the position it failed in
  }

  init(ctx: ModelContext, props: BumpSwitchProps): void {
    this.id = ctx.id;
    this.com = ctx.net('com');
    this.no = ctx.net('no');
    this.nc = ctx.net('nc');
    this.leverMm = props.leverMm;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'pressed' || typeof value !== 'boolean')
      throw new Error(`${this.type}: bad input '${name}'`);
    this.held = value;
  }

  stamp(s: MnaStamper): void {
    if (!this.damaged || this.stamped === null) this.stamped = this.pressed();
    s.conductance(this.com, this.stamped ? this.no : this.nc, 1 / CONTACT_OHMS);
  }

  step(_dt: number, io: ComponentIO): void {
    const pose = io.world?.componentPose(this.id) ?? null;
    this.mounted = pose !== null;
    this.bumped = false;
    if (pose && io.world) {
      const reachM = (BODY_HALF_MM + this.leverMm) / 1000;
      const dir = { x: dmath.cos(pose.angle), y: dmath.sin(pose.angle) };
      for (const dy of [-LEVER_HALF_WIDTH_MM, 0, LEVER_HALF_WIDTH_MM]) {
        const hit = io.world.raycast(toWorld(pose, { x: 0, y: dy }), dir, reachM);
        if (hit && hit.bodyId !== 'robot' && hit.distance <= reachM) this.bumped = true;
      }
    }
    const other = this.stamped ? this.no : this.nc;
    this.contactA = Math.abs(io.solution.voltage(this.com) - io.solution.voltage(other)) / CONTACT_OHMS;
    if (!this.damaged && this.pressed() !== this.stamped) io.invalidate();
  }

  faults(): readonly Fault[] {
    return this.contactA > MAX_A
      ? [
          {
            code: 'OVER_CURRENT',
            componentId: this.id,
            params: { currentMa: this.contactA * 1000, limitMa: MAX_A * 1000 },
          },
        ]
      : [];
  }

  snapshot(): BumpSwitchState {
    return {
      pressed: this.stamped ?? false,
      bumped: this.bumped,
      mounted: this.mounted,
      contactMa: this.contactA * 1000,
      damaged: this.damaged,
    };
  }

  private pressed(): boolean {
    return this.held || this.bumped;
  }
}
