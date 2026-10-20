# Context — P1 hardening

## Status
2026-10-19: goldens 8 → 31 (all scenarios); conformance suite 33/33 in Node; engine fixes (EEPROM, double-buffered
UART TX, UCSRA read-only bits) → board-avr-uno 0.4.0, goldens re-recorded (only serial slice stamps moved; outcomes
identical). 2026-10-20: browser libs installed; full `pnpm test:sim` green (conformance 33 Node + 66 browser,
goldens 32 Node + 70 browser). Fix: Vitest `commands.readFile` resolves from the project root (cwd), not the test file.
Perf: avr8js decode chain replaced by generated switch (packages/boards/avr-uno/scripts/gen-decoder.ts →
src/decoder.generated.ts, drift + 65 536-opcode differential test); LU factor reuse in MnaCircuit (sameBits cache).
Goldens bit-identical, no engine bump for these. Line-follower lap avg 0.303 ms (was ≈ 0.5). Curves cost ~19 solves/slice.
2D frame budget done (renderer-2d browser test, mean + p95 gate, ROBOSIM_PERF_SCALE via `define`).
2026-10-20: steps 6–8 done; `pnpm verify` green. P1 hardening complete (uncommitted).
Follow-ups: CI `sim` job not yet run on GitHub; Playwright browser cache needs a pinned actions/cache SHA (no `gh` here);
2D frame budget fails under heavy parallel CPU load (passes alone) — run `test:sim` on an idle machine.

## Decisions
- 2026-10-20 slice = steps 6+7+8. Runaway firmware: sim-time cap only (deterministic, no wall-clock limit).
  CI: separate `sim` job on every PR (Playwright --with-deps, cached), `pnpm test:sim`; `test:perf` report-only in CI.
- Playwright pinned 1.63.0 (1.64.x < 2 weeks old at start).
- All test:sim suites live in `apps/grader/test/` (golden + conformance), browser config `vitest.browser.config.ts`.
- Conformance lives with the board (packages/boards/avr-uno/test/conformance: sketches.ts → generated.ts via
  `pnpm firmware:gen`, sets in apps/compiler/scripts/firmware-sets.ts; drift test covers both sets).
- `pnpm test:sim` = Node + Chromium + Firefox; `pnpm test:sim:node` = Node only.
- Real-HW behaviours kept (not bugs): pulseIn under-reads long pulses (millis ISR), ISR jitter, Timer0 PWM 1 tick.
- Watchdog not emulated (avr8js AVRWatchdog resets CPU behind the adapter) — documented gap.
- Perf gate is a Node script (scripts/perf-budgets.ts) against dist: Vitest's transform adds ~20 % and is not what the worker runs.
- Known slow demos (not gated): mosfet-ramp ~0.37, transistor-motor/motor-driver ~0.26–0.28 ms/slice.
- 2D frame gate = ArenaRenderer.draw + 1-px getImageData readback (forces raster); mean over batch because
  Firefox rounds performance.now() to 1 ms. React re-render cost of the Lab page is not in it.
- Target is bit-identical in browsers (dmath/fdlibm), not "within tolerance" as EG §6 says — update EG.

## Constraints
- WSL only; no sudo for the agent; downloads.arduino.cc blocked.
