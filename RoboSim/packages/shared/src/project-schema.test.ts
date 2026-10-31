import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION,
  ProjectDocumentError,
  migrateDocument,
  parseProjectDocument,
  type ProjectDocument,
} from './project-schema.js';

const valid = (): ProjectDocument => ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  board: { id: 'avr-uno', version: '1.0.0' },
  components: [
    {
      id: 'r1',
      type: 'passive.resistor',
      typeVersion: '1.0.0',
      x: 0,
      y: 0,
      rotation: 0,
      flipped: false,
      props: { ohms: 220 },
    },
    {
      id: 'sw',
      type: 'power.switch',
      typeVersion: '1.0.0',
      x: 10,
      y: 0,
      rotation: 90,
      flipped: true,
      props: {},
      inputs: { on: true },
      mount: { x: 10, y: 0, z: 5, yaw: 0 },
    },
  ],
  wires: [
    {
      id: 'w1',
      from: { part: 'board', pin: 'D13' },
      to: { part: 'r1', pin: 'a' },
      color: 'red',
      points: [[1, 2]],
    },
  ],
  code: { language: 'cpp', files: [{ name: 'sketch.ino', content: 'void setup() {}\nvoid loop() {}\n' }] },
  libraries: [],
  arena: { arenaVersionId: 'oval', startPose: { x: 0.6, y: 0.3, heading: 0 } },
  successConditions: {
    id: 'c',
    condition: { all: [{ type: 'laps', count: 1 }, { not: { type: 'noCollision', tolerance: 0 } }] },
    score: [{ type: 'timeBonus', under: 20, weight: 25 }],
  },
  meta: { title: 'Demo' },
});

const issues = (doc: unknown): readonly string[] => {
  try {
    parseProjectDocument(doc);
    return [];
  } catch (e) {
    if (e instanceof ProjectDocumentError) return e.issues;
    throw e;
  }
};

describe('project document schema', () => {
  it('accepts a complete document and returns it unchanged', () => {
    expect(parseProjectDocument(valid())).toEqual(valid());
  });

  it('bench projects need no arena', () => {
    const { arena: _a, successConditions: _s, ...bench } = valid();
    expect(issues(bench)).toEqual([]);
  });

  it('arena conditions without an arena are rejected; serial ones are fine', () => {
    const { arena: _a, ...noArena } = valid();
    expect(issues(noArena)).toEqual(["successConditions: condition 'laps' needs an arena"]);
    expect(
      issues({
        ...noArena,
        successConditions: { id: 's', condition: { type: 'serialMatches', pattern: 'ok' } },
      }),
    ).toEqual([]);
  });

  it('reports structural problems: bad rotations, the reserved board id', () => {
    const doc = valid();
    expect(
      issues({
        ...doc,
        components: [
          ...doc.components,
          { ...doc.components[0], rotation: 45 },
          { ...doc.components[0], id: 'board' },
        ],
      }),
    ).toEqual([
      expect.stringMatching(/^components\.2\.rotation/),
      "components.3.id: 'board' is reserved for the board",
    ]);
  });

  it('then cross-checks a well-formed document: duplicate ids, dangling wire ends', () => {
    const doc = valid();
    expect(
      issues({
        ...doc,
        components: [...doc.components, doc.components[0]],
        wires: [...doc.wires, { ...doc.wires[0], to: { part: 'ghost', pin: 'x' } }],
      }),
    ).toEqual([
      "components.2.id: duplicate component id 'r1'",
      "wires.1.id: duplicate wire id 'w1'",
      "wires.1.to.part: unknown part 'ghost'",
    ]);
  });

  it('rejects unknown keys and malformed conditions', () => {
    expect(issues({ ...valid(), extra: 1 })).not.toEqual([]);
    expect(issues({ ...valid(), successConditions: { id: 'c', condition: { all: [] } } })).not.toEqual([]);
    expect(
      issues({ ...valid(), successConditions: { id: 'c', condition: { type: 'laps', count: 0 } } }),
    ).not.toEqual([]);
  });

  it('accepts legs seated in another part and rejects impossible seats', () => {
    const seated = (seats: Record<string, { part: string; pin: string }>) => {
      const doc = valid();
      const [r1, sw] = doc.components;
      return { ...doc, components: [{ ...r1, seats }, sw] };
    };
    expect(issues(seated({ a: { part: 'sw', pin: 'a' } }))).toEqual([]);
    expect(issues(seated({ a: { part: 'nope', pin: '1a' } }))).toEqual([
      "components.0.seats.a.part: pin 'a' cannot be seated in part 'nope'",
    ]);
    expect(issues(seated({ a: { part: 'board', pin: 'D13' } }))).toHaveLength(1);
    expect(issues(seated({ a: { part: 'r1', pin: 'b' } }))).toHaveLength(1);
  });

  it('accepts a part on a mounted servo horn and rejects dangling, unmounted or chained hosts', () => {
    const onServo = (target: string, hostMount = true, hostOn?: string) => {
      const doc = valid();
      const [r1, sw] = doc.components as [
        ProjectDocument['components'][number],
        ProjectDocument['components'][number],
      ];
      const host = { ...sw, mount: { x: 10, y: 0, z: 5, yaw: 0, ...(hostOn ? { onServo: hostOn } : {}) } };
      return {
        ...doc,
        components: [
          { ...r1, mount: { x: 10, y: 0, z: 35, yaw: 0, onServo: target } },
          hostMount ? host : sw,
        ],
      };
    };
    expect(issues(onServo('sw'))).toEqual([]);
    expect(issues(onServo('nope'))).toEqual(["components.0.mount.onServo: unknown part 'nope'"]);
    expect(issues(onServo('r1'))).toEqual(['components.0.mount.onServo: a part cannot be mounted on itself']);
    const loose = onServo('sw');
    const { mount: _m, ...bare } = loose.components[1] as ProjectDocument['components'][number];
    expect(issues({ ...loose, components: [loose.components[0], bare] })).toEqual([
      "components.0.mount.onServo: 'sw' is not mounted on the robot",
    ]);
    expect(issues(onServo('sw', true, 'r1'))).toEqual([
      "components.0.mount.onServo: 'sw' is itself mounted on a servo",
      "components.1.mount.onServo: 'r1' is itself mounted on a servo",
    ]);
  });

  it('rejects non-objects and versions it cannot read', () => {
    expect(issues(null)).toEqual(['document must be an object']);
    expect(issues({ ...valid(), schemaVersion: 0 })).toEqual(['schemaVersion must be a positive integer']);
    expect(issues({ ...valid(), schemaVersion: PROJECT_SCHEMA_VERSION + 1 })[0]).toMatch(
      /newer than this app/,
    );
  });
});

