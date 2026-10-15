import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '@robosim/shared';
import { SimClient } from './client.js';
import { HeadlessRun } from './input-log.js';
import { SimHost } from './host.js';
import type { InputLog, WorkerToMain } from './protocol.js';
import { ProjectLoadError, buildRun, builtinSource, loadProject } from './scenarios.js';

const blink = () => builtinSource('blink');
const lineFollower = () => builtinSource('line-follower');

/** Problems `loadProject` reports for a modified copy of a built-in project. */
function problems(edit: (doc: ProjectDocument) => ProjectDocument, base = blink()): readonly string[] {
  try {
    loadProject(edit(base.project), base.firmware, 1);
    return [];
  } catch (e) {
    if (e instanceof ProjectLoadError) return e.issues;
    throw e;
  }
}

describe('project loader', () => {
  it('every built-in demo is a valid document that loads', () => {
    for (const id of ['blink', 'button', 'dimmer', 'servo', 'serial', 'line-follower'] as const) {
      const run = buildRun({ scenario: id });
      expect(run.scene.scenario).toBe(id);
      expect(run.scene.title).toBe(builtinSource(id).project.meta.title);
    }
  });

  it('a project load is the same run as the built-in it came from', () => {
    const a = buildRun({ scenario: 'button' });
    const b = buildRun(builtinSource('button'));
    expect(b.scene).toEqual({ ...a.scene, scenario: null });
    for (const s of [a, b]) {
      s.circuit.sim.input('btn', 'pressed', true);
      s.circuit.sim.run(300);
    }
    expect(b.circuit.sim.snapshot()).toEqual(a.circuit.sim.snapshot());
  });

  it('maps board pins: MCU pins in header order, GND to ground, 5V to the rail; the rail is not a part', () => {
    const run = buildRun({ scenario: 'dimmer' });
    expect(run.scene.pins).toEqual(['D6', 'A0']);
    expect(run.scene.parts.map((p) => p.id)).toEqual(['pot', 'r1', 'led']);
  });

  it('builds the robot from the chassis and mounted parts; the chassis is not a circuit part', () => {
    const run = buildRun(lineFollower());
    expect(run.scene.kind).toBe('arena');
    expect(run.scene.parts.map((p) => p.id)).not.toContain('chassis');
    expect(run.scene.robot?.wheels).toHaveLength(2);
    expect(run.lineSensor).toEqual({ id: 'line', spacingMm: 12 });
    expect(run.world?.componentPose('line')).not.toBeNull();
    expect(run.challenge).toBeDefined();
  });

  it('applies initial inputs (switch ON) before slice 0', () => {
    const run = buildRun(lineFollower());
    expect(run.circuit.models['sw']?.snapshot()).toMatchObject({ on: true });
  });

  it('turns the Serial Monitor on when the sketch calls Serial.begin', () => {
    expect(buildRun({ scenario: 'serial' }).scene.serial).toBe(true);
    expect(buildRun({ scenario: 'blink' }).scene.serial).toBe(false);
  });

  it('reports every problem at once, with the part, wire or pin involved', () => {
    expect(
      problems((d) => ({
        ...d,
        board: { id: 'esp32', version: '1' },
        components: [
          { ...(d.components[0] as ProjectDocument['components'][number]), typeVersion: '9.9.9' },
          { ...(d.components[1] as ProjectDocument['components'][number]), type: 'actuator.unobtainium' },
        ],
        wires: [
          ...d.wires,
          {
            id: 'x1',
            from: { part: 'r1', pin: 'zz' },
            to: { part: 'board', pin: '3V3' },
            color: 'red',
            points: [],
          },
          {
            id: 'x2',
            from: { part: 'r1', pin: 'a' },
            to: { part: 'board', pin: 'D99' },
            color: 'red',
            points: [],
          },
        ],
      })),
    ).toEqual([
      "board 'esp32' is not supported (only 'avr-uno')",
      "component 'r1': passive.resistor@9.9.9 is not available (have 1.0.0)",
      "component 'led': unknown type 'actuator.unobtainium'",
      "wire x1: r1 (passive.resistor) has no pin 'zz'",
      'wire x1: board pin 3V3 is not simulated yet',
      "wire x2: the board has no pin 'D99'",
    ]);
  });

  /** Blink built on a half breadboard: legs seated in holes, jumpers from the board to strips and a rail. */
  function blinkOnBreadboard(): ProjectDocument {
    const d = blink().project;
    const at = (part: string, pin: string) => ({ part, pin });
    const jumper = (id: string, from: [string, string], to: [string, string]) => ({
      id,
      from: at(...from),
      to: at(...to),
      color: 'yellow',
      points: [],
    });
    return {
      ...d,
      components: [
        {
          id: 'bb',
          type: 'passive.breadboard-half',
          typeVersion: '1.0.0',
          x: 0,
          y: 0,
          rotation: 0,
          flipped: false,
          props: {},
        },
        ...d.components.map((c) =>
          c.id === 'r1'
            ? { ...c, seats: { a: at('bb', '10a'), b: at('bb', '14a') } }
            : { ...c, seats: { a: at('bb', '14c'), k: at('bb', '17c') } },
        ),
      ],
      wires: [
        jumper('j1', ['board', 'D13'], ['bb', '10e']),
        jumper('j2', ['bb', '17e'], ['bb', 'tn3']),
        jumper('j3', ['bb', 'tn20'], ['board', 'GND1']),
      ],
    };
  }

  it('resolves breadboard strips and seated legs without adding nets for unused holes', () => {
    const plain = buildRun(blink());
    const onBoard = buildRun({ ...blink(), project: blinkOnBreadboard() });
    expect(onBoard.scene.parts.map((p) => p.id)).toEqual(['r1', 'led']);
    expect(onBoard.circuit.assembled.netCount).toBe(plain.circuit.assembled.netCount);
    expect(onBoard.scene.staticFindings).toEqual(plain.scene.staticFindings);
    for (const s of [plain, onBoard]) s.circuit.sim.run(1500);
    expect(onBoard.circuit.sim.snapshot().components).toEqual(plain.circuit.sim.snapshot().components);
  });

  it('a leg in an unconnected strip stays floating; bad holes are reported', () => {
    const doc = blinkOnBreadboard();
    const unplugged = { ...doc, wires: doc.wires.filter((w) => w.id !== 'j1') };
    const run = buildRun({ ...blink(), project: unplugged });
    run.circuit.sim.run(1500);
    expect(run.circuit.models['led']?.snapshot()).toMatchObject({ brightness: 0 });
    expect(
      problems(() => ({
        ...doc,
        components: doc.components.map((c) =>
          c.id === 'led' ? { ...c, seats: { a: { part: 'bb', pin: '99z' } } } : c,
        ),
      })),
    ).toEqual(["component led pin a: bb (passive.breadboard-half) has no pin '99z'"]);
  });

  it('checks the arena, the robot drive and the success conditions', () => {
    expect(
      problems((d) => ({ ...d, arena: { arenaVersionId: 'moon', startPose: { x: 0, y: 0, heading: 0 } } })),
    ).toEqual(["unknown arena 'moon'"]);
    expect(
      problems((d) => ({ ...d, components: d.components.filter((c) => c.id !== 'motorR') }), lineFollower()),
    ).toContain('the chassis needs one TT motor mounted on each side (mount.y > 0 = left)');
    expect(
      problems(
        (d) => ({ ...d, successConditions: { id: 'c', condition: { type: 'reachZone', zone: 'mars' } } }),
        lineFollower(),
      ),
    ).toEqual([expect.stringContaining('mars')]);
  });

  it('turns the start heading (degrees) into the robot pose', () => {
    const base = lineFollower();
    const run = buildRun({
      ...base,
      project: {
        ...base.project,
        arena: { arenaVersionId: 'oval', startPose: { x: 1, y: 0.5, heading: 90 } },
      },
    });
    expect(run.world?.bodies()[0]).toMatchObject({ position: { x: 1, y: 0.5 }, angle: Math.PI / 2 });
  });
});

