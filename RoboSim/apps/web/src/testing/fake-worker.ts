import {
  SnapshotEncoder,
  packSnapshot,
  type Frame,
  type MainToWorker,
  type SceneInfo,
  type WorkerToMain,
} from '@robosim/sim-runtime/client';
import { act } from '@testing-library/react';
import type { WorkerLike } from '../lab/use-simulation.js';

/** In-memory stand-in for the simulation worker: records commands, lets the test push replies. */
export class FakeWorker implements WorkerLike {
  sent: MainToWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerToMain>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: MainToWorker): void {
    this.sent.push(message);
  }
  terminate(): void {}
  private encoder = new SnapshotEncoder();
  reply(msg: WorkerToMain): void {
    act(() => this.onmessage?.({ data: msg } as MessageEvent<WorkerToMain>));
  }
  load(scene: SceneInfo, replaying = 0): void {
    this.encoder = new SnapshotEncoder();
    this.reply({ type: 'loaded', scene, seed: 1, engineVersion: 'test', replaying });
  }
  /** Publishes a frame the way SimHost does: events, dictionary, then a transferred snapshot. */
  frame({ faults, findings, damaged, ...hot }: Frame): void {
    this.reply({ type: 'findings', findings });
    this.reply({ type: 'faults', faults });
    this.reply({ type: 'damaged', damaged });
    const e = this.encoder.encode(hot);
    if (e.delta) this.reply({ type: 'dict', delta: e.delta });
    this.reply({ type: 'snapshot', buffer: packSnapshot(e.count, e.values, e.tags) });
  }
}
