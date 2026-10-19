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

## Tier B + C (P2) — started 2026-10-19, four slices (B1, B2, C1, C2)

Per slice: parts + model tests, art + footprints, catalog (`phase: P2`), FA/EN names, safety rules with
trigger/clean fixtures, demos in the Lab, docs (PRD/TD/Release Plan/README), `pnpm verify`, browser check.
Editor library shows P2 parts (editor passes `phase="P2"`).

### Slice B1 — reactive elements, capacitors, NE555 — done 2026-10-19 (uncommitted; browser check batched at end)
- [x] Engine: capacitor + inductor branch elements (BDF2 companion, BE after discontinuities, state owned by the part), DC mode (caps open)
- [x] Engine: transient integrator (LTE-controlled sub-steps 1 µs–1 ms, breakpoints at edges of MCU pins that
      reach a reactive net, MCU run in chunks so inputs land within a sub-step, slice-averaged solution,
      per-net envelope), settle/pendingSwitch event location, ComponentIO.now; static analysis in DC mode
- [x] TT motor winding inductance + damping; driver clamp diodes; goldens re-recorded; engineVersion bump
- [x] Parts: ceramic capacitor, electrolytic capacitor (polarity, rating, ESR, leakage, venting), NE555
- [x] Safety: SAF-CAPACITOR (reversed / over-voltage, any `capacitor` trait part)
- [x] Demos: 555 blinker (pulseIn period), RC charge curve (A0 + Serial)
- [x] Editor library lists P2 parts; prop/option/input label test + Tier A label gaps filled

### Slice B2 — transistors — done 2026-10-19 (uncommitted; browser check batched at end)
- [x] Engine: BJT element (cutoff/active/saturation, NPN/PNP), MOSFET level-1 (Newton), per-solve power, thermal in parts
- [x] Engine: PWM pins reaching a base/gate are edge-driven in reactive circuits; edge-level reconcile; static transition probe
- [x] Parts: 2N2222, BC547, 2N3906, TIP120, IRLZ44N, IRF520 module
- [x] Safety: SAF-BASE-NO-RESISTOR, SAF-FLYBACK (switch-off probe sees the spike), SAF-MOSFET-GATE
- [x] Demos: transistor motor (TIP120 + 1N4007 + knob), MOSFET soft start (IRLZ44N), no-flyback safety demo

### Slice C1 — I²C / SPI — done 2026-10-19 (uncommitted; verify green; browser check batched at end)
- [x] avr-uno TWI / SPI (AVRTWI / AVRSPI, byte timing from SCL / SPI clock), board-avr-uno 0.3.0, goldens re-recorded
- [x] sim-core bus routers (bus nets, idle-high, address match, wired-AND; SPI chip select), RegisterPort, stampPullUp, `powerOn` hook
- [x] Safety: SAF-I2C-PULLUP, SAF-I2C-ADDRESS (resetPin exemption), SAF-I2C-LEVEL
- [x] Libraries pinned: BusIO, Unified Sensor, GFX, SSD1306, LiquidCrystal_I2C, MPU6050, BMP280, VL53L0X; compiler: CRLF include scan, archives linked as a group, DRIVER_VERSION 2
- [x] Parts: SSD1306 OLED, LCD 16×2 + PCF8574, MPU-6050, BMP280 (I²C + SPI), VL53L0X; 3V3 rail in the loader
- [x] Art (OLED framebuffer, LCD 5×8 ROM), footprints, id prefixes (also Tier B), arena beam + default mount for VL53L0X
- [x] Demos: OLED, LCD, IMU tilt, weather station (3V3), laser avoider robot

### Slice C2 — timed single-wire — done 2026-10-19 (uncommitted)
- [x] Engine: core reports mode changes with level; `mcuMode` hook; `OpenDrainWatch` + `pullLow` (sim-core/src/single-wire.ts)
- [x] Libraries pinned: DHT 1.4.7, OneWire v2.3.8, DallasTemperature v4.0.6, NeoPixel 1.15.5
- [x] Parts: DHT11, DS18B20 (search ROM, multiple on one bus, parasite power), WS2812 strip (chained, current draw; `peakCurrentPer`)
- [x] Art/footprints/id prefixes, i18n, demos (two thermometers, NeoPixel rainbow), docs

### Wrap-up
- [x] README (features, hardware, planned)
- [x] Full `pnpm verify` (271/271 tasks, 2026-10-19)
- [x] Browser check of Tier B/C demos in the editor (FA UI): OLED, LCD, NeoPixel, thermometers, 555, TIP120, IMU, weather, laser avoider — all ≈1× real time, no errors
