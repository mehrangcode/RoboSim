import { UNO_ELECTRICAL, UNO_MCU_PINS, avrUno } from '@robosim/board-avr-uno';
import { findDefinition } from '@robosim/catalog';
import { chassisGeometry, type Chassis2wdProps } from '@robosim/component-chassis-2wd';
import { ARENAS } from '@robosim/content';
import { RUNTIME_RULES, STATIC_RULES } from '@robosim/safety-rules';
import {
  ChallengeTracker,
  PlanckWorld,
  SafetyMonitor,
  analyzeCircuit,
  resolveProps,
  validateChallenge,
  type ArenaSpec,
  type BoardInfo,
  type ChallengeSpec,
  type ComponentDefinition,
  type Finding,
  type MountSpec,
  type PropValue,
  type RobotSpec,
} from '@robosim/sim-core';
import { BOARD_PART, type PinRef, type ProjectDocument } from '@robosim/shared';
import { unoFiveVolt } from './board-rail.js';
import { buildCircuit, type Circuit, type CircuitSpec } from './circuit.js';
import type { ArenaScene, FindingView, FirmwarePayload, PartInfo, SceneInfo } from './protocol.js';

/** A loaded project, ready to run. */
export interface Scenario {
  readonly circuit: Circuit;
  readonly world: PlanckWorld | null;
  readonly arena: ArenaSpec | null;
  readonly scene: SceneInfo;
  /** Runtime safety: latched findings + damage model, observing every slice. */
  readonly safety: SafetyMonitor;
  /** Arena challenge (FR-ARN-11), when the project has success conditions. */
  readonly challenge?: ChallengeTracker;
  /** The line sensor the Lab draws under the robot. */
  readonly lineSensor?: { readonly id: string; readonly spacingMm: number };
}