describe('project document migrations', () => {
  const chain = {
    1: (d: Record<string, unknown>) => ({ ...d, renamed: d['old'] }),
    2: ({ old: _old, ...d }: Record<string, unknown>) => d,
  };

  it('applies forward migrations in order up to the target version', () => {
    expect(migrateDocument({ schemaVersion: 1, old: 'x' }, 3, chain)).toEqual({
      schemaVersion: 3,
      renamed: 'x',
    });
    expect(migrateDocument({ schemaVersion: 2, renamed: 'y', old: 'z' }, 3, chain)).toEqual({
      schemaVersion: 3,
      renamed: 'y',
    });
  });

  it('upgrades a v1 document (no seats) to the current version unchanged', () => {
    const v1 = { ...valid(), schemaVersion: 1 };
    expect(parseProjectDocument(v1)).toEqual(valid());
  });

  it('upgrades a v2 document (no board mount) and accepts a mounted board in v3', () => {
    expect(parseProjectDocument({ ...valid(), schemaVersion: 2 })).toEqual(valid());
    const mounted = { ...valid(), board: { ...valid().board, mount: { x: -30, y: 0, z: 75, yaw: 0 } } };
    expect(parseProjectDocument(mounted).board.mount).toEqual({ x: -30, y: 0, z: 75, yaw: 0 });
  });

  it('upgrades a v3 document (board at the origin) and accepts a placed board in v4', () => {
    expect(parseProjectDocument({ ...valid(), schemaVersion: 3 })).toEqual(valid());
    const placed = { ...valid(), board: { ...valid().board, position: { x: 25.4, y: -50.8, rotation: 90 } } };
    expect(parseProjectDocument(placed).board.position).toEqual({ x: 25.4, y: -50.8, rotation: 90 });
    expect(() =>
      parseProjectDocument({ ...placed, board: { ...placed.board, position: { x: 0, y: 0, rotation: 45 } } }),
    ).toThrow(/board\.position\.rotation/);
  });

  it('fails loudly on a gap in the chain', () => {
    expect(() => migrateDocument({ schemaVersion: 1 }, 3, { 2: chain[2] })).toThrow(
      /no migration from schemaVersion 1/,
    );
  });
});
