# RoboSim — Product Requirements Document

Oct 13, 2026 · @MehranG

## 1. Overview

RoboSim (working name) is a bilingual (English/Persian) web app where aspiring robotics makers design a circuit, write real Arduino code, and watch their robot drive in a 2D or 3D virtual arena before buying any parts.

**Problem.** Beginners who want to get into robotics face high and risky part costs. One wiring mistake can burn an Arduino board or a motor driver, and buying parts that turn out to be wrong is discouraging. Existing tools cover only part of the journey: circuit simulators stop at the circuit, and microcontroller simulators do not show a robot moving in a physical world.

**Solution.** One integrated loop: design the circuit, write code, simulate the robot in an arena, fix safety problems flagged by the app, then export a priced shopping list and wiring guide to build the real thing with confidence.

**Vision.** Become the default first step for anyone starting robotics in Persian- and English-speaking communities: "build it virtually first, then buy only what works."

**Target users.** Students, hobbyists, and self-learners aged roughly 14+ who are curious about robotics, have little or no electronics experience, and are cost-sensitive. Secondary users: teachers and robotics clubs running classes.

## 2. Goals, non-goals and success metrics

The MVP succeeds if a complete beginner can build, program, and test a working line-follower robot virtually in under 60 minutes, then leave with a shopping list.

**Goals (MVP)**

- Let users build Arduino Uno robot circuits from a curated component library and run real Arduino C++ code on them.
- Show the robot behaving physically in a 2D arena and a 3D arena, with a one-click switch between them on the same simulation state.
- Catch common beginner mistakes that would damage real parts, and explain them in plain language.
- Produce a bill of materials (BOM) with estimated prices and a wiring guide.
- Let users create an account, save projects to the cloud, and reopen them on any device.
- Ship fully bilingual: English (LTR) and Persian (RTL) from day one.

**Non-goals (MVP)**

- Analog SPICE-level accuracy, PCB design, thermal or EMI simulation.
- Boards other than Arduino Uno (ESP32 and others come later).
- Block-based coding, community gallery, real-time collaboration.
- Native mobile apps (responsive web is enough; desktop is the primary target).

**Success metrics (first 3 months after launch)**

| Metric                                                | Target   |
| ----------------------------------------------------- | -------- |
| Signed-up users who complete the first guided project | ≥ 40%    |
| Median time to first successful simulation run        | < 10 min |
| Projects saved per active user                        | ≥ 2      |
| BOM exports per completed project                     | ≥ 30%    |
| Simulation runs that crash or hang                    | < 1%     |

## 3. Personas and core user journeys

Two personas drive MVP decisions; the beginner is primary, so every screen must work without prior electronics knowledge.

| Persona                              | Profile                                                                   | Main need                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Sara, the curious beginner (primary) | 16–25, student, watched robot videos, never wired a circuit, tight budget | Learn and test safely without burning parts or money                      |
| Ali, the hobby maker                 | 20–35, has built a few Arduino projects, plans a bigger robot             | Validate a design and get an exact parts list before ordering             |
| Teacher / club lead (secondary)      | Runs a robotics class with limited kits                                   | Let every student experiment even when there are not enough physical kits |

**Journey A — guided first robot (primary)**

1. Land on the home page, choose language (EN/FA), sign up with email.
2. Pick the guided project "Line-follower robot".
3. A pre-placed chassis appears; follow steps to add sensors, motor driver, and motors and wire them.
4. Paste or edit the provided starter code, press Run.
5. Watch the robot in the 2D arena; switch to 3D to see it from another angle.
6. A safety warning appears (e.g., motor wired directly to a pin); read the explanation and fix it.
7. Robot completes the track; open the BOM and wiring guide; export them.

**Journey B — free design**

1. Create a blank project, place components from the library, wire them.
2. Write code, run, debug using the serial monitor and pin-state view.
3. Pick an arena (line track, obstacle course, open floor), test, save, export BOM.

## 4. MVP functional requirements

Each requirement has an ID (FR-x.y) so the coding agent and reviewers can reference it in commits, tests, and issues. "Must" items block the MVP release; "Should" items can slip.

