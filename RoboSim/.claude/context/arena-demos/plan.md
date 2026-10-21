# Plan — Maze solver + sumo bot demos (closes slice 14 "still open")

Goal: starter firmware + projects for the maze and sumo arenas, each succeeding on its arena's default
challenge headless, with goldens, Lab/editor demos and FA/EN text. Sumo also checks that the robot stays
in the ring (new `stayInZone` constraint).

Acceptance: `maze-solver` reaches the maze goal < 240 s; `sumo-bot` pushes the opponent out while staying
in the ring < 60 s; both deterministic goldens (Node + browser leg), zero safety findings; `pnpm verify`
and `pnpm test:sim` green; browser check (FA UI).

## Steps
- [x] 1. sim-core `stayInZone` constraint: spec + validation, evaluate leaf, schema (shared), tests, i18n
- [x] 2. content: sumo challenge = pushOut ∧ stayInZone(ring) ∧ timeLimit; challenge name text
- [x] 3. Maze solver: 3× HC-SR04 (NewPing) right-wall follower; scenario `maze-solver`; test
- [x] 4. Sumo bot: line sensor edge detect + HC-SR04 search/charge; scenario `sumo-bot`; test
- [x] 5. firmware:gen, goldens (engineVersion bump if needed), Lab/editor demo lists, i18n
- [x] 6. Docs (Release Plan, TD §5.7, README), verify, test:sim, browser check
