# RoboSim — Architecture Decision Records

**Owner:** Engineering lead · **Format:** one section per decision; never edit an accepted decision's substance — supersede it with a new ADR.
**Statuses:** *Proposed* → *Accepted* → (*Superseded by ADR-NNN* | *Deprecated*)

| ADR | Title | Status |
|---|---|---|
| 001 | TypeScript monorepo with pnpm and Turborepo | Accepted |
| 002 | Modular monolith API with separate runtime-specific services | Accepted |
| 003 | In-browser MCU emulation with avr8js and rp2040js | Accepted |
| 004 | One world model, two renderers | Accepted |
| 005 | SVG circuit canvas | Accepted |
| 006 | Gate only server-enforceable value | Accepted |
| 007 | Workspace tenancy with PostgreSQL row-level security | Accepted |
| 008 | Server-side PDF rendering with headless Chromium | Accepted |
| 009 | Platform-hosted open-weight models as the default AI | Accepted |
| 010 | Disposable gVisor sandboxes with a warm pool for builds | Accepted |
| 011 | Deterministic simulation and server-verified runs | Accepted |
| 012 | Modified nodal analysis for the electrical model | Accepted |
| 013 | NestJS on Fastify with Drizzle ORM | Accepted |
| 014 | In-app authentication with federated SSO | Accepted |
| 015 | Yjs and Hocuspocus for real-time collaboration | Accepted |
| 016 | Self-hosted, in-region infrastructure | Accepted |
| 017 | Prepaid renewals instead of recurring card billing | Accepted |
| 018 | Pin TypeScript to 6.0.x | Accepted |
| 019 | PGlite for Docker-free development and database tests | Accepted |
| 020 | NestJS 12 (ESM) with Zod through Standard Schema | Accepted (refines ADR-013) |
| 021 | planck.js with trigonometry routed through `dmath` | Accepted |
| 022 | Build service drives avr-gcc directly; Linux-namespace sandbox for development | Accepted |
| 023 | Entitlements resolved in-process from plan versions ⊕ overrides; grants only raise | Accepted |
| 024 | Parts list computed in the browser from the document; interim staff price list keyed by part key | Accepted |
| 025 | Guided projects as built-in content with declarative checks evaluated in the browser | Accepted |
| 026 | View-only measurement channel in the worker protocol | Accepted |
| 027 | Full-state snapshot and restore contract for time travel | Proposed |
| 028 | Catalogue metadata (functions, directions, currents, faults, tolerance) as optional manifest extensions; cross-part relations as catalogue tables | Proposed |
| 029 | Firmware variants by patching initialised data via a build symbol map | Proposed |
| 030 | Debug builds and source-level debugging in the emulator | Proposed |
| 031 | Stored runs and run share links | Proposed |
| 032 | Behaviour-changing run options travel in the input log | Proposed |

---

## ADR-001 — TypeScript monorepo with pnpm and Turborepo

- **Context.** Simulation code must run in the browser, in the grader (Node), and in tests; contracts must be shared between web, admin, and API.
- **Decision.** One TypeScript monorepo (pnpm workspaces, Turborepo caching). Shared Zod schemas in `packages/shared`; simulation in framework-free `packages/sim-core`.
- **Consequences.** One language end to end; type-safe contracts; requires strict boundary rules (dependency-cruiser) to keep packages decoupled.
- **Alternatives.** Polyrepo (contract drift, slower cross-cutting changes); Nx (heavier, less needed at this size).

## ADR-002 — Modular monolith API with separate runtime-specific services

- **Context.** Strong consistency between billing, entitlements, learning, and commerce; small team; on-prem deployability.
- **Decision.** Business logic lives in one NestJS application with enforced module boundaries and an outbox for events. Separate services only where the runtime profile differs: compiler (untrusted code), grader (CPU-bound simulation), exporter (headless browser), realtime (long-lived WebSockets).
- **Consequences.** Simple transactions and deployments; modules can be extracted later because they communicate through public interfaces and events.
- **Alternatives.** Microservices per module (distributed transactions, ops cost too high for team size).

## ADR-003 — In-browser MCU emulation with avr8js and rp2040js

- **Context.** Simulations must feel real-time, keep working during backend outages, and cost little to serve at scale.
- **Decision.** Run firmware in a Web Worker with avr8js (ATmega328P, ATmega2560) and rp2040js (RP2040). Server only compiles and, for grading, re-runs headless.
- **Consequences.** Near-zero marginal server cost per simulation; offline capable; limited to MCUs with mature JS emulators (ESP32 deferred to a P5 research track).
- **Alternatives.** Server-side emulation streamed to the browser (latency, cost, connectivity sensitivity).

## ADR-004 — One world model, two renderers

- **Context.** v0.1 risked 2D/3D desync and double maintenance.
- **Decision.** `sim-core` owns a single world state; 2D (Canvas) and 3D (three.js) renderers consume the same snapshots and contain no simulation logic. Physics is planar (Planck.js).
- **Consequences.** View switch is instant and lossless; 3D cost is rendering only; no ramps/3D physics (out of scope).
- **Alternatives.** Separate 3D physics engine (desync, cost, determinism risk).

## ADR-005 — SVG circuit canvas

- **Context.** Breadboard editing with up to ~200 components and 400 wires; needs crisp zoom, hit-testing, accessibility.
- **Decision.** React-rendered SVG with memoized component nodes and a single root transform for pan/zoom; an accessible component list mirrors the canvas.
- **Consequences.** Native DOM events and accessibility; meets budget at target size. If profiling shows budget misses beyond 200 components, revisit with a Canvas/WebGL layer for wires only (new ADR).
- **Alternatives.** Konva/Canvas (worse accessibility and text crispness; more custom hit-testing).

## ADR-006 — Gate only server-enforceable value

- **Context.** v0.1 gated simulation and 3D for lapsed users, but both run client-side and cannot be enforced; guests could do more than lapsed users.
- **Decision.** Paid value is limited to what the server controls: builds (quota, boards), cloud storage and versions, server-rendered exports, AI, collaboration, publishing, verified grading, and organization features. Simulation, 2D/3D, safety checker, and editor are available in every edition. Lapsed accounts fall back to Free, a superset of guest mode.
- **Consequences.** No bypassable paywalls; fairer product; conversion relies on genuinely valuable server features and hardware bundles.
- **Alternatives.** Client-side DRM/obfuscation for the simulator (bypassable, harms performance and trust).