### 4.1 Workspace and layout

- **FR-1.1 (Must)** Main workspace has four resizable panes: component library, circuit canvas, code editor, simulation view (2D/3D arena). Panes collapse on small screens.
- **FR-1.2 (Must)** Top toolbar: Run, Pause, Stop, Reset, simulation speed (0.25×–4×), 2D/3D toggle, Save, Export, language switch.
- **FR-1.3 (Should)** Autosave project to local storage every 30 s and on cloud when signed in.

### 4.2 Circuit editor

- **FR-2.1 (Must)** Drag components from the library onto a canvas in breadboard-style view; rotate, delete, multi-select, undo/redo (≥ 50 steps).
- **FR-2.2 (Must)** Draw wires by clicking pin to pin; wires snap to pins, can be colored, and show a tooltip with the pin name.
- **FR-2.3 (Must)** Build a netlist from the canvas (which pins are connected) that feeds both the simulator and the safety checker.
- **FR-2.4 (Must)** Component property panel (e.g., resistor value, battery voltage, motor rated RPM).
- **FR-2.5 (Should)** Zoom and pan; zoom-to-fit.

**MVP component library (all Must):**

| Category                | Components                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Controller              | Arduino Uno (ATmega328P)                                                                        |
| Power                   | 9 V battery, 4×AA pack (6 V), 2S Li-ion pack (7.4 V), on/off switch                             |
| Actuators               | DC gear motor (TT motor), SG90 servo, LED, buzzer                                               |
| Drivers                 | L298N motor driver module                                                                       |
| Sensors                 | HC-SR04 ultrasonic, TCRT5000 IR line sensor (single), 3-channel line sensor module, push button |
| Passive                 | Resistor, potentiometer                                                                         |
| Mechanical (arena only) | 2-wheel differential chassis with caster, 4-wheel chassis                                       |

### 4.3 Code editor and compilation

- **FR-3.1 (Must)** Monaco-based C++ editor with Arduino syntax highlighting, always LTR even in Persian UI.
- **FR-3.2 (Must)** On Run, the code is sent to the backend compile service, compiled with arduino-cli for `arduino:avr:uno`, and the resulting HEX is returned. Compile errors are shown with line numbers in the editor.
- **FR-3.3 (Must)** Support the Servo library and standard Arduino core APIs (`digitalWrite`, `analogWrite`, `pulseIn`, `millis`, `Serial`, etc.).
- **FR-3.4 (Must)** Cache compile results by code hash so re-running unchanged code skips compilation.
- **FR-3.5 (Must)** Serial monitor pane showing `Serial.print` output.

### 4.4 Microcontroller simulation

- **FR-4.1 (Must)** Run the compiled HEX in the browser using avr8js (ATmega328P emulation) inside a Web Worker so the UI stays responsive.
- **FR-4.2 (Must)** Map emulated GPIO, PWM, and timer outputs to the netlist so connected components react (LED lights, motor driver inputs change, servo angle follows pulse width).
- **FR-4.3 (Must)** Feed sensor values back into the emulated pins (ultrasonic echo timing, line sensor digital/analog levels, button presses).
- **FR-4.4 (Must)** Live pin-state inspector showing HIGH/LOW and PWM duty for every pin.
- **FR-4.5 (Must)** Real-time pacing: simulation clock tracks wall-clock time at 1× and honors the speed setting.

### 4.5 Robot arena (2D and 3D)

- **FR-5.1 (Must)** A single physics and world model drives both views. 2D (top-down canvas) and 3D (three.js) are two renderers of the same state, so switching views never resets or desyncs the simulation.
- **FR-5.2 (Must)** Physics: planar rigid-body model of the chassis with differential-drive kinematics, wheel friction, and collisions with walls/obstacles. Motor speed depends on PWM duty and battery voltage.
- **FR-5.3 (Must)** Built-in arenas: line-follow track (oval + figure-eight), obstacle course, open floor with walls.
- **FR-5.4 (Must)** Sensor models: line sensors sample the floor texture under their mounted position; ultrasonic sensor ray-casts in a \~15° cone with 2–400 cm range.
- **FR-5.5 (Must)** Robot placement: drag the robot to a start pose; Reset returns to it.
- **FR-5.6 (Must)** 3D view has an orbit camera and a "follow robot" camera; 2D view supports zoom and pan.
- **FR-5.7 (Should)** Show sensor rays and readings as an overlay toggle.

