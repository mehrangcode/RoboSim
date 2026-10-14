# Simulator Lab (demo page, pulled forward before slice 5)

**Goal:** see the engine in the browser at `/lab`, and add a visible demo with every later slice.

## Steps

- [x] `packages/sim-runtime` — scenario builder (parts + wires → Simulation), demo scenarios (line follower on oval; bench: blink, button, dimmer, servo), committed firmware hex generated from asm with a drift test, worker protocol types + `SimHost` (pacer loop, frames ≤ 30 Hz)
- [x] `packages/renderer-2d` — canvas renderer of scene + frame (floor, walls, zones, robot, sensor spots, trail); consumes plain data only
- [x] `apps/web` `/lab` route (lazy chunk) — Web Worker, Arena tab (canvas, run/pause/reset/speed, telemetry), Bench tab (LED glow, press-and-hold button, pot slider, servo horn, pin table); FA/EN strings
- [x] Verify in a real browser (dev server), `pnpm verify` green, docs

## Acceptance

- `/lab` shows the robot lapping the oval live; controls work; telemetry updates.
- Bench demos react to input (button lights LED, pot dims LED / turns servo).
- Initial JS budget unchanged (engine + renderer are lazy / in the worker).
