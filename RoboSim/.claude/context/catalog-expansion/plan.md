# Plan — component catalogue expansion (Tiers A, B, C)

**Goal:** grow the catalogue from the 16-part P1 basic set to a full beginner-to-maker kit: discrete
semiconductors, logic ICs, more drivers, actuators, sensors and modules — each a realistic,
datasheet-calibrated model with art, safety coverage, bilingual names and a visible demo.

**Acceptance (all tiers):** every new part has manifest + model + tests (valid manifest, datasheet
operating points, faults), FA/EN name, canvas footprint + art (+ live state), mounting footprint when it
can sit on a robot, a demo document, and `pnpm verify` green. Goldens stay bit-identical unless the
slice says otherwise (then `engineVersion` bump + re-record).

User decisions (2026-10-17): fundamentals `basic` (free), modules/specialty `pro`; new categories
`semiconductor` + `ic`; Tier A now as P1 slices 16a–c (3D view → slice 17), Tiers B + C in P2; all of Tier A.

## Docs
- [x] PRD §7.2 catalogue table (tiers, phases, new categories)
- [x] Release Plan: P1 slices 16a–c, 3D → 17; P2 catalogue tracks B + C; P4 1.3 line
- [x] Technical Design §5.4 (elements, fast path, settle), §5.5 (bump switch, new sensors), §6 libraries, planned §5.4 Tier B / Tier C

## Slice 16a — discrete parts, outputs, power — done 2026-10-17 (uncommitted)
- [x] Categories `semiconductor`, `ic` (contracts, new-component, library filter, i18n)
- [x] `diode`: 1N4007, 1N4148, Zener 5.1 V
- [x] `led-rgb` (common cathode / anode)
- [x] `buzzer-passive` (tone frequency from edges)
- [x] `relay-module` (1-ch 5 V, H/L trigger, COM/NO/NC contacts)
- [x] MG996R servo
- [x] `seven-segment` (1 digit, CC / CA)
- [x] `linear-regulator`: LM7805, AMS1117-3.3
- [x] `lm2596` buck module
- [x] Art + footprints, catalog, i18n, demos, docs, verify, browser check
- [x] Engine fixes: input settling at power-on / pin-mode change; `signalPassthrough`, `bondedPins`, `isolationGroups`; versions bumped, goldens re-recorded

## Slice 16b — drivers, logic ICs, engine fast path — done 2026-10-17 (uncommitted)
- [x] Engine: `settle()` combinational pass + MCU-edge fast path (opt-in; goldens identical)
- [x] TB6612FNG, L9110S
- [x] ULN2003A + 28BYJ-48 stepper (+ Stepper library in compiler lock)
- [x] `logic-74hc`: 74HC00, 08, 32, 86, 14
- [x] 74HC595, CD4017
- [x] DIP footprints + generic chip art, demos, docs, verify, browser check

## Slice 16c — sensors and input modules — done 2026-10-17 (uncommitted)
- [x] Bump switch (lever reach on the robot), 5-channel line array, IR obstacle (FC-51)
- [x] PIR (HC-SR501), sound (KY-038), soil moisture
- [x] Joystick (KY-023), 4×4 keypad (+ Keypad library), rotary encoder (KY-040)
- [x] Art, mounting, demos, docs, verify, browser check

## Tier B (P2) — reactive elements and transistors
- [ ] Engine: capacitors/inductors (companion models, sub-stepping), BJT/MOSFET region models
- [ ] Capacitors, NE555, 2N2222, BC547, 2N3906, TIP120, IRF520, IRLZ44N; safety rules

## Tier C (P2) — MCU buses
- [ ] avr-uno TWI + SPI, I²C/SPI device framework; timed single-wire via fast path
- [ ] MPU-6050, SSD1306, LCD 16×2 I²C, BMP280, VL53L0X, DHT11, DS18B20, WS2812
