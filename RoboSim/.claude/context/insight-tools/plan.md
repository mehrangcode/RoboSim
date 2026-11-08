# Plan — Insight & tooling track (IT-1 … IT-20)

Goal: implement the 20 IT slices one at a time. Each slice is self-contained: read its PRD row, user story,
Technical-Design §18.<n> and the Release-Plan IT table row before starting.

## Per-slice procedure (repeat for every slice)
1. Read: PRD row (FR id) · User-Stories (US id) · Docs/Technical-Design.md §18.<n> · ADRs it cites · Release-Plan §3 IT row.
2. Write failing tests from the story's ACs and the TD **Tests** list (TDD).
3. Implement behind the slice's feature flag; FA + EN i18n keys; RTL; a11y.
4. `pnpm verify` green; goldens unchanged unless the slice says otherwise; browser check FA/EN (WSL only, API_PORT=3001).
5. Docs sync: PRD status note on the FR row, TD §18.<n> *Implemented* note, Release-Plan row, README; tick the box below; update context.md.

## Slices (recommended order)
- [x] IT-1 — Wiring ↔ sketch consistency check · FR-SAF-08 · US-SAF-06 · TD §18.1
- [x] IT-2 — Virtual multimeter + measure channel (ADR-026) · FR-SIM-13 · US-SIM-09 · TD §18.2
- [x] IT-3 — Analog oscilloscope (phase 1 + fine mode) · FR-SIM-14 · US-SIM-10 · TD §18.3 · after IT-2
- [x] IT-4 — Power budget and battery life · FR-SIM-15 · US-SIM-11 · TD §18.4 · after IT-2
- [x] IT-5 — Serial log export and diff · FR-SIM-21 · US-SIM-17 · TD §18.5
- [x] IT-6 — Find a part by function (ADR-028 manifest extensions) · FR-CIR-12 · US-CIR-09 · TD §18.6
- [x] IT-7 — Wiring hints and auto-tidy · FR-CIR-11 · US-CIR-08 · TD §18.7
- [ ] IT-8 — Damage post-mortem · FR-SIM-16 · US-SIM-12 · TD §18.8 · after IT-2, IT-3
- [ ] IT-9 — Time-travel scrubber (ADR-027) · FR-SIM-17 · US-SIM-13 · TD §18.9
- [ ] IT-10 — Ghost run and A/B · FR-ARN-13 · US-ARN-09 · TD §18.10
- [ ] IT-11 — Shareable run links (ADR-031) · FR-SIM-12 · US-SIM-08 · TD §18.11
- [ ] IT-12 — Fault injection (ENGINE_VERSION bump) · FR-SIM-19 · US-SIM-15 · TD §18.12
- [ ] IT-13 — Tolerance mode (ENGINE_VERSION bump) · FR-SIM-20 · US-SIM-16 · TD §18.13
- [ ] IT-14 — Sketch tests (project schema v5) · FR-COD-09 · US-COD-08 · TD §18.14
- [ ] IT-15 — Explain this net · FR-AI-11 · US-AI-07 · TD §18.15 · after IT-2
- [ ] IT-16 — Cost and substitute optimizer · FR-BOM-07 · US-BOM-06 · TD §18.16
- [ ] IT-17 — Parameter sweep and PID tuner (ADR-029) — P4 · FR-SIM-18 · US-SIM-14 · TD §18.17
- [ ] IT-18 — Seeded random arenas — P4 · FR-ARN-14 · US-ARN-10 · TD §18.18
- [ ] IT-19 — Spectator / projector mode — P4 · FR-WRK-08 · US-WRK-06 · TD §18.19 · after IT-11
- [ ] IT-20 — Source-level debugger (ADR-030) — P4 · FR-COD-08 · US-COD-07 · TD §18.20

## Acceptance (track)
- All 20 stories' ACs automated and passing; common exit criteria in Release-Plan §3 IT met per slice.

