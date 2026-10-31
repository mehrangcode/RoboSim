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