export class ProjectLoadError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Cannot load project: ${issues.join('; ')}`);
    this.name = 'ProjectLoadError';
  }
}

export const UNO_BOARD: BoardInfo = {
  pins: avrUno.pins,
  electrical: UNO_ELECTRICAL,
  packageMaxCurrentMa: avrUno.power.mcuPackageMaxCurrentMa,
};

/** Arduino Uno R3 with headers; rides on the robot when there is one. */
const UNO_MASS_KG = 0.025;
/** Part id of the 5 V rail stand-in (not a document component, so it cannot collide). */
const RAIL = '5V-rail';
const MCU_PINS = new Set(UNO_MCU_PINS.map((p) => p.id));
const GROUND_PINS = new Set(avrUno.pins.filter((p) => p.capabilities.includes('ground')).map((p) => p.id));

export function findingView(f: Finding): FindingView {
  return {
    ruleId: f.ruleId,
    severity: f.severity,
    kind: f.kind,
    componentIds: f.componentIds,
    pinIds: f.pinIds,
    messageKey: f.messageKey,
    params: f.params,
  };
}

/** Degrees → radians; exact for multiples of 90° (heading / 180 is exact, × π is one rounding). */
const radians = (deg: number): number => (deg / 180) * Math.PI;

/**
 * Turns a validated project document plus its firmware into a runnable scenario (Technical Design
 * §8.10 → §5): circuit, MCU, optional arena + robot, success conditions, safety.
 */
export function loadProject(doc: ProjectDocument, firmware: FirmwarePayload, seed: number): Scenario {
  const issues: string[] = [];
  if (doc.board.id !== avrUno.id)
    issues.push(`board '${doc.board.id}' is not supported (only '${avrUno.id}')`);
  if (firmware.format !== 'ihex') issues.push(`firmware format '${firmware.format}' is not supported`);

  // Components: catalogue definition at the exact version the document was saved with.
  const defs = new Map<string, ComponentDefinition>();
  for (const c of doc.components) {
    let def: ComponentDefinition;
    try {
      def = findDefinition(c.type);
    } catch {
      issues.push(`component '${c.id}': unknown type '${c.type}'`);
      continue;
    }
    if (def.manifest.version !== c.typeVersion)
      issues.push(
        `component '${c.id}': ${c.type}@${c.typeVersion} is not available (have ${def.manifest.version})`,
      );
    defs.set(c.id, def);
  }

  // Wires → engine terminals. Board header pins: MCU I/O → `mcu.<pin>`, GND → ground, 5V → rail.
  let railUsed = false;
  const terminal = (ref: PinRef, where: string): string | 'ground' | null => {
    if (ref.part === BOARD_PART) {
      if (MCU_PINS.has(ref.pin)) return `mcu.${ref.pin}`;
      if (GROUND_PINS.has(ref.pin)) return 'ground';
      if (ref.pin === '5V') {
        railUsed = true;
        return `${RAIL}.pos`;
      }
      issues.push(
        avrUno.pins.some((p) => p.id === ref.pin)
          ? `${where}: board pin ${ref.pin} is not simulated yet`
          : `${where}: the board has no pin '${ref.pin}'`,
      );
      return null;
    }
    const def = defs.get(ref.part);
    if (!def) return null; // reported above
    if (!def.manifest.pins.some((p) => p.name === ref.pin)) {
      issues.push(`${where}: ${ref.part} (${def.manifest.id}) has no pin '${ref.pin}'`);
      return null;
    }
    return `${ref.part}.${ref.pin}`;
  };
  const wires: (readonly [string, string])[] = [];
  const ground: string[] = [];
  const mcuPins = new Set<string>();
  const connect = (a: string, b: string): void => {
    if (a === 'ground' && b === 'ground') return;
    if (a === 'ground') ground.push(b);
    else if (b === 'ground') ground.push(a);
    else wires.push([a, b]);
  };
  const engineTerminal = (ref: PinRef, where: string): string | null => {
    const t = terminal(ref, where);
    if (t?.startsWith('mcu.')) mcuPins.add(t.slice(4));
    return t;
  };

  // Breadboards and other purely topological parts (internal conductors only) never reach the MNA:
  // their holes are merged here, so unused strips cost nothing and only real terminals get nets.
  const topological = new Set(
    doc.components.filter((c) => defs.get(c.id)?.internalConnections).map((c) => c.id),
  );
  const strips = new UnionFind();
  const hole = (ref: PinRef, where: string): string | null => {
    const def = defs.get(ref.part) as ComponentDefinition;
    if (def.manifest.pins.some((p) => p.name === ref.pin)) return `hole:${ref.part}.${ref.pin}`;
    issues.push(`${where}: ${ref.part} (${def.manifest.id}) has no pin '${ref.pin}'`);
    return null;
  };
  const node = (ref: PinRef, where: string): string | null => {
    if (topological.has(ref.part)) return hole(ref, where);
    const t = engineTerminal(ref, where);
    return t === null ? null : `term:${t}`;
  };

  // Wires, then legs seated in another part's holes (FR-CIR-03).
  const links: (readonly [PinRef, PinRef, string])[] = [
    ...doc.wires.map((w) => [w.from, w.to, `wire ${w.id}`] as const),
    ...doc.components.flatMap((c) =>
      Object.entries(c.seats ?? {}).map(
        ([pin, at]) => [{ part: c.id, pin }, at, `component ${c.id} pin ${pin}`] as const,
      ),
    ),
  ];
  for (const [from, to, where] of links) {
    if (topological.has(from.part) || topological.has(to.part)) {
      const a = node(from, where);
      const b = node(to, where);
      if (a !== null && b !== null) strips.union(a, b);
      continue;
    }
    const a = engineTerminal(from, where);
    const b = engineTerminal(to, where);
    if (a !== null && b !== null) connect(a, b);
  }
  if (topological.size > 0) {
    for (const id of topological)
      for (const [a, b] of defs.get(id)?.internalConnections?.() ?? [])
        strips.union(`hole:${id}.${a}`, `hole:${id}.${b}`);
    // Chain the real terminals of every merged group, in the order they were first seen.
    const groups = new Map<string, string[]>();
    for (const key of strips.keys()) {
      if (!key.startsWith('term:')) continue;
      const root = strips.find(key);
      groups.set(root, [...(groups.get(root) ?? []), key.slice(5)]);
    }
    for (const members of groups.values()) {
      const [first, ...rest] = members.includes('ground')
        ? ['ground', ...members.filter((m) => m !== 'ground')]
        : members;
      for (const t of rest) connect(first as string, t);
    }
  }

  // Arena, robot, success conditions.
  let arena: ArenaSpec | null = null;
  if (doc.arena) {
    const base = ARENAS[doc.arena.arenaVersionId];
    if (!base) issues.push(`unknown arena '${doc.arena.arenaVersionId}'`);
    else {
      const { x, y, heading } = doc.arena.startPose;
      arena = { ...base, start: { x, y, angle: radians(heading) } };
    }
  }
  const challengeSpec = doc.successConditions as ChallengeSpec | undefined;
  if (challengeSpec)
    issues.push(
      ...validateChallenge(challengeSpec, {
        zones: arena?.zones ?? [],
        objects: (arena?.obstacles ?? []).filter((o) => o.dynamic).map((o) => o.id),
      }),
    );
  const robot = arena ? robotSpec(doc, defs, arena, issues) : null;
  if (issues.length > 0) throw new ProjectLoadError(issues);

  const electrical = doc.components.filter(
    (c) => !topological.has(c.id) && (defs.get(c.id)?.manifest.pins.length ?? 0) > 0,
  );
  const parts: CircuitSpec['parts'] = Object.fromEntries([
    ...electrical.map((c) => [
      c.id,
      { def: defs.get(c.id) as ComponentDefinition, props: c.props as Record<string, PropValue> },
    ]),
    ...(railUsed ? [[RAIL, { def: unoFiveVolt }]] : []),
  ]);
  if (railUsed) ground.push(`${RAIL}.neg`);
  const pins = UNO_MCU_PINS.map((p) => p.id).filter((p) => mcuPins.has(p));
  const world = arena ? new PlanckWorld(arena, robot ? [robot] : []) : null;
  const circuit = buildCircuit({
    parts,
    wires,
    ground,
    mcu: {
      core: avrUno.createCore({
        format: 'ihex',
        bytes: Uint8Array.from(firmware.text, (ch) => ch.charCodeAt(0)),
        sha256: firmware.sha256,
      }),
      electrical: UNO_ELECTRICAL,
      pins,
    },
    ...(world ? { world } : {}),
    seed,
  });
  for (const c of electrical)
    for (const [name, value] of Object.entries(c.inputs ?? {})) circuit.sim.input(c.id, name, value);

  const challenge = challengeSpec
    ? new ChallengeTracker(circuit.sim, world, arena, challengeSpec)
    : undefined;
  if (challenge) circuit.sim.addObserver(challenge);

  const line = electrical.find((c) => c.type === 'sensor.line-3ch');
  const lineProps = line
    ? resolveProps(findDefinition(line.type).manifest, line.props as Record<string, PropValue>)
    : null;

  const scene: Omit<SceneInfo, 'staticFindings'> = {
    scenario: null,
    title: doc.meta.title,
    kind: arena ? 'arena' : 'bench',
    parts: electrical.map((c): PartInfo => {
      const m = (defs.get(c.id) as ComponentDefinition).manifest;
      return { id: c.id, type: m.id, inputs: m.inputs };
    }),
    pins,
    serial: doc.code.files.some((f) => /\bSerial\s*\.\s*begin\s*\(/.test(f.content)),
    code: doc.code.files,
    project: doc,
    ...(arena && world ? { arena: arenaScene(arena, world) } : {}),
    ...(robot
      ? {
          robot: {
            footprint: robot.geometry.footprint,
            wheels: robot.geometry.wheels.map((w) => ({
              x: w.position.x,
              y: w.position.y,
              radiusM: w.radiusM,
            })),
            caster: robot.geometry.caster,
          },
        }
      : {}),
  };

  // Safety: static analysis before running, runtime monitor while running (Technical Design §5.6).
  const staticFindings = analyzeCircuit(circuit.assembled, STATIC_RULES, UNO_BOARD).map(findingView);
  const safety = new SafetyMonitor(circuit.sim, circuit.assembled, UNO_BOARD, RUNTIME_RULES);
  circuit.sim.addObserver(safety);

  return {
    circuit,
    world,
    arena,
    scene: { ...scene, staticFindings },
    safety,
    ...(challenge ? { challenge } : {}),
    ...(line && lineProps ? { lineSensor: { id: line.id, spacingMm: Number(lineProps['spacingMm']) } } : {}),
  };
}

/** Robot from the chassis component and every mounted part; null when the project has no chassis. */
function robotSpec(
  doc: ProjectDocument,
  defs: ReadonlyMap<string, ComponentDefinition>,
  arena: ArenaSpec,
  issues: string[],
): RobotSpec | null {
  const chassis = doc.components.filter((c) => c.type === 'mechanical.chassis-2wd');
  if (chassis.length === 0) return null;
  if (chassis.length > 1) {
    issues.push('only one chassis per project is supported');
    return null;
  }
  const body = chassis[0] as (typeof chassis)[number];
  const geometry = chassisGeometry(
    resolveProps(
      (defs.get(body.id) as ComponentDefinition).manifest,
      body.props as Record<string, PropValue>,
    ) as unknown as Chassis2wdProps,
  );
  const mounted = doc.components.filter((c) => c.mount && c.id !== body.id);
  const motors = mounted.filter((c) => c.type === 'actuator.tt-motor');
  const left = motors.filter((m) => (m.mount?.y ?? 0) > 0);
  const right = motors.filter((m) => (m.mount?.y ?? 0) < 0);
  if (left.length !== 1 || right.length !== 1) {
    issues.push('the chassis needs one TT motor mounted on each side (mount.y > 0 = left)');
    return null;
  }
  const mounts: Record<string, MountSpec> = {};
  for (const c of mounted) {
    const m = c.mount as NonNullable<typeof c.mount>;
    mounts[c.id] = { xMm: m.x, yMm: m.y, heightMm: m.z, ...(m.yaw !== 0 ? { angle: radians(m.yaw) } : {}) };
  }
  const payloadKg =
    mounted.reduce((kg, c) => kg + (defs.get(c.id)?.manifest.massG ?? 0) / 1000, 0) + UNO_MASS_KG;
  return {
    id: 'robot',
    geometry,
    payloadKg,
    mounts,
    drives: { left: (left[0] as (typeof left)[number]).id, right: (right[0] as (typeof right)[number]).id },
    start: arena.start,
  };
}

/** Display raster at 2 mm/px: a quarter of the memory of the 1 mm physics raster. */
function arenaScene(arena: ArenaSpec, world: PlanckWorld): ArenaScene {
  const src = world.floor;
  const widthPx = Math.ceil(src.widthPx / 2);
  const heightPx = Math.ceil(src.heightPx / 2);
  const data = new Uint8Array(widthPx * heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) data[y * widthPx + x] = src.data[2 * y * src.widthPx + 2 * x] ?? 255;
  }
  return {
    widthM: arena.widthM,
    heightM: arena.heightM,
    floor: { widthPx, heightPx, data },
    zones: (arena.zones ?? []).map((z) => ({
      id: z.id,
      kind: z.kind,
      x: z.center.x,
      y: z.center.y,
      radiusM: z.radiusM,
    })),
  };
}

/** Insertion-ordered union-find over string keys (tiny: one entry per used hole and terminal). */
class UnionFind {
  readonly #parent = new Map<string, string>();

  keys(): IterableIterator<string> {
    return this.#parent.keys();
  }

  find(key: string): string {
    let root = this.#parent.get(key) ?? key;
    if (!this.#parent.has(key)) this.#parent.set(key, key);
    while (root !== this.#parent.get(root)) root = this.#parent.get(root) ?? root;
    this.#parent.set(key, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.#parent.set(rb, ra);
  }
}
