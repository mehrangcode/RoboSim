# Context — P1 sim-core foundation

## Status

Slices 1–4 + Lab committed by user. Slices 5 (safety + damage) and 6 (success conditions + scoring + Lab challenge panel) done 2026-10-14, uncommitted. Next: slice 7 — worker protocol (§5.8: SharedArrayBuffer snapshots, event stream, input log).

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

## Known issues

- `~/src/robosim` deleted 2026-10-14 at user request.

- ~~Flaky outbox test~~ fixed 2026-10-14: `uuidv7()` was random below 1 ms, so same-ms outbox events sorted randomly; now monotonic (RFC 9562 §6.2).
- Dev runs from WSL only (`tools/require-wsl.ts` blocks Windows); local `.env` has `API_PORT=3001` (Windows `node app.js` holds 3000).
- `.github/workflows` sits under `RoboSim/`, so GitHub will not run it until the repo root (or workflow paths) is adjusted.
