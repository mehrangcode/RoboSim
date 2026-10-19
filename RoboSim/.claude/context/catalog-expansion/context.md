# Context — component catalogue expansion

## Status

2026-10-19: Tier A committed (0a861e0). Tier B + C started (user: "implement P2 Tier B & C"). Tier B + C complete (B1, B2, C1, C2), docs + README updated, `pnpm verify` green, browser check done. Nothing committed (awaiting user).

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

## Tier B/C decisions (2026-10-19)

- Engine version for all Tier B/C work: sim-core 0.4.0, components 0.3.0 (new packages too), safety-rules 0.3.0,
  sim-runtime 0.5.0; board-avr-uno bumps to 0.3.0 in C1. Line-follower lap now 14.44 s (grade.test pins it).
- Reactive elements are MNA branches (no internal nodes): C → r = ESR + 1/(a0·C), L → r = R + L·a0. History in
  `ReactiveState.history`; `circuit.restart()` drops it (BE) after edges/outputs change/settle switch/dirty.
- Integrator constants: MIN_STEP 1 µs, MAX = slice, INSTANT_STEP 1e-9 (re-solve without time passing), LTE abs
  1 mV / 0.1 mA + 0.1 %. Sliver rule splits remainders (earlier version looped forever).
- Published solution in transient slices = WeightedSolution (time average); settle/MCU inputs use instantaneous.
  Tests that read part state after ≤ 1 ms see averages (use ≥ 2 ms).
- TT motor: L = 1.5 mH (prop inductanceMh), 2.2 kΩ damping across terminals. Drivers stamp clamp/body diodes.
- Static probes are `dcOnly` (caps open). 555 astable flip-flops inside DC settle passes (harmless).
- New trait `capacitor`; SAF-CAPACITOR reads REVERSE_VOLTAGE / OVER_VOLTAGE faults of capacitor parts.
- Enum options must not contain dots (i18n key separator): electrolytic ratings are `v6_3`…`v63`.
- Library panel default phase is P2. `capacitorCode` lives in circuit-canvas/src/markings.ts (lint: fast refresh).
- i18n merge helper: scratchpad `i18n_add.py <locales> <spec.json>` (spec {en:{ns:tree},fa:{ns:tree}}).
- B2: BJT = PWL region model (VCCS in active), MOSFET = level-1 Newton (Vgs step ≤ 2 V), ≤ 60 passes when transistors
  exist (diode-only circuits keep 10 → bit-identical). `TransistorReading.power` is per operating point (blend it,
  never multiply averaged V × I). Parts stamp avalanche diode (BV), body/ec diodes, TIP120 8 kΩ b–e.
- Edge-driven pins now = signal group touching reactive nets OR transistor control nets (base/gate). Averaging PWM
  phases with a freewheel diode chattered → 1 µs steps (62k steps per 50 slices); real edges → ~25 steps/slice.
- `reconcileEdgeLevels()`: edge-driven pins without pending edges follow the output level (FixedCore emits no edges).
- Step loop termination: sliver steps ≤ 2·MIN are forced/accepted; rejections shrink ≥ 10 % (two infinite loops found).
- LTE inductor tolerance 1 mA + 0.5 % (motors), capacitor 1 mV + 0.1 % (timers).
- BJT avalanche → OVER_VOLTAGE latched 10 ms (PWM kickbacks = sustained → damaged in ~50 ms); MOSFET → AVALANCHE
  (non-damaging). PARTIAL_ENHANCEMENT when Vth < scaled Vgs < full-enhancement V and Id > 50 mA.
- Static `transition(pin, from, to)` probe: 30 slices at `from`, 5 slices watched; only pins reaching a switch control.
- Pot position 0 = wiper at pin a (5 V in the demos' knob) → analogRead 1023.
- Golden re-record under the same uncommitted version: `git checkout -- apps/grader/golden && pnpm golden:update`.
  Golden lap 14.46 s; grade.test (fresh compile) 14.44 s — they always differ by 20 ms.
- Simulation.stats {steps, rejected, solves} for perf diagnosis. Blink alone costs ~0.54 ms CPU per slice (AVR).
- C1: I²C devices answer only when powered; the scheduler's `powerOn(io)` hook (once, at the power-on operating point)
  lets modules skip start-up times at t = 0 (a real Uno runs setup() ~65 ms after power-on). BMP280/VL53L0X use it.
- C1: toolchain.lock.json — edit with exact-text inserts (python json.dumps reflows the inline `apt` array); then
  `pnpm compiler:setup`. Lock `version` must equal the git tag (LiquidCrystal_I2C tag 1.1.3, properties say 1.1.2).
- C1: compiler fixes — includes split on /\r?\n/ (CRLF headers hid `#include <Wire.h>`; CRLF sketches also bypassed
  include refusals), link archives inside -Wl,--start-group/--end-group (BusIO before MPU6050 alphabetically). DRIVER_VERSION 2.
- C1: SAF-I2C-PULLUP flags lines idling < 1.5 V (a VIH-relative check false-alarmed on 5 V modules with 3.3 V pull-ups).
- C1: weather demo runs the BMP280 from 3V3 and clears PORT bits of SDA/SCL after begin (Uno's internal 5 V pull-ups).
- C2: avr-uno emits no edge for input→output-low when PORT is already low (OneWire/DHT); `onPinModeChange` now passes the
  output level and parts get `mcuMode`. Single-wire parts schedule both edges of every pulse; the restore level is the DC
  level without the part (no pull-up → stays low).
- C2: WS2812 decodes `io.edges(din)` in step (works for MCU and chained `emitEdge` input); `peakCurrentPer: "count"`
  makes SAF-SUPPLY-OVERLOAD scale per LED (37 mA).
- Laser avoider sketch: proportional veer (≤ 45 cm right, clear > 60 cm back left by accumulated heading, < 18 cm back up)
  reaches the obstacle-course goal in ~17 s; spin-until-clear variants ping-ponged in the first chamber.
- Unconfirmed: once, opening a demo while the previous one was still on its first (cold) compile showed the default
  project instead; not reproducible with warm build caches.
