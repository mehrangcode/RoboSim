import { describe, expect, it } from 'vitest';
import { diffSerialAsync } from './run-diff.js';

const untimed = (n: number, f: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => ({ text: f(i) }));

describe('diffSerialAsync', () => {
  it('runs the worst capped case over several tasks', async () => {
    // D = 1 990, just under the cap.
    const a = untimed(1990, (i) => `a${i}`);
    const b = untimed(1990, (i) => (i % 2 ? `a${i}` : `b${i}`));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const d = await diffSerialAsync(a, b, {}, undefined, 1);
    clearInterval(timer);
    expect(d?.counts).toEqual({ added: 995, removed: 995, timing: 0 });
    expect(ticks).toBeGreaterThan(0); // other tasks ran in between
  });

  it('resolves null once aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    expect(await diffSerialAsync(untimed(3, String), untimed(3, String), {}, ctl.signal)).toBeNull();
  });
});