## ADR-007 — Workspace tenancy with PostgreSQL row-level security

- **Context.** Schools and institutions require strong isolation; individuals and orgs share the same features.
- **Decision.** Every user has a personal workspace; organizations are workspaces with members. All tenant data carries `workspace_id`, protected by RLS (`app.workspace_id` set per transaction) in addition to application authorization. Admin access uses a separate audited role with `BYPASSRLS`.
- **Consequences.** Uniform model for billing and data ownership; defence in depth; requires discipline in migrations (enforced by CI isolation tests).
- **Alternatives.** Schema-per-tenant (operational overhead at thousands of orgs); application-only checks (single point of failure).

## ADR-008 — Server-side PDF rendering with headless Chromium

- **Context.** PDFs must be entitlement-gated (server) and render Persian with correct shaping and RTL; client libraries such as pdfmake handle Arabic-script shaping poorly.
- **Decision.** `apps/exporter` renders HTML templates in headless Chromium (Playwright) with embedded Vazirmatn; outputs stored in object storage with signed URLs.
- **Consequences.** Correct typography in both languages; enforceable entitlement; adds a CPU-heavy service scaled by queue.
- **Alternatives.** Client-side PDF (unenforceable, poor shaping); LaTeX/XeTeX (heavier templates, slower iteration).

## ADR-009 — Platform-hosted open-weight models as the default AI

- **Context.** Major foreign AI providers are often unreachable from Iranian networks and their terms may restrict use in or from the region; the product must not depend on them (BR-15).
- **Decision.** The default assistant uses open-weight models served by the platform (vLLM; Ollama for dev/small on-prem) through an OpenAI-compatible interface. External providers are BYOK adapters, enabled per deployment only after legal approval and a reachability check. The platform does not offer or recommend ways to circumvent provider restrictions.
- **Consequences.** Predictable availability and data residency; GPU cost and Persian quality must be managed (eval harness, credits); external providers mainly benefit deployments where they are permitted.
- **Alternatives.** External provider as default (availability and legal risk).

## ADR-010 — Disposable gVisor sandboxes with a warm pool for builds

- **Context.** Untrusted C++ compiled at classroom burst rates with p95 < 5 s.
- **Decision.** Each build runs in a fresh container under gVisor (`runsc`), no network, strict limits, destroyed after use; a warm pool of pre-started sandboxes and pre-built core archives per FQBN removes cold-start and core compile time. Content-addressed caching on server and in the browser.
- **Consequences.** Strong isolation with acceptable latency; dedicated node pool cost; dev uses plain Docker with the same limits.
- **Alternatives.** Long-lived compile workers (cross-user contamination risk); Firecracker microVMs (stronger but heavier to operate on available infrastructure; revisit if threat model changes); WASM toolchain in the browser (immature for full avr-gcc/arm toolchains and libraries).

## ADR-011 — Deterministic simulation and server-verified runs

- **Context.** Grades and competitions must be tamper-resistant and reproducible.
- **Decision.** Fixed-step scheduler, seeded PRNG, deterministic math (`dmath`), stable iteration order, engine version pinning. Only grader-executed runs produce official results; browser runs are "unofficial".
- **Consequences.** Fair grading and regrades; constraints on coding style in `sim-core` (lint-enforced); grader keeps several engine versions deployable.
- **Alternatives.** Trust client-reported results (trivially forgeable).

## ADR-012 — Modified nodal analysis for the electrical model

- **Context.** Safety rules and realistic behaviour need currents and analog voltages (pin current, LED current, dividers, battery sag), not only logic levels.
- **Decision.** Small dense MNA solver over the netlist, recomputed on change, with piecewise-linear diodes and behavioural models for drivers and modules; MCU pins modelled as sources with output resistance.
- **Consequences.** Physically meaningful currents for safety rules and visuals; not SPICE accuracy (transients and RF out of scope).
- **Alternatives.** Logic-only nets (cannot detect over-current); embedded SPICE (ngspice WASM — heavy, slow to integrate with cycle-level MCU timing).

## ADR-013 — NestJS on Fastify with Drizzle ORM

- **Context.** v0.1 proposed plain Fastify + Prisma. Enterprise scope adds many modules, guards (RBAC, entitlements), and RLS.
- **Decision.** NestJS 11 on the Fastify adapter for module structure, DI, and guards; Drizzle ORM for SQL-first schema, migrations, and straightforward `SET LOCAL` per transaction for RLS.
- **Consequences.** Consistent module conventions; Fastify performance retained; Drizzle requires more explicit SQL knowledge than Prisma.
- **Alternatives.** Plain Fastify (more hand-built structure); Prisma (awkward with RLS session variables and per-request transactions).

## ADR-014 — In-app authentication with federated SSO

- **Context.** Email + SMS OTP, MFA, passkeys, per-org OIDC/SAML, SCIM, LTI; on-prem deployability.
- **Decision.** Authentication implemented in the `iam` module using vetted libraries (argon2, `@simplewebauthn/server`, `openid-client`, `@node-saml/node-saml`, `jose`), with sessions in Redis/Postgres.
- **Consequences.** Full control over Persian UX and SMS OTP flows; fewer moving parts on-prem; security-critical code requires two-reviewer rule and pen testing.
- **Alternatives.** Keycloak (strong features, but custom SMS OTP SPI, theming, and an extra stateful system to operate and upgrade for every on-prem customer).

## ADR-015 — Yjs and Hocuspocus for real-time collaboration

- **Context.** Concurrent editing of circuits and code, offline tolerance.
- **Decision.** Yjs CRDT documents per project served by Hocuspocus with Redis scaling and Postgres persistence; stores bind to Yjs when collaboration is on.
- **Consequences.** Proven conflict-free merging and offline support; CRDT document must stay mapped to `ProjectDocument` (schema tests).
- **Alternatives.** Operational transform (server complexity); lock-based editing (poor classroom UX).

## ADR-016 — Self-hosted, in-region infrastructure

