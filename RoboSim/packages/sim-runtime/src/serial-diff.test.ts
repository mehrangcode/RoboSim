import { describe, expect, it } from 'vitest';
import { SimClient } from './client.js';
import { grade } from './grade.js';
import { SimHost } from './host.js';
import type { InputLog, WorkerToMain } from './protocol.js';
import { serialLines } from './serial.js';
import { DIFF_MAX_LINES, diffSerial, textLines, verifiedLines, type DiffLine } from './serial-diff.js';

const timed = (...xs: [number, string][]): DiffLine[] => xs.map(([slice, text]) => ({ slice, text }));
const untimed = (...xs: string[]): DiffLine[] => xs.map((text) => ({ text }));

describe('diffSerial (FR-SIM-21)', () => {
  it('reports identical logs with no divergence', () => {
    const a = timed([1, 'ready'], [1000, 'tick 0'], [2000, 'tick 1']);
    const d = diffSerial(a, [...a]);
    expect(d.firstDivergence).toBeNull();
    expect(d.counts).toEqual({ added: 0, removed: 0, timing: 0 });
    expect(d.ops?.every((o) => o.kind === 'equal')).toBe(true);
    expect(diffSerial([], []).firstDivergence).toBeNull();
  });

  it('marks one changed line with the first differing column', () => {
    const d = diffSerial(
      untimed('ready', 'tick 0', 'tick 1', 'end'),
      untimed('ready', 'tick 0', 'tock 1', 'end'),
    );
    expect(d.firstDivergence).toEqual({ lineA: 2, lineB: 2, column: 1, reason: 'text' });
    expect(d.counts).toEqual({ added: 1, removed: 1, timing: 0 });
    expect(d.ops?.map((o) => o.kind)).toEqual(['equal', 'equal', 'removed', 'added', 'equal']);
  });

  it('aligns an insertion and keeps the rest equal', () => {
    const d = diffSerial(untimed('a', 'b', 'c', 'd'), untimed('a', 'b', 'NEW', 'c', 'd'));
    expect(d.firstDivergence).toMatchObject({ lineA: 2, lineB: 2, reason: 'text' });
    expect(d.ops).toEqual([
      { kind: 'equal', a: 0, b: 0 },
      { kind: 'equal', a: 1, b: 1 },
      { kind: 'added', b: 2 },
      { kind: 'equal', a: 2, b: 3 },
      { kind: 'equal', a: 3, b: 4 },
    ]);
  });

  it('reports a log that ends early as a length divergence', () => {
    const d = diffSerial(untimed('a', 'b', 'c'), untimed('a', 'b'));
    expect(d.firstDivergence).toEqual({ lineA: 2, lineB: 2, column: 0, reason: 'length' });
    expect(d.counts.removed).toBe(1);
  });

  it('finds a timing-only divergence unless timing is ignored or within tolerance', () => {
    const a = timed([1, 'x'], [1000, 'y'], [2000, 'z']);
    const b = timed([1, 'x'], [1003, 'y'], [2000, 'z']);
    const d = diffSerial(a, b);
    expect(d.firstDivergence).toEqual({ lineA: 1, lineB: 1, column: 0, reason: 'timing' });
    expect(d.counts.timing).toBe(1);
    expect(d.ops?.[1]).toEqual({ kind: 'equal', a: 1, b: 1, timing: true });
    expect(diffSerial(a, b, { ignoreTiming: true }).firstDivergence).toBeNull();
    expect(diffSerial(a, b, { timingToleranceMs: 3 }).firstDivergence).toBeNull();
    // An untimed side (imported .txt) compares text only.
    expect(diffSerial(a, untimed('x', 'y', 'z')).firstDivergence).toBeNull();
  });

  it('agrees with an edit-script check on random logs', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let t = 0; t < 50; t++) {
      const a = untimed(
        ...Array.from({ length: 30 + Math.floor(rnd() * 30) }, () => String(Math.floor(rnd() * 5))),
      );
      const b = untimed(
        ...Array.from({ length: 30 + Math.floor(rnd() * 30) }, () => String(Math.floor(rnd() * 5))),
      );
      const d = diffSerial(a, b);
      // Replaying the ops rebuilds both sides in order.
      const ra: string[] = [];
      const rb: string[] = [];
      for (const o of d.ops ?? []) {
        if (o.kind !== 'added') ra.push(a[o.a]?.text ?? '?');
        if (o.kind !== 'removed') rb.push(b[o.b]?.text ?? '?');
        if (o.kind === 'equal') expect(a[o.a]?.text).toBe(b[o.b]?.text);
      }
      expect(ra).toEqual(a.map((l) => l.text));
      expect(rb).toEqual(b.map((l) => l.text));
    }
  });

  it('falls back to a linear first-divergence scan past the caps', () => {
    const big = untimed(...Array.from({ length: DIFF_MAX_LINES + 1 }, (_, i) => `line ${i}`));
    const other = big.map((l, i) => (i === 12345 ? { text: 'changed' } : l));
    const d = diffSerial(big, other);
    expect(d.tooLarge).toBe(true);
    expect(d.ops).toBeNull();
    expect(d.firstDivergence).toEqual({ lineA: 12345, lineB: 12345, column: 0, reason: 'text' });
    const far = diffSerial(untimed(...'abcdefgh'.split('')), untimed(...'12345678'.split('')), { maxD: 4 });
    expect(far).toMatchObject({ tooLarge: true, firstDivergence: { lineA: 0, reason: 'text' } });
  });

  it('diffs 10 k lines with a few edits quickly', () => {
    const a = untimed(...Array.from({ length: 10_000 }, (_, i) => `t=${i} v=${(i * 7) % 1024}`));
    const b = a.map((l, i) => (i % 200 === 0 ? { text: `${l.text}!` } : l));
    const t0 = performance.now();
    const d = diffSerial(a, b);
    expect(performance.now() - t0).toBeLessThan(500); // TD budget 50 ms, checked loosely on shared CI
    expect(d.counts).toEqual({ added: 50, removed: 50, timing: 0 });
  });
});

