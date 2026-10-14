import { SLICES_PER_SECOND, type Simulation } from './scheduler.js';

export interface PacerOptions {
  /** Wall-clock source in milliseconds (e.g. `performance.now`); injected so the engine never reads a clock. */
  readonly now: () => number;
  /** Simulated seconds per wall second. */
  readonly speed?: number;
  /** Maximum wall time spent simulating per tick (ms). */
  readonly budgetMs?: number;
}

export interface TickResult {
  readonly slicesRun: number;
  /** Simulated time advanced / wall time since the previous tick. */
  readonly realTimeFactor: number;
  /** True when the budget ran out before reaching the wall-clock target. */
  readonly behind: boolean;
}

/**
 * Wall-clock pacing (Technical Design §5.3): wall time only decides how many slices to run.
 * When the budget runs out the simulation slows down — it never skips slices (FR-SIM-05).
 */
export class Pacer {
  private speedFactor: number;
  private readonly budgetMs: number;
  private anchorWall = 0;
  private anchorSlice = 0;
  private lastTickWall = 0;
  private running = false;

  constructor(
    private readonly sim: Simulation,
    private readonly options: PacerOptions,
  ) {
    this.speedFactor = options.speed ?? 1;
    this.budgetMs = options.budgetMs ?? 12;
  }

  get speed(): number {
    return this.speedFactor;
  }

  start(): void {
    this.running = true;
    this.rebase(this.options.now());
  }

  pause(): void {
    this.running = false;
  }

  setSpeed(speed: number): void {
    if (!(speed > 0)) throw new RangeError(`Speed must be > 0, got ${speed}`);
    this.speedFactor = speed;
    this.rebase(this.options.now());
  }

  tick(): TickResult {
    const tickStart = this.options.now();
    if (!this.running) return { slicesRun: 0, realTimeFactor: 0, behind: false };
    const target =
      this.anchorSlice +
      Math.floor(((tickStart - this.anchorWall) * this.speedFactor * SLICES_PER_SECOND) / 1000);
    const startSlice = this.sim.slice;
    let now = tickStart;
    while (this.sim.slice < target && now - tickStart < this.budgetMs) {
      this.sim.step();
      now = this.options.now();
    }
    const behind = this.sim.slice < target;
    if (behind) this.rebase(now); // slow down instead of trying to catch up forever
    const slicesRun = this.sim.slice - startSlice;
    const wallSinceLast = now - this.lastTickWall;
    this.lastTickWall = now;
    const realTimeFactor = wallSinceLast > 0 ? (slicesRun * 1000) / SLICES_PER_SECOND / wallSinceLast : 0;
    return { slicesRun, realTimeFactor, behind };
  }

  private rebase(now: number): void {
    this.anchorWall = now;
    this.anchorSlice = this.sim.slice;
    this.lastTickWall = now;
  }
}
