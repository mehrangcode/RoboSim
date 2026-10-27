# Context — Editor tools bundle

Status (2026-10-27): D1 verified. D2 steps 7–12 implemented, browser-checked (FA + EN, API + web dev servers) and
documented (PRD statuses, Release-Plan entry, TD §4 row, API-Spec /me, README). Step 13 done: `pnpm verify` green (275 tasks), bundle 234 KB gz.
Uncommitted — commit only when the user asks.

## Decisions (user, 2026-10-26)
- Two sub-slices: D1 sim views (plotter + logic analyzer), then D2 code/workspace. Each verified before the next.
- Formatter: clang-format as WASM in the browser (lazy chunk), not a server endpoint.
- Hover docs: FA + EN written by Claude for the core API and all 16 pinned libraries; Persian marked for review.
- Onboarding tour: editor essentials (~7 stops), once per browser/account, re-openable from Help (F1); no tour library.

## Decisions (user, 2026-10-27) — D2
- D2 delivered in one pass (steps 7–13), single verify at the end.
- Hover docs: full public API of all 16 pinned libraries (+ core), summary/params/returns/example, FA+EN.
- Copy/paste: versioned JSON on navigator.clipboard; in-app (localStorage) buffer fallback when denied.
- Tour seen-state: server user preference via API (all devices); guests → localStorage.
- Defaults: re-run unfinished D1 test packages (api, web, sim-runtime, grader) one by one first;
  clang-format WASM npm package, Arduino IDE 2 .clang-format; library "Add" inserts after last #include.

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

## D2 touchpoints (2026-10-27)
- Hover: `code-editor/monaco.ts` has hover feature imported but no `registerHoverProvider`; monaco.ts has no i18n →
  locale getter set from `monaco-editor.tsx`. Doc keys `editor:apiDocs.<of|core>.<name>` + dynamic-keys prefix.
  i18n gate (`packages/i18n/scripts/check.ts`): fa/en parity, ICU placeholder parity, static-key scan, unused keys.
- Libraries: lock file only in apps/compiler (web may not import it: depcruise `browser-never-imports-server-code`)
  → new list in packages/shared + compiler parity test. Insert `#include` via files state/onChange (undoable).
- Toolbar/shortcuts: editor-page.tsx `toolbar` const + single window keydown `useEffect` (`keys` ref); Help =
  `help-dialog.tsx` (`SHORTCUTS`). No dialog/popover primitives in packages/ui — copy help-dialog pattern.
- WASM: follow `lab/code-analysis.ts` `?url` + dynamic import; `pnpm bundle:check` guards initial JS.
- Palette add-part: reuse library-panel `add` + `matches()` from circuit-canvas `search.ts`.
- Tour pref: drizzle `users` (apps/api/src/db/schema.ts), migration 0008, shared `meSchema`/`updateMeRequestSchema`,
  `auth.service.ts updateMe/toMe`, `apps/web/src/testing/fake-auth.ts`; `useAuth().me` (null = guest).
- Copy/paste: split `duplicateComponents` (document.ts l.372) into extract → payload / insert payload; keys in
  `circuit-canvas.tsx onKeyDown` (Ctrl+D precedent); paste at `viewCenterRef`.

## D2 implementation notes (2026-10-27)
- API table split per library: `packages/shared/src/arduino-api/{model,libraries,<lib>}.ts`, aggregated in
  `arduino-api.ts` (classes + `extends` + `instances`, `declaredClass`, `membersOf`, `lookupApi`, `docKey`).
  `member: true` = class-scoped constant (BMP280 nested enums → `Adafruit_BMP280::X`). 588 doc entries, 28 classes.
- Docs: `packages/i18n/locales/{en,fa}/apidocs.json` (gate-checked, NOT in `resources`; registered lazily via
  `@robosim/i18n/apidocs` `addApiDocs`). Coverage test: `packages/i18n/src/apidocs.test.ts`. Fragments were authored in
  scratchpad and merged — the JSON files are now the source of truth.
- Known gaps: struct fields (NewPing ping_result, Keypad key[]) not modelled; `word()` fn shares key with type `word`.
- Formatter: `@wasm-fmt/clang-format@23.1.1` (vite entry, wasm via ?url), official Arduino style file
  `apps/web/src/code-editor/arduino.clang-format` (tooling-project-assets); short blocks stay on one line (by design).
- Monaco: hover provider + DocumentFormattingEditProvider + class-aware completions; bidi CSS in apps/web index.css.
- CodeEditor `command` prop (`EditorCommand {kind:'format'|'libraries', seq}`) for the palette.
- Copy/paste: document.ts `copySelection`/`pasteClip`/`pasteOffset`/`clipBox` (duplicate built on them);
  `circuit-canvas/src/clipboard.ts` (navigator.clipboard text + localStorage mirror used only when read is denied);
  `circuitClipSchema` in shared project-schema. Canvas keys Ctrl+C/X/V.
- Browser check: scratchpad d2-check.mjs; needs the API running (without it the dev proxy's /me hangs, auth stays
  "loading" and the tour waits — correct behaviour). Fixed from it: library dialog lost focus after Add (Escape dead);
  tour progress used Latin digits in FA.
- Library Add also pins `{name, version}` in doc.libraries (US-COD AC1) via SketchPanel/CodeEditor `onLibraryAdd`.
- Palette commands are built when it opens (snapshot; modal), via `openPalette` ref — React compiler forbids building
  them in render (refs in closures).
- 2026-10-27: user's `pnpm verify` failed in @robosim/web#test (log excerpt had no test name). Not reproducible
  (alone ×3, turbo forced, 3 concurrent runs: all 172 green). Suspect: editor-tools findBy (1 s default) on the lazy
  library dialog + apidocs chunk under load → waits now 10 s, file testTimeout 20 s. Ask for the failing test name if it recurs.