## IT-1 detailed steps (owner answers 2026-11-02: Safety tab + code markers while editing; both quick fixes; canvas highlight on click; never commit)
- [x] a. sim-core types: `ComponentManifest.signalDirection?`, `PinUse.arg?`/`context?`, `CodeFacts.libraryPins?` (additive)
- [x] b. code-analysis: arg locations, randomSeed context, library ctor pins (NewPing, SoftwareSerial, Stepper, NeoPixel, OneWire, Serial) + tests
- [x] c. manifests: `signalDirection` on bidirectional parts + catalog test
- [x] d. safety-rules `./consistency`: BoardPinView types, 3 rules, quick-fix candidates, `applyPinReplacements` + tests
- [x] e. circuit-canvas: `boardPinView(doc)` (+ passthrough follow) + tests; `highlight` prop on CircuitCanvas
- [x] f. web: `useCodeFacts` shared hook, `useConsistency` (300 ms), Safety tab works while editing (group + badge), fixes (one undo), code markers, click → canvas highlight, AI context
- [x] g. i18n EN/FA (safety.json, shell.json, dynamic keys)
- [x] h. corpus test (demos/guided refs: no UNWIRED/DIRECTION), STATIC_RULES unchanged; `pnpm verify`; browser check FA/EN (owner checked it in the browser, 2026-11-04)
- [x] i. docs sync (PRD status, TD §18.1 implemented note, Release-Plan, README)

## IT-2 detailed steps (owner answers 2026-11-03: no flag (like IT-1); armed "Place red/black" buttons + Enter/Shift+Enter; probes session-only; KCL-audit fixes only if goldens hold, else document; never commit)
- [x] a. sim-core: `beginOwner` + owner lists in `MnaCircuit`, `mna/ledger.ts` `elementTerminalCurrents`, `terminalCurrent`; `AveragedSolution.phases()`; ledger tests (signs + KCL)
- [x] b. sim-core: `Simulation.pinCurrent` / `mcuPinCurrentIn` / `partPower` (`measure.ts`) + tests (13.6 mA, battery P<0, PWM power)
- [x] c. sim-core: `ohmmeter()` in static-analyzer + tests; per-part KCL audit (fix result-neutral only)
- [x] d. sim-runtime: protocol `PointRef`/`MeasureProbe`/`measure`/`ohms`; `MeasureRecorder` (viewOnly), host drain, client; determinism tests
- [x] e. circuit-canvas: `wireCut` + tests; `probe-overlay.tsx` (+/COM glyphs, wire arrow)
- [x] f. web: `formatSi`, `multimeter.tsx`, dock tab `'meter'`, toolbar + palette, `use-simulation` senders, armed probe buttons, keyboard; tests
- [x] g. i18n EN/FA `meter.*`
- [x] h. goldens unchanged; `pnpm verify` (279/279); browser check FA/EN (Ω 220.0 Ω without a run, live V/A, stop-run hint, Persian digits, RTL min/max)
- [x] i. docs sync (PRD, TD §18.2 note, Release-Plan, README; note: no web flag consumer)

## IT-3 detailed steps (owner answers 2026-11-04: rebuild PWM edges from pin PWM freq/duty/phase for v probes on PWM-driven nets; test D5 980 Hz + D9 490 Hz; CSV `time_ms`; phase 1 only — fine mode deferred; no flag (like IT-1/2); never commit)
- [x] a. sim-runtime: scope channel in `MeasureRecorder` ([avg,min,max] with `netEnvelope`) + PWM edge descriptors for v probes on PWM nets; tests (timer-555 max > avg, no-flyback kickback, digest unchanged)
- [x] b. sim-runtime: `scope.ts` `ScopeRing` (worker, 30 s) + `ScopeBuffer` (client, 60 s), host refill, client export; tests
- [x] c. web: `lib/csv.ts` (move `toCsv`), `lab/scope-math.ts` (trigger/holdoff/cursors/RMS/freq, PWM reconstruction) + tests
- [x] d. web: `lab/oscilloscope.tsx` (canvas, bands, dash+label, keyboard cursors, modes, CSV, settings `robosim.scope.v1`), dock tab `'scope'`, "Add to scope" (meter + canvas menu) + tests
- [x] e. i18n EN/FA `scope.*`
- [x] f. goldens unchanged; perf (≤ 10 µs/slice 4 ch); `pnpm verify`; browser check FA/EN
- [x] g. docs sync (PRD, US-SIM-10 AC3 unchanged, TD §18.3 note: time_ms + PWM rebuild + fine mode deferred, Release-Plan 490/980 wording, README)
- [x] h. phase 2: fine mode (`addSubstepObserver`, `scopeFine`, auto-disable when RTF < 0.8 × speed for 2 s) + tests
- [x] i. 4-channel real-time check: `pnpm test:perf` gates the slowest scenario with 4 ch (± fine) < 1 ms/slice; production-build browser A/B at 1.00×; worker tick-period fix

