import { createI18n } from '@robosim/i18n';
import type { ProjectDocument } from '@robosim/shared';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CircuitCanvas } from './circuit-canvas.js';
import { addComponent, addWire, blankProject, pinNamesOf } from './document.js';
import { PITCH, pinPosition } from './geometry.js';
import { useCircuitEditor, type CircuitEditorState } from './use-circuit-editor.js';

/*
 * Canvas frame budget (FR-CIR-06: 60 FPS at 200 components and 400 wires) in headless Chromium and Firefox.
 * Four full breadboards and 196 parts with 400 bent wires on a 1280 × 800 canvas; each interaction step is
 * one pointer or wheel event per animation frame. Two numbers per step:
 *  - work: the event, React's render and commit, and style + layout (forced), timed on the main thread;
 *  - frame: the interval between animation frames, which also pays for paint. A frame over 1.5 × 16.7 ms
 *    is a dropped frame.
 * Gated on the p95 of each, the best of BATCHES batches (OS / GC hiccups rarely hit all of them).
 * ROBOSIM_PERF_SCALE (via the browser config's `define`) scales the budget for slower machines.
 */

declare const __PERF_SCALE__: number;
const FRAME_MS = 1000 / 60;
const WORK_BUDGET_MS = FRAME_MS * __PERF_SCALE__;
const FRAME_BUDGET_MS = 1.5 * FRAME_MS * __PERF_SCALE__;
const STEPS = 60;
const BATCHES = 3;

const TYPES = [
  'passive.resistor',
  'actuator.led',
  'sensor.push-button',
  'ic.74hc595',
  'passive.potentiometer',
  'passive.capacitor-ceramic',
  'semiconductor.2n2222',
  'sensor.hc-sr04',
  'driver.l298n',
  'actuator.sg90-servo',
  'display.oled-ssd1306',
  'sensor.mpu6050',
] as const;

/** 4 full breadboards, 196 parts (some plugged in), 400 wires with a bend each; deterministic. */
function bigCircuit(): ProjectDocument {
  let doc = blankProject('perf', '');
  for (let i = 0; i < 4; i++)
    doc = addComponent(doc, 'passive.breadboard-full', [
      (15 + (i % 2) * 70) * PITCH,
      (30 + Math.floor(i / 2) * 26) * PITCH,
    ]).doc;
  for (let i = 0; i < 196; i++) {
    const type = TYPES[i % TYPES.length] as string;
    const gx = i < 60 ? 18 + (i % 30) * 4 + (i >= 30 ? 70 - 60 : 0) : -60 - (i % 14) * 14;
    const gy = i < 60 ? 33 + (i >= 30 ? 26 : 0) : -10 + Math.floor(i / 14) * 12;
    doc = addComponent(doc, type, [gx * PITCH, gy * PITCH]).doc;
  }
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const parts = doc.components.filter((c) => !c.type.startsWith('passive.breadboard'));
  const pick = () => {
    const c = parts[rnd(parts.length)] as (typeof parts)[number];
    const pins = pinNamesOf(c.type);
    return { part: c.id, pin: pins[rnd(pins.length)] as string };
  };
  while (doc.wires.length < 400) {
    const from = pick();
    const to = pick();
    const a = pinPosition(doc, from, pinNamesOf);
    const b = pinPosition(doc, to, pinNamesOf);
    if (!a || !b) continue;
    doc = addWire(
      doc,
      from,
      to,
      [[Math.round(a[0] / PITCH) * PITCH, Math.round(b[1] / PITCH) * PITCH]],
      'yellow',
    ).doc;
  }
  return doc;
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
/**
 * Resolves after React has rendered and committed what an event scheduled. React's scheduler queues its work
 * as a posted message from a microtask; a message posted after that one runs after it (FIFO).
 */
const channel = new MessageChannel();
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => {
    channel.port1.onmessage = resolve;
    channel.port2.postMessage(0);
  });
};
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? NaN;

let host: HTMLDivElement;
let editor: CircuitEditorState;
let svg: SVGSVGElement;
let unmount: () => void;

beforeAll(async () => {
  // Synthetic pointers are never "active": capture would throw.
  Element.prototype.setPointerCapture = () => {};
  const i18n = await createI18n({ lng: 'en', plugins: [initReactI18next] });
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;width:1280px;height:800px';
  const style = document.createElement('style');
  style.textContent =
    '.perf-canvas{position:relative;width:1280px;height:800px;overflow:hidden} .perf-canvas>svg{display:block;width:100%;height:100%}';
  document.head.append(style);
  document.body.append(host);
  const doc = bigCircuit();
  expect(doc.components).toHaveLength(200);
  expect(doc.wires).toHaveLength(400);
  function Harness() {
    editor = useCircuitEditor(doc);
    return <CircuitCanvas editor={editor} className="perf-canvas" />;
  }
  const root = createRoot(host);
  root.render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  for (let i = 0; i < 5; i++) await nextFrame();
  svg = host.querySelector('svg[role="application"]') as SVGSVGElement;
  unmount = () => root.unmount();
});

