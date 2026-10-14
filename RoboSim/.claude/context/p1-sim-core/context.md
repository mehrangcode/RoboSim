# Context — P1 sim-core foundation

## Status

Slices 1–3 done 2026-10-14 (uncommitted), incl. the full PRD §7.2 P1 basic set (18 catalogue ids; jumper wires = netlist edges). `pnpm verify` 104/104, 274 tests. Next: slice 4 — planck.js world implementing `WorldModel` (incl. `componentPose` from mount slots, floor raster 1 px = 1 mm, raycast vs bodies), chassis body from `chassisGeometry`, wheels ↔ `TtMotor.outputOmega()` / `loadTorqueNm`.

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

## Known issues

- `~/src/robosim` deleted 2026-10-14 at user request.

- ~~Flaky outbox test~~ fixed 2026-10-14: `uuidv7()` was random below 1 ms, so same-ms outbox events sorted randomly; now monotonic (RFC 9562 §6.2).
- Dev runs from WSL only (`tools/require-wsl.ts` blocks Windows); local `.env` has `API_PORT=3001` (Windows `node app.js` holds 3000).
- `.github/workflows` sits under `RoboSim/`, so GitHub will not run it until the repo root (or workflow paths) is adjusted.
