import { describe, expect, it } from 'vitest';
import { SimClient } from './client.js';
import { SimHost } from './host.js';
import type { MeasureProbe, WorkerToMain } from './protocol.js';
import { SCOPE_BUFFER_SLICES, ScopeBuffer } from './scope.js';

/** `slices` rows of `channels` channels, reading `[k, k + 0.25, k + 0.5]` + 100·channel for slice `k`. */
function rows(from: number, slices: number, channels: number): Float32Array {
  const d = new Float32Array(slices * channels * 3);
  for (let k = 0; k < slices; k++)
    for (let c = 0; c < channels; c++) {
      const o = (k * channels + c) * 3;
      d[o] = from + k + 100 * c;
      d[o + 1] = from + k + 0.25 + 100 * c;
      d[o + 2] = from + k + 0.5 + 100 * c;
    }
  return d;
}

describe('ScopeBuffer (TD §18.3)', () => {
  it('wraps: keeps the newest `capacity` slices, keyed by slice number', () => {
    const b = new ScopeBuffer(2, [], 10);
    for (let from = 5; from < 30; from += 5) b.append(from, 5, rows(from, 5, 2));
    expect([b.start, b.end, b.length]).toEqual([20, 30, 10]);
    expect(b.value(0, 20)).toBe(20);
    expect(b.value(1, 29, 2)).toBe(129.5);
    expect(b.value(0, 19)).toBeNaN();
    expect(b.value(0, 30)).toBeNaN();
  });

  it('a batch that does not continue the ring starts it over', () => {
    const b = new ScopeBuffer(1, [], 100);
    b.append(0, 10, rows(0, 10, 1));
    b.append(50, 3, rows(50, 3, 1));
    expect([b.start, b.end]).toEqual([50, 53]);
    expect(b.value(0, 5)).toBeNaN();
  });

  it('caps the main-thread history at 60 s', () => {
    const b = new ScopeBuffer(4);
    for (let from = 0; from < 61_000; from += 1000) b.append(from, 1000, rows(from, 1000, 4));
    expect(b.length).toBe(SCOPE_BUFFER_SLICES);
    expect(b.start).toBe(1000);
    expect(b.data.byteLength).toBe(60_000 * 4 * 3 * 4); // 2.9 MB
  });

  it('fine samples: per channel in time order, trimmed to the last 10 s, cleared by a new run', () => {
    const b = new ScopeBuffer(2);
    b.append(0, 100, rows(0, 100, 2));
    b.appendFine(true, Float64Array.from([0, 0.0005, 1, 1, 0.0005, 2, 0, 0.001, 3]));
    const f = b.fine(0);
    expect([...f.t.subarray(f.from, f.to)]).toEqual([0.0005, 0.001]);
    expect([...f.v.subarray(f.from, f.to)]).toEqual([1, 3]);
    expect(b.fine(1).to - b.fine(1).from).toBe(1);
    expect(b.reactive).toBe(true);
    b.append(100, 12_000, rows(100, 12_000, 2)); // 12.1 s of readings: the old samples age out
    b.appendFine(true, Float64Array.from([0, 12.05, 4]));
    const g = b.fine(0);
    expect([...g.t.subarray(g.from, g.to)]).toEqual([12.05]);
    b.append(0, 5, rows(0, 5, 2)); // a new run
    expect(b.fine(0).to - b.fine(0).from).toBe(0);
  });

  it('PWM changes apply from their slice; the one describing the oldest slices is kept', () => {
    const b = new ScopeBuffer(2, [], 10);
    b.append(0, 5, rows(0, 5, 2), Float64Array.from([0, 0, 976.5625, 0.5, 3, 0, 490, 0.25, 3, 1, 1000, 0.1]));
    expect(b.pwmAt(0, 2)).toEqual({ slice: 0, freqHz: 976.5625, duty: 0.5 });
    expect(b.pwmAt(0, 4)?.freqHz).toBe(490);
    expect(b.pwmAt(1, 2)).toBeNull();
    b.append(5, 10, rows(5, 10, 2), Float64Array.from([12, 0, 0, 0]));
    expect(b.start).toBe(5);
    expect(b.pwmAt(0, 6)?.freqHz).toBe(490); // the change at slice 3 still holds at the ring start
    expect(b.pwmAt(0, 12)).toBeNull(); // freqHz 0: no longer PWM
  });
});

function harness() {
  const wall = 0;
  const messages: WorkerToMain[] = [];
  const client = new SimClient();
  const host = new SimHost(
    (m) => {
      messages.push(m);
      client.receive(m);
    },
    () => wall,
  );
  return { host, client, messages };
}

