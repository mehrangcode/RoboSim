import type { Frame } from '@robosim/sim-runtime/client';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWorker } from '../testing/fake-worker.js';
import { STALL_MS, useSimulation } from './use-simulation.js';

const frame = (over: Partial<Frame> = {}): Frame => ({
  seq: 1,
  simTime: 1,
  rtf: 1,
  running: true,
  parts: {},
  pins: {},
  faults: [],
  findings: [],
  damaged: { parts: [], pins: [] },
  ...over,
});

describe('useSimulation: a worker that dies or stops answering', () => {
  let onFrame: FrameRequestCallback | null = null;
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => ((onFrame = cb), 1));
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  /** Animation frames every 100 ms from `from` to `to` (ms). */
  const frames = (from: number, to: number) => {
    for (let t = from; t <= to; t += 100) act(() => onFrame?.(t));
  };

  function setup() {
    const workers: FakeWorker[] = [];
    // Stable, like the default factory or a page's prop.
    const createWorker = () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    };
    const hook = renderHook(() => useSimulation(createWorker));
    return { hook, workers };
  }

  it('reports a running simulation whose frames stop arriving, and clears it when they resume', () => {
    const { hook, workers } = setup();
    workers[0]?.frame(frame({ seq: 1 }));
    frames(100, STALL_MS);
    expect(hook.result.current.stalled).toBe(false);
    frames(STALL_MS + 100, STALL_MS + 1000);
    expect(hook.result.current.stalled).toBe(true);
    workers[0]?.frame(frame({ seq: 2 }));
    frames(STALL_MS + 1100, STALL_MS + 1100);
    expect(hook.result.current.stalled).toBe(false);
  });

  it('does not call a paused run or a hidden tab stalled', () => {
    const { hook, workers } = setup();
    workers[0]?.frame(frame({ running: false }));
    frames(100, 2 * STALL_MS);
    expect(hook.result.current.stalled).toBe(false);
    workers[0]?.frame(frame({ seq: 2, running: true }));
    frames(2 * STALL_MS + 100, 2 * STALL_MS + 100);
    act(() => onFrame?.(4 * STALL_MS)); // the tab came back after a long time hidden
    expect(hook.result.current.stalled).toBe(false);
  });

  it('restarts a crashed worker with a fresh one that receives the next commands', () => {
    const { hook, workers } = setup();
    act(() => workers[0]?.onerror?.({ message: 'RangeError: boom' } as ErrorEvent));
    expect(hook.result.current.error).toBe('RangeError: boom');
    act(() => hook.result.current.restart());
    expect(workers).toHaveLength(2);
    expect(hook.result.current.error).toBeNull();
    hook.result.current.send({ type: 'control', action: 'run' });
    expect(workers[1]?.sent).toEqual([{ type: 'control', action: 'run' }]);
    expect(workers[0]?.sent).toEqual([]);
  });
});
