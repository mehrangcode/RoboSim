# Plan — Guided projects (FR-LRN-01 P2 set, US-LRN-01, FR-PRJ-01 "from guided project")

Goal: a beginner opens /learn, starts "Line-follower" (Free) or "Obstacle avoider" (Maker; teaser for Free), gets a
new project with the chassis pre-placed, and follows sequential FA/EN steps in an editor side panel. Each step is
checked live by declarative validators (circuit, mounts, code, run result) with targeted hints; finishing all steps
and meeting the arena's success condition marks the project complete and records progress (server or local).

## Steps
- [x] 0. Close BOM slice step 6: `pnpm verify` (turbo concurrency 2) green (browser check folded into step 6).
- [x] 1. Content model (`packages/shared` contracts + `packages/content/src/guided/`): `GuidedProject`
      (slug, version, tier, FA/EN title/summary/steps markdown, images, starter doc, arena + challenge ids,
      success condition), `StepValidator` union (partPresent, connected → pin set {pwm, analog, digital, gnd, 5v},
      wireBetween, mountedOn, codeFact via code-analysis, codeTodoResolved, runSucceeds) with failure reasons → hint keys.
- [x] 2. Pure validator engine (engine-free, next to `CircuitNets` in circuit-canvas or new module): evaluate steps
      against ProjectDocument + code facts + last run outcome; sequential state machine (active / done /
      needs-attention). Unit tests incl. AC1 (IN1 on D5 → pass; D4 → PWM hint).
- [x] 3. Content: Line-follower (oval, Uno + L298N + 2× TT + 3-ch line sensor + 4×AA) and Obstacle avoider
      (obstacle course, Uno + L298N + 2× TT + HC-SR04): starter docs, fill-in-blank sketches (TODOs), steps FA/EN,
      images (SVG), solution sketches compile + succeed (golden-style test through `grade`).
- [x] 4. Migration `0007_guided`: `guided_progress` (user, workspace, content_version_id text, project_id,
      completed_steps int[], completed_at; RLS owner). API module `learning`: GET /guided-projects,
      GET /guided-projects/:slug (gated → teaser + `entitlement_required` per `learning.guided_projects`),
      PUT /progress/guided/:contentVersionId, GET /progress/guided. (POST /projects unchanged: the web posts the starter doc.)
- [x] 5. Web: /learn catalogue page (cards, tier badge, progress, teaser + upgrade); editor "Guide" side panel
      (step markdown, images, hint, "show me" canvas highlight, reveal solution for code steps, progress bar,
      completion celebration); guest progress in localStorage merged on sign-in. FA/EN, RTL.
- [x] 6. Tests (shared/content unit, API HTTP, web) + `pnpm verify` green + browser check FA/EN.
- [x] 7. Docs: PRD/TD/API-Spec/Release-Plan/User-Stories notes, ADR-025, CLAUDE.md/README sync.

## Acceptance
- US-LRN-01 AC1: step "Connect IN1 to a PWM pin" — IN1→D5 completes; IN1→D4 shows the PWM-pins hint.
- US-LRN-01 AC2: all steps done + success condition met → completion shown and progress recorded
  (server when signed in, local for guests, merged on sign-in).
- Free user: Line-follower full; Obstacle avoider shows teaser + upgrade (server returns no body).
- Both solution sketches succeed on their arenas headless (deterministic test).
- `pnpm verify` green.