- **Context.** Reachability, latency, payments, and data residency for Iranian users; on-prem customers.
- **Decision.** All runtime dependencies are self-hostable open-source components (Kubernetes, CloudNativePG, Valkey, S3-compatible storage, OpenBao, Harbor, Verdaccio, Grafana stack, GlitchTip, PostHog). No runtime third-party CDN, font, analytics, or SaaS. SaaS hosted in Iran with a DR site.
- **Consequences.** Resilience to filtering and sanctions-related service denial; higher operational responsibility (SRE role, runbooks).
- **Alternatives.** Global SaaS providers (often unreachable or unavailable to Iranian businesses).

## ADR-017 — Prepaid renewals instead of recurring card billing

- **Context.** Iranian payment gateways do not support stored-card recurring charges in the way international processors do.
- **Decision.** Subscriptions are prepaid periods with reminders, one-click renewal, and optional wallet auto-renewal; organizations pay by gateway or invoice.
- **Consequences.** Churn risk at renewal points mitigated by reminders, yearly discount, and wallet; simpler compliance.
- **Alternatives.** Direct debit mandates (limited availability; revisit if gateways offer standardized recurring payments).

## ADR-018 — Pin TypeScript to 6.0.x

- **Context.** TypeScript 7.0 (the native Go compiler) is `latest` on npm, but typescript-eslint 8.71 supports only `>=4.8.4 <6.1.0`; linting with type information would break.
- **Decision.** Pin `typescript@6.0.3` across the monorepo; Renovate is restricted to `<6.1` until typescript-eslint declares support for 7.x.
- **Consequences.** Stable lint/typecheck; we miss TS 7 compile-speed gains for now. Revisit when typescript-eslint supports 7.x.

## ADR-019 — PGlite for Docker-free development and database tests

- **Context.** The development machine has no Docker, yet migrations, RLS policies, and tenant isolation must be verified for real, not mocked (NFR-TEN-01).
- **Decision.** The API supports `DATABASE_DRIVER=pglite` (PostgreSQL compiled to WebAssembly, in-process) for local development and for all database tests. Tests run every migration on a fresh in-memory PGlite instance and switch to the restricted `robosim_app` role, so RLS is enforced exactly as in production. `pglite` is rejected when `APP_ENV=production`.
- **Consequences.** Real SQL, real RLS, zero infrastructure for contributors and CI. PGlite runs a single connection, so concurrency behaviour (e.g. `SKIP LOCKED` contention between relay instances) must additionally be tested against PostgreSQL 16 via Testcontainers in P1.
- **Alternatives.** Mocked repositories (would not test RLS); requiring Docker for every developer (not available now).

## ADR-020 — NestJS 12 (ESM) with Zod through Standard Schema

- **Context.** ADR-013 chose NestJS 11. NestJS 12 (Aug 2026) is ESM-only and adds Standard Schema validation for `@Body/@Query/@Param` with a built-in `StandardSchemaValidationPipe`.
- **Decision.** Use NestJS 12 as an ESM application. Request validation uses the Zod schemas from `packages/shared` directly (`@Body({ schema })`) with a global `StandardSchemaValidationPipe` whose exception factory produces `validation_failed` problem details. Tests use Vitest with SWC (decorator metadata).
- **Consequences.** One schema language end to end without class-validator DTOs; all relative imports carry `.js` extensions.

## ADR-021 — planck.js with trigonometry routed through `dmath`

- **Context.** §5.9 requires simulation results to be bit-identical across JavaScript engines (golden traces in Node, Chrome and Firefox are a P1 exit criterion). planck.js (the physics engine chosen in §5.5) calls `Math.sin`, `Math.cos` and `Math.atan2`, which ECMAScript leaves implementation-approximated. Its remaining arithmetic is IEEE-754 basic operations and `Math.sqrt`, which are exact. An alternative was a custom minimal engine; it was rejected so that later needs (pushable objects, sumo, multi-robot) reuse a mature solver.
- **Decision.** Pin planck **1.5.0** and keep a committed pnpm patch (`patches/planck@1.5.0.patch`, registered under `patchedDependencies`). It replaces the 8 trig bindings in `dist/planck.mjs` and `dist/planck.js` with lazy calls to `globalThis.__robosimDmath`, which `sim-core/src/world/planck-world.ts` sets to the fdlibm-derived `dmath` functions. The unused `random()` utility is left alone; the engine never calls it.
- **Consequences.** Upgrading planck means regenerating the patch (`pnpm patch planck@<v>`, apply the same 8 substitutions, `pnpm patch-commit`). A test fails if planck stops calling the routed functions. The global hook only affects the dedicated simulation worker or grader process.

## ADR-022 — Build service drives avr-gcc directly; Linux-namespace sandbox for development

- **Context.** §6 planned `arduino-cli` inside a gVisor container. From our network, `downloads.arduino.cc` (package index, toolchains, cores, ctags) answers HTTP 403, so `arduino-cli core install` cannot complete, on developer machines or in an image build. GitHub, the PlatformIO registry, and Ubuntu's apt mirrors are reachable. The team also does not want Docker in local development. The engine already needed real compiled firmware for the built-in demos (they were hand-assembled until P1 slice 10).
- **Decision.** `apps/compiler` is its own Arduino build driver. avr-gcc 7.3.0, avr-libc and binutils come from Ubuntu (`gcc-avr`, `avr-libc`, `binutils-avr`). The Arduino AVR core 1.8.6 and the extra libraries (Servo 1.3.0, NewPing 1.9.7) are pinned in `apps/compiler/toolchain.lock.json`, by git commit or tarball SHA-256, and fetched by `pnpm compiler:setup` into `.local/toolchain`. The driver reproduces what arduino-cli does for the Uno:
  - It merges the `.ino` files with `#include <Arduino.h>` and generated prototypes, with `#line` directives. The prototype scanner replaces ctags.
  - It uses the same `platform.txt` flags, including LTO.
  - It links against prebuilt `core.a` and per-library archives.
  - It resolves libraries from `#include`s.
  - It produces HEX with a size report.
  - The toolchain id (lock, gcc build, driver version) is part of every cache key.

  User builds run under `COMPILER_RUNTIME=local`. Each gcc/ld call runs in fresh unprivileged user, mount, PID and network namespaces (`unshare`):
  - There is no network (loopback only) and `/proc` is private.
  - The work dir is the only writable mount. The toolchain and prebuilt archives are read-only.
  - `/home`, `/mnt`, `/root`, `/tmp`, `/var` and `/run` are empty tmpfs.
  - `prlimit` caps memory, CPU, file size and open files, and a wall-clock kill enforces the 30 s budget.
  - Source guards (Security §5) reject absolute or `..` includes, macro includes, `#include_next`/`#import`, `.incbin`/`.include` and null bytes before gcc runs.
