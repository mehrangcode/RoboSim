import { UNO_BODY, UNO_ELECTRICAL, UNO_MCU_PINS, avrUno } from '@robosim/board-avr-uno';
import { findDefinition } from '@robosim/catalog';
import { analyzeSketch } from '@robosim/code-analysis';
import { chassisGeometry, type Chassis2wdProps } from '@robosim/component-chassis-2wd';
import { mountProblem } from '@robosim/component-chassis-2wd/mounting';
import { ARENAS, startPoseProblem } from '@robosim/content';
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
  type InputSpec,
  type MountSpec,
  boxInertia,
  robotMass,
  type PointMass,
  type PropValue,
  type RobotSpec,
} from '@robosim/sim-core';
import { BOARD_PART, type PinRef, type ProjectDocument } from '@robosim/shared';
import { unoFiveVolt, unoThreeVolt } from './board-rail.js';
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

/**
 * Why `value` is not a valid `name` input for a part declaring `specs`, or null. Checked when a run
 * is built, so a bad document or input log is refused up front instead of throwing mid-run.
 */
export function inputValueIssue(
  specs: readonly InputSpec[],
  name: string,
  value: number | boolean,
): string | null {
  const spec = specs.find((i) => i.name === name);
  if (!spec)
    return specs.length > 0
      ? `has no input '${name}' (has ${specs.map((i) => i.name).join(', ')})`
      : 'accepts no input';
  if (typeof value !== spec.type) return `input '${name}' must be a ${spec.type}`;
  if (typeof value === 'number' && !(value >= (spec.min ?? -Infinity) && value <= (spec.max ?? Infinity)))
    return `input '${name}' = ${value} is outside [${spec.min ?? '-∞'}, ${spec.max ?? '∞'}]`;
  return null;
}

export const UNO_BOARD: BoardInfo = {
  pins: avrUno.pins,
  electrical: UNO_ELECTRICAL,
  packageMaxCurrentMa: avrUno.power.mcuPackageMaxCurrentMa,
};

/** Part ids of the supply-pin stand-ins (not document components, so they cannot collide). */
const RAILS = {
  '5V': { id: '5V-rail', def: unoFiveVolt },
  '3V3': { id: '3V3-rail', def: unoThreeVolt },
} as const;
type RailPin = keyof typeof RAILS;
const isRailPin = (pin: string): pin is RailPin => pin in RAILS;
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
    ...(f.codeRefs ? { codeRefs: f.codeRefs } : {}),
  };
}

