# Context — Editor tools bundle

Status: D1 steps 1–4 + 6 (docs) done (2026-10-26), uncommitted. Step 5 open: full `pnpm verify` was stopped by
Claude Code (system low on memory) mid-run — format/i18n/arch gates green; lint+typecheck reached no errors;
tests passed in all packages that finished (sim-core, avr-uno, shared, compiler, admin, components…); api, web,
sim-runtime, grader test tasks did not finish. Targeted runs green earlier: sim-runtime 107/107, web new tests 16/16.
Browser check script ready: scratchpad/browser-check.mjs (needs `pnpm --filter @robosim/web dev` on :5173).
Also formatted pre-existing unformatted packages/boards/avr-uno/test/conformance/generated.ts (whitespace only).

## Decisions (user, 2026-10-26)
- Two sub-slices: D1 sim views (plotter + logic analyzer), then D2 code/workspace. Each verified before the next.
- Formatter: clang-format as WASM in the browser (lazy chunk), not a server endpoint.
- Hover docs: FA + EN written by Claude for the core API and all 16 pinned libraries; Persian marked for review.
- Onboarding tour: editor essentials (~7 stops), once per browser/account, re-openable from Help (F1); no tour library.

## Findings
- Serial bytes already reach the UI (`serial` events, decoded per baud in `lab/serial-monitor.tsx`): plotter is UI-only.
- `McuCore.onPinEdge` gives cycle-stamped output edges (16 MHz → 62.5 ns). Timer PWM is register-derived
  (`pwmFromRegisters`); check whether avr8js port listeners fire for OC toggles, else synthesize edges.
- Completions: `packages/shared/src/arduino-api.ts` (core + Servo/NewPing/Stepper/Keypad, EN only).
- No clang-format binary in WSL (irrelevant with WASM choice).
- Editor dock tabs: `DockTab` in `apps/web/src/editor/editor-page.tsx`.
- Hardware PWM DOES emit `onPinEdge` edges (avr8js toggles port pins for OC outputs) — no synthesis needed.
  Edge stamps jitter ±1 cycle (timer updated at instruction boundaries) → 62.5 ns, fine for 1 µs.
- Inputs: new optional `McuCore.onPinInput` (avr-uno: fired in `applyDueInputs` at `atCycle`). Observation only.
- Probe protocol: `MainToWorker {type:'probe', pins|null}`, `WorkerToMain {type:'edges', capture, start?, data
  (Float64 triples pinIdx,level,cycle), until, full?}`; host re-arms the probe on reset/load (new capture id);
  `SimClient.capture: PinCapture`. Caps: 8 pins, 500k edges. No engineVersion bump (observation only).
- Plotter: `apps/web/src/lab/plotter.ts` (pure) + `serial-plotter.tsx` (SVG); `decodeSerial` gained `partial`.
  Chart colours: new `--color-series-1..8` tokens in packages/ui (validated light/dark via dataviz validator).
- web consumes workspace packages from `dist`: rebuild sim-core/avr-uno/sim-runtime before web tests.
