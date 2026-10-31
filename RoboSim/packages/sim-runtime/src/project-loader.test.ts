import { describe, expect, it } from 'vitest';
import { BUILTIN_ARENAS } from '@robosim/content';
import type { ComponentInstance, ProjectDocument } from '@robosim/shared';
import { SimClient } from './client.js';
import { HeadlessRun } from './input-log.js';
import { SimHost } from './host.js';
import type { InputLog, WorkerToMain } from './protocol.js';
import { obstacleViews } from './views.js';
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
            to: { part: 'board', pin: 'VIN' },
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
      'wire x1: board pin VIN is not simulated yet',
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

  it('rejects a start pose off the mat or on an obstacle', () => {
    const at = (arenaVersionId: string, x: number, y: number) => (d: ProjectDocument) => {
      const { successConditions: _conditions, ...rest } = d;
      return { ...rest, arena: { arenaVersionId, startPose: { x, y, heading: 0 } } };
    };
    expect(problems(at('oval', 0.02, 0.8), lineFollower())).toEqual([
      'the start pose puts the robot off the arena',
    ]);
    expect(problems(at('obstacle-course', 0.95, 0.8), lineFollower())).toEqual([
      "the start pose overlaps 'block-1'",
    ]);
  });

  it('runs the line-follower robot on every built-in arena with its default challenge', () => {
    const base = lineFollower();
    const { successConditions: _conditions, ...project } = base.project;
    for (const a of BUILTIN_ARENAS) {
      const { x, y, angle } = a.spec.start;
      const run = buildRun({
        ...base,
        project: {
          ...project,
          arena: { arenaVersionId: a.id, startPose: { x, y, heading: (angle / Math.PI) * 180 } },
          ...(a.challenge ? { successConditions: a.challenge as ProjectDocument['successConditions'] } : {}),
        },
      });
      for (let i = 0; i < 200; i++) run.circuit.sim.step();
      expect(run.world?.bodies()[0]?.position.x, a.id).toBeCloseTo(x, 1);
      expect(run.scene.arena?.obstacles.length, a.id).toBe(a.spec.obstacles?.length ?? 0);
      expect(run.challenge?.result().status ?? 'none', a.id).not.toBe('failure');
      if (a.id === 'sumo') expect(obstacleViews(run)['opponent']).toMatchObject({ x: 1.35, y: 1 });
    }
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

  /** The line follower with one part's mount changed. */
  const remount = (id: string, change: (m: { x: number; y: number; z: number; yaw: number }) => object) => {
    const base = lineFollower();
    return {
      ...base,
      project: {
        ...base.project,
        components: base.project.components.map((c) =>
          c.id === id && c.mount ? { ...c, mount: { ...c.mount, ...change(c.mount) } } : c,
        ),
      },
    };
  };

  it('US-ARN-06 AC1 moving the line sensor 2 cm forward moves where it samples', () => {
    const before = buildRun(lineFollower()).world?.componentPose('line');
    const after = buildRun(remount('line', (m) => ({ x: m.x + 20 }))).world?.componentPose('line');
    // The oval start faces +x.
    expect((after?.position.x ?? 0) - (before?.position.x ?? 0)).toBeCloseTo(0.02, 12);
    expect(after?.position.y).toBe(before?.position.y);
  });

  it('FR-ARN-09 mounting moves the centre of mass: the same run drives differently', () => {
    const drive = (source: ReturnType<typeof lineFollower>) => {
      const run = buildRun(source);
      run.circuit.sim.run(1500);
      return run.world?.bodies()[0];
    };
    const stock = drive(lineFollower());
    expect(drive(lineFollower())).toEqual(stock); // deterministic
    expect(drive(remount('bat', (m) => ({ x: m.x + 120 })))).not.toEqual(stock);
  }, 30_000);

  /** The line follower plus an SG90 (horn at `angleDeg`) carrying an HC-SR04 on its horn. */
  const scanner = (angleDeg: number, host = 'servo') => {
    const base = lineFollower();
    const part = (
      id: string,
      type: string,
      props: Record<string, number>,
      mount: NonNullable<ComponentInstance['mount']>,
    ): ComponentInstance => ({
      id,
      type,
      typeVersion: '1.0.0',
      x: 0,
      y: 0,
      rotation: 0 as const,
      flipped: false,
      props,
      mount,
    });
    return {
      ...base,
      project: {
        ...base.project,
        components: [
          ...base.project.components,
          part('servo', 'actuator.sg90-servo', { initialAngleDeg: angleDeg }, { x: 20, y: 0, z: 60, yaw: 0 }),
          part('sonar', 'sensor.hc-sr04', {}, { x: 20, y: 0, z: 90, yaw: 0, onServo: host }),
        ],
      },
    };
  };

  it('a part on a servo horn turns with the servo: the sonar looks where the horn points', () => {
    const look = (angleDeg: number) => {
      const run = buildRun(scanner(angleDeg));
      const robot = run.world?.componentPose('servo');
      const pose = run.world?.componentPose('sonar');
      if (!pose || !robot || !run.world) throw new Error('not mounted');
      const dir = { x: Math.cos(pose.angle), y: Math.sin(pose.angle) };
      return { robot, pose, hit: run.world.raycast(pose.position, dir, 4)?.distance ?? null };
    };
    const ahead = look(90);
    const left = look(180);
    const right = look(0);
    expect(ahead.pose.angle).toBeCloseTo(ahead.robot.angle, 12);
    expect(left.pose.angle - left.robot.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(right.pose.angle - right.robot.angle).toBeCloseTo(-Math.PI / 2, 12);
    // The horn sits on the servo's pivot, so only the heading changes, and with it what is seen.
    expect(left.pose.position.x).toBeCloseTo(ahead.pose.position.x, 12);
    expect(new Set([ahead.hit, left.hit, right.hit].map((d) => d?.toFixed(3))).size).toBe(3);
    const scene = buildRun(scanner(90)).scene.robot?.mounts.find((m) => m.id === 'sonar');
    expect(scene?.onServo).toEqual({ id: 'servo', pivotX: 0.02, pivotY: 0 });
  });

  it('refuses a part mounted on something that is not a servo', () => {
    expect(problems((d) => d, scanner(90, 'drv'))).toEqual([
      "component 'sonar': 'drv' is not a servo, so nothing can be mounted on it",
    ]);
  });

  it('refuses parts mounted off the chassis or that cannot be mounted', () => {
    const issues = (source: ReturnType<typeof lineFollower>) => problems((d) => d, source);
    expect(issues(remount('bat', () => ({ x: 500 })))).toEqual([
      "component 'bat': mounted off the chassis (x 500, y 0, z 45 mm)",
    ]);
    expect(issues(remount('line', (m) => ({ x: m.x + 40 })))).toEqual([]); // sensors may overhang the front
    expect(issues(remount('drv', () => ({ z: 400 })))[0]).toMatch(/mount height/);
    const base = lineFollower();
    const board = {
      ...base,
      project: { ...base.project, board: { ...base.project.board, mount: { x: 0, y: 200, z: 0, yaw: 0 } } },
    };
    expect(issues(board)).toEqual(['board: mounted off the chassis']);
    const chassis = {
      ...base,
      project: {
        ...base.project,
        components: base.project.components.map((c) =>
          c.id === 'chassis' ? { ...c, mount: { x: 0, y: 0, z: 0, yaw: 0 } } : c,
        ),
      },
    };
    expect(issues(chassis)).toEqual([]); // the chassis' own mount is ignored
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