const MOUNT_PROBLEM = {
  offChassis: 'mounted off the chassis',
  height: 'mount height must be 0–150 mm',
} as const;

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
    try {
      resolveProps(def.manifest, c.props as Record<string, PropValue>);
    } catch (e) {
      issues.push(`component '${c.id}': ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const [name, value] of Object.entries(c.inputs ?? {})) {
      const issue = inputValueIssue(def.manifest.inputs, name, value);
      if (issue) issues.push(`component '${c.id}': ${issue}`);
    }
    defs.set(c.id, def);
  }

  // Wires → engine terminals. Board header pins: MCU I/O → `mcu.<pin>`, GND → ground, 5V / 3V3 → rails.
  const railsUsed = new Set<RailPin>();
  const terminal = (ref: PinRef, where: string): string | 'ground' | null => {
    if (ref.part === BOARD_PART) {
      if (MCU_PINS.has(ref.pin)) return `mcu.${ref.pin}`;
      if (GROUND_PINS.has(ref.pin)) return 'ground';
      if (isRailPin(ref.pin)) {
        railsUsed.add(ref.pin);
        return `${RAILS[ref.pin].id}.pos`;
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
  if (arena && robot) {
    const problem = startPoseProblem(arena, robot.geometry.footprint, arena.start);
    if (problem?.kind === 'outside') issues.push('the start pose puts the robot off the arena');
    if (problem?.kind === 'obstacle') issues.push(`the start pose overlaps '${problem.id}'`);
  }
  if (issues.length > 0) throw new ProjectLoadError(issues);

  const electrical = doc.components.filter(
    (c) => !topological.has(c.id) && (defs.get(c.id)?.manifest.pins.length ?? 0) > 0,
  );
  const parts: CircuitSpec['parts'] = Object.fromEntries([
    ...electrical.map((c) => [
      c.id,
      { def: defs.get(c.id) as ComponentDefinition, props: c.props as Record<string, PropValue> },
    ]),
    ...[...railsUsed].map((pin) => [RAILS[pin].id, { def: RAILS[pin].def }]),
  ]);
  for (const pin of railsUsed) ground.push(`${RAILS[pin].id}.neg`);
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
    ...(arena ? { arena: arenaScene(arena) } : {}),
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
            centerOfMass: robotMass(robot.geometry, robot.payload).center,
            mounts: Object.entries(robot.mounts).map(([id, m]) => ({
              id,
              type: defs.get(id)?.manifest.id ?? '',
              x: m.xMm / 1000,
              y: m.yMm / 1000,
              angle: m.angle ?? 0,
            })),
          },
        }
      : {}),
  };

  // Safety: static analysis before running, runtime monitor while running (Technical Design §5.6).
  // Code-aware rules (FR-SAF-03) read the sketch's pin usage; the host has awaited initCodeAnalysis().
  const code = doc.code.files.length > 0 ? analyzeSketch(doc.code.files) : null;
  const staticFindings = analyzeCircuit(circuit.assembled, STATIC_RULES, UNO_BOARD, code).map(findingView);
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
  const props = resolveProps(
    (defs.get(body.id) as ComponentDefinition).manifest,
    body.props as Record<string, PropValue>,
  ) as unknown as Chassis2wdProps;
  const geometry = chassisGeometry(props);
  const mounted = doc.components.filter((c) => c.mount && c.id !== body.id);
  for (const c of mounted) {
    const m = c.mount as NonNullable<typeof c.mount>;
    const manifest = defs.get(c.id)?.manifest;
    if (!manifest) continue; // reported above
    if (!manifest.mounting) issues.push(`component '${c.id}': ${c.type} cannot be mounted on the chassis`);
    const problem = mountProblem(props, m, manifest.category === 'sensor');
    if (problem)
      issues.push(`component '${c.id}': ${MOUNT_PROBLEM[problem]} (x ${m.x}, y ${m.y}, z ${m.z} mm)`);
  }
  const boardMount = doc.board.mount ?? { x: props.bodyCenterXMm, y: 0, z: 0, yaw: 0 };
  const boardProblem = mountProblem(props, boardMount, false);
  if (boardProblem) issues.push(`board: ${MOUNT_PROBLEM[boardProblem]}`);
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
  // Mass distribution (FR-ARN-09): every mounted part where it sits; parts plugged into a mounted
  // part (an LED on a mounted breadboard) ride at their host's mount.
  const at = (
    m: { x: number; y: number },
    massG: number,
    box?: { lengthMm: number; widthMm: number },
  ): PointMass => ({
    x: m.x / 1000,
    y: m.y / 1000,
    massKg: massG / 1000,
    ...(box ? { inertiaKgM2: boxInertia(massG / 1000, box.lengthMm, box.widthMm) } : {}),
  });
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const payload: PointMass[] = [at(boardMount, UNO_BODY.massG, UNO_BODY.mounting)];
  for (const c of doc.components) {
    if (c.id === body.id) continue;
    const manifest = defs.get(c.id)?.manifest;
    if (!manifest) continue;
    if (c.mount) payload.push(at(c.mount, manifest.massG, manifest.mounting));
    else {
      const host = byId.get(Object.values(c.seats ?? {})[0]?.part ?? '');
      if (host?.mount && host.id !== body.id) payload.push(at(host.mount, manifest.massG));
    }
  }
  return {
    id: 'robot',
    geometry,
    payload,
    mounts,
    drives: { left: (left[0] as (typeof left)[number]).id, right: (right[0] as (typeof right)[number]).id },
    start: arena.start,
  };
}

/** Vector arena for the 2D view: the renderer paints the floor itself (crisp at any zoom). */
function arenaScene(arena: ArenaSpec): ArenaScene {
  return {
    widthM: arena.widthM,
    heightM: arena.heightM,
    floor: arena.floor,
    perimeterWalls: arena.perimeterWalls !== false,
    obstacles: (arena.obstacles ?? []).map((o) => ({
      id: o.id,
      shape: o.shape,
      x: o.pose.x,
      y: o.pose.y,
      angle: o.pose.angle,
      dynamic: o.dynamic === true,
    })),
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