### 4.6 Safety checker

- **FR-6.1 (Must)** Static checks on the netlist before and during Run; each finding has severity (Error = would damage real hardware, Warning = likely won't work), a bilingual explanation, and a highlight on the involved parts.
- **FR-6.2 (Must)** MVP rules:
  - Motor connected directly to an Arduino pin (no driver).
  - LED without a series resistor.
  - Short circuit between power and ground.
  - Supply voltage above a component's rating (e.g., >12 V into L298N logic, >5 V on a 5 V pin).
  - Reversed battery polarity.
  - Total estimated current draw above the source or regulator limit.
  - Floating input (button without pull-up/pull-down and no `INPUT_PULLUP` in code) as a Warning.
- **FR-6.3 (Must)** On an Error, the simulated part shows a "damaged" state (e.g., smoke icon) and stops working until fixed and reset, mirroring what would happen in reality.

### 4.7 Bill of materials and wiring guide

- **FR-7.1 (Must)** Generate a BOM from the project: component, quantity, unit price, total, and a notes column.
- **FR-7.2 (Must)** Prices come from a backend price table managed by an admin, in Iranian rial (IRR) only, in both languages, and a "last updated" date shown.
- **FR-7.3 (Must)** Wiring guide: ordered list of connections ("Uno D5 → L298N IN1") generated from the netlist, printable.
- **FR-7.4 (Must)** Export BOM as CSV and both BOM and wiring guide as PDF.

### 4.8 Accounts and projects

- **FR-8.1 (Must)** Sign up, log in, log out, password reset via email.
- **FR-8.2 (Must)** Projects list: create, rename, duplicate, delete, open. Project = circuit, code, arena choice, robot start pose, metadata.
- **FR-8.3 (Must)** Guests can try the first guided project in demo mode without saving; everything else requires an account with an active trial or subscription (see FR-12).
- **FR-8.4 (Should)** Import/export a project as a `.robosim.json` file.

### 4.9 Guided projects

- **FR-9.1 (Must)** At least two guided projects in MVP: "Line-follower robot" and "Obstacle-avoiding robot", each with step-by-step instructions, starter code, and a success condition detected by the arena (e.g., complete one lap).

### 4.10 Internationalization

- **FR-10.1 (Must)** Full UI in English and Persian; language switch persists per user.
- **FR-10.2 (Must)** Persian uses RTL layout via CSS logical properties; code editor, pin labels, and the circuit canvas stay LTR.
- **FR-10.3 (Must)** All user-facing strings live in translation files; no hard-coded strings. Safety messages and guided-project content are translated too.
- **FR-10.4 (Should)** Persian digits in UI text, Latin digits in code and pin names; a Persian-friendly font (e.g., Vazirmatn) for FA.

### 4.11 Extensibility (components, boards, arenas)

- **FR-11.1 (Must)** Each component is a self-contained package: `packages/components/<slug>/` with a `manifest.json` (id, category, names in EN/FA, pins, electrical limits, 2D SVG, 3D model reference, product link) and a `model.ts` implementing the shared `ComponentModel` interface. A registry discovers components automatically; adding one requires no changes to core code.
- **FR-11.2 (Must)** Safety rules are registry-based modules too; generic rules read the electrical limits each component declares, so new parts get safety checks for free.
- **FR-11.3 (Must)** A `Board` abstraction (emulator core, pin map, compile FQBN) so ESP32 and other boards can be added later without rewriting the simulator.
- **FR-11.4 (Must)** Arenas and guided projects are data (JSON + textures/models) loadable without code changes.
- **FR-11.5 (Must)** Admin panel: enable or disable components, assign them to plans, manage prices and product links.

### 4.12 Subscription and free trial

- **FR-12.1 (Must)** Every new account gets a free trial with all features (default 14 days, configurable in admin).
- **FR-12.2 (Must)** After the trial without an active subscription, the user can still log in, view projects, export project files, and use the shop, but cannot run simulations, use the 3D view, export BOM/wiring PDFs, or use the AI assistant. A clear paywall screen explains the plans.
- **FR-12.3 (Must)** Monthly and yearly plans priced in IRR, configured in admin. A central entitlements service decides what each user can do, enforced on the backend (compile, AI, exports), not only in the UI.
- **FR-12.4 (Must)** Payments through an Iranian payment gateway (e.g., Zarinpal) behind a `PaymentProvider` interface, with server-side payment verification and a billing history page.
- **FR-12.5 (Should)** Reminder emails 3 days and 1 day before trial end and before renewal.

### 4.13 Parts shop

- **FR-13.1 (Must)** From the BOM, "Add all to cart"; users adjust quantities or remove parts they already own.
- **FR-13.2 (Must)** Product catalog linked to components (price in IRR, stock status, images).
- **FR-13.3 (Must)** Checkout with shipping address and cost, payment through the same gateway, order history for the user, and order status (paid, preparing, shipped, delivered) managed in admin.
- **FR-13.4 (Should)** Ready-made kits for each guided project sold as bundles.
- **FR-13.5 (Must)** Buying parts does not require a subscription.

### 4.14 AI assistant (multi-provider, bring your own key)

- **FR-14.1 (Must)** Chat panel in the workspace. The assistant receives the netlist, code, compile errors, safety findings, recent serial output, and a summary of the robot's behavior, and answers in the user's language.
- **FR-14.2 (Must)** Provider abstraction `LLMProvider` (streaming chat, model list, key validation). MVP adapters: OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, and any OpenAI-compatible endpoint.
- **FR-14.3 (Must)** Bring your own key: users add an API key per provider in settings; a provider becomes available only after its key passes a test call. Users choose the active provider and model.
- **FR-14.4 (Must)** Keys are encrypted at rest (AES-256-GCM, master key from environment), never sent back to the browser (only the last 4 characters are shown), and all AI calls are proxied through the backend. Users can delete keys anytime.
- **FR-14.5 (Must)** Development setup: an Ollama provider with configurable `OLLAMA_BASE_URL` (default `http://localhost:11434`; from a Docker container under WSL2 use `http://host.docker.internal:11434`). In dev mode a server-level default provider can be used without user keys.
- **FR-14.6 (Must)** Code changes suggested by the assistant appear as a diff the user accepts or rejects; nothing is applied automatically.
- **FR-14.7 (Must)** The assistant requires an active trial or subscription and is rate-limited per user.

## 5. Non-functional requirements

The simulator must feel real-time on a mid-range laptop, and the compile service must be safe to expose to untrusted code.

| Area               | Requirement                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance        | Simulation at 1× real time with ≥ 30 FPS in 2D and 3D on a mid-range laptop (4-core CPU, integrated GPU, Chrome). 2D/3D switch in < 1 s.                                                                                                     |
| Compile latency    | p95 < 5 s for a cold compile, < 200 ms for a cached one.                                                                                                                                                                                     |
| Security           | Compile jobs run in an isolated container with no network, CPU/memory/time limits (e.g., 1 CPU, 512 MB, 30 s), a read-only filesystem except a temp dir, and a code size cap (100 KB). Only an allow-list of Arduino libraries is installed. |
| Abuse protection   | Rate-limit compile requests per user and per IP (e.g., 20/min). Guests get a lower limit.                                                                                                                                                    |
| Auth security      | Passwords hashed with argon2id; HTTP-only, Secure, SameSite cookies; CSRF protection; input validation on every endpoint.                                                                                                                    |
| Browser support    | Latest 2 versions of Chrome, Edge, Firefox; Safari best effort. Desktop first, usable on tablets.                                                                                                                                            |
| Accessibility      | Keyboard-operable toolbar and dialogs; color is never the only signal for errors; WCAG 2.1 AA contrast.                                                                                                                                      |
| Reliability        | Simulator runs fully client-side after compile, so it keeps working if the backend is briefly down.                                                                                                                                          |
| Data               | Daily database backups; users can delete their account and all projects.                                                                                                                                                                     |
| Observability      | Structured logs, error tracking on frontend and backend, compile success/failure metrics.                                                                                                                                                    |
| Network conditions | App and assets must work for users with slow or filtered internet: self-host fonts and libraries, avoid third-party CDNs at runtime, keep initial JS bundle < 500 KB gzipped (lazy-load 3D and editor).                                      |

## 6. Technical architecture

Simulation runs entirely in the browser; the Node.js backend handles accounts, project storage, prices, and sandboxed Arduino compilation.

### 6.1 Tech stack

| Layer           | Choice                                                                                    | Notes                                                        |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Repo            | pnpm monorepo: `apps/web`, `apps/api`, `apps/compiler`, `packages/shared`                 | Shared TypeScript types and Zod schemas in `packages/shared` |
| Frontend        | Vite + React + TypeScript, Tailwind CSS v4, shadcn/ui                                     | Developer already uses this stack                            |
| State           | Zustand (editor/project state), TanStack Query (server data)                              |                                                              |
| Circuit canvas  | React + SVG (or Konva if performance requires)                                            |                                                              |
| Code editor     | Monaco Editor                                                                             | Lazy-loaded                                                  |
| MCU emulation   | avr8js in a Web Worker                                                                    |                                                              |
| Physics         | Custom planar differential-drive model + Planck.js for collisions                         | One world model, two renderers                               |
| 2D renderer     | HTML Canvas 2D                                                                            |                                                              |
| 3D renderer     | three.js via @react-three/fiber + drei                                                    | Lazy-loaded                                                  |
| i18n            | i18next + react-i18next                                                                   | `en`, `fa` namespaces                                        |
| Backend API     | Node.js 20 LTS + Fastify + TypeScript                                                     | Zod validation                                               |
| Database        | PostgreSQL 16 with Prisma ORM                                                             |                                                              |
| Compile service | Separate Node service wrapping arduino-cli, running jobs in per-request Docker containers | Job queue with BullMQ + Redis                                |
| Cache           | Redis                                                                                     | Compile cache by SHA-256 of code + board + libs              |
| PDF export      | Client-side (e.g., pdfmake with an embedded Persian font)                                 |                                                              |
| Dev/deploy      | Docker Compose for local dev (works under WSL2 on Windows); single VPS for MVP            |                                                              |
| Testing         | Vitest (unit), Playwright (end-to-end)                                                    |                                                              |

### 6.2 Simulation pipeline

1. Editor builds the **netlist** (components + connected pin groups) from the canvas.
2. Safety checker runs static rules on the netlist (FR-6).
3. Code is compiled by the backend → HEX.
4. Simulation worker loads HEX into avr8js and steps the CPU in fixed time slices (e.g., 1 ms of simulated time per slice).
5. After each slice, a **component bus** reads pin states and updates component models (driver, motors, servo, LEDs).
6. Motor outputs feed the **world model** (physics step at 60 Hz); sensor models read the world and write back to MCU input pins.
7. Worker posts a compact state snapshot to the main thread; the active renderer (2D or 3D) draws it. Switching renderers only changes which component draws the snapshot.

### 6.3 Data model (core tables)

| Table              | Key fields                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `users`            | id, email, password_hash, display_name, locale, created_at                                                                           |
| `sessions`         | id, user_id, expires_at                                                                                                              |
| `projects`         | id, owner_id, name, board, arena_id, data (JSONB: circuit, wires, properties, robot start pose), code (text), created_at, updated_at |
| `components`       | id (slug), category, name_en, name_fa, specs (JSONB: voltage range, current draw, pinout)                                            |
| `component_prices` | component_id, currency, price, source_note, updated_at                                                                               |
| `guided_projects`  | id, slug, title_en, title_fa, steps (JSONB, bilingual), starter_project (JSONB), success_condition                                   |
| `compile_jobs`     | id, user_id, code_hash, status, error_log, created_at (for metrics and rate limiting)                                                |

The component catalog (pinouts, electrical limits, visuals) is also bundled in `packages/shared` as typed data so the simulator works offline; the database copy is the source for prices and admin edits.

Additional tables for subscriptions, shop, and AI:

| Table                    | Key fields                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `plans`                  | id, name_en, name_fa, interval (month/year), price_irr, entitlements (JSONB), active            |
| `subscriptions`          | id, user_id, plan_id, status (trial/active/expired/canceled), trial_ends_at, current_period_end |
| `payments`               | id, user_id, purpose (subscription/order), amount_irr, gateway, gateway_ref, status, created_at |
| `products`               | id, component_id (nullable for kits), name_en, name_fa, price_irr, stock_status, images         |
| `orders` / `order_items` | id, user_id, address, shipping_cost, status, total / order_id, product_id, quantity, unit_price |
| `ai_provider_keys`       | id, user_id, provider, encrypted_key, key_last4, base_url (nullable), is_active, validated_at   |
| `ai_usage`               | id, user_id, provider, model, tokens_in, tokens_out, created_at                                 |

### 6.4 API (REST, JSON, `/api/v1`)

| Method & path                                                            | Purpose                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`           | Account and session                                                               |
| `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm` | Password reset                                                                    |
| `GET /me`, `PATCH /me`                                                   | Profile and locale                                                                |
| `GET /projects`, `POST /projects`                                        | List and create                                                                   |
| `GET /projects/:id`, `PUT /projects/:id`, `DELETE /projects/:id`         | Read, save, delete                                                                |
| `POST /projects/:id/duplicate`                                           | Duplicate                                                                         |
| `POST /compile`                                                          | Body: code, board. Returns HEX or errors (sync with timeout; may return a job id) |
| `GET /compile/:jobId`                                                    | Poll a long compile                                                               |
| `GET /components`, `GET /prices?currency=IRR`                            | Catalog and prices                                                                |
| `GET /guided-projects`, `GET /guided-projects/:slug`                     | Guided content                                                                    |
| `PUT /admin/prices/:componentId`                                         | Admin price updates (role-protected)                                              |

Additional endpoints:

| Method & path                                                              | Purpose                   |
| -------------------------------------------------------------------------- | ------------------------- |
| `GET /plans`, `GET /me/subscription`, `GET /me/entitlements`               | Plans and access          |
| `POST /billing/checkout`, `GET /billing/callback`, `GET /billing/history`  | Subscription payment flow |
| `GET /products`, `POST /cart/from-bom`, `POST /orders`, `GET /orders`      | Shop                      |
| `GET /ai/providers`, `PUT /ai/keys/:provider`, `DELETE /ai/keys/:provider` | Provider keys (BYOK)      |
| `GET /ai/models?provider=`, `POST /ai/chat` (streaming)                    | Assistant                 |
| `/admin/plans`, `/admin/products`, `/admin/orders`, `/admin/components`    | Admin management          |

## 7. Implementation plan and instructions for the AI coding agent

Build in nine milestones (M0–M8), each ending in a runnable, tested state; do not start a milestone until the previous one's acceptance criteria pass.

### 7.1 Milestones

1. **M0 — Foundation.** Monorepo, Vite/React app shell with the four-pane layout, Fastify API skeleton, PostgreSQL + Prisma, Docker Compose, i18n with EN/FA and RTL switching, CI running lint and tests.
   - Accept: app runs with `docker compose up`; switching to Persian flips layout to RTL with no hard-coded strings.
2. **M1 — Circuit editor.** Component catalog in `packages/shared`, drag-drop canvas, wiring, properties, undo/redo, netlist builder with unit tests.
   - Accept: a user can build the line-follower circuit; netlist unit tests pass.
3. **M2 — Compile + MCU simulation.** Compiler service with sandboxing and cache, Monaco editor, avr8js worker, LED/button/serial support, pin inspector.
   - Accept: Blink and a Serial "hello" sketch compile and run; compile errors map to editor lines.
4. **M3 — Robot components and 2D arena.** L298N, DC motors, servo, ultrasonic, line sensors; world model and physics; 2D renderer; built-in arenas.
   - Accept: starter line-follower code completes a lap of the oval track in 2D.
5. **M4 — 3D view.** three.js renderer of the same world state, cameras, instant 2D/3D switching.
   - Accept: switching views mid-run keeps robot position and time identical.
6. **M5 — Safety checker, BOM, wiring guide.** All FR-6 rules with bilingual messages; BOM with prices; CSV/PDF export.
   - Accept: each safety rule has a test circuit that triggers it; PDF renders Persian correctly.
7. **M6 — Accounts, projects, guided projects, polish.** Auth, project CRUD, guest mode limits, two guided projects with success detection, performance and accessibility pass.
   - Accept: Journey A from section 3 works end to end in a Playwright test, in both languages.

**M7 — Subscriptions and shop.** Trial, plans, entitlements, payment gateway, paywall, product catalog, cart from BOM, orders, admin screens.

- Accept: a new user's trial expires (time-mocked in tests), simulation is blocked, payment in the gateway sandbox restores access; a BOM becomes a paid order.

**M8 — AI assistant.** `LLMProvider` interface, Ollama adapter first (developer's own machine), then OpenAI, Anthropic, Gemini, OpenRouter, and OpenAI-compatible; encrypted key storage; chat panel with project context; diff-based code suggestions.

- Accept: with Ollama running locally the assistant explains a broken line-follower in English and Persian; adding a valid key for another provider enables it, an invalid key is rejected.

### 7.2 Working rules for the agent

- Reference requirement IDs (e.g., `FR-5.1`) in commit messages and test names.
- TypeScript strict mode everywhere; no `any` without a comment explaining why.
- Keep the simulation core (`packages/sim-core`: netlist, component models, world model, physics) framework-free and unit-tested, so it can run in a worker and in tests without a browser.
- Every component model is a class implementing a shared interface (pins in, pins out, `step(dt)`, electrical limits for the safety checker); adding a new component should not require changes elsewhere.
- Never run user code on the host: compilation only inside the sandbox described in section 5.
- All UI text through i18next keys with both `en` and `fa` entries; CI fails on missing keys.
- Use CSS logical properties (`ms-`, `me-`, `ps-`, `pe-` in Tailwind) instead of left/right.
- When a requirement is ambiguous, choose the simplest option that satisfies it, write the assumption in `docs/decisions.md`, and continue.
- Development happens on Windows with WSL2; scripts must work in that environment (no macOS-only tooling).

## 8. Risks, open questions and roadmap

The biggest risk is the 2D+3D arena scope in the MVP; the shared world model keeps it manageable, but 3D should be cut to M4 "Should" if timelines slip.

**Risks**

| Risk                                                              | Impact | Mitigation                                                                                                            |
| ----------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| Simulation differs from real hardware and users blame the product | High   | Label results as estimates; calibrate motor and sensor models against real parts; collect user feedback per component |
| Compile service abuse or sandbox escape                           | High   | Container isolation, no network, resource limits, rate limits, allow-listed libraries                                 |
| 2D + 3D in MVP delays launch                                      | Medium | Single world model; 3D renderer is view-only and lazy-loaded; can ship 2D first if needed                             |
| Price data goes stale quickly                                     | Medium | Show "last updated" date; admin panel for fast updates; later, partner shops                                          |
| Users on slow or filtered internet                                | Medium | Self-hosted assets, small initial bundle, client-side simulation                                                      |
| Performance on low-end laptops                                    | Medium | Worker-based simulation, adaptive render quality, 2D as default view                                                  |

**Open questions**

- [ ] Final product name and domain.
- [ ] Where do initial prices come from (which shops), and who updates them?
- [ ] Should the default view on first run be 2D or 3D?
- [ ] Email provider for sign-up and password reset.
- [ ] Hosting location for the VPS (affects latency and reachability for Persian-speaking users).
- [ ] Subscription prices, trial length, and which payment gateway to use.

**Roadmap after MVP**

- ESP32 support (Wi-Fi/Bluetooth-controlled robots) and more sensors (IMU, encoders, IR remote).
- Block-based coding with Blockly for younger beginners.
- Platform-provided AI credits inside the subscription, so users without their own API key can use the assistant.
- Community gallery: share, like, and remix projects.
- Challenges and badges; classroom mode for teachers.
- Partner shops with one-click ordering of the BOM.
