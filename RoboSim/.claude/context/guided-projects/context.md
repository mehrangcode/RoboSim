# Context — Guided projects

Status: 2026-10-26 — ALL STEPS DONE (uncommitted). `pnpm verify` green (turbo --concurrency=2); web initial JS
297.7 KB gz of 300 KB budget (+2.9 KB, mostly guided zod schemas pulled in via @robosim/shared index).
Browser check (Playwright chromium, guest flow, FA + EN): /learn cards, Start → /editor with Guide pane, Next →
step 2 with hint. Fixed: guide scroll reset on step change. Not browser-checked: signed-in flow, a full wiring
walk-through, BOM tabs (BOM slice's browser check still open).

Also built (steps 4–7):
- API module `learning` + migration 0007_guided (`guided_progress`, RLS owner) + test/learning.test.ts (7).
  validation_failed answers 400 (not 422).
- Web: `src/lib/learning-api.ts`, `src/learn/{learn-page,guide-panel,markdown,svg,use-guided-progress}.tsx`,
  `/learn` route + nav "Learn", Guide pane in editor (Layout pane `guide`, mobile tab), `editor-page` `current`
  now memoized; fake `src/testing/fake-learning.ts`; i18n namespace `guided` (prefixes guided:reason., guided:guide.status.).
- Docs: PRD FR-LRN-01 status, API-Spec §4.6 note, TD guided_progress row, Release-Plan block, ADR-025, README row,
  Engineering-Guide firmware:gen row.

Built so far:
- `packages/shared/src/guided.ts`: localized text, `guidedCheckSchema` (part/prop/connected/boardPin/code/run),
  fail reasons, step/summary/project/progress schemas, `contentVersionId` = `slug@version`. Project doc gets
  optional `guided: {slug, version}` (no schema version bump: additive).
- `packages/circuit-canvas/src/guided.ts` (subpath `@robosim/circuit-canvas/guided`): `evaluateStep`,
  `evaluateGuide` (statuses done/active/attention/locked/upcomingDone, `completedIds`), `boardPinsOfKind`
  (digital excludes D0/D1 and A pins). 10 tests incl. AC1.
- `packages/content/src/guided/` (subpaths `@robosim/content/guided`, `/guided/firmware`): line-follower (free) and
  obstacle-avoider (paid, HC-SR04 TRIG D12/ECHO D11, TOO_CLOSE blank; works 18–30 cm, reference 25), shared
  drive steps, robot base builder, inline SVG assets, plain-data `sketches.ts` + generated `GUIDED_HEX`
  (3rd firmware set in apps/compiler/scripts/firmware-sets.ts).
- `packages/sim-runtime/src/guided.test.ts` (12): docs valid, assets exist, starter → intro → driver, reference passes
  all steps, blank sketch → codeMissing, reference grades success (line 14.4 s, avoider ~11 s).
- depcruise rule `browser-never-bundles-guided-content`.
- Gotcha: `pnpm firmware:gen` reformats conformance generated.ts (prettier drift) → `git checkout` it.

User decisions (2026-10-26):
- Content lives in the repo (`packages/content`), typed + versioned; API serves it. DB content tables + admin CMS
  (FR-ADM-04, FR-EXT-04) are a later slice.
- Validators are declarative (JSON-serializable), evaluated live in the browser; failure reasons map to hints.
- Starting creates a new project from the starter doc (chassis pre-placed): POST /projects when signed in, local for
  guests. Progress in `guided_progress` (migration 0007) via PUT /progress/guided/:id; guests in localStorage, merged
  on sign-in (same pattern as BOM inventory).
- Media: safe markdown subset + bundled SVG/PNG images + "show me" canvas highlight. Video deferred (needs MinIO).
- Obstacle avoider uses HC-SR04 on the obstacle course (new demo; existing ones are bump/VL53L0X/3-sonar maze).
- Steps sequential with auto-advance; earlier steps re-checked and can drop to "needs attention".
- Code steps: fill-in-blank TODOs in the starter sketch, validated via code-analysis facts; "reveal solution" hint.
- UI: /learn catalogue page + collapsible "Guide" side panel in the editor.

Facts:
- Entitlement `learning.guided_projects`: Free = `first` (Line-follower), paid = `all` (packages/shared/src/entitlements.ts).
- Arenas/challenges: `ARENAS`/`CHALLENGES` in packages/content (oval `oval-one-lap`, `obstacle-course`).
- Scenario builders + sketches: packages/sim-runtime/src/scenarios.ts, firmware/sketches.ts (`pnpm firmware:gen`).
- Next migration 0007, next ADR-025.

Blockers: none.
