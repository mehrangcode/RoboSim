# RoboSim — Product Requirements Document (PRD)

**Version:** 1.0 (Enterprise) · **Date:** 2026-10-13 · **Owner:** @MehranG · **Status:** Approved for planning
**Supersedes:** [archive/RoboSim-PRD-v0.1-mvp.md](archive/RoboSim-PRD-v0.1-mvp.md)
**Related:** [BRD](BRD.md) · [User Stories](User-Stories.md) · [Technical Design](Technical-Design.md) · [API Spec](API-Spec.md) · [Release Plan](Release-Plan.md)

---

## 1. Overview

**Vision.** Be the default first step for anyone who builds a robot in Persian- and English-speaking communities: *build it virtually, verify it, then buy only what works.*

**Product.** RoboSim is a bilingual (English LTR / Persian RTL) web platform with five connected capabilities:

| Capability | What the user gets |
|---|---|
| **Design** | Breadboard-style circuit editor with a curated library of real, purchasable parts |
| **Program** | Arduino C++ editor and block-based coding, compiled in a secure cloud sandbox |
| **Simulate** | Cycle-level MCU emulation in the browser, an electrical model, and a physics arena shown in 2D and 3D from one shared world state |
| **Verify** | A safety checker that flags wiring that would damage real hardware, plus server-verified runs for grading and competitions |
| **Build** | BOM, wiring guide, one-click kit purchase, and direct upload of the same code to a real board |

On top of these sit **organizations** (schools, academies, universities) with classes, assignments, autograding, LMS integration, SSO, and analytics; a **community** with gallery, remix, and competitions; real-time **collaboration**; and an **AI assistant**.

### 1.1 Product principles

