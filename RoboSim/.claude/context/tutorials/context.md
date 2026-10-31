# Context — new guided tutorials

## Status
- Step 1 done: `arenaId` nullable (shared `guidedSummarySchema`, content `GuidedContent`), `benchBase()` in
  `packages/content/src/guided/bench.ts`, `GuidedContent.referenceInputs` (scripted inputs for the grade test),
  `packages/sim-runtime/src/guided.test.ts` generalised (sketch id = camelCase(slug); no robot assumptions).
- Step 2 done: placeholders for all 11 sketch ids in `sketches.ts` (`<CONST>_SOLUTION_SKETCH = ''`, one
  delimited section per slug) and `generated.ts` (`id: ''`). Harness in `.local/tools/` (see below).
- Steps 3–6 done (2026-10-31): all 6 robot refs re-validated (steps + grade success, 0 findings/damage);
  scanning TOO_CLOSE 20/25/30/35 all succeed; plain line-follower fails oval-wide-gaps. Registered 13 in
  index (learn order), firmware regenerated (conformance file diff was formatting-only → reverted),
  learning.test updated. guided.test 91/91, api learning 7/7, content 45/45.
- Step 7: docs done (Release-Plan P2 block + arena note, PRD FR-LRN-01/FR-ARN-05, TD arenas, ADR-025 'Later',
  README). format/i18n/arch green. Serialised turbo verify running; then browser check (Learn + 1 bench + 1 robot).

## Authoring conventions (every new tutorial)
- Module `packages/content/src/guided/<slug>.ts` exporting `export const <camelSlug>: GuidedContent`.
  Covers/step images (inline SVG strings) live in that module (not assets.ts) to avoid edit clashes.
- Sketches: only inside the slug's delimited section of `guided/sketches.ts` — `<C>_STARTER_SKETCH`
  (pins `0` + `// TODO:` line like line-follower), `<C>_PINS` (the solution snippet shown by the code step),
  `<C>_SOLUTION_SKETCH` (= starter.replace(...)). sketches.ts must stay import-free (compiler script imports it).
- Steps: first `intro` (reading step, no checks), then build steps with checks, a `code` step whose checks
  flag the starter's blank pins (`codeMissing`) and has `solution`, last step `run` with `{kind:'run'}`.
  Step ids `/^[a-z0-9][a-z0-9-]{0,47}$/`, ≤16 checks/step, ≤40 steps. Text `{en, fa}`; fa natural Persian
  (informal "تو" register like existing tutorials), Persian digits in prose where existing content does.
- Robot: `robotBase()` + `DRIVE_STEPS`/`DRIVE_PARTS`/`DRIVE_WIRES`/`DRIVE_CODE_CHECKS` from robot.ts /
  drive-steps.ts; `introStep(en, fa)`; `finished(starter, parts, wirePairs, solution)`; slots `deck`,
  `front-bracket`, `front-top`?, `motor-left`, `motor-right` (see chassis-2wd geometry). `free: false`.
- Bench: `benchBase(guided, title, starterSketch, challenge)`; `arenaId: null`; `free: true`; challenge uses
  only `serialMatches` / `pinState` / `timeLimit`; interactive goals get `referenceInputs`.
  Bench intro should not mention robots; reuse `introStep` only for robots.
- Reference must: pass every step, then `grade()` → `success` within 120 s sim, no static findings, no damage.

## Harness (dev only, .local is gitignored)
1. `node .local/tools/compile-sketch.ts packages/content/src/guided/sketches.ts <C>_SOLUTION_SKETCH /tmp/claude-1000/<slug>.hex`
2. Copy `.local/tools/try-guided.test.ts.template` → `packages/sim-runtime/src/tmp-<slug>.test.ts`, edit the import
   (`import { <camelSlug> as c } from '../../content/src/guided/<slug>.js'`) and HEX path; run
   `cd packages/sim-runtime && npx vitest run src/tmp-<slug>.test.ts`. Delete the tmp test afterwards.
- Never run whole-package/turbo test suites (WSL OOM). Single test files only.

## Integration (main session, at the end)
Register in `guided/index.ts` in learn order; `pnpm firmware:gen`; learning.test.ts expectations;
fake-learning; docs (Release-Plan, decisions ADR-025, PRD); browser check.

## Integration notes from helpers
- New arena `oval-wide-gaps` (+ challenge, i18n, BUILTIN_ARENAS) for mind-the-gap; `oval-gaps` untouched
  (arenas are not versioned). Docs to update: Release-Plan arena list ("eight arenas … four line tracks"),
  PRD FR-ARN-05.
- Engine extras: guided `prop` checks fall back to manifest defaults; code check uses `servo`, `dht`;
  `part` check `onServo`; `mount.onServo` (no schema bump; TD §8.10, API-Spec updated by helper).
- Weather station is serial-only (LCD1602 is a pro part; user chose serial-only, 2026-10-31).
- PID uses line-5ch (pro part) — fine, tutorial is paid.
