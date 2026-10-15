# P1 — sim-core foundation (slice 1)

**Goal:** framework-free `packages/sim-core` with the deterministic building blocks every later P1 slice (Uno, components, physics, safety, grader) plugs into. Technical Design §5.

## Steps

- [x] Package scaffold (`@robosim/sim-core`, ES2023 lib only, no DOM/Node) + arch rule forbidding Node built-ins
- [x] `contracts.ts` — McuCore, ComponentModel, MnaStamper, WorldModel, snapshots
- [x] `dmath` — fdlibm-derived sin/cos/atan/atan2/exp/log (bit-identical across engines)
- [x] `prng` — xoshiro128** seeded via splitmix32, state save/restore
- [x] `netlist` — union-find terminal → net builder, ground = net 0
- [x] `mna` — dense LU + MNA (conductance, current source, voltage source w/ internal R, PWL diode region iteration ≤ 10, GMIN)
- [x] `bus` — MCU pins ↔ MNA (output = source w/ Rout, pull-up, VIL/VIH thresholding → scheduleInput)
- [x] `scheduler` — fixed 1 ms slices, PHYS_DT 2 ms, integer time, observers; pacer with injected clock
- [x] Tests: unit + integration (blink LED, button w/ pull-up) + determinism (two runs identical)
- [x] Docs: Release Plan P1 status, Technical Design deltas; `pnpm verify` green

## Acceptance

- `pnpm verify` green; sim-core has no DOM/Node imports (arch rule proves it).
- Same inputs + seed → identical snapshot stream.
- MNA matches hand-computed Ohm's-law / LED circuits within 1e-9.

## Next slices

2. Uno board (avr8js adapter, timer-derived PWM, `onPinEdge`) · 3. Components (resistor, LED, button, pot, L298N, DC motor) · 4. World/physics (planck.js), line sensor, ultrasonic · 5. Safety runtime + damage · 6. Success conditions · 7. Worker protocol.

## Slice 7 — worker protocol (§5.8) — done 2026-10-14 (uncommitted)

User decisions: layout-at-load binary snapshots; input log record + replay with Lab Export/Replay; serial event + Serial Monitor + `serial` bench demo; `load` keeps scenario id + seed (+ inputLog).

- [x] `snapshot-codec` — path-flattened Float64 values + tag bytes, append-only dict (paths, strings)
- [x] `snapshot-channel` — double-buffered SAB seqlock (Atomics) + transferable ArrayBuffer fallback
- [x] `input-log` — slice-stamped inputs (component + serial), replay observer, `HeadlessRun`
- [x] SimHost on the new protocol: hot snapshot + events (serial, findings, faults, damaged, challenge, inputLog, error); engineVersion in `loaded`
- [x] `client` (main side, DOM-free): messages + SAB → `Frame`; `@robosim/sim-runtime/client` subpath
- [x] `serial` firmware + bench scenario (greeting, tick, uppercase echo)
- [x] Lab: hook on client (rAF poll), Serial Monitor, Export/Replay; en + fa strings
- [x] Tests: codec, channel, host (both transports), replay ≡ live, serial; Lab tests
- [x] Docs: TD §5.8 current implementation, Release Plan P1; `pnpm verify` green

## Slice 8 — project document + loader (TD §8.10) — done 2026-10-14 (uncommitted)

User decisions: slice 8 = project document; firmware = prebuilt image passed alongside the document (`load { project, firmware }`), produced by the build service later.

- [x] `ProjectDocument` Zod schema (+ `schemaVersion`, migration hook) in `packages/shared`
- [x] Loader: document + firmware → Simulation (circuit, MCU, world/robot, challenge, safety)
- [x] Lab demos as document fixtures; `scenarios.ts` built on the loader
- [x] Protocol: `load { project, firmware, seed, inputLog? }`; `HeadlessRun` takes a document
- [x] Tests: schema/migration, invalid docs, document ≡ previous scenario frames
- [x] Docs + `pnpm verify` green; browser check

Next candidates (proposed order): 9 grader skeleton + golden traces · 10 build service · 11 circuit canvas · 12 code editor/pin inspector · 13 3D renderer + mounting editor + arenas.

## Slice 9 — grader skeleton + golden traces (TD §11.1, EG §6) — done 2026-10-14 (uncommitted)

User decisions: grader = library + CLI (no queue yet); golden traces bit-exact in Node now, Playwright browsers later; Lab demo = **Verify run** button; fixtures = existing demos.

- [x] `views.ts` — pin/robot/challenge views shared by host and grader
- [x] `grade.ts` (sim-runtime, DOM/Node-free): `grade(job)` → status, score, final state, 10 Hz trace, serial, findings, damage; engine-version check; maxSimSeconds ≤ 300
- [x] `apps/grader`: CLI (`job.json` → result JSON + gzip trace), golden suite (`golden/*.json`, `UPDATE_GOLDEN=1`, refuses to rewrite without `engineVersion` bump), root `pnpm test:sim`
- [x] Lab: grade worker + **Verify run** card (verified vs live: identical / differs, trace hash); en + fa
- [x] Tests + docs (TD §11.1, EG, Release Plan) + `pnpm verify` + browser check

Next candidates: 10 build service · 11 circuit canvas · 12 code editor/pin inspector · 13 3D renderer + mounting editor + arenas · Playwright golden leg (Chrome/Firefox).