afterAll(() => {
  unmount();
  host.remove();
});

const pointer = (type: string, target: Element, x: number, y: number, button = 0) =>
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, pointerId: 1 }),
  );

/** Runs `step` once per animation frame; returns work and frame-interval samples per batch. */
async function measure(setup: () => void, step: (i: number) => void, teardown: () => void) {
  const batches: { work: number[]; frame: number[] }[] = [];
  for (let b = 0; b < BATCHES; b++) {
    setup();
    await settle();
    const work: number[] = [];
    const frame: number[] = [];
    let last = await nextFrame();
    for (let i = 0; i < STEPS + 5; i++) {
      // Start after this frame's paint, in a task of its own: paint shows up in the frame interval.
      await settle();
      const t0 = performance.now();
      step(i);
      await settle();
      svg.getBoundingClientRect();
      const t1 = performance.now();
      const now = await nextFrame();
      // The first frames after setup warm up caches.
      if (i >= 5) {
        work.push(t1 - t0);
        frame.push(now - last);
      }
      last = now;
    }
    teardown();
    await settle();
    batches.push({ work, frame });
  }
  const best = (key: 'work' | 'frame') => Math.min(...batches.map((x) => p95(x[key])));
  return { batches, best };
}

async function check(name: string, setup: () => void, step: (i: number) => void, teardown: () => void) {
  const { best } = await measure(setup, step, teardown);
  return { name, work: best('work'), frame: best('frame') };
}

describe('circuit canvas at 200 parts and 400 wires', () => {
  const report = (r: { name: string; work: number; frame: number }) => {
    const numbers = `${r.name}: work p95 ${r.work.toFixed(2)} ms, frame p95 ${r.frame.toFixed(2)} ms`;
    expect(r.work, numbers).toBeLessThan(WORK_BUDGET_MS);
    expect(r.frame, numbers).toBeLessThan(FRAME_BUDGET_MS);
  };

  it('pans at 60 FPS', async () => {
    report(
      await check(
        'pan',
        () => pointer('pointerdown', svg, 600, 400, 1),
        (i) => pointer('pointermove', svg, 600 + (i % 30) * 8, 400 + (i % 30) * 4),
        () => pointer('pointerup', svg, 600, 400),
      ),
    );
  });

  it('zooms with the wheel at 60 FPS', async () => {
    report(
      await check(
        'wheel zoom',
        () => {},
        (i) =>
          svg.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              clientX: 640,
              clientY: 400,
              deltaY: i % 20 < 10 ? -40 : 40,
            }),
          ),
        () => {},
      ),
    );
  });

  it('drags one part with its wires at 60 FPS', async () => {
    const body = () => host.querySelector('[data-part-body="led2"] *') as Element;
    report(
      await check(
        'drag part',
        () => pointer('pointerdown', body(), 300, 300),
        (i) => pointer('pointermove', svg, 300 + (i % 30) * 6, 300 + (i % 30) * 3),
        () => {
          pointer('pointerup', svg, 300, 300);
          editor.undo();
        },
      ),
    );
  });

  it('drags a group of twenty parts at 60 FPS', async () => {
    const ids = editor.doc.components.slice(-20).map((c) => c.id);
    const body = () => host.querySelector(`[data-part-body="${ids[0]}"] *`) as Element;
    report(
      await check(
        'drag group',
        () => {
          editor.setSelection({ parts: ids, wire: null });
        },
        (i) => {
          if (i === 0) pointer('pointerdown', body(), 300, 300);
          else pointer('pointermove', svg, 300 + (i % 30) * 6, 300 + (i % 30) * 3);
        },
        () => {
          pointer('pointerup', svg, 300, 300);
          editor.undo();
        },
      ),
    );
  });

  it('highlights nets under a moving pointer at 60 FPS', async () => {
    const pins = [...host.querySelectorAll('circle[data-pin]')].slice(0, 80);
    report(
      await check(
        'hover',
        () => {},
        (i) => pointer('pointerover', pins[i % pins.length] as Element, 0, 0),
        () => pointer('pointerleave', svg, 0, 0),
      ),
    );
  });
});
