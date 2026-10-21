# Context — canvas completion

Status: started 2026-10-21. Arena-demos work left uncommitted; user commits it.

User decisions (2026-10-21): full group ops; align + distribute; movable board w/ rotation, schema v4, layout-only;
toggleable minimap (M) + Playwright perf gate report-only in CI.

## State (2026-10-21)
DONE 2026-10-21: all 7 steps. verify green (275 tasks, goldens unchanged), canvas frame budget green in Chromium + Firefox
(worst work p95 ≈ 8–10 ms), browser check FA OK (band, align, board drag+rotate, minimap M, Space pan). Uncommitted — user commits.
Docs updated: TD §8.10/§17/§3 canvas row, Release Plan, README, EG.

## Decisions / notes
- Board = part id `board` in selection; schema v4 `board.position {x,y,rotation}`, never flips/deletes/copies; loader ignores it → no engine bump, goldens unchanged (frozen v3 jobs migrate).
- Group rotate/flip: one rigid body around snapped bbox centre; single part keeps first-leg pivot. Passengers (parts whose seats all lie in moving parts) always follow.
- Duplicate with a breadboard places the copy below the group (overlapping holes would seat copies in the original).
- Background drag = band select (fully inside); pan = Space+drag / middle / touch.
- `apply()` updater runs lazily → compute new ids from `doc` directly (fixed duplicate/library/drop).
- Perf test: prod React (define NODE_ENV + oxc jsx development:false); no `act` in prod → `settle()` = microtask + MessageChannel post (FIFO after scheduler task); start each step after paint.