- **Consequences.**
  - The API refuses `COMPILER_RUNTIME=local` in staging and production. Hosted environments still need the gVisor runtime (§6), which will run this same driver in its image, without arduino-cli.
  - `pnpm compiler:setup` plus the apt packages are a one-time developer step and a CI step. Ubuntu 24.04 needs `kernel.apparmor_restrict_unprivileged_userns=0` for the sandbox.
  - Edge cases that arduino-cli's ctags handles differently (functions declared inside macros, templates) need a manual forward declaration.
  - Adding a library means adding a pinned entry to the lock and re-running setup. Adding a board means a `BOARDS` entry plus its core.


## ADR-023 — Entitlements resolved in-process from plan versions ⊕ overrides; grants only raise

- **Context.** FR-BIL-04 wants every enforcement point to call one entitlements service, with results cached for at most 60 s. Development has no Redis (no Docker, ADR-019), yet builds, projects and retention already needed real limits, and plan prices change while subscribers must keep what they bought (FR-BIL-01). Over-cap project locks must also work for sharees, who cannot read the owner's other projects under RLS.
- **Decision.**
  - Entitlements are `plan version ⊕ overrides`, resolved by `EntitlementsService` in `apps/api`. A plan version is immutable: a change publishes a new version and retires the current one. New and Free workspaces get the current version at once; a paid subscriber keeps theirs until staff set the plan again. Keys added later fall back to Free's value.
  - Overrides are additive only: quotas add (null = unlimited wins), booleans OR, ordered settings take the higher value, boards are united. Anything that restricts (organization policy, age band) is a separate `⊓` step that arrives with organizations in P3 (TD §9.1).
  - Results are cached in the API process for `ENTITLEMENTS_CACHE_MS` (60 s at most) and dropped in-process when staff change a plan, subscription or override. Daily quotas are in-process counters that reset at 00:00 Asia/Tehran (fixed UTC+03:30; TD §9.1 wins over the UTC wording in the API Spec). The Redis cache, the Redis Lua quota store and event-driven invalidation come with the deployment track.
  - Over the `projects.cloud_max` cap, the most recently updated projects stay editable and the rest are read-only (`locked`). A SECURITY DEFINER function, `app_project_rank(project)`, counts the live projects in the same workspace updated more recently, so any request transaction can decide this. The owner's entitlements apply to a project, so sharees inherit them. Retention never deletes named checkpoints or a project's latest version.
  - There is no trial yet: every workspace is on Free until staff set a plan. The PRD's 14-day Maker trial waits for checkout.
- **Consequences.**
  - One code path for every limit, testable on PGlite with real RLS. Staff can grant but never take away, so a mistaken override cannot lock a user out.
  - With several API instances, a plan change reaches other instances within the cache time (≤ 60 s) and a restart refills daily quotas, until Redis arrives. Acceptable for single-process development and the first release.
  - The rank function bypasses RLS for one count, so it returns only a number and takes a project id.
  - Subscriptions and overrides are written by staff and system code outside RLS, so the admin routes carry the access control (`StaffGuard` plus a permission per route) and every change is audited.
- **Alternatives.** A Redis-backed service from the start (no Redis in development); resolving entitlements at the edge from JWT claims (stale until the token expires); letting overrides lower values (an org policy is the place for that); locking projects by creation date (the user would lose the ones they are working on).

## ADR-024 — Parts list computed in the browser from the document; interim staff price list keyed by part key

