# P1 — sim-core foundation (slice 1)

**Goal:** framework-free `packages/sim-core` with the deterministic building blocks every later P1 slice (Uno, components, physics, safety, grader) plugs into. Technical Design §5.

## Steps

- [x] Package scaffold (`@robosim/sim-core`, ES2023 lib only, no DOM/Node) + arch rule forbidding Node built-ins
- [x] `contracts.ts` — McuCore, ComponentModel, MnaStamper, WorldModel, snapshots
- [x] `dmath` — fdlibm-derived sin/cos/atan/atan2/exp/log (bit-identical across engines)
- [x] `prng` — xoshiro128** seeded via splitmix32, state save/restore
- [x] `netlist` — union-find terminal → net builder, ground = net 0
- [x] `mna` — dense LU + MNA (conductance, current source, voltage source w/ internal R, PWL diode region iteration ≤ 10, GMIN)
- [x] `bus` — MCU pins ↔ MNA (output = source w/ Rout, pull-up, VIL/VIH thresholding → scheduleInput)
- [x] `scheduler` — fixed 1 ms slices, PHYS_DT 2 ms, integer time, observers; pacer with injected clock
- [x] Tests: unit + integration (blink LED, button w/ pull-up) + determinism (two runs identical)
- [x] Docs: Release Plan P1 status, Technical Design deltas; `pnpm verify` green

## Acceptance

- `pnpm verify` green; sim-core has no DOM/Node imports (arch rule proves it).
- Same inputs + seed → identical snapshot stream.
- MNA matches hand-computed Ohm's-law / LED circuits within 1e-9.

## Next slices

2. Uno board (avr8js adapter, timer-derived PWM, `onPinEdge`) · 3. Components (resistor, LED, button, pot, L298N, DC motor) · 4. World/physics (planck.js), line sensor, ultrasonic · 5. Safety runtime + damage · 6. Success conditions · 7. Worker protocol.
