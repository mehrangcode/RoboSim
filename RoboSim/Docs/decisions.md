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
