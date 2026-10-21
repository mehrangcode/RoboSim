# Context — arena demos

Status: started 2026-10-20.

User decisions (2026-10-20):
- Next slice = maze + sumo firmware (not canvas/build queue/3D; 3D stays last).
- Sumo: add generic `stayInZone` constraint (robot axle midpoint stays in zone; fails latching on leave).
- Maze sensors: 3× HC-SR04 + NewPing, wall follower.
- For later: build queue → ports + local adapters; canvas → UX only, projects API with P2.

Touch points for a new demo: firmware/sketches.ts (+ `pnpm firmware:gen`), scenarios.ts builder,
protocol.ts ids, catalog-demos.test.ts, apps/grader/src/golden.ts, i18n shell.json (lab.demo names/desc).

Status 2026-10-20: DONE. verify green (after engine-version test fix), test:sim green (Node+Chromium+Firefox), browser check FA OK.
Follow-up idea: challenge rows show raw zone/object ids ("ring", "opponent") — translate arena ids.
- Maze: cell-by-cell, front sonar as odometer, PD centring, braked timed turns (TURN_90_MS 370 @ PWM 120).
  27.57 s, 0 collisions; robust to ±2 cm / ±5° start.
- Sumo: SEE_CM 85 (walls are farther from mid-ring), back off edge → turn → head to middle; keep pushing
  400 ms after last echo (contact < 2 cm min range). 6.47 s default; any heading 8–29 s.
- Engine bump sim-core 0.6.0, sim-runtime 0.7.0; 32 goldens identical except engineVersion.
- Gotcha: sim-runtime tests read @robosim/content + sim-core from dist → rebuild after editing them.
- Side fix: challenge names for all built-in challenges (only oval had one).
