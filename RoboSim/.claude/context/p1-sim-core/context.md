# Context — P1 sim-core foundation

## Status

Slices 1–4 + Lab committed by user. Slices 5 (safety + damage) and 6 (success conditions + scoring + Lab challenge panel) done 2026-10-14, uncommitted. Slices 5–6 committed (`de81b4d`). Slices 7 (worker protocol), 8 (project document + loader) and 9 (grader + golden traces) done 2026-10-14, uncommitted. Next: ask user (build service proposed).

Slice 6 decisions (user): on-line = robot geometry (axle midpoint ±25 mm); scoring included now; Lab pauses on decision and shows a result card; collision = any new contact with walls/obstacles.

## Decisions

- Code lives in `Mehrtronic/RoboSim` (moved from `~/src/robosim` on 2026-10-14 at user request; P0 committed as `6d35c99`).
- Simulated time is an integer slice counter (1 slice = 1 ms) — no float drift; MCU cycle = slice × clockHz/1000.
- PWM: k+1 solves (all low, each PWM pin high alone), blended by duty (`AveragedSolution`) — average-voltage stamping was wrong for LEDs (fixed in slice 2).
- Test firmware is assembled with avr8js's assembler (CJS build path; ESM build lacks `type: module`). No avr-gcc in the environment.
- avr8js fast-PWM waveform can be one timer tick off the datasheet; register-derived duty is authoritative.
- Every net gets GMIN (1e-12 S) to ground so floating nets never make the matrix singular.
- Voltage-source current is reported as current delivered out of the + terminal.

- Component packages never import each other (even in tests); cross-component scenarios live in `packages/catalog`.
- L298N calibration: 1.6 V saturation + 0.5 Ω/leg (1.75 V @ 0.15 A, 2.1 V @ 0.5 A). Logic needs v5 ≥ 4.5 V; 78M05 needs VS ≥ 7 V, so 4×AA + regulator jumper browns out (by design).
- Safety-rule candidates for slice 5: (a) L298N VS < 7 V with regulator jumper on; (b) ENA/ENB jumper installed while an MCU pin drives EN (pin fights the 5 V rail); (c) 4-leg button wired on the same side.
- Sensors use `WorldModel.componentPose(id)`; bench fallback via inputs (`surface*`, `distanceCm`). HC-SR04 echo goes through `io.scheduleMcuInput` (cycle-exact); clamp to the *end* of the executed slice keeps the width exact.
- SG90 sees pulses only when an MCU pin drives its signal net directly (edges are per MCU pin).

- Physics: planck 1.5.0 + `patches/planck@1.5.0.patch` routes trig via `globalThis.__robosimDmath` (ADR-021). 1.5.1 skipped (published 2026-10-12, < 2 weeks).
- Robot spinning fast skids (COM 3 cm behind axle, μN limit) — realistic, covered by a test.
- Uno 5 V pin is still a test `dcSupply` stand-in: board power tree is not in the netlist yet.

- Simulator Lab at /lab (sim-runtime + renderer-2d + web lazy route); every slice must add a visible Lab demo. Browser check: Windows Chrome via CDP script in %TEMP%\robosim-cdp\shot.mjs (real-time; virtual-time headless stalls workers).
- Bundle: web initial JS 232→237 KB gz (Lab adds ~4 KB strings). The earlier 165→232 KB jump predates the Lab (zod used at startup via localeSchema/problemDetailsSchema) — follow-up: consider zod/mini in the browser.

- Safety: framework in sim-core/src/safety; rules in packages/safety-rules (one package). Static analysis solves fresh model instances (power-on + per-pin drive probes); sensor-output nets are skipped for drive probes until code analysis (P2).
- Servo demo rewired to its own 4×AA: SG90 stall 650 mA > Uno 5 V 500 mA (SAF-SUPPLY-OVERLOAD, PRD example).

- Slice 7: snapshot = flattened hot frame (Float64 + tag per path, append-only dict of paths/strings). Challenge + RTF ride in the snapshot (timeLimit changes every slice); findings/faults/damage/serial are events. SAB double buffer + seqlock; new SAB per run. Main thread imports only `@robosim/sim-runtime/client` (engine-free).
- Input log: live inputs stamped with `sim.slice`; replay applies after slice N's observers (InputLogger is the last observer) → identical to live (test compares every live frame with `HeadlessRun`). Reset after a replay = fresh live run.
- `ENGINE_VERSION` in sim-runtime/src/engine-version.ts; a test pins it to package.json versions (all components share one version).
- gen-firmware emits Prettier-stable output (single quotes, wrap > 110 cols).
- Browser check slice 7: `%TEMP%\robosim-cdp\shot7.mjs` (fa labels; profile is in Persian) — COI true, serial echo + replay verified.
- Bundle: web initial 241.5 KB gz; growth since slice 4 is locale strings only (both locales bundled eagerly).

- Slice 8: schema in packages/shared/src/project-schema.ts (strict Zod; superRefine cross-checks run only when structure is valid). PinRef {part,pin}; board = part 'board' (MCU pins, GND1-3 → ground, 5V → rail stand-in id '5V-rail'; 3V3/VIN rejected). Additions vs TD sketch: optional arena, per-component `inputs` (power-on state), mm/deg units.
- Loader: pinless components (chassis) stay out of the circuit; robot = chassis + mounted parts, payload = mounted masses + Uno 25 g, left motor = mount.y > 0. Built-in demos are documents in sim-runtime/src/scenarios.ts; verified bit-identical to the old hand-built scenarios (throwaway comparison, 15 s line-follower lap).
- InputLog now carries project + firmware (+ scenario id for built-ins) → self-contained replays.
- Worker bundle 88 → 119 KB gz (zod in the worker; lazy /lab only). Follow-up: zod/mini.

- Slice 9: `grade()` lives in sim-runtime (`grade.ts`), not apps/grader, because the Lab verify worker needs it and browser code may not import apps/grader (arch rule). Views (pins/robot/challenge/damage) moved to `views.ts`, shared by host + grader. Job = InputLog (+ new optional `endSlice`, set on export) + maxSimSeconds ≤ 300 (`MAX_SIM_SECONDS` in protocol.ts so the client can import it).
- Golden files: apps/grader/golden/<name>.job.json (frozen project + firmware) + .result.json (one sample per line; prettier-ignored). Exact JSON compare. `pnpm golden:update` writes only missing/bumped; same-version drift fails. Verified: 1-ulp pose change at slice 5000 is caught. Line-follower lap result ≈ 205 KB.
- Lab Verify: pause → exportLog → grade.worker.ts (lazy, own engine bundle) → compare final vs paused frame (pins, pose, challenge, serial tail; key-order-insensitive). Browser check: `%TEMP%\robosim-cdp\shot9.mjs` — identical at 0.31 s, 14.31 s, serial 4.01 s; ~5× RT in Chrome.
- Web initial JS 242.0 KB gz (+0.5 KB strings).

## Known issues

- `~/src/robosim` deleted 2026-10-14 at user request.

- ~~Flaky outbox test~~ fixed 2026-10-14: `uuidv7()` was random below 1 ms, so same-ms outbox events sorted randomly; now monotonic (RFC 9562 §6.2).
- Dev runs from WSL only (`tools/require-wsl.ts` blocks Windows); local `.env` has `API_PORT=3001` (Windows `node app.js` holds 3000).
- `.github/workflows` sits under `RoboSim/`, so GitHub will not run it until the repo root (or workflow paths) is adjusted.
