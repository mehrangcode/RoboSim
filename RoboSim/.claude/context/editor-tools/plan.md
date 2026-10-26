# Plan — Editor tools bundle (P2: FR-SIM-07 plotter, FR-SIM-08, FR-COD-02/05/07, FR-WRK-05/06, FR-CIR-09)

Goal: the editor gets the remaining P2 workspace tools, delivered as two verified sub-slices.

## D1 — Simulation views (serial plotter, logic analyzer)
- [x] 1. Plotter core (pure, web): parse serial lines → numeric series (comma/space/tab, `label:value`
      à la Arduino IDE 2), rolling window, tests incl. US-SIM-03 AC2.
- [x] 2. Plotter UI: Monitor | Plotter toggle in `SerialMonitor` (editor dock + Lab), canvas chart,
      legend with series toggles, pause, autoscale, FA/EN, RTL-safe.
- [x] 3. Probe channel in `sim-runtime`: `MainToWorker {type:'probe', pins|null}` → `PinRecorder` on
      `onPinEdge` (+ timer-PWM and input-pin edges if the port listener misses them) → batched
      `WorkerToMain {type:'edges'}` per frame. View-only: not in the input log, no engine bump.
- [ ] 4. Logic analyzer UI: editor dock tab `analyzer`: pick ≤ 8 pins, record/stop/clear, timing
      diagram (canvas), zoom/pan, two cursors with Δt, pulse width / period / duty at cursor (1 µs),
      FA/EN. US-SIM-02 AC2 test (D9 + D10, 100 ms).
- [ ] 5. `pnpm verify` green + browser check (FA/EN).
- [ ] 6. Docs: PRD/TD/User-Stories/Release-Plan notes, README/CLAUDE.md sync.

## D2 — Code & workspace
- [ ] 7. Hover docs FA/EN (FR-COD-02): extend `ARDUINO_API` to all 16 pinned libraries, docs per
      entry (summary, params, returns, example) in i18n; Monaco hover + completion docs in UI language.
- [ ] 8. Library manager (FR-COD-07): pinned libraries from `toolchain.lock.json` with versions,
      description, "Add" inserts `#include`.
- [ ] 9. Formatter (FR-COD-05): clang-format WASM, lazy chunk, Arduino style; Shift+Alt+F + menu.
- [ ] 10. Command palette (FR-WRK-05): Ctrl/Cmd+K, all editor actions + component search.
- [ ] 11. Onboarding tour (FR-WRK-06): ~7 stops, skippable, once per browser/account, from Help (F1).
- [ ] 12. Copy/paste between projects (FR-CIR-09): clipboard payload keeps wiring inside the selection.
- [ ] 13. `pnpm verify` + browser check + docs.

## Acceptance
- US-SIM-03 AC2: comma-separated numbers per line → one series per column in plotter mode.
- US-SIM-02 AC2: D9 + D10 recorded for 100 ms → timing diagram shows both; cursor measures pulse width to 1 µs.
- FR-COD-02: hover docs in the UI language for core + all pinned libraries.
- FR-COD-05/07, FR-WRK-05/06, FR-CIR-09 as in PRD; goldens unchanged; `pnpm verify` green.