describe('project runs through the worker protocol', () => {
  function host() {
    const client = new SimClient();
    const messages: WorkerToMain[] = [];
    let wall = 0;
    const h = new SimHost(
      (m) => {
        messages.push(m);
        client.receive(m);
      },
      () => wall,
    );
    const advance = (ms: number) => {
      for (let t = 0; t < ms; t += 16) {
        wall += 16;
        h.tick();
      }
    };
    return { h, client, messages, advance };
  }

  it('loads a document + firmware, and an invalid one reports why', () => {
    const { h, client } = host();
    const src = builtinSource('button');
    h.handle({ type: 'load', ...src });
    expect(client.scene).toMatchObject({ scenario: null, title: 'Button + LED', kind: 'bench' });
    h.handle({ type: 'load', project: { ...src.project, wires: 'nope' } as never, firmware: src.firmware });
    expect(client.error).toMatch(/^Invalid project document: wires/);
  });

  it('an exported log is self-contained: it replays headless without the Lab', () => {
    const { h, client, advance } = host();
    let log: InputLog | null = null;
    client.onInputLog = (l) => (log = l);
    h.handle({ type: 'load', ...builtinSource('button'), seed: 5 });
    h.handle({ type: 'control', action: 'run' });
    advance(120);
    h.handle({ type: 'input', componentId: 'btn', name: 'pressed', value: true });
    advance(120);
    h.handle({ type: 'control', action: 'pause' });
    h.handle({ type: 'exportLog' });
    const exported = JSON.parse(JSON.stringify(log)) as InputLog; // as written to / read from a file
    expect(exported.scenario).toBeNull();
    const slice = Math.round((client.frame?.simTime ?? 0) * 1000);
    const replay = new HeadlessRun(
      { project: exported.project, firmware: exported.firmware },
      exported.seed,
      exported.entries,
    );
    replay.runTo(slice);
    const parts = Object.fromEntries(
      replay.scenario.circuit.sim
        .snapshot()
        .components.filter((c) => c.state !== null)
        .map((c) => [c.id, c.state]),
    );
    expect(parts).toEqual(client.frame?.parts);
  });
});
