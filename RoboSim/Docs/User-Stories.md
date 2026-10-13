# RoboSim — User Stories

**Version:** 1.0 · **Date:** 2026-10-13 · **Owner:** @MehranG
**Related:** [PRD](PRD.md) (requirements `FR-*`) · [Release Plan](Release-Plan.md) (phases)

## How to read this document

- Stories are grouped into **epics** by module code. Each story lists the requirements it implements, its priority, and its phase.
- Acceptance criteria use **Given / When / Then**. A story is done only when every criterion passes as an automated test (unit, integration, or Playwright E2E) and the [Definition of Done](Engineering-Guide.md#10-definition-of-done) is met.
- Personas (Sara, Ali, Ms. Rezaei, Dr. Karimi, Reza, Mina, Hamed) are defined in [PRD §4.1](PRD.md#41-personas).
- Unless stated otherwise, every story must work in **both EN (LTR) and FA (RTL)**; this is not repeated per story.

## Epic index

| Epic | Module | Stories |
|---|---|---|
| E1 Workspace | WRK | US-WRK-01 … 05 |
| E2 Circuit design | CIR | US-CIR-01 … 07 |
| E3 Programming | COD | US-COD-01 … 06 |
| E4 Build | BLD | US-BLD-01 … 04 |
| E5 Simulation | SIM | US-SIM-01 … 08 |
| E6 Arena | ARN | US-ARN-01 … 08 |
| E7 Safety | SAF | US-SAF-01 … 05 |
| E8 BOM & exports | BOM | US-BOM-01 … 05 |
| E9 Projects & collaboration | PRJ | US-PRJ-01 … 07 |
| E10 Identity | IAM | US-IAM-01 … 07 |
| E11 Organizations | ORG | US-ORG-01 … 06 |
| E12 Learning | LRN | US-LRN-01 … 09 |
| E13 Community | CMY | US-CMY-01 … 05 |
| E14 Billing | BIL | US-BIL-01 … 07 |
| E15 Shop | SHP | US-SHP-01 … 06 |
| E16 AI assistant | AI | US-AI-01 … 06 |
| E17 Hardware bridge | HWB | US-HWB-01 … 03 |
| E18 Internationalization | I18N | US-I18N-01 … 03 |
| E19 Extensibility | EXT | US-EXT-01 … 04 |
| E20 Admin & operations | ADM / NTF / ANL | US-ADM-01 … 07 |

---

## E1 — Workspace (WRK)

### US-WRK-01 — Work in a familiar multi-pane editor
**As** Sara **I want** the library, canvas, code, and arena visible together **so that** I can see how my changes affect the robot.
*FR-WRK-01, FR-WRK-03 · Must · P1*
- **AC1** Given a new project, when it opens, then the five panes appear in the default layout and each pane can be resized by dragging its splitter.
- **AC2** Given I rearranged panes, when I reopen RoboSim on the same account, then my layout is restored.
- **AC3** Given the window is 900 px wide, when the workspace renders, then panes collapse into tabs and no content is horizontally clipped.

### US-WRK-02 — Control the simulation from a toolbar
**As** Ali **I want** Run, Pause, Step, Stop, Reset, and speed controls with shortcuts **so that** I can debug timing problems.
*FR-WRK-02, FR-SIM-05 · Must · P1*
- **AC1** Given a built project, when I press `F5`, then the simulation runs; `F6` pauses; `F10` advances exactly 1 ms of simulated time.
- **AC2** Given speed 4× on a slow machine, when the host cannot keep up, then the indicator shows the achieved real-time factor (e.g. "2.7×") and no cycles are skipped.
- **AC3** Given any toolbar button, when I navigate with Tab and press Enter, then the action runs (keyboard operability).

### US-WRK-03 — Never lose work
**As** Sara **I want** my work saved automatically **so that** a crash or closed tab does not lose progress.
*FR-WRK-04 · Must · P2*
- **AC1** Given I added a component, when 10 s pass or I close the tab, then the change is in IndexedDB.
- **AC2** Given I am signed in and online, when 30 s pass after a change, then the project is saved to the cloud and the status shows "Saved".
- **AC3** Given I was offline and edited, when connectivity returns, then local changes sync without overwriting newer cloud changes (conflict copy created if not collaborative).

### US-WRK-04 — First-time tour
**As** Sara **I want** a short guided tour **so that** I understand the screen without reading documentation.
*FR-WRK-06 · Must · P2*
- **AC1** Given my first visit, when the workspace opens, then a ≤ 6-step tour starts; I can skip it; Help → Tour restarts it.

### US-WRK-05 — Switch workspaces
**As** Ms. Rezaei **I want** to switch between my personal workspace and my academy **so that** class work and personal projects stay separate.
*FR-WRK-07 · Must · P3*
- **AC1** Given I belong to an org, when I switch workspace in the header, then the project list, entitlements, and policies of that workspace apply immediately.
- **AC2** Given I am in the org workspace, when I create a project, then it is owned by the org.

## E2 — Circuit design (CIR)

### US-CIR-01 — Place components
**As** Sara **I want** to drag parts onto a breadboard view **so that** the circuit looks like the real thing.
*FR-CIR-01, FR-CIR-03, FR-CIR-09 · Must (copy between projects: Should, P2) · P1*
- **AC1** Given the library, when I drag an L298N onto the canvas, then it is placed under the cursor and selected.
- **AC2** Given a selection of 3 components, when I press `R`, then all rotate 90° around the selection centre; `Ctrl+Z` reverts it.
- **AC3** Given 100 consecutive edits, when I press undo 100 times, then the canvas returns to the initial state.
- **AC4** Given a resistor dropped on a breadboard, when both legs land on different strips, then each leg joins that strip's net.
- **AC5** Given I copy three wired components and paste them into another project, then the wires between them are preserved.

### US-CIR-02 — Wire pins
**As** Sara **I want** to click pin to pin to draw a wire **so that** wiring is fast and precise.
*FR-CIR-02 · Must · P1*
- **AC1** Given I click Uno pin D5 and then L298N IN1, then a wire is created and both pins belong to the same net.
- **AC2** Given I hover a pin, then its name and all pins on the same net are highlighted.
- **AC3** Given a wire, when I change its colour, then the colour persists and appears in the wiring guide.

### US-CIR-03 — Edit component properties
**As** Ali **I want** to set values such as resistance or battery voltage **so that** the simulation matches my parts.
*FR-CIR-05 · Must · P1*
- **AC1** Given a resistor, when I enter `220`, then the value is 220 Ω and the label updates.
- **AC2** Given a battery, when I enter a voltage outside the chemistry range, then the input is rejected with an explanation.

### US-CIR-04 — Netlist is always correct
**As** an engineer **I want** the netlist derived incrementally and tested **so that** simulation, safety, and BOM always agree.
*FR-CIR-04 · Must · P1*
- **AC1** Given the reference line-follower circuit, when the netlist is built, then it equals the golden netlist fixture.
- **AC2** Given 200 components and 400 wires, when one wire changes, then the netlist update takes < 16 ms (benchmark in CI).

### US-CIR-05 — Navigate large circuits
**As** Ali **I want** zoom, pan, fit, and a minimap **so that** I can work on big designs.
*FR-CIR-06 · Must · P1*
- **AC1** Given a circuit, when I press `F`, then the view fits all components.
- **AC2** Given 200 components, when I pan and zoom, then interaction stays ≥ 60 FPS on the reference laptop.

### US-CIR-06 — Find parts in my language
**As** Sara **I want** to search "موتور" or "motor" **so that** I find parts without knowing English names.
*FR-CIR-10 · Must · P1*
- **AC1** Given the query "موتور", then DC motor, servo, and stepper results appear.
- **AC2** Given the query typed with Arabic "ي" or "ك", then results equal those for Persian "ی" / "ک".

### US-CIR-07 — See a schematic
**As** Ali **I want** an auto-generated schematic **so that** I can read the circuit like an engineer.
*FR-CIR-07 · Should · P4*
- **AC1** Given a circuit, when I switch to schematic view, then every net and component appears and the view is read-only.

## E3 — Programming (COD)

### US-COD-01 — Write Arduino code
**As** Ali **I want** a real code editor **so that** I can write the same C++ I will flash to my board.
*FR-COD-01 · Must · P1*
- **AC1** Given the FA UI, when the editor opens, then code is LTR with Latin digits.
- **AC2** Given a sketch with `motor.h`/`motor.cpp`, when I build, then all files compile together.

### US-COD-02 — Understand compile errors
**As** Sara **I want** errors on the exact line with a simple explanation **so that** I can fix them myself.
*FR-COD-03 · Must · P1*
- **AC1** Given a missing semicolon on line 12, when I build, then line 12 is marked and a FA/EN explanation "A `;` is missing at the end of the previous statement" is shown.
- **AC2** Given any of the 50 catalogued beginner errors, then a plain-language explanation exists in both languages (content test).

### US-COD-03 — Autocomplete and docs
**As** Sara **I want** suggestions and hover docs for Arduino functions **so that** I learn the API while typing.
*FR-COD-02, FR-COD-05 · Must (format: Should) · P2*
- **AC1** Given I type `digitalW`, then `digitalWrite(pin, value)` is suggested with a translated description.
- **AC2** Given badly indented code, when I press `Shift+Alt+F`, then the file is formatted in Arduino style.

### US-COD-04 — Program with blocks
**As** a 14-year-old student **I want** to snap blocks together **so that** I can program without syntax errors.
*FR-COD-04 · Must · P4*
- **AC1** Given a block program, when I build, then the generated C++ (visible side-by-side) compiles and behaves identically to hand-written equivalent code (golden tests for each block).
- **AC2** Given "Convert to code", when I confirm, then the project switches to C++ with the generated code and the blocks become read-only history.

### US-COD-05 — Use libraries safely
**As** Ali **I want** to add Servo or NewPing from a library manager **so that** I do not have to manage includes.
*FR-COD-07, FR-BLD-06 · Must · P2*
- **AC1** Given the library manager, when I add `Servo`, then `#include <Servo.h>` is inserted and the project pins the library version.
- **AC2** Given code including a non-allow-listed library, when I build, then the build fails with "library not available" and a link to request it.

### US-COD-06 — Pin usage extracted from code
**As** an engineer **I want** pin usage extracted from code **so that** safety rules can cross-check code and wiring.
*FR-COD-06 · Must · P1*
- **AC1** Given `analogWrite(7, 128)`, then the analyzer reports pin 7 as PWM output.
- **AC2** Given pins in `const int` or `#define`, then constants are resolved for literal values.

## E4 — Build (BLD)

### US-BLD-01 — Build on Run
**As** Sara **I want** Run to compile automatically **so that** I do not need to know what compiling is.
*FR-BLD-01, FR-BLD-05 · Must · P1*
- **AC1** Given changed code, when I press Run, then the status shows queued → compiling → running, and the simulation starts with the new firmware.
- **AC2** Given an unchanged project, when I press Run again, then no server build occurs (browser cache hit).

### US-BLD-02 — Fast cached builds
**As** Ms. Rezaei **I want** 20 students building the same starter code to start instantly **so that** class time is not wasted.
*FR-BLD-03 · Must · P1*
- **AC1** Given identical sources, board, and libraries, when a second user builds, then the server returns the cached artifact in < 200 ms (p95).

### US-BLD-03 — Fair and limited builds
**As** the platform **I want** quotas, rate limits, and fair-share queues **so that** abuse or one large class cannot degrade service.
*FR-BLD-04 · Must · P1*
- **AC1** Given a Free user with 30 builds today, when they build again, then the API returns `429 build_quota_exceeded` with reset time and the paywall explains the Maker plan.
- **AC2** Given org A has 200 queued builds and org B submits one, then B's build starts within the fair-share window (≤ 2 positions behind the head).

### US-BLD-04 — Malicious code cannot escape
**As** the platform **I want** builds sandboxed **so that** untrusted code cannot harm infrastructure.
*FR-BLD-02 · Must · P1*
- **AC1** Given the sandbox test suite (network access, fork bomb, huge output, path traversal in `#include`, 10 GB file write, infinite preprocessor recursion), when each is built, then it fails safely within limits and the host is unaffected (security test in CI).

## E5 — Simulation (SIM)

### US-SIM-01 — Run real firmware
**As** Ali **I want** my compiled code executed cycle-accurately **so that** timing behaves like the real Uno.
*FR-SIM-01, FR-SIM-02 · Must · P1*
- **AC1** Given Blink with `delay(1000)`, then the LED toggles every 1.000 s ± 1 ms of simulated time.
- **AC2** Given the peripheral conformance suite (timers, PWM frequencies on each pin, ADC, USART, I²C, SPI, EEPROM, interrupts), then all tests pass.

### US-SIM-02 — See what pins are doing
**As** Ali **I want** a live pin inspector **so that** I can debug without guessing.
*FR-SIM-06, FR-SIM-08 · Must (analyzer: Should) · P1/P2*
- **AC1** Given `analogWrite(5, 64)`, then pin 5 shows PWM 25 % at ~980 Hz.
- **AC2** Given pins D9 and D10 selected in the logic analyzer, when the run records 100 ms, then a timing diagram shows both signals and the cursor measures pulse width to 1 µs.

### US-SIM-03 — Serial monitor and plotter
**As** Sara **I want** to see `Serial.print` output and plot numbers **so that** I can watch sensor values.
*FR-SIM-07 · Must · P1/P2*
- **AC1** Given `Serial.begin(9600)` and prints, then lines appear with optional timestamps.
- **AC2** Given comma-separated numbers per line, when plotter mode is on, then each column is a series.

### US-SIM-04 — Realistic electrical behaviour
**As** Sara **I want** a potentiometer to change the analog reading **so that** inputs behave like real ones.
*FR-SIM-03 · Must · P1*
- **AC1** Given a 10 kΩ pot between 5 V and GND with wiper on A0, when I set it to 30 %, then `analogRead(A0)` returns 307 ± 2.
- **AC2** Given an LED with 220 Ω at 5 V, then simulated current is 13–14 mA and brightness reflects it.

### US-SIM-05 — Parts break like real parts
**As** Sara **I want** a part to show it is damaged when I make a dangerous mistake **so that** I learn what would happen in reality.
*FR-SIM-10, FR-SAF-04 · Must · P1*
- **AC1** Given a motor wired directly to D9, when the code drives D9 HIGH, then the Uno pin is marked damaged, a smoke icon and text appear, and D9 stops working until fix + reset.
- **AC2** Given the fix is applied but not reset, then the part stays damaged.

### US-SIM-06 — Interact during a run
**As** Sara **I want** to press buttons and move obstacles while the robot runs **so that** I can test reactions.
*FR-SIM-11 · Must · P1*
- **AC1** Given a running simulation, when I click a button component, then the input pin changes for as long as I hold it.

### US-SIM-07 — Deterministic results
**As** Ms. Rezaei **I want** the same submission to always get the same result **so that** grading is fair.
*FR-SIM-09 · Must · P1*
- **AC1** Given a project version, artifact, arena, pose, input log, and seed, when it runs 10 times in the browser and 10 times in the grader, then pose traces are identical in the grader and the browser trace is within 1 mm / 0.1° of the grader at every 100 ms sample.

### US-SIM-08 — Replay a run
**As** Ali **I want** to save and share a replay **so that** others can see exactly what happened.
*FR-SIM-12 · Should · P4*
- **AC1** Given a recorded run, when replayed, then the robot trace is identical to the original.

## E6 — Arena (ARN)

### US-ARN-01 — Watch the robot move
**As** Sara **I want** to see my robot drive in an arena **so that** I understand what my code does physically.
*FR-ARN-01, FR-ARN-02, FR-ARN-03 · Must · P1*
- **AC1** Given both motors at 100 % forward on a 2-wheel chassis with a 6 V pack via L298N, then the robot drives straight at the calibrated speed ± 5 %.
- **AC2** Given left 100 %, right 0 %, then the robot turns right around the right wheel.
- **AC3** Given the robot hits a wall, then it stops at the wall and does not pass through it.

### US-ARN-02 — Switch 2D and 3D without losing state
**As** Sara **I want** to switch to 3D mid-run **so that** I can see the robot from another angle without restarting.
*FR-ARN-01, FR-ARN-07, FR-ARN-08 · Must · P1*
- **AC1** Given a run at t = 12.345 s, when I toggle to 3D, then simulated time and pose are unchanged and the switch completes in < 1 s (3D already loaded).
- **AC2** Given the 2D view, when I enable "follow" and the sensor overlay, then the camera tracks the robot and sensor rays/readings are drawn each frame.

### US-ARN-03 — Sensors see the world
**As** Sara **I want** line and distance sensors to react to the arena **so that** my line follower and obstacle avoider work.
*FR-ARN-04, FR-SIM-04 · Must · P1*
- **AC1** Given a TCRT5000 mounted 5 mm above a black line, then its digital output reads the "line" level; over white it reads the opposite.
- **AC2** Given a wall 50 cm ahead inside the 15° cone, then `pulseIn` on ECHO returns 2,900 µs ± 2 %.
- **AC3** Given an obstacle at 450 cm, then the sensor reports out-of-range timing like the real HC-SR04.

### US-ARN-04 — Choose an arena
**As** Ali **I want** built-in arenas **so that** I can test different behaviours.
*FR-ARN-05 · Must · P1*
- **AC1** Given the arena picker, then line track variants, obstacle course, maze, sumo ring, and open floor are available with thumbnails.

### US-ARN-05 — Set the start pose
**As** Sara **I want** to drag the robot to a start position **so that** every test starts the same way.
*FR-ARN-06 · Must · P1*
- **AC1** Given I drag and rotate the robot, when I press Reset, then it returns to that pose; the pose is saved with the project.

### US-ARN-06 — Mount sensors on the chassis
**As** Ali **I want** to place sensors on the chassis **so that** sensor placement affects behaviour like on the real robot.
*FR-ARN-09 · Must · P1*
- **AC1** Given I move the line sensor 2 cm forward, then sampling uses the new position and the 3D model shows it there.

### US-ARN-07 — Build my own arena
**As** Ms. Rezaei **I want** to draw a custom track **so that** assignments match my lesson.
*FR-ARN-10 · Must · P4*
- **AC1** Given the arena editor, when I draw walls, a line path, and a goal zone and save, then the arena is selectable in projects and assignments of my workspace.

### US-ARN-08 — Know when I succeeded
**As** Sara **I want** the app to tell me when my robot completed the task **so that** I know I am done.
*FR-ARN-11 · Must · P1*
- **AC1** Given success condition "1 lap in < 60 s", when the robot passes all checkpoints in order within 60 s, then a success message appears and the event is recorded.

## E7 — Safety (SAF)

### US-SAF-01 — Get warned before I break something
**As** Sara **I want** dangerous wiring flagged with an explanation **so that** I do not destroy real parts.
*FR-SAF-01, FR-SAF-02, FR-SAF-06 · Must · P1*
- **AC1** For each GA rule, a fixture circuit triggers exactly that rule with the correct severity, highlights, and FA/EN text (one test per rule).
- **AC2** Given I fix the wiring, then the finding disappears within 300 ms.
- **AC3** Given the findings panel, when I filter by Error, then only Errors are listed; Warnings can be acknowledged, Errors cannot.

### US-SAF-02 — Code and wiring cross-checks
**As** Sara **I want** to be told when my code and wiring disagree **so that** I find bugs before running.
*FR-SAF-03 · Must · P2*
- **AC1** Given `analogWrite(7, …)` on Uno, then a Warning "pin 7 has no PWM; use 3, 5, 6, 9, 10, or 11" appears on the code line and the pin.

### US-SAF-03 — Runtime faults
**As** Sara **I want** faults that only happen while running (two outputs fighting) to be caught **so that** I learn about them too.
*FR-SAF-04 · Must · P1*
- **AC1** Given D2 and D3 wired together and driven HIGH/LOW, when the code runs, then a runtime Error appears and the damage model applies.

### US-SAF-04 — Errors block upload and purchase
**As** Mehrtronic **I want** unresolved Errors to block hardware upload and BOM purchase **so that** customers do not damage parts we sold them.
*FR-SAF-07 · Must · P2*
- **AC1** Given one unresolved Error, when I press "Buy this kit" or "Upload", then the action is blocked with the list of Errors; with only Warnings, I must tick "I understand".

### US-SAF-05 — New parts get checks automatically
**As** Mina **I want** generic rules to use manifest limits **so that** adding a part does not need new rule code.
*FR-SAF-05, FR-EXT-02 · Must · P1*
- **AC1** Given a new component manifest with `vin.absMax = 12`, when 15 V is connected, then the generic overvoltage rule fires without code changes.

## E8 — BOM & exports (BOM)

### US-BOM-01 — Get a priced parts list
**As** Ali **I want** a BOM with prices and stock **so that** I know what my robot costs.
*FR-BOM-01, FR-BOM-02 · Must · P2*
- **AC1** Given the line-follower project, then the BOM lists every component, breadboard, and wire set with quantity, unit price, line total, stock, and a "price as of" timestamp.

### US-BOM-02 — Exclude parts I own
**As** Ali **I want** to mark parts I own **so that** I only buy what I need.
*FR-BOM-03 · Must · P2*
- **AC1** Given I mark "Arduino Uno" as owned, then it is excluded from totals and remembered for future projects.

### US-BOM-03 — Follow a wiring guide
**As** Sara **I want** step-by-step wiring instructions **so that** I can build the real robot.
*FR-BOM-04 · Must · P2*
- **AC1** Given the project, then the guide lists every connection once, grouped (power, motors, sensors), each step with a diagram highlighting that connection.

### US-BOM-04 — Export documents
**As** Ali **I want** CSV/XLSX/PDF exports **so that** I can print or share them.
*FR-BOM-05 · Must · P2*
- **AC1** Given FA locale, when I export the PDF, then Persian text is correctly shaped and right-aligned, numbers use Persian digits, and code/pin names stay LTR (visual regression test).
- **AC2** Given a Free user, when they request PDF, then the API returns `403 entitlement_required` and the UI offers CSV and the upgrade.

### US-BOM-05 — Buy the kit in one click
**As** Ali **I want** "Buy this kit" **so that** I can order everything without searching the shop.
*FR-BOM-06, FR-SHP-03, FR-SHP-06 · Must · P2*
- **AC1** Given a BOM without Errors, when I click "Buy this kit", then a cart with all non-owned products and quantities is created.
- **AC2** Given a guided project, then its ready-made kit and kit price are shown inside the project and can be added to the cart.

## E9 — Projects & collaboration (PRJ)

### US-PRJ-01 — Manage projects
**As** Ali **I want** to create, duplicate, rename, tag, and delete projects **so that** I stay organized.
*FR-PRJ-01, FR-PRJ-02 · Must · P2*
- **AC1** Given I delete a project, then it moves to Trash for 30 days and can be restored.
- **AC2** Given a Free user with 3 cloud projects, when they create a fourth, then the API returns `403 quota_exceeded` and the UI offers local-only or upgrade.

### US-PRJ-02 — Versions and restore
**As** Ali **I want** named versions and diffs **so that** I can go back when I break something.
*FR-PRJ-03 · Must · P2*
- **AC1** Given two versions, when I open diff, then added/removed components and wires are listed and code shows a line diff.
- **AC2** Given I restore v3, then a new version is created equal to v3 (history is never rewritten).

### US-PRJ-03 — Share a project
**As** Ali **I want** to share a read-only link **so that** a friend can see my robot run.
*FR-PRJ-04 · Must · P2*
- **AC1** Given link-view sharing, when an anonymous user opens the link, then they can run the simulation but cannot edit; "Remix" requires sign-in.
- **AC2** Given an org policy forbidding external sharing, then the link option is disabled for org projects.

### US-PRJ-04 — Import/export project files
**As** Ali **I want** to export a `.robosim` file **so that** I keep a copy outside the platform.
*FR-PRJ-06 · Must · P2*
- **AC1** Given an exported file from schema v1, when imported into a later version, then it migrates and opens identically.

### US-PRJ-05 — Edit together in real time
**As** two students **we want** to edit the same project simultaneously **so that** we can build as a team.
*FR-PRJ-08 · Must · P4*
- **AC1** Given two editors, when both change different components, then both changes appear on both screens within 500 ms (p95).
- **AC2** Given both edit the same code line, then the CRDT merge keeps both edits without data loss.
- **AC3** Given one editor goes offline and edits, when reconnected, then edits merge automatically.

### US-PRJ-06 — Comment on a design
**As** Ms. Rezaei **I want** to comment on a component or code line **so that** feedback is precise.
*FR-PRJ-05 · Should · P4*
- **AC1** Given a comment anchored to the L298N, then it stays attached when the component moves.

### US-PRJ-07 — Org templates
**As** Ms. Rezaei **I want** to publish templates to my org **so that** other teachers reuse them.
*FR-PRJ-07 · Must · P3*
- **AC1** Given a published org template, then all org teachers see it under "New from template".

## E10 — Identity (IAM)

### US-IAM-01 — Sign up with email or mobile
**As** Sara **I want** to sign up with my mobile number **so that** I do not need an email address.
*FR-IAM-01 · Must · P2*
- **AC1** Given a valid Iranian mobile number, when I request an OTP, then an SMS arrives; a correct code within 2 min creates the account; 5 wrong attempts lock OTP for 15 min.

### US-IAM-02 — Secure my account
**As** Ali **I want** MFA and session control **so that** my account stays safe.
*FR-IAM-02, FR-IAM-03 · Must · P2/P3*
- **AC1** Given TOTP enabled, then login requires the code; recovery codes are shown once.
- **AC2** Given the sessions page, when I revoke a session, then that device is logged out on its next request.

### US-IAM-03 — Minors are protected by default
**As** a guardian **I want** my 15-year-old's account to need my consent and have safe defaults **so that** they are protected.
*FR-IAM-04 · Must · P2*
- **AC1** Given a date of birth under 16, when signing up, then a guardian contact is required and the account stays in "pending consent" (demo mode only) until the guardian confirms.
- **AC2** Given a minor account, then community commenting, marketing messages, and BYOK are disabled.

### US-IAM-04 — Log in with my university account
**As** Dr. Karimi's student **I want** to log in with university SSO **so that** I do not need another password.
*FR-IAM-05 · Must · P3*
- **AC1** Given SAML configured and enforced for `uni.ac.ir`, when a user enters an `@uni.ac.ir` email, then they are redirected to the IdP, and on first login an account is created with the mapped role.

### US-IAM-05 — Automatic provisioning
**As** Reza **I want** SCIM provisioning **so that** joiners and leavers are handled by our directory.
*FR-IAM-06 · Must · P3*
- **AC1** Given a SCIM `DELETE /Users/{id}`, then the member is deactivated, sessions revoked, and seat released within 60 s.

### US-IAM-06 — Take my data and leave
**As** Ali **I want** to export my data and delete my account **so that** I stay in control.
*FR-IAM-07 · Must · P2*
- **AC1** Given an export request, then a download link with JSON + `.robosim` files is emailed within 24 h.
- **AC2** Given deletion confirmed, then after 14 days the account and personal data are purged; invoices are retained as legally required with personal data minimized.

### US-IAM-07 — Passkeys
**As** Reza **I want** passkeys for admins **so that** phishing cannot steal admin access.
*FR-IAM-02 · Must · P3*
- **AC1** Given a registered passkey, then login with it succeeds without password.

## E11 — Organizations (ORG)

### US-ORG-01 — Create an organization
**As** Ms. Rezaei **I want** to create an academy workspace with a pilot **so that** I can evaluate RoboSim with my students.
*FR-ORG-01 · Must · P3*
- **AC1** Given self-serve creation, then the org gets a 30-day Classroom pilot with 10 seats.

### US-ORG-02 — Invite members
**As** Reza **I want** to invite by CSV with roles **so that** onboarding 300 students is fast.
*FR-ORG-02, FR-ORG-03 · Must · P3*
- **AC1** Given a CSV of 300 rows (name, email/phone, role, class), then valid rows are invited, invalid rows are reported with reasons, and seats are assigned up to the limit.

### US-ORG-03 — Set policies for minors
**As** Reza **I want** org policies **so that** students under 18 cannot publish publicly and AI runs only on the platform model.
*FR-ORG-04 · Must · P3*
- **AC1** Given the policy, when an under-18 member tries to publish, then the action is unavailable; AI provider selection shows only the platform model.

### US-ORG-04 — Branches
**As** the owner of a school chain **I want** branches with their own admins and seat pools **so that** each campus manages itself.
*FR-ORG-05 · Should · P3*
- **AC1** Given branch admin role, then the admin manages only members of that branch.

### US-ORG-05 — Restrict components and boards
**As** Ms. Rezaei **I want** to restrict the library to the parts in our physical kits **so that** students design what we can build.
*FR-ORG-04 · Must · P3*
- **AC1** Given an allowed-components list, then other components are hidden in the library and rejected on save.

### US-ORG-06 — Understand how my organization uses RoboSim
**As** Reza **I want** seat utilization and class outcome analytics **so that** I can justify the licence and help weak classes.
*FR-ANL-02 · Must · P3*
- **AC1** Given the org analytics page, then seat utilization, active learners per week, assignment completion, and the top 5 safety errors per class are shown for a chosen date range and exportable as CSV.
- **AC2** Given a teacher, then only their own classes are visible.

## E12 — Learning (LRN)

### US-LRN-01 — Follow a guided project
**As** Sara **I want** step-by-step instructions that check my work **so that** I can build my first robot alone.
*FR-LRN-01 · Must · P2*
- **AC1** Given step "Connect IN1 to a PWM pin", when I connect IN1 to D5, then the step is marked complete; to D4, then a hint explains PWM pins.
- **AC2** Given all steps done and the success condition met, then the project shows completion and records progress.

### US-LRN-02 — Take a course
**As** Sara **I want** a course with lessons and quizzes **so that** I learn systematically and get a certificate.
*FR-LRN-02 · Must · P3*
- **AC1** Given all lessons completed, then a PDF certificate with a verification URL is issued.

### US-LRN-03 — Create a class
**As** Ms. Rezaei **I want** to create a class and share a join code **so that** students join quickly.
*FR-LRN-03 · Must · P3*
- **AC1** Given a join code, when a student in my org enters it, then they join the class; codes can be regenerated or disabled.

### US-LRN-04 — Create an assignment
**As** Ms. Rezaei **I want** to configure an assignment with arena, success conditions, rubric, and due date **so that** it matches my lesson.
*FR-LRN-04 · Must · P3*
- **AC1** Given a published assignment, then students see it with due date (Jalali in FA) and starter project.
- **AC2** Given "lock board to Uno and components to kit list", then students cannot add other parts.

### US-LRN-05 — Fair automatic grading
**As** Ms. Rezaei **I want** submissions graded by a server re-run **so that** results cannot be faked in the browser.
*FR-LRN-05, FR-SIM-09, FR-BLD-07 · Must · P3*
- **AC1** Given a submission, then the grader runs the exact artifact with the assignment seed and stores score, trace summary, and replay; the student's browser result is labelled "unofficial".
- **AC2** Given 40 submissions at once, then all are graded within 5 min (p95).
- **AC3** Given a tampered client claiming success, then the stored grade reflects only the verified run.

### US-LRN-06 — Gradebook
**As** Ms. Rezaei **I want** a gradebook with feedback and release control **so that** students see grades when I am ready.
*FR-LRN-06 · Must · P3*
- **AC1** Given unreleased grades, then students see "submitted" only; after release they see score and feedback.
- **AC2** Given export, then CSV/XLSX contain student, assignment, auto score, rubric marks, total, late flag.

### US-LRN-07 — See my class live
**As** Ms. Rezaei **I want** a live dashboard **so that** I can help stuck students during class.
*FR-LRN-07 · Must · P3*
- **AC1** Given an active class session, then I see each student's current step, last activity, and active safety errors, refreshed ≤ 10 s.

### US-LRN-08 — Use RoboSim from Moodle
**As** Dr. Karimi **I want** to add RoboSim assignments in Moodle **so that** grades go to my Moodle gradebook.
*FR-LRN-08 · Must · P3*
- **AC1** Given RoboSim registered as an LTI 1.3 tool, when I deep-link an assignment, then students launch it from Moodle with SSO-free login and roles mapped.
- **AC2** Given a released grade, then it appears in the Moodle gradebook via AGS within 5 min.

### US-LRN-09 — Inform guardians
**As** a guardian **I want** a periodic progress summary **so that** I know how my child is doing.
*FR-LRN-09 · Should · P3*
- **AC1** Given opt-in, then a weekly FA/EN summary of completed activities and grades is sent.

## E13 — Community (CMY)

### US-CMY-01 — Publish to the gallery
**As** Ali **I want** to publish my robot with a licence **so that** others can learn from it.
*FR-CMY-01 · Must · P4*
- **AC1** Given publication, then the gallery page shows cover, description, runnable simulation, BOM, and licence.

### US-CMY-02 — Remix with attribution
**As** Sara **I want** to remix a published robot **so that** I start from something that works.
*FR-CMY-02 · Must · P4*
- **AC1** Given a remix, then the copy is in my workspace and shows "Remixed from … by …" and the chain is preserved.

### US-CMY-03 — Safe community for minors
**As** a guardian **I want** minors protected from contact by strangers **so that** the community is safe.
*FR-CMY-03, FR-CMY-04 · Must · P4*
- **AC1** Given any account, then there is no direct messaging feature.
- **AC2** Given a minor's publication, then it is visible only after moderator approval.
- **AC3** Given text containing a phone number or social handle, then it is blocked with an explanation.

### US-CMY-04 — Moderate content
**As** a moderator **I want** a queue with actions **so that** I can handle reports quickly.
*FR-CMY-04, FR-ADM-07 · Must · P4*
- **AC1** Given a report, then it appears in the queue with context; actions are logged in the audit log.

### US-CMY-05 — Enter a competition
**As** Ali **I want** to submit my robot to a competition **so that** I can compare with others fairly.
*FR-CMY-05 · Must · P4*
- **AC1** Given a submission, then the leaderboard rank comes only from verified runs; client results are never accepted.
- **AC2** Given results frozen, then no further submissions or regrades change the leaderboard.

## E14 — Billing (BIL)

### US-BIL-01 — Start a trial
**As** Sara **I want** a free trial of everything **so that** I can decide before paying.
*FR-BIL-01, FR-BIL-04 · Must · P2*
- **AC1** Given a new personal workspace, then a 14-day Maker trial is active and the trial end date is shown.
- **AC2** Given the trial ended (time-mocked), then entitlements are Free, projects beyond 3 are read-only, and nothing is deleted.

### US-BIL-02 — Pay for Maker
**As** Sara **I want** to pay with my bank card through a trusted gateway **so that** I can subscribe.
*FR-BIL-02 · Must · P2*
- **AC1** Given checkout, when payment succeeds and the server verifies it with the gateway, then the subscription activates and entitlements update within 5 s.
- **AC2** Given the callback arrives twice, then only one activation and one payment record exist (idempotency).
- **AC3** Given the user closes the browser after paying, then the reconciliation job activates the subscription within 15 min.

### US-BIL-03 — Renew easily
**As** Sara **I want** reminders and one-click renewal **so that** my access does not lapse by accident.
*FR-BIL-03 · Must · P2*
- **AC1** Given a subscription ending in 7, 3, and 1 days, then reminders are sent via my preferred channels.
- **AC2** Given wallet balance ≥ price, then renewal happens automatically on the end date.

### US-BIL-04 — Understand a paywall
**As** Sara **I want** to know exactly why an action is blocked **so that** I can decide to upgrade.
*FR-BIL-05 · Must · P2*
- **AC1** Given a blocked action, then the dialog names the entitlement in plain language, the cheapest unlocking plan, and keeps my work intact.

### US-BIL-05 — Use a coupon
**As** Sara **I want** to apply a discount code **so that** I benefit from promotions.
*FR-BIL-06 · Must · P2*
- **AC1** Given a valid code, then the discounted price is shown before payment; expired or exhausted codes show the reason.

### US-BIL-06 — Pay by invoice as an organization
**As** an academy's billing manager **I want** a proforma invoice and bank transfer **so that** we can pay through our accounting process.
*FR-BIL-07, FR-BIL-08 · Must · P3*
- **AC1** Given a quote accepted, then a proforma with economic code is generated; when finance confirms the transfer, then seats activate and an official invoice is issued and queued for Moodian submission.

### US-BIL-07 — Refunds
**As** finance **I want** to issue full or partial refunds **so that** customer issues are resolved correctly.
*FR-BIL-09 · Must · P2*
- **AC1** Given a refund, then the payment record, subscription period, and accounting entries are adjusted and audited.

## E15 — Shop (SHP)

### US-SHP-01 — Browse products
**As** Ali **I want** products linked to the components I used **so that** I know exactly what to buy.
*FR-SHP-01 · Must · P2*
- **AC1** Given a component page, then linked products show price, stock, and images.

### US-SHP-02 — Stock is reserved while I pay
**As** Ali **I want** items reserved during checkout **so that** they are not sold out while I pay.
*FR-SHP-02 · Must · P2*
- **AC1** Given checkout started, then quantities are held for 15 min and released on timeout or cancellation.

### US-SHP-03 — Check out
**As** Ali **I want** shipping options by province **so that** I know total cost and delivery time.
*FR-SHP-04 · Must · P2*
- **AC1** Given an address in Isfahan and a 1.2 kg cart, then available methods and rates for that province and weight are shown with VAT.

### US-SHP-04 — Track my order
**As** Ali **I want** notifications and tracking **so that** I know when parts arrive.
*FR-SHP-05 · Must · P2*
- **AC1** Given status change to `shipped`, then I receive SMS/email with the tracking number.

### US-SHP-05 — Manage fulfilment
**As** Hamed **I want** an order queue with picking lists **so that** I can ship quickly and correctly.
*FR-SHP-05, FR-ADM-05 · Must · P2*
- **AC1** Given paid orders, then I can filter, print picking lists and labels, and move orders through statuses; each change is audited.

### US-SHP-06 — Bulk kits for a school
**As** Ms. Rezaei **I want** to order 20 kits by invoice **so that** the academy can buy hardware in one purchase.
*FR-SHP-07 · Should · P3*
- **AC1** Given a quote request, then sales receives it and can issue a quote; acceptance creates an invoice-paid order.

## E16 — AI assistant (AI)

### US-AI-01 — Ask why my robot fails
**As** Sara **I want** to ask "why doesn't my robot follow the line?" **so that** I get help that knows my project.
*FR-AI-01 · Must · P2*
- **AC1** Given a project where the sensor output is inverted in code, then the answer (in my UI language) identifies the inverted condition and cites the line.

### US-AI-02 — Accept or reject suggestions
**As** Ali **I want** AI changes shown as diffs **so that** nothing changes without my approval.
*FR-AI-05 · Must · P2*
- **AC1** Given a suggestion, then a diff appears with Apply and Reject; Apply creates a version.

### US-AI-03 — Use the platform AI within my credits
**As** Sara **I want** to use AI without my own key **so that** I can get help easily.
*FR-AI-02, FR-AI-03, FR-AI-08 · Must · P2*
- **AC1** Given remaining credits, then requests stream; the meter updates after each response; at zero, the paywall offers a credit pack.
- **AC2** Given 11 requests within a minute, then the 11th returns `429 rate_limited` with `Retry-After`.
- **AC3** Given I delete a conversation, then it is removed from history and storage.

### US-AI-04 — Bring my own key
**As** Ali **I want** to add my own provider key **so that** I can use my preferred model.
*FR-AI-04 · Must · P2*
- **AC1** Given a valid key, then a test call passes and the provider becomes selectable; an invalid key is rejected with the provider's error message.
- **AC2** Given any API response, then the full key never appears (only last 4 chars).

### US-AI-05 — Tutor mode
**As** Ms. Rezaei **I want** the AI to give hints, not answers, during assignments **so that** students learn.
*FR-AI-06, FR-AI-07 · Must · P3*
- **AC1** Given tutor mode "hints", when a student asks for the full solution, then the assistant declines and offers a hint; evaluation set shows ≤ 2 % full-solution leakage.

### US-AI-06 — AI quality gate
**As** the product owner **I want** an evaluation harness **so that** model or prompt changes never reduce quality.
*FR-AI-09 · Must · P2*
- **AC1** Given a candidate change, then CI runs the 200-item FA/EN eval; release is blocked if the score drops > 2 points.

## E17 — Hardware bridge (HWB)

### US-HWB-01 — Upload to my real Uno
**As** Ali **I want** to upload the same code to my real board from the browser **so that** I do not need the Arduino IDE.
*FR-HWB-01, FR-HWB-04, FR-HWB-05 · Must · P4*
- **AC1** Given Chrome, a connected Uno, and no safety Errors, when I click Upload and choose the port, then the firmware is written and verified, and progress is shown.
- **AC2** Given the wrong board selected, then the error says the board did not respond to the expected bootloader.
- **AC3** Given Firefox (no Web Serial), then Upload offers the HEX download with `avrdude` instructions.

### US-HWB-02 — Pico upload
**As** Ali **I want** a UF2 file and instructions **so that** I can flash my Pico.
*FR-HWB-02 · Must · P4*
- **AC1** Given a Pico project, then "Upload" downloads `<project>.uf2` with a BOOTSEL instruction dialog.

### US-HWB-03 — Real serial monitor
**As** Ali **I want** the same serial monitor for the real board **so that** I compare simulation and reality.
*FR-HWB-03 · Must · P4*
- **AC1** Given a connected board, then output appears in the serial monitor and plotter.

## E18 — Internationalization (I18N)

### US-I18N-01 — Use RoboSim in Persian
**As** Sara **I want** the whole app in Persian **so that** I can learn in my language.
*FR-I18N-01, FR-I18N-02, FR-I18N-03 · Must · P0*
- **AC1** Given FA, then layout is RTL, no untranslated string appears in any screen (E2E crawl), and code/canvas stay LTR.
- **AC2** Given a PR adding a key only in `en`, then CI fails the i18n check.

### US-I18N-02 — Dates, digits, currency
**As** Sara **I want** Jalali dates, Persian digits, and Toman display **so that** information feels natural.
*FR-I18N-04 · Must · P0*
- **AC1** Given FA, then dates render in Jalali, numbers in Persian digits, and prices in Toman when the display option is on (stored values remain IRR).

### US-I18N-03 — Bilingual content workflow
**As** Mina **I want** translation status per content item **so that** nothing is published half-translated.
*FR-I18N-05 · Must · P2*
- **AC1** Given a guided project missing EN text, when I publish, then publishing is blocked unless EN is marked intentionally absent.

## E19 — Extensibility (EXT)

### US-EXT-01 — Add a component without touching core
**As** an engineer **I want** to scaffold a component package **so that** adding parts is fast and safe.
*FR-EXT-01, FR-EXT-06 · Must · P1*
- **AC1** Given `pnpm new:component tb6612fng`, then a package with manifest, model, tests, and assets is created; after implementation, it appears in the library with no edits outside the package.

### US-EXT-02 — Add a board
**As** an engineer **I want** a `Board` interface **so that** new MCUs plug in.
*FR-EXT-03 · Must · P1*
- **AC1** Given the Pico board package, then the simulator, build service, and HWB use it through the interface only (architecture lint passes).

### US-EXT-03 — Calibrate a component
**As** an engineer **I want** to store measured calibration data **so that** the simulation matches the parts we sell.
*FR-EXT-05 · Must · P2*
- **AC1** Given calibration data for the TT motor (RPM vs. voltage), then the motor model uses it and the calibration test compares simulated vs. measured within ± 5 %.

### US-EXT-04 — Publish content without a deploy
**As** Mina **I want** to publish arenas and guided projects from the CMS **so that** content does not wait for engineering.
*FR-EXT-04, FR-ADM-04 · Must · P2*
- **AC1** Given a published content item, then it is live in production within 5 min without a code deploy.

## E20 — Admin & operations (ADM, NTF, ANL)

### US-ADM-01 — Support a user safely
**As** a support agent **I want** read-only impersonation with consent **so that** I can see what the user sees.
*FR-ADM-02, FR-ADM-10 · Must · P2*
- **AC1** Given the user granted consent, then I can view their workspace read-only for 60 min; a banner shows to me, the session is audited, and the user is notified.

### US-ADM-02 — Manage the catalogue
**As** Mina **I want** to enable components per tier and link products **so that** the library matches the shop.
*FR-ADM-03 · Must · P2*
- **AC1** Given a component disabled, then it disappears from the library for new placements; existing projects keep it and show a notice.

### US-ADM-03 — Reconcile payments
**As** finance **I want** a daily reconciliation report **so that** every gateway transaction matches a record.
*FR-ADM-06, FR-BIL-02 · Must · P2*
- **AC1** Given the daily report, then mismatches (paid-but-not-activated, activated-but-not-paid) are listed and actionable.

### US-ADM-04 — Feature flags
**As** an engineer **I want** feature flags by environment, plan, org, and percentage **so that** I can release gradually.
*FR-ADM-09 · Must · P0*
- **AC1** Given a flag at 10 %, then ~10 % of users (sticky per user) see the feature.

### US-ADM-05 — Audit everything privileged
**As** a security officer **I want** an audit log **so that** every privileged action is traceable.
*FR-ADM-10 · Must · P2*
- **AC1** Given any admin mutation, then an audit record with actor, action, target, before/after, IP, and time exists and cannot be modified by admins.

### US-ADM-06 — Notification preferences
**As** Sara **I want** to choose which notifications I get **so that** I am not spammed.
*FR-NTF-01, FR-NTF-02, FR-NTF-03 · Must · P2*
- **AC1** Given I disable "product updates", then I receive no marketing messages; transactional messages still arrive.

### US-ADM-07 — KPI dashboard
**As** Mehrtronic management **I want** a KPI dashboard **so that** we steer the business with data.
*FR-ANL-04 · Must · P2*
- **AC1** Given the dashboard, then each BRD §10 KPI is shown with weekly trend and segment filter.

---

## Appendix — Requirements verified without a dedicated story

These requirements are enablers, back-office capabilities, or low-priority items. They are verified by the method listed instead of a user story; they still follow the Definition of Done.

| Requirement | Verification |
|---|---|
| FR-WRK-05 Command palette | Playwright: every toolbar action is reachable via Ctrl/Cmd+K in FA and EN |
| FR-CIR-08 Labels, notes, frames (Could) | Unit tests on document schema + visual regression |
| FR-ARN-12 Multiple robots (Could, P5) | Specified when scheduled; deterministic multi-firmware golden traces |
| FR-AI-10 Dev default provider | Engineering Guide §2 setup check in CI (`pnpm dev:infra` smoke test with Ollama stub) |
| FR-ADM-01 Separate admin application | Security tests: admin routes rejected on public origin; MFA enforced |
| FR-ADM-08 AI administration | Integration tests: provider cannot be enabled without `legal_approved_at`; usage dashboard totals match `ai_usage` |
| FR-ANL-01 Event pipeline | Integration tests: consent respected, minors excluded from marketing analytics, no third-party requests (network assertion in E2E) |
| FR-ANL-03 Personal skills map (Should) | Unit tests on skill aggregation from completed tasks |
| FR-BIL-10 Second gateway (Should) | Contract test suite shared by all `PaymentProvider` implementations; failover test with `fake` providers |
| FR-SHP-08 External commerce backend (Should) | Contract tests against `CommerceBackend`; sync job integration test with a mock store |
| FR-CMY-06 Challenges and badges (Should) | Unit tests on badge criteria; E2E for weekly challenge flow |
| FR-LRN-10 Plagiarism signal (Should) | Unit tests on similarity scoring with fixture pairs (identical, renamed variables, rewired equivalent) |
