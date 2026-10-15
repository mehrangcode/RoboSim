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

## Slice 10 — build service, thin vertical (TD §6) — done 2026-10-15 (uncommitted)

User decisions: no Docker; `downloads.arduino.cc` is 403 (geo-blocked) → no arduino-cli. Toolchain = Ubuntu apt `gcc-avr` 7.3.0 / `avr-libc` / `binutils-avr` + ArduinoCore-avr 1.8.6 from GitHub, driven directly by `apps/compiler` (ADR). Scope = thin vertical (compiler + sync `POST /builds` + Lab sketch → Compile → Run; queue/SSE/MinIO/quota later). Core + libs fetched by `pnpm compiler:setup` into `.local/toolchain/` (pinned SHAs). Libraries: Servo, NewPing, core built-ins (SoftwareSerial, Wire, SPI, EEPROM) — full support, allow-list extensible. Built-in demos switch to HEX compiled from their .ino (golden re-record + engineVersion bump).

- [x] `compiler:setup` script: pinned clones + SHA check + toolchain check
- [x] `apps/compiler`: input validation, .ino preprocessing (prototypes, `#line`), cached core.a/lib objects, link, HEX + size report, diagnostics parser + explanation keys, content-addressed cache
- [x] API `build-gateway` module: `POST /api/v1/builds` (sync, Idempotency-Key, rate limit, lazy compiler → 503) + `GET /api/v1/artifacts/:id`
- [x] Demo firmware compiled from .ino (`pnpm firmware:gen`) + golden re-record (no engineVersion bump: engine unchanged, only the frozen jobs' firmware)
- [x] Lab: "Your code" tab (template circuit → edit → Compile & run → diagnostics + explanations → run on same circuit); en + fa
- [x] Tests + docs (ADR-022, TD §6 delta, EG, Security §5, Release Plan) + CI toolchain step + `pnpm verify` + browser check

Next candidates: §6 second half (Redis queue, DRR fair share, SSE, MinIO, quota — needs infra) · 11 circuit canvas · 12 code editor/pin inspector · 13 3D renderer + mounting editor + arenas · Playwright golden leg.

## Slice 11 — circuit canvas, thin vertical (FR-CIR-01..06, 10; ADR-005) — done 2026-10-15 (uncommitted)

User decisions: thin vertical; simple hand-made SVG art; breadboard insertion = explicit `seats` (schema v2, identity migration); persistence = localStorage autosave + JSON import/export (server projects API later); UI = new Lab **Design** tab (library | canvas | properties → code → Compile & run).

- [x] Schema v2: `ComponentInstance.seats?: { [pin]: PinRef }`, migration 1→2, cross-checks; tests
- [x] Loader: seats → connections; topological parts (breadboards, `internalConnections`) resolved by union-find, never MNA nets (unchanged wiring order without them → goldens identical)
- [x] Engine-free subpaths: `@robosim/component-*/manifest`, `@robosim/catalog/manifests`, `@robosim/board-avr-uno/pins`
- [x] `packages/circuit-canvas`: footprints + SVG art (0.1" grid), document reducer + undo/redo (≥100), seats from geometry, nets (hover highlight, < 16 ms @ 200 parts), canvas (pan/zoom/fit, drag, rotate/flip/delete, wires with bends + colours, pin tooltip), library (FA/EN search, Persian normalisation, categories), property panel (manifest-driven, E12 for resistors, validation), accessible parts list
- [x] SceneInfo.project (open a demo in the editor); demo documents laid out for the canvas; starter = Uno + half breadboard + LED blink
- [x] Lab Design tab: new / open demo / import / export / autosave; sketch editor on the document's code; Compile & run on the designed circuit; en + fa
- [x] Tests + docs (TD §3/§4 deltas, ADR-005 note, Release Plan) + `pnpm verify` + browser check

Next candidates: 12 Monaco editor + pin inspector · 13 3D renderer + mounting editor + arenas · canvas follow-ups (box select, align, minimap, 60 FPS gate, movable board) · server projects API · §6 queue half · Playwright golden leg.

## Slice 12 — editor workspace (FR-WRK-01…03, FR-SIM-11) — done 2026-10-15 (uncommitted)

User decisions: fixed arrangement with resizable + collapsible panes, layout saved in the browser (drag-docking later); one Run = compile if code/circuit changed (unchanged demos run their prebuilt firmware), any edit stops the run; inputs on the canvas parts while running (button press, switch toggle, popover sliders for knobs/sensors), live state on the art; /editor replaces the Lab's Design tab (Lab gets "Open in editor").

- [x] circuit-canvas: `mode` edit/run/view; run-mode interactions + input popover; live art (button, servo, motor, buzzer, damaged badge)
- [x] ui: `ResizeHandle` (separator role, keyboard, RTL-aware) + tests
- [x] /editor route: toolbar (Run/Pause, Step, Stop, Reset, speed 0.25–4×, RTF, New/Open demo/Import/Export/Save, Help, shortcuts F5/Shift+F5/F10/Ctrl+S), panes (library+properties | canvas / simulation | code), bottom dock (Serial, Pins, Safety, Challenge), layout persistence
- [x] Run state machine: build-if-needed, demo passthrough, edits stop, ready/expected scene
- [x] Responsive: < 1024 px tabs, < 768 px view-and-run banner
- [x] Lab: remove Design tab, "Open in editor" link; nav "Editor"; en + fa
- [x] Tests + docs + `pnpm verify` + browser check

Next: 13 Monaco editor + full pin inspector + serial baud/timestamps · 14 arena in workspace (follow, trail, overlays, start pose, more arenas) · 15 mounting editor · 16 3D · 17 canvas completion · 18 build service queue half · 19 hardening.