## IT-4 detailed steps (owner answers 2026-11-04: hybrid power capture (phase-avg per slice + sub-step on re-solving slices via watchPower path); I fill all manifests from datasheets + review table; duty % in localStorage per project; buckets merge 2:1 past 300; no flag; never commit)
- [x] a. manifests: `limits.typicalCurrentMa` / `idleCurrentMa` / `minSupplyV` (+ `peakCurrentMa` where missing) on every part; `validateManifest` ≥ 0 check + catalog test
- [x] b. sim-runtime: `battery-life.ts` `batteryLife()` (bisection, range) + tests (analytic, monotonic, below cut-off)
- [x] c. sim-runtime: `energy.ts` `EnergyMeter` (viewOnly, identity caching, hybrid capture, 1 s buckets with 2:1 merge) + tests (conservation 2 % motor-driver/dimmer, cached = uncached, digest unchanged)
- [x] d. sim-runtime: protocol `energy` message (≤ 500 ms, on pause), host register, client store
- [x] e. circuit-canvas: `power-budget.ts` `staticBudget(doc)` (supply tree, regulator chaining, buck η) + tests
- [x] f. web: `lab/power-panel.tsx` (table, stacked SVG energy chart, battery cards, static/measured toggle, warnings → SAF-SUPPLY-OVERLOAD), dock tab `'power'`, duty in localStorage + tests
- [x] g. i18n EN/FA `power.*`
- [x] h. cross-check test (motor-driver brown-out vs estimate ≤ 10 %); perf budgets; goldens unchanged; `pnpm verify`; browser check FA/EN
- [x] i. docs sync (PRD, TD §18.4 note, Release-Plan, README)

## IT-5 detailed steps (owner answers 2026-11-04: new dock tab 'diff'; decode at the monitor's baud; Clear clears the view only; no flag; keys in shell.json `lab.serialExport.*`/`lab.serialDiff.*`; never commit)
- [x] a. sim-runtime: `SerialArchive` (1 MB cap, `truncated`), `serialLines` + tests
- [x] b. sim-runtime: `serial-diff.ts` `diffSerial` (Myers, timing, caps, linear fallback) + tests incl. live vs `grade()` showcase
- [x] c. sim-runtime client: `serialArchive`, `previousSerial` (reset on `loaded`), exports
- [x] d. web: `lab/serial-export.ts` (txt / txt+times / csv, `\xNN`, import parser, filename) + tests
- [x] e. web: `lab/serial-diff.tsx` (sources, side-by-side/stacked, jump to first divergence, ± labels, LTR log) + dock tab `'diff'` + tests
- [x] f. web: monitor Export ▾ / Compare…; verify-panel "Compare serial with live run" when `differs`
- [x] g. i18n EN/FA
- [x] h. perf budgets; goldens unchanged; `pnpm verify`; browser check FA/EN
- [x] i. docs sync (PRD, TD §18.5 note, Release-Plan, README)

## IT-6 detailed steps (owner answers 2026-11-07: Ask AI when top score < 60 (AC4 reworded); shared price loader + localStorage offline cache (BOM reuses it); compare table below the list in the sidebar; generic why per function + per-part why only where needed, review table for owner; tag all 66 parts incl. chassis; no flag; never commit)
- [x] a. catalog: `src/functions.ts` (`PART_FUNCTIONS`, `functionById`) + `exports["./functions"]`
- [x] b. sim-core: `functions?`/`interfaces?` in `ManifestExtensions`; `validateManifest` kebab + no duplicates + tests
- [x] c. manifests: `functions`, `interfaces` on all 66; catalog.test cross-checks (ids exist, every fn ≥ 1 part, every part ≥ 1 fn, FA+EN synonyms)
- [x] d. circuit-canvas: `rankParts` + search.test (FA/EN/Arabic/ZWNJ/"۵ ولت"/two motors, name queries unchanged, < 2 ms)
- [x] e. web: shared price loader (`lib/catalog-prices.ts`, localStorage cache) used by BOM + library
- [x] f. circuit-canvas: library-panel ranked list, why line, chips, compare (≤ 3), `priceOf`/`onAskAi` props + tests
- [x] g. web: editor-page passes `priceOf`, `onAskAi` (AI usable → open assistant tab prefilled)
- [x] h. i18n EN/FA `components:functions.*`, editor library keys
- [x] i. goldens unchanged; `pnpm verify`; browser check FA/EN; review table for owner
- [x] j. docs sync (PRD, US-CIR-09 AC4, TD §18.6 note, Release-Plan, README)
