import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
} from '@robosim/sim-core';

export interface ResistorProps {
  readonly ohms: number;
  readonly powerRatingMw: number;
}

export interface ResistorState {
  readonly currentMa: number;
  readonly powerMw: number;
  readonly damaged: boolean;
}

export class Resistor implements ComponentModel<ResistorProps, ResistorState>, Damageable {
  readonly type = 'passive.resistor';
  private id = '';
  private a: NetId = 0;
  private b: NetId = 0;
  private props: ResistorProps = { ohms: 220, powerRatingMw: 250 };
  private currentA = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext, props: ResistorProps): void {
    this.id = ctx.id;
    this.a = ctx.net('a');
    this.b = ctx.net('b');
    this.props = props;
  }

  stamp(s: MnaStamper): void {
    if (this.damaged) return; // burnt open
    s.conductance(this.a, this.b, 1 / this.props.ohms);
  }

  step(_dt: number, io: ComponentIO): void {
    this.currentA = this.damaged
      ? 0
      : (io.solution.voltage(this.a) - io.solution.voltage(this.b)) / this.props.ohms;
  }

  faults(): readonly Fault[] {
    const powerMw = this.powerMw();
    return powerMw > this.props.powerRatingMw
      ? [
          {
            code: 'OVER_POWER',
            componentId: this.id,
            params: { powerMw, ratingMw: this.props.powerRatingMw },
          },
        ]
      : [];
  }

  snapshot(): ResistorState {
    return { currentMa: this.currentA * 1000, powerMw: this.powerMw(), damaged: this.damaged };
  }

  private powerMw(): number {
    return this.currentA * this.currentA * this.props.ohms * 1000;
  }
}