const D = (pin: string): MeasureProbe => ({ kind: 'v', red: { part: 'board', pin }, black: null });

describe('scope channel through host and client (FR-SIM-14)', () => {
  it('folds every slice into the client buffer, with the PWM of D5 (976.6 Hz, 50 %)', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'rgb-melody' });
    h.host.handle({ type: 'measure', channel: 'scope', probes: [D('D5'), D('D9'), D('D2')] });
    for (let k = 0; k < 20; k++) h.host.handle({ type: 'control', action: 'step' }); // 10 slices each
    const s = h.client.scope;
    expect(s?.channels).toBe(3);
    expect(s?.length).toBe(200);
    const last = (s?.end ?? 0) - 1;
    expect(s?.pwmAt(0, last)).toMatchObject({ freqHz: 976.5625, duty: 0.5 });
    expect(s?.value(0, last, 1)).toBeLessThan(0.5); // low phase
    expect(s?.value(0, last, 2)).toBeGreaterThan(4); // high phase
    expect(s?.value(0, last)).toBeCloseTo(((s?.value(0, last, 1) ?? 0) + (s?.value(0, last, 2) ?? 0)) / 2, 1);
    expect(s?.pwmAt(2, last)).toBeNull();
  });

  it('caps the scope at 4 channels; a new subscription starts a new buffer; a load clears it', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'rgb-melody' });
    h.host.handle({
      type: 'measure',
      channel: 'scope',
      probes: ['D2', 'D5', 'D6', 'D8', 'D9'].map(D),
    });
    for (let k = 0; k < 20; k++) h.host.handle({ type: 'control', action: 'step' });
    expect(h.client.scope?.channels).toBe(4);
    h.host.handle({ type: 'measure', channel: 'scope', probes: [D('D5')] });
    h.host.handle({ type: 'control', action: 'step' }); // one step: 10 slices
    expect(h.client.scope?.channels).toBe(1);
    expect(h.client.scope?.length).toBe(10);
    h.host.handle({ type: 'control', action: 'reset' });
    expect(h.client.scope?.length ?? 0).toBe(0);
  });

  it('fine mode: sub-steps reach the client; toggling it keeps the history (same subscription)', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'timer-555' });
    h.host.handle({
      type: 'measure',
      channel: 'scope',
      probes: [{ kind: 'v', red: { part: 'timer', pin: 'out' }, black: null }],
    });
    for (let k = 0; k < 5; k++) h.host.handle({ type: 'control', action: 'step' });
    const before = h.client.scope;
    expect(before?.fine(0).to).toBe(0);
    h.host.handle({ type: 'scopeFine', on: true });
    for (let k = 0; k < 5; k++) h.host.handle({ type: 'control', action: 'step' });
    expect(h.client.scope).toBe(before);
    expect(before?.length).toBe(100);
    expect(before?.reactive).toBe(true);
    const f = before?.fine(0);
    expect((f?.to ?? 0) - (f?.from ?? 0)).toBeGreaterThanOrEqual(50); // ≥ 1 per slice
    expect(f?.t[(f?.to ?? 1) - 1]).toBeCloseTo((before?.end ?? 0) / 1000 - 0.001, 9);
    h.host.handle({ type: 'scopeFine', on: false });
    const n = f?.to;
    for (let k = 0; k < 3; k++) h.host.handle({ type: 'control', action: 'step' });
    expect(h.client.scope?.fine(0).to).toBe(n);
  });

  it('fine mode on a circuit without sub-steps tells the client it is not reactive', () => {
    const h = harness();
    h.host.handle({ type: 'scopeFine', on: true }); // before load: kept for the run
    h.host.handle({ type: 'load', scenario: 'blink' });
    h.host.handle({ type: 'measure', channel: 'scope', probes: [D('D13')] });
    for (let k = 0; k < 3; k++) h.host.handle({ type: 'control', action: 'step' });
    expect(h.client.scope?.reactive).toBe(false);
    expect(h.messages.filter((m) => m.type === 'scopeFine')).toHaveLength(1);
  });

  it('marks probes on parts that are gone as unresolved (NaN)', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'blink' });
    h.host.handle({
      type: 'measure',
      channel: 'scope',
      probes: [D('D13'), { kind: 'v', red: { part: 'ghost', pin: 'a' }, black: null }],
    });
    for (let k = 0; k < 3; k++) h.host.handle({ type: 'control', action: 'step' });
    expect(h.client.scope?.unresolved).toEqual([1]);
    expect(h.client.scope?.value(1, (h.client.scope?.end ?? 1) - 1)).toBeNaN();
  });
});
