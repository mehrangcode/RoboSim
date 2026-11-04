# Context — Insight & tooling track

**Status (2026-11-04):** IT-4 (power budget) done: `pnpm verify` 279/279, browser check EN/FA on motor-driver (estimate → measured, chart, ⚠ peak over rating, RTF 1.00× while recording). Next: IT-5 (serial log export). IT-1 browser check (step h) still open.

## Where the spec lives
- PRD §6: FR-SAF-08, FR-SIM-12 (status note), FR-SIM-13…21, FR-CIR-11/12, FR-COD-08/09, FR-ARN-13/14, FR-BOM-07, FR-AI-11, FR-WRK-08; PRD §9 row "IT".
- User-Stories: US-SIM-08 (extended), US-SIM-09…17, US-CIR-08/09, US-COD-07/08, US-ARN-09/10, US-SAF-06, US-BOM-06, US-AI-07, US-WRK-06.
- Technical-Design §18 (one subsection per slice), API-Spec (run shares, build symbol/debug artifacts), decisions.md ADR-026…031.
- Release-Plan §3 "IT — Insight & tooling track" (slice table, flags, exit criteria), risks R-17…19.

## Key decisions
- View-only instruments never enter the input log and never bump ENGINE_VERSION (ADR-026), like the logic-analyzer probe.
- Fault injection and tolerance change behaviour → recorded in input log, ENGINE_VERSION bump.
- Instruments are free in every plan (ADR-006); only storage (run shares), builds (debug/sweep fallback) and AI are gated.
- Optional manifest extensions (functions, substitutes, tolerance, faults, typicalCurrentMa) follow one contract (ADR-028).

- Owner decisions (2026-11-02): all IT tools free (ADR-006); phasing IT-1…16 P2, IT-17…20 P4 (1.1); `@robosim/content` joins ENGINE_PACKAGES (one golden:update); `runs.cloud_max` Free 5 / Maker 200 / Classroom 50 per seat / Institution ∞, no run links for u13.

- IT-1 decisions: quick fixes edit by span (`PinArg`/`applyPinEdits`), not whole-line finds; Safety tab works while editing; `CircuitCanvas.highlight`; `signalDirection` manifest field (ADR-028 metadata); guided starters intentionally get SAF-PIN-UNWIRED on their `0` placeholder pins.
- Owner works git themselves: never commit or run git write commands.

## Blockers / open points
- See each TD §18.<n> "Risks & open points".
- IT-2 decisions (2026-11-03): no `it.multimeter` flag (web has no flag consumer; same as IT-1); probes placed via armed "Place red/black" buttons, keyboard Enter/Shift+Enter; probes session-only (no schema change); KCL-audit model fixes only when goldens are unchanged, otherwise document the part here.
- IT-2 implementation notes: ledger = per-owner stamp segments + in-place `LedgerElement` fields (copying elements per read blew the 5 µs/slice meter budget); transient power is integrated only for parts a `p` probe watches (`Simulation.watchPower`); `ohms` can carry the edited `project` so Ω works without a run; keyboard placement is via point lists in the panel (the canvas has no pin focus traversal); KCL audit over all built-in scenarios found no model to fix (goldens untouched).
- IT-3 decisions (2026-11-04): PWM edges rebuilt in the main thread from `measures.pwm` (timer freq/duty) between phase levels (`Simulation.stepSolution` for transient circuits); test D5 980 Hz + D9 490 Hz; CSV `time_ms`; no worker `ScopeRing` (scope stays subscribed while it has channels); "Add to scope" lives in the meter panel (canvas has no context menu); no `it.scope` flag; fine mode deferred.
- IT-3 fine-mode decisions (2026-11-04): toggle is a separate `scopeFine {on}` message (no new session, history kept); ≤ 64 samples/slice/channel, min/max of 32 runs beyond; client keeps 10 s / 500 k points per channel; rebuilt PWM wins over fine samples; auto-off at RTF < 0.8 × chosen speed for 2 s with a retry button; timebases down to 10 µs/div.
- IT-4 decisions (2026-11-04): hybrid capture (phase-averaged per slice; sub-step integration only on re-solving/transient slices); all manifests filled from datasheets with a review table; duty % in localStorage per project; energy buckets merge 2:1 past 300; no `it.power-budget` flag consumer (like IT-1..3).
- IT-4 implementation notes (2026-11-04): no `peakCurrentMa` added (only SAF-SUPPLY-OVERLOAD reads it; adding would change static findings) — pessimistic static bound falls back to typical; new `limits.dropoutV` on the 3 regulators; `BATTERY_CELLS` exported by component-battery; `Simulation.mcuPower()` + `watchPower(ids, {mcu})` with O(1) slots and one ledger pass per sub-step (`MnaCircuit.addOwnerPowers`); energy buckets sent incrementally (TD's 20 KB at 50×300 was wrong: 60 KB) with `bucketFrom`.
- IT-4 perf decision (owner, 2026-11-04): energy meter costs ~5 % lap / ~7 % worst while recording (TD's 1 % assumed identity-cache hits; motor robots re-solve every slice) → recording only while the Power panel is open or the opt-in "record every run" (localStorage) is set; main→worker `energy {on}`; report carries `fromSlice` ("measured since"); budgets 8 % / 12 % while recording, 0 when off.
- IT-4 browser-check fixes (2026-11-04): measured values hidden unless `run.ready` (a stopped run of an older project showed a stale report); batteries left out of the load table (they have cards); a driver's measured row says it includes what it passes to its outputs (static shows only its own draw).
