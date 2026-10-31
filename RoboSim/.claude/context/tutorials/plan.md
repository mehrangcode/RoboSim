# Plan — 11 new guided tutorials (FR-LRN-01)

**Goal:** add 5 bench + 6 robot guided tutorials, with engine support for arena-less tutorials and
servo-mounted parts.

## Decisions (user, 2026-10-31)
- Bench tutorials are free; the new robot tutorials are paid.
- Scanning avoider: add real engine support (part mounted on a servo horn rotates with it).
- Bench completion: the `run` step passes when the project's `successConditions` are met
  (`serialMatches` / `pinState`). No new check kinds.
- Learn order: bench first → line follower → square → gap → PID → obstacle avoider → scanning → maze → sumo.

## Catalogue (slug · arena · free)
| # | slug | title | arena |
|---|---|---|---|
| 1 | blink-traffic-light | Blink & Traffic Light | — (free) |
| 2 | button-counter | Button Counter | — (free) |
| 3 | dimmer-knob | Dimmer Knob | — (free) |
| 4 | servo-sweep | Servo Sweep | — (free) |
| 5 | weather-station | Desk Weather Station | — (free) |
| 6 | line-follower | (existing, free) | oval |
| 7 | square-track | Square Track: Sharp Corners | square |
| 8 | mind-the-gap | Mind the Gap | oval-gaps |
| 9 | pid-line-follower | Smooth Line Follower (PID) | figure-eight |
| 10 | obstacle-avoider | (existing) | obstacle-course |
| 11 | scanning-avoider | Scanning Obstacle Avoider | obstacle-course |
| 12 | maze-explorer | Maze Explorer | maze |
| 13 | sumo-bot | Sumo Bot | sumo |

## Steps
- [x] 1. Engine: arena-less guided (`arenaId` optional in content types, shared summary schema, mapper,
      fake-learning); `benchBase()` builder; `referenceInputs` for scripted inputs in the grade test;
      generalise `sim-runtime/src/guided.test.ts` (no drive-robot assumptions).
- [x] 2. Per-tutorial sketch modules `packages/content/src/guided/sketches/<slug>.ts`; scratch harness that
      compiles a sketch + grades a doc (for tuning without regenerating all firmware).
- [x] 3. Engine: servo-mounted parts (mount `onServo` parent → world pose follows servo angle; schema,
      sim-core world, sim-runtime loader, mounting editor, 3D view, tests).
- [x] 4. Bench tutorials 1–5 (weather-station serial-only: LCD is pro; prop-default fallback + code checks servo/dht added).
- [x] 5. Robot tutorials 7, 8, 9, 12, 13, then 11 (after step 3).
- [x] 6. Register in index (order), sketches, `pnpm firmware:gen`, FIRMWARE map, learning.test, fake-learning.
- [ ] 7. Docs: Release-Plan, decisions ADR-025, PRD/README mentions; i18n; `pnpm verify` (serialised to
      avoid OOM); browser check of Learn page + one bench + one robot tutorial.

## Acceptance
- Each reference passes all steps and meets its challenge in `grade()` (≤120 s sim), no findings/damage.
- Free plan sees 6 free tutorials (5 bench + line follower); others locked.
- Servo-mounted sensor rotates in sim with the servo; covered by unit tests.
- Lint, typecheck, tests, i18n check green.