- **Context.** FR-BOM-01…05 and FR-PRJ-06 were planned as server endpoints (`GET /projects/:id/bom`, `POST /exports`) fed by the shop catalogue. The shop (FR-SHP) does not exist yet, but guests and offline users already build circuits and need a parts list, a wiring guide and a file they can keep. The PDF exports need the server export service ([ADR-008](decisions.md#adr-008--server-side-pdf-rendering-with-headless-chromium)), which is not built either.
- **Decision.**
  - The BOM, the wiring guide and the free exports (`.robosim`, CSV, XLSX, circuit SVG and PNG) are computed in the browser from the project document, in pure engine-free code in `packages/circuit-canvas`. They work offline and for guests and need no entitlement; only the future PDFs need `export.pdf`.
  - Prices and stock come from an interim, staff-edited price list, `catalog_prices`, keyed by part key: the catalogue type, `type?prop=value&…` for a variant (the props that make a different physical part are `variantPropsOf(id)` in the catalogue package), `board:<id>` and `consumable.jumper-*`. The shop adopts the same keys, so its catalogue replaces the table without touching the BOM. The BOM shows the latest change as "price as of".
  - Owned parts live in `user_inventory` (owner-only RLS) for signed-in users and in `robosim.inventory.v1` in the browser for guests; sign-in merges the guest marks into the account (the larger count wins).
  - `.robosim` is a zip with `manifest.json` (`format`, `formatVersion: 1`, `schemaVersion`, `exportedAt`) and `project.json`, with room for assets. Import migrates and validates and refuses a newer `formatVersion`; the older `.robosim.json` is still accepted.
- **Consequences.**
  - No server round trip and no new service for the common case, and the same document always gives the same BOM. The cost is that the BOM logic ships in the web bundle and a server-side BOM (for PDFs, the shop's cart from a BOM, or the API) needs the same package run on the server.
  - Staff maintain prices by hand until the shop exists; a part with no price shows as unpriced, never as free. Stock is a staff-set status, not real inventory.
  - Jumper types (male or female ends) are inferred from connector kinds, not drawn, so a quantity can be off for unusual parts; packs of 10 with 20 % spare absorb most of it.
  - Part keys are a public contract between the price list, the inventory and the shop: renaming a catalogue type or variant prop orphans its price rows.
- **Alternatives.** Server-computed BOM and exports from the start (needs the shop and the export service, and fails for guests offline); a spreadsheet library for XLSX (a large dependency for one sheet); prices inside the component manifests (they would change with releases, not with staff edits).

## ADR-025 — Guided projects as built-in content with declarative checks evaluated in the browser

- **Context.** FR-LRN-01 needs step-by-step projects whose steps check the learner's circuit and code live ("L298N IN1 connected to a PWM pin"), in FA and EN, gated by plan (`learning.guided_projects`: Free gets the first project). The content CMS (FR-ADM-04) and the `content_items` tables do not exist yet, and the checks must react on every edit, offline-capable for the build steps.
- **Decision.**
  - Guided projects are typed content in `packages/content/src/guided` (FA/EN text in a Markdown subset, inline SVG images, a starter document with `guided: { slug, version }`, a reference build and solution sketch). Progress is keyed by `slug@version`. The API serves them and applies the plan: a locked project returns only its summary. The guided content is a separate entry point (`@robosim/content/guided`) and a dependency-cruiser rule stops browser packages from importing it, so paid text never ships in the bundle.
  - Step checks are declarative data (`part`, `prop`, `connected`, `boardPin`, `code`, `run`) defined in `packages/shared`, so the CMS can author them later. The browser evaluates them against the document (nets from `CircuitNets`), the sketch's pin facts (the FR-COD-06 analyser, loaded lazily) and the live run, in `packages/circuit-canvas/src/guided.ts`. Each failure has a reason with a generic FA/EN hint that a step may override.
  - Steps run in order: the first step that does not pass is current; a completed step that breaks again is flagged for attention. Steps once completed are recorded (server `guided_progress` with owner-only RLS when signed in, `robosim.guided.v1` in the browser for guests, merged on sign-in), and the run step stays done once a run succeeded.
  - Every guided project has a test that its reference build passes all steps and that its compiled solution meets the challenge headless (`GUIDED_HEX`, a third firmware set).
- **Consequences.**
  - Progress is trusted from the client: it is a learner's own record, not a grade. Anything that counts (assignments, competitions) keeps using server-side verified runs (FR-LRN-05).
  - New or changed content ships with a release until the CMS exists; the content tables can import these modules unchanged, because the shape is already the API contract.
  - Changing a project's steps needs a version bump, or old progress would point at steps that no longer exist.
- **Alternatives.** TypeScript validator functions per step (flexible, but content could never live outside the code); server-side checking on every edit (latency, and no help for guests offline); building the CMS first (delays the first guided project by a slice).
- **Later (2026-10-31), 13 projects.** Guided projects may have no arena (`arenaId: null`): bench projects on the Uno alone, free, completed when the project's own success conditions (`serialMatches`, `pinState`) are met, so no new check kind was needed. Interactive references carry `referenceInputs` that the headless test replays. Free's `learning.guided_projects: first` now means "the projects marked `free`" (five bench projects and the Line-follower). The servo radar needed real engine support rather than a fake: a part mounted `onServo` turns with the horn (TD §8.10).

## ADR-026 — View-only measurement channel in the worker protocol

- **Status.** Accepted (2026-11-03, slice IT-2; see the implemented note in [TD §18.2](Technical-Design.md#182-virtual-multimeter-fr-sim-13-slice-it-2)).
- **Context.**
  - FR-SIM-13/14/15/16 and FR-AI-11 need voltages, currents and power from the running simulation.
  - The MNA solution exposes node voltages and source, diode and transistor currents. It does not expose currents through conductances, current sources or wires: wires are merged into nets.
  - The logic-analyzer `probe` (FR-SIM-08) already showed the pattern for a view-only worker feature: it is not part of the input log and leaves `engineVersion` unchanged.
  - Instruments must not perturb determinism (ADR-011), must cost little per slice (§17), and must stay free (ADR-006).
- **Decision.**
  - **Attribution in the solver.** `MnaCircuit` tags every stamped element with its owner: component index, −1 for the MCU bus, −2 for probe stamps. `terminalCurrent(owner, net, solution)` derives the current from a net into a part from the element kind (one table, KCL-tested). Pin, part-power and wire currents are all built on it.
  - **Wire currents** come from a document-level cut set: the sum of part-pin currents on one side of the wire. A wire that is part of a zero-ohm loop reports "undefined", because the solver cannot distinguish the parallel paths.
  - **One channel.** A single subscription message `measure { channel, probes }` with probes addressed by document refs (`PointRef`). The worker resolves the refs per load and answers with `measures` messages carrying transferred `Float32Array`s, drained with each snapshot (≤ 30 Hz). Each instrument (meter, scope, power, black box) is a `SliceObserver` flagged `viewOnly`, registered before the `InputLogger`.
  - **Resistance** is measured on a fresh static instance with sources removed and a 1 mA test current. The live run is never touched.
  - **Determinism contract.**
    - Measurement code only reads `Simulation` and its solutions.
    - It is absent from the input log and grade jobs.
    - It changes no `ENGINE_PACKAGES` version.
    - Every instrument slice adds a test that the golden digest is unchanged with the instrument attached.
- **Consequences.**
  - Physically meaningful pin, part and wire currents, live and paused, at a cost of ≤ 1 % for tagging plus small per-probe costs.
  - Later instruments reuse one resolution, transport and test pattern.
  - The ledger describes the last stamped operating point, which can differ slightly from the time-averaged solution in transient circuits (documented).
  - The grader gains nothing. Verified results stay as before.
- **Alternatives.**
  - Add handles for every conductance to `MnaSolution`: invasive API change for every model, and still no wire currents.
  - Model wires as tiny resistors: grows the matrix (O(n³) dense LU) and changes every golden result.
  - Compute currents in the main thread from snapshots: lacks the stamps, and per-slice data is too large to post.
  - Use `Simulation.netResistance` on the live run for Ω: disturbs warm-start state and therefore the replay guarantee.

## ADR-027 — Full-state snapshot and restore contract for time travel

- **Status.** Proposed (2026-11-02, insight & tooling track; accept when the slice that needs it starts).
- **Context.**
  - FR-SIM-17 needs to show any past moment exactly and to resume a run from it.
  - Re-simulating from slice 0 costs ≈ 0.3 ms per simulated ms, which takes too long for long runs.
  - Run state is spread over: `Simulation` (scheduler fields, MNA stamps and warm-start regions, published solutions, per-component PRNG), about 50 component models, the avr8js core and peripherals, the planck.js world, and the observers (safety monitor, challenge tracker, input logger).
  - Much of that state is behind closures: avr8js write hooks and clock events; planck's broadphase callbacks and contact listener; `ModelContext.random`.
  - JSON-style serialisation alone cannot restore it, and restamping after a restore would change results. For example, `Battery.stampedOcv` restamps only after 1 mV of drift.
- **Decision.**
  - **Restore in place into a fresh build.** `buildRun(source, seed, options)` builds a new scenario, which recreates every closure and all topology. `restoreState` then overwrites only mutable data, in place. Snapshots are never applied to the live run.
  - **Contract.** `snapshotState(): S` / `restoreState(s: S): void` on `Simulation`, `McuCore`, `WorldModel` and non-view `SliceObserver`s, and optionally on `ComponentModel`.
    - `S` holds no functions.
    - Capture is a pure read: deep copies, and no field or `dirty` changes.
    - `restoreState(snapshotState())` on an identically built instance yields a state for which continuing is bit-identical to the original.
  - **Components: generic walker by default** (`sim-core/src/state.ts`).
    - It copies own enumerable data fields: primitives, typed arrays (`.set`), plain objects and arrays recursively, and `Map`/`Set` of primitives.
    - It writes into the existing objects, so references shared with the solver (`ReactiveState` in an MNA branch) stay shared.
    - It refuses functions-as-state, unknown class instances and references to other models, unless the class is registered (`Prng`) or the model implements `snapshotState` itself.
    - A refusal disables keyframing for that run, which falls back to replay. It is never a silent partial restore.
  - **MNA.** `MnaCircuit.exportState` saves the stamp lists exactly as last stamped, with each reactive branch's state located by owner and field path at capture time, plus the warm-start regions and the device operating points. The LU cache is dropped: it is bit-identical when rebuilt. Solutions (`Solution`, `AveragedSolution`, `WeightedSolution`) are serialised structurally. Nothing is restamped or re-solved on restore.
  - **PRNG.** `Simulation` keeps each component's `Prng`, and restore sets the words in place (`Prng.setState`), so existing closures stay valid.
  - **avr8js (pinned 0.21.1).**
    - The state includes `cpu.data`, `pc`, `cycles`, pending-interrupt state, the EEPROM backend and the peripherals' own data fields, plus RoboSim's queues and level maps.
    - Clock events are captured as descriptors through a registry that wraps `cpu.addClockEvent`: timer `count` (bound method), and RoboSim's SPI, TWI and USART frame callbacks.
    - avr8js-internal closures that cannot be identified (ADC conversion result, EEPROM write) are "opaque". A keyframe is taken only at a slice boundary with no opaque event pending: it retries for up to 64 slices, else that keyframe is skipped.
    - A shape-drift test freezes the peripherals' field lists.
  - **planck.js (patched 1.5.0).**
    - The world's object graph is deep-cloned with prototypes preserved, cycles handled and immutable shapes shared, then swapped into `PlanckWorld`. Body references are rebound by body-list order, and the contact listener is re-attached (`attachListeners`).
    - The pnpm patch moves `BroadPhase.query` and `queryCallback` from per-instance closures to prototype methods, so a cloned graph carries no stale closures.
    - These keyframes live only in worker memory and are not portable.
  - **Keyframes**:
    - every 1000 slices with thinning (1 s, then 5 s, then 20 s);
    - 48 MB cap;
    - seek = nearest keyframe + deterministic re-simulation with the run's input log;
    - fork = the restored run becomes live with the log truncated after the slice (`InputLog.forkOf` is informational; replay from 0 is the source of truth).
  - **Verification.**
    - For every golden fixture: keyframe → fresh build → restore → continue gives the same `traceDigest` as a straight run.
    - Capturing on vs off gives the same digest.
    - In tests, a state-hash self-check runs after each capture.
- **Consequences.**
  - Exact scrubbing and forks with bounded memory, independent of run length.
  - Every new stateful model must stay walker-compatible or implement the contract. The per-fixture golden round-trip catches violations.
  - Upgrading avr8js or planck now requires re-validating snapshot support. The drift tests make that explicit.
  - Keyframes are not shareable artefacts. Shared replays (IT-11) still use input logs.
- **Alternatives.**
  - **Replay from slice 0 only**: exact and simple, but seeks take seconds to minutes. Kept as the fallback.
  - **Serialising planck through its JSON serializer**: drops contacts and warm-start impulses, so it diverges after restore.
  - **Rebuilding contacts by stepping**: same problem.
  - **Forking the worker by cloning the whole scenario graph**: closures would point into the old instance.
  - **Recording every frame instead of state**: views only, so no exact resume.
  - **Running a lagging shadow worker**: doubles CPU and cannot scrub backwards.

## ADR-028 — Catalogue metadata (functions, directions, currents, faults, tolerance) as optional manifest extensions; cross-part relations as catalogue tables

- **Status.** Proposed (2026-11-02, insight & tooling track; accept when the slice that needs it starts).
- **Context.** Several insight-track slices need facts about parts that today's `ComponentManifest` (`packages/sim-core/src/contracts.ts`) does not hold:
  - FR-CIR-12 needs what a part is for (`functions`, `interfaces`);
  - FR-SAF-08 needs which pins are inputs, outputs or both (`signalDirection`);
  - FR-SIM-15 needs datasheet currents (`limits.typicalCurrentMa`, `limits.idleCurrentMa`);
  - FR-SIM-19 needs the faults a model can simulate (`injectableFaults`);
  - FR-SIM-20 needs per-property variation (`tolerance`);
  - FR-BOM-07 needs substitutions between two parts with a pin mapping.
  Each slice could invent its own field, file or table. Two problems follow from that: some fields change simulation results while others are plain metadata, and the loader pins every component to its exact manifest `version` (`typeVersion`), so a careless version bump would break saved projects. Component packages must not depend on each other (TD §3.1), and prices are staff data, not manifest data (ADR-024).
- **Decision.**
  - One optional contract, `ManifestExtensions`, which `ComponentManifest` extends (`sim-core/src/contracts.ts`):
    - **Metadata class** (never read by models or engine rules):
      - `functions?: string[]` (ids from `@robosim/catalog/functions`);
      - `interfaces?: ('digital'|'analog'|'pwm'|'i2c'|'onewire'|'uart'|'pulse')[]`;
      - `signalDirection?: Record<pin, 'in'|'out'|'bidir'>` (default from `PinKind`);
      - datasheet currents go into the existing `limits: Record<string, number>` as `limits.typicalCurrentMa`, `limits.idleCurrentMa` and `limits.minSupplyV` (TD §18.4), so they need no new field.
    - **Behaviour class** (read by component models through the engine):
      - `injectableFaults?: readonly InjectableFaultSpec[]` (TD §18.12; named so to avoid a clash with the runtime `ComponentModel.faults()`);
      - `tolerance?: Record<string, { kind: 'pct' | 'abs'; value: number; dist: 'uniform' | 'normal' }>`.
  - Every extension is optional. A part without it is silent in the feature that reads it (no search hit, no direction warning, no estimate, no fault offered), never wrong.
  - Validation lives in one place, `validateManifest` (`sim-core/src/manifest.ts`): pin and prop names are real; numbers are finite and in range; `tolerance` keys are number props or model parameters the manifest names. Vocabulary ids and cross-references are checked in `packages/catalog/src/catalog.test.ts`, because `sim-core` does not know the catalogue.
  - Versioning rules:
    - Extensions **never** bump a manifest's `version`, since saved documents pin `typeVersion`.
    - Metadata-class changes need no package bump and leave goldens untouched.
    - Behaviour-class changes bump the shared `components` version in `ENGINE_PACKAGES` (`packages/sim-runtime/src/engine-version.ts`) and need `pnpm golden:update` only when a golden fixture uses the part with the feature enabled. Faults and tolerance are off by default and recorded in the input log when on, so default runs stay bit-identical.
  - Relations between parts are **catalogue tables**, not manifest fields: `@robosim/catalog/substitutes` (FR-BOM-07: `from`, `to`, `pinMap`, `bonds`, `ties`, `requires`, `codeImpact`, `benefits`). The same goes for the function vocabulary (`@robosim/catalog/functions`). Both are engine-free subpaths, so the editor and API can read them without models.
  - Human text for extensions lives in i18n (`components:functions.*`, `components:substitutes.*`, `components:<id>.why.*`), never in manifest JSON. Synonyms used for search are data in the vocabulary, because search spans both languages.
- **Consequences.**
  - Each slice adds fields without schema churn elsewhere, and engine safety is preserved by the class split. Reviewers can tell at a glance whether a manifest diff needs a golden update.
  - About 60 manifest JSON files get edited for `functions`/`interfaces`. Catalogue tests keep coverage complete (every part has a function; bidirectional sensor pins are declared).
  - Substitutes and vocabulary ship with releases until the shop or CMS can own them. Their ids become a public contract like part keys (ADR-024): renaming a function id or a substitute id breaks saved UI state such as compare selections, so they are append-only.
  - `limits.typicalCurrentMa` is a datasheet estimate. Measured values (FR-SIM-13/15) always win where available.
- **Alternatives.**
  - A separate side-car metadata file per part: two sources of truth that drift from pins.
  - A single free-form `meta: Record<string, unknown>`: unvalidated, and hides whether a field affects simulation.
  - Substitutes inside each manifest: needs knowledge of other packages' pins and breaks the no-cross-component-dependency rule.
  - Prices in manifests: rejected already in ADR-024.

## ADR-029 — Firmware variants by patching initialised data via a build symbol map

- **Status.** Proposed (2026-11-02, insight & tooling track; accept when the slice that needs it starts).
- **Context.** FR-SIM-18 (parameter sweep, PID tuner) runs tens to hundreds of variants of one sketch that differ only in a few constants. Rebuilding each variant costs build quota, server CPU and queue time (§6), and needs a network round trip per variant; sweeps should run offline in the browser like other instruments (ADR-006). On AVR, initialised globals live in `.data`, whose initial image is stored in flash and copied to SRAM by the C runtime at reset, so a variable's start value is a few known bytes in the HEX.
- **Decision.**
  - Every successful AVR build emits a `SymbolMap` JSON artifact next to the HEX (read from the ELF the build already links; release flags already contain `-g`): `.data` VMA/LMA, global symbols, and the sketch's `// @tune min..max step` variables with their flash patch address, size and encoding.
  - When sources contain `@tune`, the driver adds a generated translation unit that makes each tunable externally visible and possibly written (an `asm volatile` escape in a `used, externally_visible` function), so LTO cannot constant-fold it; a post-link check marks folded or missing variables as not patchable.
  - The browser creates variants with `patchFirmware` (`packages/sim-runtime`): parse HEX, write the encoded value, re-serialise, new sha256. A variant is an ordinary `FirmwarePayload` in an ordinary input log, so it replays, verifies and grades like any run.
  - Non-patchable tunables (`const`, `static`, array sizes, `#if`) fall back to rebuilds with `defines: { ROBOSIM_TUNE_<name>: value }`, which count against `build.daily_quota` (≤ 50 per sweep).
  - The driver version goes to 3, so toolchain ids and caches roll once.
- **Consequences.**
  - Sweeps of patchable constants cost no builds and work offline. They are bounded by the learner's CPU (a pool of up to 4 grade workers).
  - A patched image is not byte-identical to a rebuild with the new literal, because the compiler may generate different code for a literal. Applying the best value therefore rebuilds, and the learner re-verifies.
  - The escape function changes code generation for tunables only, and costs a few bytes of flash.
  - The annotation syntax and the encodings are a public contract between `packages/shared/src/tune.ts`, the compiler and the web app.
- **Alternatives.** One build per variant (quota, latency, server load); patching machine code immediates (fragile, depends on instruction selection); reading parameters from EEPROM or serial at run time (changes the learner's sketch and teaches a pattern unrelated to tuning); always compiling with `-fno-lto` (changes timing and size of every build).

## ADR-030 — Debug builds and source-level debugging in the emulator

- **Status.** Proposed (2026-11-02, insight & tooling track; accept when the slice that needs it starts).
- **Context.** FR-COD-08 needs breakpoints, stepping by source line and variable inspection for Arduino sketches running in avr8js in a worker. Release builds are `-Os -flto`, which makes line mapping and variables unreliable. The scheduler runs the MCU inside each 1 ms slice, in some circuits in several transient chunks, so stopping mid-slice by returning from `McuCore.run` would mean making `Simulation.step` resumable, an invasive change in determinism-critical code. Hosts must never ship toolchain paths to clients (Security §5).
- **Decision.**
  - A build `profile: 'debug'` compiles user translation units with `-Og -g -fno-lto` and links them against the unchanged LTO core and library archives. The profile is part of the cache key.
  - A TypeScript ELF/DWARF reader in `apps/compiler` turns the ELF into a `DebugInfo` JSON artifact: user-file line table, functions, globals, best-effort locals and types. Paths are mapped like diagnostics.
  - `McuCore` gets an optional `McuDebugPort`. `AvrUnoCore` runs a separate debug loop only while a halt table is set, and calls a synchronous `onHalt` before the instruction executes.
  - The worker halts by blocking in `Atomics.wait` on a debug mailbox `SharedArrayBuffer`. The simulation stack stays intact, so halts are instruction-exact mid-slice, and the main thread inspects memory through mailbox commands. Stepping is data (halt table plus stack-pointer predicates) computed on the main thread from the line table.
  - The debugger requires cross-origin isolation, like shared snapshots.
- **Consequences.**
  - The release path has zero overhead and golden traces are unchanged. A debug session never changes simulated state, so its input log replays exactly.
  - Debug builds count as builds. Their firmware behaves differently from release (timing, size), so the UI shows a banner, and graded submissions must use release artifacts.
  - While halted, the worker answers only mailbox commands. `stop` and `load` go through an `abort` first.
  - Electrical and world views at a halt show the last completed slice, and pin outputs show the halt cycle. This is documented in the UI.
  - Locals and call stacks are best effort (no CFA unwinding in v1). Library and core code has no line info and is stepped over.
- **Alternatives.** gdb remote stub (`avr8js` gdbserver) over a WebSocket bridge (needs a server or a gdb in the browser, heavy for learners); a resumable mid-slice scheduler (invasive, risks determinism); halting only at slice boundaries (up to 1 ms late, wrong line and variables); shipping the ELF and parsing DWARF in the browser (larger download, toolchain paths in the binary).

## ADR-031 — Stored runs and run share links

- **Status.** Proposed (2026-11-02, insight & tooling track; accept when the slice that needs it starts).
- **Context.** FR-SIM-12 asks for shareable replays. Input logs already reproduce a run bit-for-bit under the same engine version (§5.8, §5.9), and project share links exist (HMAC token, hashed in the database, `/s/$token`). Runs must not become an official result channel (ADR-011), storage is a server cost (ADR-006), and minors' sharing follows existing policy.
- **Decision.**
  - A `runs` table holds the gzipped `InputLog` (≤ 2 MiB, `bytea` until the object-storage track), a client-computed summary labelled unofficial, digests and the engine version.
  - RLS restricts every row to its owner within the workspace (`runs_owner`). Public reads go through a system lookup by `share_token_hash` only.
  - A run has at most one link. Its token is HMAC-SHA256(`SHARE_LINK_SECRET`, `run:<id>.<nonce>`), domain-separated from project tokens. The owner can regenerate or revoke it, and the database stores only its SHA-256.
  - `/r/$token` re-simulates the log in the browser and shows the real outcome and trace digest. If the engine version differs, it shows a banner, replays on request in the live worker (`grade()` refuses other versions), and offers "open as project" instead of keeping old engine bundles.
  - Saving needs an account and is limited by the quota `runs.cloud_max`. Viewing needs no account. Link creation answers `policy_restricted` for `u13` and for org policies without public links.
  - `/r/*` may be framed (`frame-ancestors *`). Embeds hide account actions.
- **Consequences.**
  - Sharing a run costs one row and no server CPU. Viewers always see a result their own browser computed, not a stored claim.
  - Logs embed the whole project document and firmware, so a run link discloses the sketch and circuit. The save dialog says so, and revoking the link removes access.
  - Runs recorded under older engines may stop replaying identically. Accepted for the MVP; an engine-bundle archive or server re-grade is a later decision.
  - `bytea` storage grows the database until the object-storage move. The quota and the 2 MiB cap bound it.
- **Alternatives.** Server-side grading of every saved run (CPU per save, and official-looking results outside the grader's flow); storing traces or video instead of logs (large, and not re-verifiable); a separate `run_shares` table for people shares (not needed until runs get roles); reusing project links (a run is immutable and has its own lifecycle).

## ADR-032 — Behaviour-changing run options travel in the input log

- **Status.** Proposed (2026-11-02, insight & tooling track; accept when the slice that needs it starts).
- **Context.**
  - Fault injection (FR-SIM-19) and tolerance mode (FR-SIM-20) change simulated behaviour.
  - Verified runs, replays, shared run links and the grader must reproduce them exactly (FR-SIM-09, ADR-011).
  - Today the input log (`InputLog`: project, firmware, seed, entries, `engineVersion`) fully determines a run.
- **Decision.**
  - **Run options in the log.** Every option that changes behaviour is part of the input log, never read from ambient state at grade time.
    - Pre-run options go in the header: `faultPlan.breakableWires` and `tolerance.seed`.
    - Timed events are entries: `fault` and `faultClear`.
    - The grader and `HeadlessRun` read only the log. The project document's `simulation.tolerance` setting only pre-fills the next live run.
  - **Separate random streams.** Option randomness uses PRNG streams separate from the run seed's per-component streams: `tol:<id>`, `<id>#<label>` and `#wire:<id>`. Enabling an option therefore never shifts unrelated random numbers.
  - **Version bump.** Packages whose behaviour gains such options bump their versions, which yields a new `ENGINE_VERSION`. Goldens are re-recorded and must be result-identical, because no fixture uses the options.
  - **Validation.** Logs are validated before slice 0 (`replayIssues`): declared fault ids and params in range, armed wires, numeric seeds.
- **Consequences.**
  - Faulted and tolerance runs are gradable and shareable like any run.
  - Older engines reject newer logs through the existing `EngineVersionMismatchError`.
  - The log schema grows by optional fields only, so old logs replay unchanged.
  - Arming wires before a run is a visible constraint of the netlist model, accepted in exchange for a cheap solve.
- **Alternatives.**
  - Storing options in the project document only: a grade job could disagree with what the learner ran.
  - Encoding faults as component inputs (`component` entries): would bypass manifest-declared fault semantics and validation, and cannot open wires.
  - Making every wire breakable: dense LU cost grows with nets³.
