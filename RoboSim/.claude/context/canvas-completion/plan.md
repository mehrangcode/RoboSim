# Plan — canvas completion (FR-CIR-01 multi-select/align, FR-CIR-06 minimap + 60 FPS, movable board)

Goal: close the P1 canvas leftovers from slice 11.

Acceptance:
- Box select (drag on empty canvas; Shift+drag adds), Shift/Ctrl-click toggle, Ctrl+A; group move/rotate/flip/duplicate/delete = one undo step; duplicate copies wires internal to the selection.
- Align L/C/R/T/M/B + distribute H/V (3+), grid-snapped, seats recomputed.
- Board movable + rotatable: schema v4 `board.position?`, identity migration, loader ignores it (no engine bump, goldens unchanged), not deletable.
- Minimap (toggle button + M, persisted), click/drag pans.
- Playwright perf test 200 parts / 400 wires, p95 frame ≤ 16.7 ms locally, report-only in CI.

Steps:
- [x] 1 Schema v4 board.position + migration + tests
- [x] 2 Document ops: multi-part move/rotate/flip/duplicate/delete, align/distribute, board placement; tests
- [x] 3 Editor state: selection set, box select, keyboard (Ctrl+A, Esc), toolbar align; tests
- [x] 4 Movable board in canvas (drag/rotate) + geometry using board placement
- [x] 5 Minimap
- [x] 6 Perf: optimise + Playwright 200/400 gate wired into CI report-only
- [x] 7 i18n en+fa, docs (TD/Release Plan/README), pnpm verify, browser check
