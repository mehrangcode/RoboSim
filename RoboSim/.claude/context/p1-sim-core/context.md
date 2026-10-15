# Context — P1 sim-core foundation

## Status

Slices 1–4 + Lab committed by user. Slices 5 (safety + damage) and 6 (success conditions + scoring + Lab challenge panel) done 2026-10-14, uncommitted. Slices 5–6 committed (`de81b4d`). Slices 7 (worker protocol), 8 (project document + loader) and 9 (grader + golden traces) done 2026-10-14, uncommitted. Slice 10 (build service, thin vertical) done 2026-10-15, uncommitted. Next: ask user.
Slice 11 (circuit canvas, thin vertical) and slice 12 (editor workspace) done 2026-10-15, uncommitted. Next: ask user (proposed 13 Monaco + pin inspector).

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

- Slice 10 (ADR-022): `downloads.arduino.cc` is HTTP 403 from our network → no arduino-cli. Toolchain = apt `gcc-avr` 7.3.0/`avr-libc`/`binutils-avr` + ArduinoCore-avr 1.8.6 (GitHub, commit-pinned) + Servo 1.3.0 (GitHub) + NewPing 1.9.7 (PlatformIO tarball, sha256) in `apps/compiler/toolchain.lock.json`; `pnpm compiler:setup` → `.local/toolchain`. User wants no Docker; full library support (core built-ins + Servo + NewPing, allow-list extensible).
- Compiler driver (apps/compiler): own .ino preprocessor (prototype scanner instead of ctags, `#line`), platform.txt flags + LTO, prebuilt core.a/lib*.a per toolchain id in `.local/compiler-cache/prebuilt`, HEX normalised to LF (objcopy writes CRLF). Toolchain id = lock + `avr-gcc -v` + flags + DRIVER_VERSION.
- Sandbox `local`: `unshare --user --map-root-user --net --mount --pid --fork --mount-proc` per gcc call; binds work→/srv, toolchain→/opt (ro), prebuilt→/media (ro); tmpfs over /home /root /mnt /tmp /var /run; prlimit as/fsize/cpu/nofile. CI needs `sysctl kernel.apparmor_restrict_unprivileged_userns=0` (Ubuntu 24.04). API refuses `local` in staging/production.
- apps/compiler must not depend on sim-runtime (bootstrap loop when generated.ts is broken): gen script + drift test import sketches.ts/generated.ts by relative path.
- Compiled demos changed behaviour vs the assembly: Servo lib clamps to 544 µs (≈4° at pot 0); serial first tick at 1000 ms; line-follower sketch had D10/IN4 floating (fixed: pins 5..10 OUTPUT). Lap still 14.47 s / 100. Goldens re-recorded without engineVersion bump (engine unchanged; only frozen job firmware).
- Lab sketch tab: protocol `load { template, files, firmware }` (worker swaps code into the demo's document → scenario null) and `SceneInfo.code`; web stays engine-free. Editor disables font ligatures (`<=` showed as `≤`).
- Browser check slice 10: `%TEMP%\robosim-cdp\shot10.mjs` (fa) — errors marked on lines 2/6 with FA explanations, blink@100 ms toggles D13, Verify ✓ identical, line follower compiled live laps at 14.47 s.
- Web initial JS 248.2 KB gz (+6.2 KB: build explanation strings in both locales).

## Known issues

- `~/src/robosim` deleted 2026-10-14 at user request.

- ~~Flaky outbox test~~ fixed 2026-10-14: `uuidv7()` was random below 1 ms, so same-ms outbox events sorted randomly; now monotonic (RFC 9562 §6.2).
- Dev runs from WSL only (`tools/require-wsl.ts` blocks Windows); local `.env` has `API_PORT=3001` (Windows `node app.js` holds 3000).
- Build service open items: Redis queue/DRR/SSE/MinIO/quota/entitlements; idempotency + rate limit are in-process (per client IP until sessions); gVisor runtime; fork-bomb/disk-fill/recursive-macro sandbox tests.
- `.github/workflows` sits under `RoboSim/`, so GitHub will not run it until the repo root (or workflow paths) is adjusted.

- Slice 11: canvas in `packages/circuit-canvas` (already named in depcruise browser rule + TD §3 tree), source-exported like `@robosim/ui`. Coordinates mm, 0.1" (2.54 mm) grid; footprints/art live in circuit-canvas (not component packages) for now. Breadboards are topological in the loader (strips via union-find), so unused holes never become MNA nets.
- Slice 11 details: schema v2 `seats` (identity migration). Engine-free entries: `@robosim/component-*/manifest`, `@robosim/catalog/manifests` (parity test vs CATALOG), `@robosim/board-avr-uno/pins`; `pnpm new:component` scaffolds `manifest.ts`. Board fixed at canvas origin (not in the document). Lab Design tab: `design-panel.tsx` (autosave key `robosim.lab.design.v1`), starter in `design-starter.ts`; `SceneInfo.project` lets the tab open demos. Demo docs re-laid out on the grid (x/y only; goldens frozen, unchanged).
- Browser check slice 11: `%TEMP%\robosim-cdp\shot11.mjs` (fa) — seats, hover net highlight, compile & run blink + LED glow, mouse drag unseats + undo, mouse wire with bend, ي/ك search, line-follower demo opens. Dev: `pnpm exec turbo run dev --filter=@robosim/api --filter=@robosim/web`.
- Web initial JS 252.5 KB gz (+4.3 KB: editor strings in both locales).
- Slice 12: `/editor` (apps/web/src/editor): editor-page, use-run (Run model), use-layout (+ size class via matchMedia), project-store (`robosim.editor.project.v1` = {project, pristine}; confirm before replacing a modified project), starter.ts (moved from the Lab), help-dialog. Lab Design tab removed; Lab panels (arena/pins/serial/findings/challenge/sketch) are reused from `src/lab`. Canvas `mode` edit/run/view + `interactionOf` (pressed → momentary, single boolean → toggle, else popover). `ResizeHandle` in @robosim/ui. Test helper `src/testing/fake-worker.ts`. Browser check: `%TEMP%\robosim-cdp\shot12.mjs`. Web initial JS 256.7 KB gz.