describe('textLines', () => {
  it('splits decoded chunks on CR, LF and CRLF across chunk boundaries', () => {
    expect(
      textLines([
        { slice: 3, text: 'Robo' },
        { slice: 4, text: 'Sim\r' },
        { slice: 5, text: '\nok\nlast' },
      ]),
    ).toEqual([
      { slice: 3, text: 'RoboSim' },
      { slice: 5, text: 'ok' },
      { slice: 5, text: 'last' },
    ]);
    expect(textLines([{ slice: 1, text: 'a\r\rb\n\n' }]).map((l) => l.text)).toEqual(['a', '', 'b', '']);
  });
});

describe('live run vs verified run', () => {
  it('a live run of the serial demo and grade() of its log do not diverge', () => {
    let wall = 0;
    const client = new SimClient();
    let log = null as InputLog | null;
    client.onInputLog = (l) => (log = l);
    const host = new SimHost(
      (m: WorkerToMain) => client.receive(m),
      () => wall,
    );
    host.handle({ type: 'load', scenario: 'serial' });
    host.handle({ type: 'control', action: 'run' });
    for (let t = 0; t < 600; t += 16) {
      wall += 16;
      host.tick();
    }
    host.handle({ type: 'speed', value: 4 });
    for (let t = 0; t < 1200; t += 16) {
      wall += 16;
      host.tick();
    }
    host.handle({ type: 'control', action: 'pause' });
    host.handle({ type: 'exportLog' });
    if (!log || !client.frame) throw new Error('no log');

    const live = serialLines(client.serialArchive.chunks, 115200);
    expect(live.length).toBeGreaterThan(2);
    const r = grade({ log, maxSimSeconds: client.frame.simTime });
    const verified = verifiedLines(r.trace.serial);
    expect(verified[0]).toEqual({ slice: live[0]?.slice, text: 'RoboSim ready' });
    expect(diffSerial(live, verified).firstDivergence).toBeNull();
    // A monitor at the wrong baud shows garbled text, so the diff reports text (the UI hints "baud differs").
    expect(diffSerial(serialLines(client.serialArchive.chunks, 9600), verified).firstDivergence?.reason).toBe(
      'text',
    );
  }, 30_000);

  it('keeps the previous run archive when a new run loads', () => {
    let wall = 0;
    const client = new SimClient();
    const host = new SimHost(
      (m: WorkerToMain) => client.receive(m),
      () => wall,
    );
    const run = (ms: number) => {
      host.handle({ type: 'load', scenario: 'serial' });
      host.handle({ type: 'control', action: 'run' });
      for (let t = 0; t < ms; t += 16) {
        wall += 16;
        host.tick();
      }
    };
    run(1500);
    const first = client.serialArchive;
    expect(first.chunks.length).toBeGreaterThan(0);
    expect(client.previousSerial).toBeNull();
    run(100);
    expect(client.previousSerial).toBe(first);
    expect(client.serialArchive).not.toBe(first);
    expect(client.serialArchive.truncated).toBe(false);
  }, 30_000);
});
