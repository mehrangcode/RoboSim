# Context — component catalogue expansion

## Status

2026-10-17: docs for Tiers A–C written; Tier A complete: slices 16a–c done (uncommitted, `pnpm verify` green, goldens unchanged since 16a re-record, browser-checked). Next: ask user (proposed: slice 17 3D view, or Tier B/C in P2).

## Decisions

- Tiers: fundamentals (discrete semis, gates, 555, switches, regulators, simple sensors) `basic`; modules and
  specialty parts (TB6612, stepper, keypad, relay, OLED, IMU, WS2812…) `pro`.
- New manifest categories `semiconductor` (diodes, transistors, linear regulators) and `ic` (74HC, 595, 4017,
  ULN2003A, 555). Buck module LM2596 stays `power`.
- Multi-variant parts share one package with several definitions (battery precedent): `diode`,
  `linear-regulator`, `logic-74hc`.
- Engine limits found: MCU inputs are thresholded once per 1 ms slice; avr-uno emits output edges mid-instruction
  and applies inputs scheduled at the current cycle before the next instruction → a cycle-exact MCU-edge fast
  path is possible (needed for keypad scanning, gate read-back). Edges are reported only for output High/Low;
  mode changes to input are not edges.
- Combinational chains: today a stamp change re-solves once after all steps → one slice per gate stage; 16b adds
  an opt-in `settle()` loop.
- Arduino libraries to add (GitHub, pinned): Stepper (16b), Keypad (16c); Tier C libs later.
- `internalConnections` on a definition makes the loader treat the part as topological (never simulated) → use
  manifest `bondedPins` for real parts. `signalPassthrough` (resistor) lets io.edges/io.pwm see MCU pins behind series
  resistors (scheduleMcuInput stays direct-only; ground never linked). `isolationGroups` scopes circuit tracing.
- Input settling: scheduler solves at power-on and on `McuCore.onPinModeChange` (avr-uno emits mode changes from the
  port listener) and applies inputs at that cycle. Fixed phantom start-up button presses.
- Versions after 16a: sim-core 0.3.0, board-avr-uno 0.2.0, components 0.2.0 (all component packages), safety-rules
  0.2.0, sim-runtime 0.4.0. Only servo-sweep golden changed in substance; line follower still 14.43 s.
- Sound: `apps/web/src/editor/use-buzzer-audio.ts` (square-wave oscillator per sounding part; `robosim.audio.v1`).
- Passive buzzer: 42 Ω coil + 8 mH → DC HIGH draws coil current (pin warning); demo uses 220 Ω (no findings).
- Browser check: `%TEMP%\robosim-cdp\shot16a.mjs` (accepts JS dialogs; Windows node via `cmd.exe /c`).
- Web initial JS 260.8 KB gz (+4.5 KB: manifests + strings).
- 16b engine: `ComponentModel.logicNets/mcuEdge/settle`, `ComponentIO.emitEdge`, `Simulation.logicUnsettled`
  (SAF-LOGIC-OSCILLATION). Logic parts step in topological order (`logicOrder` in scheduler.ts). Shared CMOS helpers
  in `sim-core/src/logic.ts` (HC_FAMILY, CD4000_FAMILY, logicLevel, stampPushPull). Goldens unchanged by 16b.
- Edge-driven parts: DC-derived input changes apply at slice start (not end) — found via 595 SRCLR-tied-low test.
  Simultaneous edges (one port write) must be applied together (stepper snapped to a single coil otherwise).
- Stepper 28BYJ-48: rotor follows timed coil edges (MCU or ULN2003A `emitEdge`, inverted), pull-in 1200 half-steps/s,
  missedSteps = floor(|commanded − rotor| / 2). Stepper(2048, 8, 10, 9, 11) → IN1..IN4 = blue, pink, yellow, orange.
- Toolchain lock now has Stepper 1.1.3 + Keypad 3.1.1. NEVER prettier-format `apps/compiler/toolchain.lock.json`
  (installed copy compared byte-for-byte → "toolchain stale"; fix with `pnpm compiler:setup`).
- Browser check 16b: `%TEMP%\robosim-cdp\shot16b.mjs`, `shot16b2.mjs` (reads stepper line coords). Web initial JS
  262.5 KB gz.
- 16c: planck contact skin (1 cm/body) fixed in PlanckWorld (inset polygons, perimeter out, raycast − skin/cos);
  goldens unchanged. Bump avoider needs 3 switches (2 corner switches let a block corner wedge between them).
- scheduleMcuInput skips pins in output mode; floating-input rule skips pins driven < 0.5 s ago (lastDrivenAt).
- Canvas: `data-input` art elements = momentary buttons; interaction kind `keys` (all-boolean inputs, no popover).
- Do NOT `git checkout` the toolchain lock to inspect it (reverted Stepper/Keypad once; restored from
  `.local/toolchain/toolchain.lock.json`).
- Browser check 16c: `%TEMP%\robosim-cdp\shot16c.mjs`, `shot16c2.mjs`. Web initial JS 263.7 KB gz.
