# Plan — P1 hardening: cross-browser goldens, conformance, perf budgets, robustness

**Goal:** close the P1 exit criteria "peripheral conformance suite and golden traces pass in Node, Chrome and
Firefox" and "simulation slice and frame budgets met", and make the engine fail cleanly on bad input.

**Acceptance:** `pnpm test:sim` runs goldens + conformance in Node and in headless Chromium + Firefox (Vitest
browser mode, Playwright provider), bit-identical to the committed results; perf gates fail when a budget
(TD §17) is exceeded; robustness tests cover corrupted jobs/projects/firmware, runaway firmware, worker death,
long runs; CI runs the browser leg; docs (EG §6, TD §17, Release Plan P1 status, README) updated; `pnpm verify` green.

User decisions (2026-10-19): browsers installed in WSL (Playwright Chromium + Firefox, `--with-deps` via sudo);
Vitest browser mode (no separate @playwright/test project); hardening = more goldens + conformance + perf + robustness;
Tier B/C stays uncommitted.

## Steps
- [x] 1. Browser infra: playwright 1.63.0 + @vitest/browser-playwright 5.0.4 (grader + avr-uno devDeps); system libs installed 2026-10-20
- [x] 2. Goldens for every built-in scenario (31; suite test asserts coverage of SCENARIOS)
- [x] 3. Golden browser leg (70/70 Chromium + Firefox, bit-identical): `test/golden.browser.test.ts` (main thread + Web Worker), Chromium + Firefox
- [x] 4. Peripheral conformance suite — 10 sketches / 33 tests in packages/boards/avr-uno/test/conformance (Node 33/33, Chromium + Firefox 66/66)
- [x] 5. Perf budgets — `pnpm test:perf` (Node script vs dist): lap avg 0.303 ms ✓, static@200 ~14 ms ✓, netlist@200 ✓.
      CPU speed-up (user OK'd): table-dispatched decoder generated from avr8js (2×), LU factor reuse (bit-identical).
      2D frame (< 8 ms): packages/renderer-2d/src/frame-budget.browser.test.ts, 8 arenas × fit/zoom, Chromium + Firefox;
      worst mean ≈ 2.9 ms, worst frame 5.8 ms (Chromium). Wired into `pnpm test:sim`.
- [x] 6. Robustness: apps/grader/test/robustness.test.ts (seeded job/document fuzz, corrupted HEX, runaway + random firmware),
      long-run.long.test.ts (full 300 s cap, `test:long`), InputLogError up-front log validation, loader checks initial inputs;
      earlier: serial cap, O(1) RX queue, stall watchdog + restart
- [x] 7. CI `sim` job (Playwright --with-deps, test:sim:node + test:sim:browser gated; frame budget + test:perf report-only)
- [x] 8. Docs (EG §3/§6/§7, TD golden/§11/§17, Release Plan, README; no package CLAUDE.md exist) + `pnpm verify` green (271/271)