1. **Beginner-first.** Every screen works for someone who has never wired a circuit. Expert features are progressive, never mandatory.
2. **One source of truth.** The netlist drives simulation, safety, BOM, and wiring guide; the world model drives both 2D and 3D. No duplicated state, no desync.
3. **Honest simulation.** Results are labelled as estimates; models are calibrated against the parts Mehrtronic sells; limits of fidelity are documented in-product.
4. **Gate only what the server can enforce.** Paid value is compiles, storage, exports, AI, grading, and organization features — never a client-side toggle that can be bypassed ([ADR-006](decisions.md#adr-006--gate-only-server-enforceable-value)).
5. **Works where our users are.** Self-hosted, small bundles, offline-tolerant, Iranian payments and hosting.
6. **Safe for minors by default.** No private messaging, moderated publishing, minimal data.
7. **Extensible by data.** New components, boards, arenas, courses, and kits ship as packages and content, not core code changes.

## 2. Goals and success metrics

| ID | Product goal | Metric | Target |
|---|---|---|---|
| G-1 | Fast activation | Median time from sign-up to first successful simulation run | < 10 min |
| G-2 | Complete first robot | Beginners finishing guided project "Line-follower" | ≥ 40 % of sign-ups within 7 days |
| G-3 | Safety teaching works | Share of projects with ≥ 1 Error finding that are later fixed before BOM export | ≥ 90 % |
| G-4 | Design-to-purchase | BOM → paid order within 30 days | ≥ 8 % |
| G-5 | Classroom adoption | Active seats ÷ paid seats per org per month | ≥ 70 % |
| G-6 | Reliability | Simulation sessions without worker crash or hang | ≥ 99.5 % |
| G-7 | Grading trust | Verified-run results disputed and overturned | < 0.5 % of graded submissions |

Business objectives and KPIs are in [BRD §4 and §10](BRD.md#4-business-objectives).

## 3. Editions and entitlements

Every user acts inside a **workspace**: a personal workspace (one per user) or an organization workspace. Plans attach to workspaces. The **entitlements service** resolves the effective entitlements for `(user, workspace)` and every enforcement point listed below is **server-side**.

| Entitlement key | Free | Maker | Classroom (per seat) | Institution | Enforced at |
|---|---|---|---|---|---|
| `boards.allowed` | `uno` | all GA boards | all | all | `POST /builds` (board FQBN check) |
| `components.tier` | `basic` | `all` | `all` | `all` | Project save and verified run (netlist validation) |
| `projects.cloud_max` | 3 | ∞ | ∞ | ∞ | `POST /projects` |
| `projects.version_retention_days` | 7 | 365 | 365 | configurable (∞ default) | Retention job |
| `build.daily_quota` | 30 | 500 | 300 | 300 (poolable) | Build service admission |
| `build.priority` | low | normal | normal | high | Build queue |
| `export.csv` | ✓ | ✓ | ✓ | ✓ | Export service |
| `export.pdf` | — | ✓ | ✓ | ✓ | Export service (server-rendered) |
| `learning.guided_projects` | first project only | all | all | all | Content API |
| `learning.courses` | — | all public courses | all + org courses | all + org courses | Content API |
| `collab.realtime` | — | ✓ | ✓ | ✓ | Realtime service auth |
| `community.publish` | — | ✓ | org-configurable | org-configurable | `POST /gallery` |
| `ai.platform_credits_monthly` | 0 | plan-configured | plan-configured | plan-configured | AI gateway |
| `ai.byok` | — | ✓ | org-configurable | org-configurable | AI gateway |
| `hwb.upload` | ✓ (Uno) | ✓ | ✓ | ✓ | Client feature; artifact download requires a successful build (server) |
| `arena.custom` | — | ✓ | ✓ | ✓ | `POST /arenas` |
| `org.classes` | — | — | ✓ | ✓ | Org API |
| `org.verified_grading` | — | — | ✓ | ✓ | Grader admission |
| `org.sso` / `org.scim` | — | — | — | ✓ | IAM |
| `org.lti` | — | — | — | ✓ | LTI endpoints |
| `org.analytics` | — | — | basic | full | Analytics API |
| `org.audit_export` | — | — | — | ✓ | Audit API |

Rules:

- **Guests** (no account) get Free entitlements in demo mode with nothing persisted server-side (local storage only) and the guest build quota (10/day per IP+fingerprint).
- **Trial:** new personal workspaces start a 14-day Maker trial (length configurable). Organizations start a 30-day Classroom pilot provisioned by sales or self-serve with a seat cap of 10. *Status (2026-10-24): no trial yet; every workspace is on Free until staff set a plan, and the trial waits for checkout.*
- **Lapsed** trials or subscriptions fall back to **Free**, never below it. Data is never deleted because of lapse; projects above `projects.cloud_max` become read-only (viewable, exportable as files) until the user upgrades or deletes projects. *Status (2026-10-24): implemented; the most recently updated projects within the cap stay editable, and retention keeps named checkpoints.*
- **3D view, 2D view, simulation run, safety checker, and the circuit editor are available in every edition.** They run client-side and are not gated ([ADR-006](decisions.md#adr-006--gate-only-server-enforceable-value)).

## 4. Personas and roles

### 4.1 Personas

| Persona | Profile | Main need | Edition |
|---|---|---|---|
| **Sara — curious beginner** (primary) | 16–22, student, never wired a circuit, tight budget, mostly Persian UI | Learn safely without burning parts or money | Free → Maker |
| **Ali — hobby maker** | 25–35, has built Arduino projects, plans a bigger robot | Validate a design, get an exact parts list, upload to the real board | Maker |
| **Ms. Rezaei — robotics teacher** | Teaches 3 classes of 20 students at an academy, 8 physical kits | Every student practises; assignments graded objectively; parents see progress | Classroom |
| **Dr. Karimi — university lab coordinator** | Runs an intro mechatronics course in Moodle for 200 students | SSO, LMS grades, data residency, audit | Institution |
| **Reza — org IT admin** | Manages accounts for a school chain | Provision users, roles, SSO; control features for minors | Institution |
| **Mina — content editor (Mehrtronic)** | Writes guided projects and safety texts in FA/EN | Publish content without engineering help | Platform staff |
| **Hamed — shop operator (Mehrtronic)** | Runs inventory and fulfilment | Orders flow from BOMs; stock and prices stay correct | Platform staff |

### 4.2 Roles (RBAC)

| Scope | Role | Summary of permissions |
|---|---|---|
| Public | Guest | Demo mode; browse public gallery and shop |
| Personal workspace | Owner | Everything in their workspace |
| Organization | `org_owner` | All org settings, billing, delete org |
| Organization | `org_admin` | Members, roles, SSO/SCIM, policies, classes |
| Organization | `billing_manager` | Plans, seats, invoices, payment methods |
| Organization | `teacher` | Create classes, assignments, grade, view student work in own classes |
| Organization | `assistant_teacher` | Same as teacher but cannot delete classes or change grades after release |
| Organization | `student` | Join classes, submit assignments, own projects inside the org |
| Platform | `platform_admin` | Full back-office |
| Platform | `content_editor` | Catalogue, guided projects, courses, arenas, translations |
| Platform | `shop_operator` | Products, inventory, orders, shipping |
| Platform | `finance` | Payments, refunds, invoices, reconciliation, tax |
| Platform | `support_agent` | Read-only user/org views, consented read-only impersonation |
| Platform | `moderator` | Community moderation queue |

The full permission matrix is in [Security-Privacy-Compliance §4](Security-Privacy-Compliance.md#4-authorization-model-and-rbac-matrix).

## 5. Core user journeys

**Journey A — guided first robot (Sara).** Land → choose language → sign up (email or mobile OTP) or continue as guest → choose "Line-follower robot" → a chassis is pre-placed → follow steps to add sensors, driver, motors and wire them (each step validated) → edit starter code → Run → robot drives in 2D, switch to 3D without losing state → a safety Error appears (motor on a GPIO pin), the motor shows a "damaged" state, explanation suggests the L298N → fix, reset, run → lap completed, success celebration → open BOM and wiring guide → "Buy this kit" or export.

**Journey B — free design and real build (Ali).** Blank project → choose board → place and wire components → write code → debug with serial monitor, pin inspector, and logic-analyzer view → test in obstacle arena → save version → order missing parts from the BOM (removing owned parts) → when parts arrive, connect the real Uno by USB → upload the same code from the browser → open the real serial monitor.

**Journey C — teacher assignment (Ms. Rezaei).** Create class → import roster CSV or share join code → create an assignment from template "Obstacle avoider" with arena, starter project, success conditions, rubric, and due date → students work and submit → the grader re-runs each submission server-side → teacher reviews scores, adds rubric marks and comments → releases grades → exports gradebook; parents receive a progress summary.

**Journey D — institution onboarding (Reza, Dr. Karimi).** Sign contract → org provisioned → configure SAML/OIDC SSO and SCIM → set policies (community publishing off for under-18, AI on with platform model only) → register RoboSim as an LTI 1.3 tool in Moodle → teachers deep-link assignments into Moodle courses → grades flow back to the Moodle gradebook.

**Journey E — competition.** Organizer creates a competition with arena, scoring rules, eligibility, and deadline → participants submit projects → each submission is graded by verified runs → leaderboard updates → organizer freezes results and exports.

**Journey F — content publishing (Mina).** Create a guided project in the admin CMS → author steps in FA and EN with per-step validators → attach arena and starter project → preview → submit for review → publish to a plan tier.

## 6. Functional requirements

Format: **ID — requirement** · priority · phase. Phases are defined in [Release-Plan.md](Release-Plan.md).

### 6.1 Workspace shell (WRK)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-WRK-01 | The editor workspace has five dockable, resizable panes: component library, circuit canvas, code editor (C++ or blocks), simulation view (2D/3D), and a bottom dock (serial monitor, pin inspector, logic analyzer, safety findings, AI chat). Layout is saved per user. | Must | P1 |
| FR-WRK-02 | Top toolbar: Run, Pause, Step (1 ms), Stop, Reset, speed (0.25×–4×), real-time factor indicator, 2D/3D toggle, Save, Versions, Share, Export, Help, language switch. All actions have keyboard shortcuts. | Must | P1 |
| FR-WRK-03 | Panes collapse into tabs below 1024 px width; below 768 px the workspace is view-and-run only with a banner explaining that editing needs a larger screen. | Must | P1 |
| FR-WRK-04 | Autosave: local (IndexedDB) every 10 s and on every structural change; cloud save every 30 s when signed in and online; conflict-free when collaboration is on (FR-PRJ-08). | Must | P2 |
| FR-WRK-05 | Command palette (Ctrl/Cmd+K) for all actions and component search. *Status: done 2026-10-27 (toolbar actions, code and circuit tools, panels, every part; FA + EN search).* | Should | P2 |
| FR-WRK-06 | Onboarding tour on first visit, skippable, re-openable from Help. *Status: done 2026-10-27 (7 stops; once per account, or per browser for guests).* | Must | P2 |
| FR-WRK-07 | Workspace switcher (personal ↔ organizations) visible in the header; the active workspace determines entitlements and data ownership. | Must | P3 |

### 6.2 Circuit editor (CIR)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-CIR-01 | Drag components from the library onto a breadboard-style canvas; move, rotate (90°), flip, delete, duplicate, multi-select (box and Shift-click), align, undo/redo ≥ 100 steps. | Must | P1 |
| FR-CIR-02 | Draw wires pin-to-pin with snapping; bend points; colour selection; pin-name tooltip; highlight all pins on the same net on hover. | Must | P1 |
| FR-CIR-03 | Breadboard components (half and full size) with internal strip connectivity; jumper wires; components can be placed on breadboards. | Must | P1 |
| FR-CIR-04 | Netlist builder derives nets incrementally from the canvas in < 16 ms for 200 components; the netlist is the single source for SIM, SAF, BOM, and wiring guide. | Must | P1 |
| FR-CIR-05 | Property panel per component, driven by the manifest schema (e.g. resistor value with E-series picker, battery voltage and chemistry, motor variant). Invalid values are rejected with an explanation. | Must | P1 |
| FR-CIR-06 | Zoom, pan, zoom-to-fit, minimap; 60 FPS interaction at 200 components and 400 wires on the reference laptop. | Must | P1 |
| FR-CIR-07 | Schematic view auto-generated from the netlist (read-only), switchable with the breadboard view. | Should | P4 |
| FR-CIR-08 | Labels, notes, and grouping frames on the canvas. | Could | P4 |
| FR-CIR-09 | Copy/paste between projects; paste preserves wiring inside the selection. *Status: done 2026-10-27 (system clipboard, in-app fallback).* | Should | P2 |
| FR-CIR-10 | Library search in FA and EN (with Persian normalization of ی/ي and ک/ك and ZWNJ), filtering by category, board compatibility, and "in stock in shop". | Must | P1 |

### 6.3 Code editor and languages (COD)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-COD-01 | Monaco-based C++ editor with Arduino syntax highlighting, auto-indent, bracket matching, find/replace, multi-file sketches (`.ino`, `.h`, `.cpp` tabs); always LTR. | Must | P1 |
| FR-COD-02 | Autocomplete for Arduino core APIs and allow-listed libraries, with hover documentation in the UI language. *Status: done 2026-10-27 (core + 20 libraries, 588 docs in FA and EN).* | Must | P2 |
| FR-COD-03 | Compile diagnostics (errors and warnings) shown inline with line/column, plus a Persian/English plain-language explanation for the 50 most common beginner errors. | Must | P1 |
| FR-COD-04 | Block-based editor (Blockly) with blocks for pins, timing, serial, motors, servo, sensors, logic, maths, variables, functions. Blocks generate readable Arduino C++ shown side-by-side; "Convert to code" switches the project to C++ permanently after confirmation. Block labels are translated. | Must | P4 |
| FR-COD-05 | Code formatting (clang-format, Arduino style) on demand. *Status: done 2026-10-27 (clang-format WASM, Arduino's official style).* | Should | P2 |
| FR-COD-06 | Lightweight static analysis in the browser (tree-sitter C++) extracting pin usage (`pinMode`, `digitalWrite`, `analogWrite`, `attach`) for code-aware safety rules (FR-SAF-03). | Must | P1 |
| FR-COD-07 | Library manager listing the allow-listed Arduino libraries with versions; adding one inserts the `#include`. *Status: done 2026-10-27 (also records the pinned version in the project).* | Must | P2 |

### 6.4 Build service (BLD)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-BLD-01 | On Run, sources are sent to the build service and compiled with `arduino-cli` for the project's board FQBN; the result is a firmware artifact (HEX for AVR, UF2/ELF for RP2040) plus size report and diagnostics. | Must | P1 |
| FR-BLD-02 | Builds run in isolated sandboxes (no network, CPU/memory/time limits, read-only root filesystem, size caps) per [Security §5](Security-Privacy-Compliance.md#5-untrusted-code-execution-sandbox). | Must | P1 |
| FR-BLD-03 | Content-addressed cache: key = SHA-256 of normalized sources + FQBN + core version + library set + build flags. Cache hits return in < 200 ms (server) and are also cached in the browser (IndexedDB) for offline re-runs. | Must | P1 |
| FR-BLD-04 | Admission control: entitlement check (`boards.allowed`, `build.daily_quota`), per-user and per-IP rate limits, fair-share queueing per organization so one class cannot starve others. | Must | P1 |
| FR-BLD-05 | Build progress via server-sent events (queued → compiling → done/failed) with position in queue. | Must | P1 |
| FR-BLD-06 | Only allow-listed libraries and versions are available; the list is managed by admins and versioned; projects pin their library set. | Must | P1 |
| FR-BLD-07 | Build artifacts are stored 30 days (object storage) and linked to project versions so verified runs and uploads use the exact binary. | Must | P2 |

### 6.5 MCU and electrical simulation (SIM)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-SIM-01 | The firmware runs in the browser in a dedicated Web Worker: avr8js for ATmega328P (Uno, Nano) and ATmega2560 (Mega); rp2040js for RP2040 (Pico). | Must | P1 (AVR 328P), P4 (Mega, Pico) |
| FR-SIM-02 | Supported peripherals: GPIO, external interrupts, timers/PWM, ADC, USART (serial monitor), SPI, I²C (TWI), EEPROM, watchdog reset. | Must | P1 |
| FR-SIM-03 | Electrical model: digital nets resolved by driver strength (push-pull, open-drain, pull-ups); resistive analog sub-networks (resistors, potentiometers, LDR, voltage dividers, LEDs as piecewise-linear diodes) solved by modified nodal analysis on change; supply tree with current accounting per source and regulator. | Must | P1 |
| FR-SIM-04 | Component bus: after each 1 ms time slice, component models read pin states/duty cycles and update outputs; inputs to the MCU are scheduled with cycle-accurate timestamps (e.g. ultrasonic echo edges). | Must | P1 |
| FR-SIM-05 | Real-time pacing: simulated time tracks wall time at 1× and honours the speed setting (0.25×–4×). If the host cannot keep up, simulation slows (never skips cycles) and the real-time factor indicator shows the achieved ratio. | Must | P1 |
| FR-SIM-06 | Pin inspector: live state for every pin (mode, level, PWM duty and frequency, analog voltage). | Must | P1 |
| FR-SIM-07 | Serial monitor: baud selection, send line, timestamps, plotter mode for numeric streams (multi-series). *Status: monitor done (slice 13); plotter done 2026-10-26 (Arduino IDE 2 line format, up to 8 series).* | Must | P1 (monitor), P2 (plotter) |
| FR-SIM-08 | Logic analyzer view: record selected pins and display timing diagrams with cursor measurements. *Status: done 2026-10-26 in the editor dock (up to 8 pins, CPU-cycle timestamps, two cursors with width/period/frequency/duty).* | Should | P2 |
| FR-SIM-09 | Determinism: given the same project version, artifact, arena, start pose, inputs, and seed, the simulation produces identical results in the browser and in the headless grader. All randomness (sensor noise) uses a seeded PRNG. | Must | P1 |
| FR-SIM-10 | Damage model: when a safety Error condition occurs at runtime (FR-SAF-04), the affected component enters a `damaged` state, stops functioning, shows a visual cue (smoke/crack icon and text, not colour only), and recovers only after the fault is fixed and the simulation is reset. | Must | P1 |
| FR-SIM-11 | Interactive inputs during a run: press buttons, turn potentiometers, change LDR light level, place obstacles; all user inputs are recorded with timestamps for replay. | Must | P1 |
| FR-SIM-12 | Record and replay: a run can be saved as an input log + seed and replayed deterministically; replays can be shared. | Should | P4 |

### 6.6 Arena, physics, and views (ARN)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ARN-01 | One world model drives both views. 2D (Canvas 2D, top-down) and 3D (three.js) are renderers of the same snapshot; switching never resets or desyncs simulated time or robot pose. | Must | P1 |
| FR-ARN-02 | Planar rigid-body physics: chassis as a rigid body, differential-drive and 4-wheel skid-steer kinematics, wheel longitudinal/lateral friction, mass and inertia from the chassis manifest plus mounted components, collisions with walls and obstacles (Planck.js). | Must | P1 |
| FR-ARN-03 | Motor model: brushed DC motor with voltage, back-EMF, stall torque, and no-load speed from the manifest; PWM averaged per slice; driver voltage drop (e.g. L298N ≈ 2 V at load) and battery sag under load. | Must | P1 |
| FR-ARN-04 | Sensor models: IR line sensors sample the floor texture at their mounted position with configurable height and noise; ultrasonic ray-casts in a 15° cone, 2–400 cm, returns nearest hit with echo timing; bump switches on contact; wheel encoders tick from wheel rotation; IMU reports body acceleration and yaw rate. | Must | P1 (line, ultrasonic, bump), P4 (encoder, IMU) |
| FR-ARN-05 | Built-in arenas: line track (oval, figure-eight, 90° turns, gaps), obstacle course, maze, sumo ring, open floor with walls. | Must | P1 |
| FR-ARN-06 | Robot placement: drag to set start pose (position and heading); Reset returns to it; start pose is saved in the project. | Must | P1 |
| FR-ARN-07 | 2D view: zoom, pan, follow robot, trail of path, overlay toggle for sensor rays/readings and wheel speeds. | Must | P1 |
| FR-ARN-08 | 3D view: orbit, follow, and first-person cameras; component models mounted on the chassis at their configured positions; adaptive quality (shadows, resolution) to hold ≥ 30 FPS. | Must | P1 |
| FR-ARN-09 | Mounting editor: place sensors and wheels on the chassis (position, orientation, height) in a top-down chassis view; mounting affects sensor sampling and mass distribution. | Must | P1 |
| FR-ARN-10 | Arena editor: draw walls, obstacles, line paths (with width), start zones, and goal zones on a grid; set floor texture; save as a reusable arena. | Must | P4 |
| FR-ARN-11 | Success conditions: declarative rules over simulation state — reach zone, complete N laps, avoid collisions, stay on line ≥ X %, time limits, serial output match — combined with AND/OR and weighted scoring. Used by guided projects, assignments, and competitions. | Must | P1 (engine), P3 (scoring) |
| FR-ARN-12 | Multiple robots in one arena (e.g. sumo, races), each running its own firmware. | Could | P5 |

### 6.7 Safety checker (SAF)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-SAF-01 | Static checks run on every netlist change (debounced ≤ 300 ms) and before each Run. Each finding has severity **Error** (would damage real hardware) or **Warning** (likely will not work), a rule ID, a bilingual explanation with "why" and "how to fix", a link to a learning article, and highlights of the involved parts and wires. | Must | P1 |
| FR-SAF-02 | Rules at GA: (1) motor or other inductive load directly on an MCU pin; (2) LED without series resistance; (3) short circuit between supply and ground; (4) supply voltage above a component's absolute maximum (e.g. > 5.5 V on a 5 V pin, > 35 V on L298N motor supply, > 7 V on L298N 5 V terminal with regulator jumper removed); (5) reversed polarity; (6) per-pin current > 20 mA (Warning) / > 40 mA (Error); (7) total MCU I/O current above package limit; (8) total draw above source/regulator capacity, including servo stall current from the 5 V pin; (9) floating input (Warning); (10) missing common ground between supplies (Warning); (11) back-feeding: USB and VIN/barrel supplies conflicting; (12) I²C bus without pull-ups (Warning); (13) 5 V signal into a 3.3 V-only pin (Pico). | Must | P1 (1–11), P4 (12–13) |
| FR-SAF-03 | Code-aware rules using FR-COD-06: `analogWrite` on a non-PWM pin, output driven onto a pin wired to another output, input without pull-up/pull-down and no `INPUT_PULLUP`, servo library on a pin conflicting with timer-based PWM. | Must | P2 |
| FR-SAF-04 | Runtime checks during simulation: actual pin current, short circuits caused by code (two outputs fighting), sustained over-current; violations trigger the damage model (FR-SIM-10). | Must | P1 |
| FR-SAF-05 | Rules are registry modules; generic rules read electrical limits declared in component manifests, so new parts get checks without new code. | Must | P1 |
| FR-SAF-06 | Findings panel with filter by severity, "explain more" (opens AI assistant with the finding as context if available), and acknowledgement of Warnings (never of Errors). | Must | P1 |
| FR-SAF-07 | Before hardware upload (FR-HWB-01) and BOM purchase, unresolved Errors block the action with an explanation; Warnings require explicit acknowledgement. | Must | P2 |

### 6.8 BOM, wiring guide, and exports (BOM)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-BOM-01 | Generate a BOM from the project: component, variant, quantity, unit price (IRR), line total, stock status, linked product, notes; breadboards/wires/consumables included with sensible quantities. *Status: done in the browser (2026-10-25); no linked product yet, and jumpers are inferred from connector kinds.* | Must | P2 |
| FR-BOM-02 | Prices and stock come from the shop catalogue (FR-SHP); the BOM shows the "price as of" timestamp. *Status: thin (2026-10-25): prices and stock come from an admin-editable price list until the shop exists; "price as of" is the latest change.* | Must | P2 |
| FR-BOM-03 | Users mark parts "I already own" (remembered per user as an inventory list); owned parts are excluded from purchase totals. *Status: done (2026-10-25); signed-in users keep the list on the server, guests in the browser and it merges on sign-in.* | Must | P2 |
| FR-BOM-04 | Wiring guide: ordered, step-by-step connection list generated from the netlist ("Uno D5 → L298N IN1, yellow wire"), grouped by subsystem (power, motors, sensors), with a diagram per step; printable. *Status: done (2026-10-25).* | Must | P2 |
| FR-BOM-05 | Exports: BOM as CSV and XLSX; BOM, wiring guide, and project report as PDF rendered server-side with correct Persian shaping and RTL; circuit as SVG/PNG; project as `.robosim` file (FR-PRJ-06). PDF export requires `export.pdf`. *Status: partial (2026-10-25): CSV, XLSX, circuit SVG/PNG and `.robosim` are done in the browser and free on every plan; the PDFs wait for the server export service.* | Must | P2 |
| FR-BOM-06 | "Buy this kit": create a cart from the BOM minus owned parts in one action (FR-SHP-03). | Must | P2 |

### 6.9 Projects, versions, sharing, and collaboration (PRJ)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-PRJ-01 | Projects list per workspace: create (blank, from template, from guided project), rename, duplicate, move between own workspaces (where policy allows), archive, delete (soft delete 30 days, then purge), search, sort, tags. | Must | P2 |
| FR-PRJ-02 | A project contains: board, circuit (components, wires, properties, mounting), code (files or blocks), library set, arena reference, start pose, success conditions (optional), metadata, thumbnail. Schema is versioned with forward migrations. | Must | P2 |
| FR-PRJ-03 | Versions: named checkpoints and automatic snapshots on each successful build; diff view (circuit changes and code diff); restore any version. Retention per `projects.version_retention_days`. | Must | P2 |
| FR-PRJ-04 | Sharing: private (default), link-view (read-only, remixable or not), workspace members, specific users with view/comment/edit roles. Org policy can restrict sharing outside the org. | Must | P2 |
| FR-PRJ-05 | Comments on projects anchored to components, code lines, or versions; mentions notify collaborators. Disabled for minors outside their organization. | Should | P4 |
| FR-PRJ-06 | Import/export `.robosim` (zip: `project.json` + assets) with schema version; import validates and migrates. *Status: done client-side (2026-10-25), assets not yet.* | Must | P2 |
| FR-PRJ-07 | Templates: org admins and teachers can publish project templates to their org. | Must | P3 |
| FR-PRJ-08 | Real-time collaboration: multiple editors on the same project with presence (cursors, selections), conflict-free merges for circuit and code (CRDT), and one shared simulation controlled by the session host; offline edits merge on reconnect. Requires `collab.realtime`. | Must | P4 |

### 6.10 Learning: guided projects, courses, classes (LRN)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-LRN-01 | Guided projects: step-by-step instructions (rich text, images, short videos) with per-step validators (e.g. "L298N IN1 connected to a PWM pin"), hints, starter project, arena, and success condition. At GA: Line-follower, Obstacle avoider, Traffic light, Servo radar, Light-seeking robot, Sumo bot. *Status: P2 set done (2026-10-26): Line-follower (Free) and Obstacle avoider (Maker), built-in content with declarative checks evaluated live in the browser, FA/EN text and SVG images; videos, the CMS (FR-ADM-04) and kits (FR-SHP-06) not yet.* | Must | P2 (2), P3 (6) |
| FR-LRN-02 | Courses: ordered modules of lessons (article, guided project, quiz, sim-task); progress tracking; completion certificate (PDF, verifiable link). | Must | P3 |
| FR-LRN-03 | Classes: teachers create classes, invite by join code, link, email, or roster CSV; archive classes at term end. Students belong to classes within the org workspace. | Must | P3 |
| FR-LRN-04 | Assignments: from template or project; settings for starter project, locked components/board, arena, success conditions with weights, rubric criteria, due date, late policy, attempts limit, individual or group. | Must | P3 |
| FR-LRN-05 | Submissions: a submission freezes a project version; the grader service performs a **verified run** server-side with the exact artifact and seed; the score is computed from success conditions plus rubric marks. | Must | P3 |
| FR-LRN-06 | Gradebook: per class, per assignment; teacher feedback (text, annotated comments on circuit/code); grade release control; export CSV/XLSX; regrade on demand. | Must | P3 |
| FR-LRN-07 | Teacher dashboard: live view of who is working, common safety errors in the class, students stuck on a step, time on task. | Must | P3 |
| FR-LRN-08 | LTI 1.3 Advantage (Deep Linking, Names & Roles, Assignment & Grade Services) certified against Moodle 4.x. | Must | P3 |
| FR-LRN-09 | Guardian progress report: periodic email/SMS summary to guardian contacts entered by the org (opt-in). | Should | P3 |
| FR-LRN-10 | Plagiarism signal: similarity score between submissions (code token similarity + circuit graph similarity) shown to teachers only. | Should | P4 |

### 6.11 Community and competitions (CMY)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-CMY-01 | Gallery: publish a project version with title, description, cover, tags, licence (CC BY 4.0 default, CC BY-SA, CC BY-NC); browse, search, filter, sort by trending/new. | Must | P4 |
| FR-CMY-02 | Remix: copy a published project into own workspace with attribution chain shown. | Must | P4 |
| FR-CMY-03 | Likes, public comments (adults only; minors see but cannot comment publicly unless their org allows it), follow creators. No direct messages. | Must | P4 |
| FR-CMY-04 | Moderation: pre-moderation for first publications of new accounts and all minors' publications; reports; moderator queue with actions (hide, remove, warn, suspend); automated fa/en profanity and contact-info filters. | Must | P4 |
| FR-CMY-05 | Competitions: create with arena, scoring rules, eligibility (public, org-only, age band), team size, schedule, and submission limits; leaderboard from verified runs; result freeze and export. | Must | P4 |
| FR-CMY-06 | Challenges and badges: platform-curated weekly challenges; badges for milestones, shown on profile. | Should | P4 |

### 6.12 Billing, plans, and entitlements (BIL)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-BIL-01 | Plans, prices (IRR), billing intervals, trial lengths, and entitlement sets are configured in admin and versioned; existing subscribers keep their price version until renewal. *Status: versions and entitlement sets are done in admin (2026-10-24); prices stay unset and trials wait for checkout.* | Must | P2 |
| FR-BIL-02 | Self-serve checkout for Maker (monthly/yearly) and Classroom (seats) via the payment gateway; server-side verification; idempotent callbacks; daily reconciliation against gateway reports. | Must | P2 |
| FR-BIL-03 | Iranian gateways do not support stored-card recurring billing: renewals are prepaid periods. The system sends renewal reminders (7, 3, 1 days before) and offers one-click renewal; optional wallet (prepaid balance) auto-renews when balance suffices. | Must | P2 |
| FR-BIL-04 | Entitlements service: resolves effective entitlements per `(user, workspace)` from plan + add-ons + overrides; cached ≤ 60 s; every enforcement point in §3 calls it; changes take effect immediately after payment verification. *Status: done without add-ons or payment (pulled forward, 2026-10-24); the cache is in-process.* | Must | P2 |
| FR-BIL-05 | Paywall and upgrade UX: when an entitlement blocks an action, show what is blocked, why, and the cheapest plan that unblocks it; never lose user work. *Status: done for quotas, pro parts and builds (2026-10-24); the upgrade button leads to a plans page until checkout.* | Must | P2 |
| FR-BIL-06 | Coupons and promotions: percentage/amount, plan-restricted, usage limits, expiry; campaign tracking. | Must | P2 |
| FR-BIL-07 | Organization billing: quotes, proforma invoices, bank transfer with manual confirmation by finance, purchase-order reference, seat add/remove with prorated adjustment on next invoice. | Must | P3 |
| FR-BIL-08 | Invoices: consumer receipts (VAT-inclusive) and official invoices for business customers including economic code/national ID; submission to Moodian through an integration adapter. | Must | P3 |
| FR-BIL-09 | Billing history, receipts download, and refunds (finance-initiated, partial/full, back to gateway or wallet). | Must | P2 |
| FR-BIL-10 | Second payment gateway behind the same `PaymentProvider` interface with admin-selectable routing and failover. | Should | P3 |

### 6.13 Parts shop and fulfilment (SHP)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-SHP-01 | Product catalogue linked to components (1 component → 1..n products/variants), kits (bundles of products), and accessories; images, specs, price (IRR), stock status, max order quantity. | Must | P2 |
| FR-SHP-02 | Inventory: stock per warehouse, reservations during checkout (15 min hold), low-stock alerts, back-in-stock notifications. | Must | P2 |
| FR-SHP-03 | Cart from BOM in one action; adjust quantities; replace unavailable items with suggested equivalents that are electrically compatible (same component, different product). | Must | P2 |
| FR-SHP-04 | Checkout: address book (province/city lists), shipping methods and rates by province and weight, VAT, coupons, payment; guest checkout not allowed (account required, no subscription required). | Must | P2 |
| FR-SHP-05 | Order lifecycle: `pending_payment → paid → preparing → shipped → delivered`, plus `cancelled`, `return_requested → returned → refunded`; tracking number; customer notifications at each transition. | Must | P2 |
| FR-SHP-06 | Kits for every guided project, maintained as bundles; kit price shown inside the guided project. | Must | P2 |
| FR-SHP-07 | Organization bulk orders: quote request for N kits, invoice payment, delivery to the school address. | Should | P3 |
| FR-SHP-08 | `CommerceBackend` integration mode: catalogue, stock, and orders synced with an external Mehrtronic store instead of the built-in shop (decision per [BRD §2](BRD.md#2-mehrtronic-context-and-product-positioning)). | Should | P2 |

### 6.14 AI assistant (AI)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-AI-01 | Chat panel in the workspace. Context sent with each request: netlist summary, code (current file + related), latest diagnostics, safety findings, last 200 lines of serial output, robot behaviour summary (pose trace, collisions, success-condition status), and the active guided step. Answers in the user's language. | Must | P2 |
| FR-AI-02 | Provider abstraction `LLMProvider` (streaming chat, model list, key validation, token counting). Adapters: platform-hosted open-weight models (OpenAI-compatible server such as vLLM or Ollama), and BYOK adapters for OpenAI, Anthropic, Google Gemini, OpenRouter, and generic OpenAI-compatible endpoints — each enabled per deployment only after legal review and a reachability check (BR-15). | Must | P2 |
| FR-AI-03 | Platform credits: plan-defined monthly allowance metered in tokens; usage meter visible to the user; credit packs purchasable. | Must | P2 |
| FR-AI-04 | BYOK: users (or org admins for the whole org) add keys per provider; a key is activated only after a successful test call; keys are envelope-encrypted, never returned to the browser (last 4 characters shown), deletable anytime. | Must | P2 |
| FR-AI-05 | Suggested changes to code or circuit are presented as a diff (code) or change list (circuit) that the user applies or rejects; nothing is applied automatically. | Must | P2 |
| FR-AI-06 | Tutor mode for learners and assignments: the assistant gives hints and explanations but does not output complete solutions; teachers can set the mode per assignment (off / hints / full). | Must | P3 |
| FR-AI-07 | Guardrails: system prompts treat project content as untrusted data; output filtered for unsafe content; minors' conversations follow org policy (can be disabled or limited to the platform model). | Must | P2 |
| FR-AI-08 | Rate limits per user and per org; conversation history stored per project for 90 days (configurable), deletable. | Must | P2 |
| FR-AI-09 | Evaluation harness: a fixed bilingual set of ≥ 200 robotics Q&A and debugging tasks scored before any model/prompt change ships. | Must | P2 |
| FR-AI-10 | Development: server-level default provider via `AI_DEFAULT_PROVIDER` and `OLLAMA_BASE_URL` (default `http://localhost:11434`; from Docker under WSL2 `http://host.docker.internal:11434`). | Must | P0 |

### 6.15 Hardware bridge (HWB)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-HWB-01 | Upload the project's built artifact to a real board from the browser via Web Serial (Chrome/Edge desktop): STK500v1 for Uno/Nano (Optiboot 115200 baud, old bootloader 57600), STK500v2 for Mega 2560. Progress, verify, and clear error messages (wrong board, port busy, no sync). | Must | P4 |
| FR-HWB-02 | Pico: download UF2 with instructions to drag onto the BOOTSEL drive. | Must | P4 |
| FR-HWB-03 | Real-board serial monitor and plotter using the same UI as the simulator. | Must | P4 |
| FR-HWB-04 | Pre-upload gate: safety Errors block upload; Warnings need acknowledgement (FR-SAF-07). | Must | P4 |
| FR-HWB-05 | Browsers without Web Serial show download of the artifact with `avrdude` instructions. | Must | P4 |

### 6.16 Internationalization (I18N)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-I18N-01 | Full UI, content, emails, SMS, PDFs, invoices, and error messages in English and Persian; language preference stored per user and defaulted from the browser. | Must | P0 |
| FR-I18N-02 | Persian uses RTL layout implemented with CSS logical properties; code editor, pin labels, canvas, and schematic stay LTR; mixed-direction strings use Unicode isolation. | Must | P0 |
| FR-I18N-03 | All user-facing strings live in translation files; CI fails on missing keys or unused keys; pseudo-localization build for testing. | Must | P0 |
| FR-I18N-04 | Persian digits in UI text, Latin digits in code and pin names; Vazirmatn font self-hosted; Jalali calendar for dates in FA, Gregorian in EN; IRR/Toman display option. | Must | P0 |
| FR-I18N-05 | Content (guided projects, courses, components, safety texts) is stored per locale with translation status; publishing requires both locales unless the editor marks a locale as intentionally absent. | Must | P2 |

### 6.17 Extensibility and content registry (EXT)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-EXT-01 | Each component is a package `packages/components/<slug>/` with `manifest.json` (id, version, category, tier, names FA/EN, pins with electrical types, electrical limits, properties schema, 2D SVG, 3D model, mounting footprint, calibration data, product links) and `model.ts` implementing `ComponentModel`. A build-time registry discovers packages; no core changes needed. | Must | P1 |
| FR-EXT-02 | Safety rules are registry modules (`packages/safety-rules/<rule-id>/`) with tests; generic rules consume manifest limits. | Must | P1 |
| FR-EXT-03 | Boards are packages `packages/boards/<slug>/` implementing `Board` (emulator core adapter, pin map, peripherals, FQBN, upload protocol, power tree). | Must | P1 |
| FR-EXT-04 | Arenas, guided projects, courses, and kits are content packages (JSON + assets) loaded from the content registry and editable in the admin CMS; content is versioned and published by environment. | Must | P2 |
| FR-EXT-05 | Component calibration workflow: measured parameters (motor speed vs. voltage, sensor thresholds) stored per component version with source notes; models read calibration data. | Must | P2 |
| FR-EXT-06 | Component authoring kit: scaffolder (`pnpm new:component`), manifest JSON Schema, model test harness, and visual preview page. | Must | P1 |

### 6.18 Organizations and identity (ORG, IAM)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-IAM-01 | Sign up / log in with email + password or mobile number + SMS OTP; email verification; password reset; account lockout and throttling. | Must | P2 |
| FR-IAM-02 | MFA: TOTP and passkeys (WebAuthn); mandatory for platform staff and org admins; optional for users. | Must | P2 (TOTP), P3 (passkeys) |
| FR-IAM-03 | Sessions: list active sessions and devices, revoke individually or all. | Must | P2 |
| FR-IAM-04 | Age and consent: date of birth at sign-up; users under 18 have minor-safe defaults; under 16 self-signup requires guardian consent via email or SMS confirmation; under 13 only through an organization account ([Security §6](Security-Privacy-Compliance.md#6-privacy-and-protection-of-minors)). | Must | P2 |
| FR-IAM-05 | SSO per organization: OIDC and SAML 2.0, domain verification, just-in-time provisioning, role mapping from IdP claims/groups; enforced SSO option. | Must | P3 |
| FR-IAM-06 | SCIM 2.0 provisioning (users and groups) for Institution. | Must | P3 |
| FR-IAM-07 | Account data export (JSON + project files) and account deletion (with 14-day grace, then purge across services and backups per retention policy). | Must | P2 |
| FR-ORG-01 | Create organization (self-serve with pilot, or sales-provisioned), profile, logo, verified domains. | Must | P3 |
| FR-ORG-02 | Members: invite by email/phone/link/CSV, assign roles (§4.2), groups, deactivate, transfer ownership. | Must | P3 |
| FR-ORG-03 | Seats: assign/unassign seats; seat usage; over-seat behaviour configurable (block new members or invoice overage). | Must | P3 |
| FR-ORG-04 | Policies: allowed boards/components, community publishing (per age band), AI mode (off / platform only / BYOK allowed) and tutor mode default, external sharing, data retention, required MFA, IP allow-list (Institution). | Must | P3 |
| FR-ORG-05 | Sub-units: an organization can contain campuses/branches with their own admins and seat pools (school chains). | Should | P3 |

### 6.19 Admin and back-office (ADM)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ADM-01 | Separate admin application with platform RBAC (§4.2), MFA required, IP allow-list option. | Must | P2 |
| FR-ADM-02 | Users and organizations: search, view, suspend, restore, change plan, grant overrides, resend verifications; consented read-only impersonation with audit trail and visible banner. | Must | P2 |
| FR-ADM-03 | Catalogue: enable/disable components per tier, product links, calibration data, library allow-list. | Must | P2 |
| FR-ADM-04 | Content CMS: guided projects, courses, arenas, articles, translations with review/publish workflow and preview. | Must | P2 |
| FR-ADM-05 | Commerce: products, kits, inventory, warehouses, shipping rates, orders, returns. | Must | P2 |
| FR-ADM-06 | Finance: plans/prices, coupons, payments, reconciliation report, refunds, invoices, tax settings. | Must | P2 |
| FR-ADM-07 | Moderation queue and trust & safety tools. | Must | P4 |
| FR-ADM-08 | AI: provider enablement per deployment, model catalogue, credit allowances, usage and cost dashboards, evaluation results. | Must | P2 |
| FR-ADM-09 | Feature flags per environment, plan, org, or user percentage. | Must | P0 |
| FR-ADM-10 | Audit log viewer: every privileged action (who, what, when, from where, before/after) searchable and exportable. | Must | P2 |

### 6.20 Notifications (NTF)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-NTF-01 | Channels: email, SMS, in-app notification centre; templates per locale managed in admin. | Must | P2 |
| FR-NTF-02 | Transactional events: verification, password reset, OTP, trial ending, renewal reminders, payment receipts, order status, assignment published/due/graded, mentions, moderation outcomes. | Must | P2 |
| FR-NTF-03 | Preferences per category; marketing messages require explicit opt-in and are never sent to minors. | Must | P2 |

### 6.21 Analytics and reporting (ANL)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ANL-01 | Product event tracking through a server-side pipeline to self-hosted analytics; consent-aware; minors excluded from marketing analytics; no third-party trackers. | Must | P2 |
| FR-ANL-02 | Org analytics: seat utilization, class progress, assignment outcomes, common safety errors, time on task; export CSV. | Must | P3 |
| FR-ANL-03 | Personal progress: skills map (circuits, coding, sensors, control) built from completed tasks. | Should | P3 |
| FR-ANL-04 | Management dashboard with the BRD KPIs ([BRD §10](BRD.md#10-business-kpis-and-reporting)). | Must | P2 |

## 7. Catalogue at 1.0 GA

### 7.1 Boards

| Board | MCU | Emulator | FQBN | Phase |
|---|---|---|---|---|
| Arduino Uno R3 | ATmega328P | avr8js | `arduino:avr:uno` | P1 |
| Arduino Nano | ATmega328P | avr8js | `arduino:avr:nano` | P4 |
| Arduino Mega 2560 | ATmega2560 | avr8js (2560 config) | `arduino:avr:mega` | P4 |
| Raspberry Pi Pico | RP2040 | rp2040js | `rp2040:rp2040:rpipico` (arduino-pico core) | P4 |
| ESP32 DevKit | ESP32 | research track | `esp32:esp32:esp32` | P5 (conditional, see Release Plan) |

### 7.2 Components

Tier rule: fundamentals are `basic` (available in Free): discrete semiconductors, logic ICs, the 555, switches, regulators and simple sensors. Modules and specialty parts are `pro`. Parts are delivered in three expansion tiers by the engine work they need: **A** works with the P1 engine (P1 slices 16a–c), **B** needs reactive elements and transistor models (P2), **C** needs MCU buses (I²C, SPI) and timed single-wire protocols (P2).

| Category | Components (tier `basic` in **bold**, others `pro`) | Phase |
|---|---|---|
| Power | **9 V battery**, **4×AA pack**, **on/off switch**, LM2596 buck module (A), 2S Li-ion pack, 18650 holder, USB power | P1; Li-ion, 18650, USB in P2 |
| Semiconductors | **1N4007 rectifier diode**, **1N4148 signal diode**, **5.1 V Zener** (A), **LM7805**, **AMS1117-3.3** regulators (A), **2N2222**, **BC547**, **2N3906** transistors, **TIP120** Darlington, **IRLZ44N** logic-level MOSFET, IRF520 MOSFET module (B) | A in P1, B in P2 |
| Integrated circuits | **74HC00**, **74HC08**, **74HC32**, **74HC86**, **74HC14**, **74HC595**, **CD4017**, **ULN2003A** (A), **NE555** (B) | A in P1, B in P2 |
| Actuators | **TT gear motor**, **SG90 servo**, **LED**, **active buzzer**, **RGB LED**, **passive buzzer** (A), MG996R servo, relay module (1-ch, 5 V), 28BYJ-48 stepper (A) | P1 |
| Drivers | **L298N**, TB6612FNG, L9110S (A) | P1 |
| Sensors | **HC-SR04**, **TCRT5000 single**, **3-channel line module**, **push button**, **LDR**, **bump/limit switch**, **joystick (KY-023)**, **rotary encoder (KY-040)**, **sound sensor (KY-038)**, **soil moisture**, 5-channel line array, IR obstacle (FC-51), PIR (HC-SR501), 4×4 keypad (A); MPU-6050 IMU, BMP280, VL53L0X, DHT11, DS18B20 (C); IR receiver (VS1838B), wheel encoder | P1 (bold, A); C in P2; IR receiver, encoder in P4 |
| Displays | **7-segment digit** (A), 16×2 LCD (I²C), SSD1306 OLED (I²C), WS2812 strip (C) | A in P1, C in P2 |
| Comms | HC-05 Bluetooth (UART, simulated as a phone-controller panel) | P4 |
| Passive & prototyping | **Resistor**, **potentiometer**, **breadboard (half/full)**, **jumper wires**, **ceramic and electrolytic capacitors** (B) | P1; capacitors in P2 |
| Mechanical | **2-wheel differential chassis with caster**, 4-wheel chassis, tank-tread chassis (skid-steer), sensor brackets | P1 (bold), P2 |

Every part ships with a datasheet-calibrated model, FA/EN name, breadboard art with live state, safety limits, and a demo project. Required Arduino libraries join the build allow-list with the part (Stepper and Keypad in A; Wire-based device libraries, Adafruit SSD1306/GFX, LiquidCrystal_I2C, DHT, OneWire/DallasTemperature, Adafruit NeoPixel in C).

## 8. Non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| NFR-PERF-01 | Simulation | Uno firmware at 1× real time, 2D ≥ 60 FPS and 3D ≥ 30 FPS on the reference laptop (4-core CPU, integrated GPU, 8 GB RAM, latest Chrome); 2D↔3D switch < 1 s (3D first load < 3 s on 10 Mbps). |
| NFR-PERF-02 | Build | p95 < 5 s cold, < 200 ms cached (server), < 20 ms cached (browser); sustained 20 cold builds/s at peak with autoscaling; queue wait p95 < 10 s. |
| NFR-PERF-03 | API | p95 < 300 ms, p99 < 1 s for non-build endpoints at 1,000 req/s. |
| NFR-PERF-04 | Web | Initial JS for the app shell < 300 KB gzipped; editor, Monaco, Blockly, and 3D lazy-loaded; LCP < 2.5 s on 10 Mbps; marketing site LCP < 1.5 s. |
| NFR-SCALE-01 | Capacity | 500,000 registered users, 20,000 concurrently active, 2,000 concurrent collaboration sessions, 50,000 projects edited per day without architectural change. |
| NFR-AVL-01 | Availability | Web and API ≥ 99.9 % monthly; build service ≥ 99.5 %; scheduled maintenance announced 72 h ahead, ≤ 4 h/month, outside school hours. |
| NFR-REL-01 | Resilience | After a build, the simulator runs fully client-side; a backend outage does not interrupt running simulations; edits queue locally and sync later. |
| NFR-DR-01 | Backup & DR | PostgreSQL PITR with RPO ≤ 15 min; RTO ≤ 4 h; daily object-storage replication to a second site; quarterly restore drills. |
| NFR-SEC-01 | Security | OWASP ASVS Level 2 for all services; build sandbox per [Security §5](Security-Privacy-Compliance.md#5-untrusted-code-execution-sandbox); annual external penetration test and before 1.0 GA. |
| NFR-PRIV-01 | Privacy | Data minimization; minors' protections; retention schedule; export and deletion within 30 days of request ([Security §6](Security-Privacy-Compliance.md#6-privacy-and-protection-of-minors)). |
| NFR-TEN-01 | Tenancy | Organization data isolation enforced in the application layer **and** by PostgreSQL row-level security; cross-tenant access tests in CI. |
| NFR-NET-01 | Network | No runtime dependency on third-party CDNs, fonts, analytics, or SaaS unreachable from Iran; all assets self-hosted; PWA caches the app shell and last-used content for offline simulation. |
| NFR-A11Y-01 | Accessibility | WCAG 2.2 AA for all non-canvas UI; keyboard-operable editor actions and toolbar; canvas elements reachable via an accessible component list; colour never the only signal; screen-reader announcements for safety findings and run status. |
| NFR-BRW-01 | Browsers | Latest 2 versions of Chrome, Edge, Firefox; Safari 17+ best effort (no Web Serial); tablets (iPadOS/Android Chrome) for run/view and light editing. |
| NFR-OBS-01 | Observability | Structured logs with correlation IDs; distributed tracing; RED metrics per service; build cache hit rate, queue depth, sandbox failures; frontend error and worker crash reporting; SLO dashboards and alerting. |
| NFR-UX-01 | Usability | A first-time beginner completes Journey A in < 60 min in moderated tests (n ≥ 8, ≥ 80 % success) in both languages before P2 exit. |
| NFR-DEP-01 | Deployability | Same artifacts deploy to SaaS and Private Cloud (Helm); air-gapped install bundle; zero-downtime rolling deploys; database migrations backward-compatible for one release. |
| NFR-MNT-01 | Maintainability | TypeScript strict; ≥ 80 % line coverage in `sim-core`, safety rules, entitlements, billing; architecture boundaries enforced by lint rules. |
| NFR-CMP-01 | Compliance | Iranian e-commerce, payment, and tax requirements per [Security §8](Security-Privacy-Compliance.md#8-iranian-legal-and-commercial-compliance). |

## 9. Release mapping

| Phase | Theme | Public milestone |
|---|---|---|
| P0 | Platform foundation | — |
| P1 | Simulation engine (circuit, code, build, MCU + electrical sim, 2D/3D arena, safety) | Closed alpha |
| P2 | Individual product: accounts, projects, BOM/exports, billing, shop, guided content, AI | **Public launch for individuals (1.0-Individual)** |
| P3 | Education & enterprise: orgs, SSO/SCIM, classes, verified grading, LTI, org billing, analytics | **1.0 GA (Enterprise)** |
| P4 | Ecosystem: Blockly, collaboration, community, competitions, hardware bridge, Nano/Mega/Pico, arena editor | 1.1 – 1.3 |
| P5 | Expansion: ESP32 (conditional), MicroPython, multi-robot arenas, Private Cloud v2 | 2.0 |

Details, exit criteria, and timeline: [Release-Plan.md](Release-Plan.md).

## 10. Open questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q-1 | Final product name and domain (`robosim` availability, trademark). | Sponsor | P2 start |
| Q-2 | Built-in shop vs. integration with an existing Mehrtronic store (FR-SHP-08). | Commerce lead | P2 start |
| Q-3 | Price points for each plan and kit bundle discounts. | Finance | P2 mid |
| Q-4 | Primary and secondary payment gateways; eNamad status. | Finance | P0 end |
| Q-5 | Iranian cloud provider for SaaS (Kubernetes, object storage, GPU availability for platform AI). | Engineering lead | P0 start |
| Q-6 | Email and SMS providers. | Engineering lead | P0 end |
| Q-7 | Default first-run view: 2D (recommended for performance) or 3D. | Product | P1 mid |
| Q-8 | Platform AI model choice after Persian evaluation (FR-AI-09). | Engineering | P2 mid |
| Q-9 | Pilot schools for P3 (target 5–10). | Sales | P2 end |

---

## Appendix A — Resolution of v0.1 review gaps

| # | v0.1 gap | Resolution in this version |
|---|---|---|
| 1 | Repo layout in §6.1 did not include `packages/sim-core` or `packages/components/<slug>/`. | The monorepo layout is defined once in [Technical Design §3](Technical-Design.md#3-repository-layout) and includes `sim-core`, `boards/*`, `components/*`, `safety-rules`, renderers, services, and content. Engineering Guide references it instead of repeating it. |
| 2 | PDF exports were generated client-side but supposed to be entitlement-enforced on the backend. | PDFs are rendered server-side by the export service (headless Chromium, HTML templates), which checks `export.pdf` (FR-BOM-05). This also fixes Persian glyph shaping, which client PDF libraries handle poorly ([ADR-008](decisions.md#adr-008--server-side-pdf-rendering-with-headless-chromium)). |
| 3 | Simulation paywall was bypassable because the simulator runs client-side after compile. | Principle: only server-enforceable value is gated. The simulator, 2D/3D, and safety checker are free in every edition; paid value is build quota, boards, storage, exports, AI, collaboration, grading, and org features — all enforced server-side (§3, [ADR-006](decisions.md#adr-006--gate-only-server-enforceable-value)). Results that matter (grades, competitions) come only from server-side verified runs (FR-LRN-05). |
| 4 | Guests could run the guided demo while lapsed users could not run anything. | Lapsed users fall back to the Free edition, which is a superset of guest demo mode (§3). |
| 5 | Data model lacked user roles, arenas, carts, password-reset tokens, and component/plan assignment. | Complete data model in [Technical Design §8](Technical-Design.md#8-data-model) including RBAC memberships, arenas, carts, auth tokens, plan entitlements, component tiers, audit, and tenancy columns. |
| 6 | 3D was "Must" in requirements but "cut if timelines slip" in risks. | 3D is a Must in P1 with a fixed scope (view-only renderer of the shared world model, adaptive quality) and its own exit criterion; the risk register no longer contains a conditional downgrade. |
| 7 | Milestones said M0–M8 but the list was malformed. | Replaced by phases P0–P5 in [Release-Plan.md](Release-Plan.md), each with scope, exit criteria, and dates. |
| 8 | Target users aged 14+ but no privacy, consent, or retention policy for minors. | FR-IAM-04, FR-CMY-03/04, FR-NTF-03, FR-ANL-01, and [Security §6](Security-Privacy-Compliance.md#6-privacy-and-protection-of-minors) define age bands, guardian/org consent, minor-safe defaults, and retention. |
| 9 | No Mehrtronic positioning. | [BRD §2](BRD.md#2-mehrtronic-context-and-product-positioning) defines brand architecture, strategic role, and the design → kit commerce loop. |
