# RoboSim — Release Plan

**Version:** 1.0 · **Date:** 2026-10-13 · **Owner:** @MehranG (product), Engineering lead
**Related:** [PRD §9](PRD.md#9-release-mapping) · [BRD](BRD.md) · [User Stories](User-Stories.md)

---

## 1. Delivery approach

RoboSim is built as **one enterprise product delivered in phases**, not as an MVP that is later rewritten.

| Principle | Meaning |
|---|---|
| Production-grade from P0 | Security, tenancy (`workspace_id` + RLS), i18n, observability, CI gates, and the full data model exist from the first phase. No "we'll add it later" shortcuts. |
| Vertical slices | Each phase ends with working user journeys, not with layers. |
| Architecture for the end state | Organizations, entitlements, boards, and content registries are designed in P0/P1 even if their UI ships later, so later phases add features instead of refactoring foundations. |
| Exit criteria are tests | A phase exits when its criteria pass in CI/staging, not on a date. Dates are planning estimates. |
| Feature flags | Work for later phases may merge early behind flags. |

## 2. Phase overview

| Phase | Theme | Calendar (estimate) | Public milestone |
|---|---|---|---|
| **P0** | Platform foundation | 2026-11-02 → 2026-12-11 (6 w) | — |
| **P1** | Simulation engine | 2026-12-14 → 2027-04-09 (17 w incl. Nowruz) | Closed alpha (internal + 30 invited makers) |
| **P2** | Individual product & commerce | 2027-04-12 → 2027-07-02 (12 w) | **1.0-Individual public launch: 2027-07-05** (summer break) |
| **P3** | Education & enterprise | 2027-06-07 → 2027-09-10 (14 w, overlaps P2 tail) | **1.0 GA (Enterprise): 2027-09-13**, before the school year (1 Mehr) |
| **P4** | Ecosystem | 2027-09-13 → 2028-03-03 | 1.1 (Nov 2027), 1.2 (Jan 2028), 1.3 (Mar 2028) |
| **P5** | Expansion | from 2028-04 | 2.0 |

```mermaid
gantt
  dateFormat  YYYY-MM-DD
  title RoboSim delivery (estimates)
  section Foundation
  P0 Platform foundation        :p0, 2026-11-02, 2026-12-11
  section Core
  P1 Simulation engine          :p1, 2026-12-14, 2027-04-09
  Nowruz (reduced capacity)     :crit, 2027-03-18, 2027-04-02
  section Product
  P2 Individual + commerce      :p2, 2027-04-12, 2027-07-02
  1.0-Individual launch         :milestone, 2027-07-05, 0d
  P3 Education + enterprise     :p3, 2027-06-07, 2027-09-10
  1.0 GA                        :milestone, 2027-09-13, 0d
  section Ecosystem
  P4 1.1 Blocks, boards, HW     :p41, 2027-09-13, 2027-11-26
  P4 1.2 Community, arenas      :p42, 2027-11-29, 2028-01-21
  P4 1.3 Collaboration, Pico    :p43, 2028-01-24, 2028-03-03
```

## 3. Phase details

### P0 — Platform foundation

**Scope**
- Monorepo per [Technical Design §3](Technical-Design.md#3-repository-layout); CI pipeline with all gates (lint, typecheck, arch rules, i18n, unit, integration, image scan, SBOM).
- Infrastructure: local Docker Compose (WSL2) and a Docker-free local mode on PGlite ([ADR-019](decisions.md#adr-019--pglite-for-docker-free-development-and-database-tests)); OpenTelemetry tracing hooks, structured JSON logs with request IDs.
- *Re-scoped 2026-10-13:* staging Kubernetes, Harbor/Verdaccio mirrors, CloudNativePG, OpenBao, observability stack, and Argo CD move to **P1 (Platform deployment track)** because no cluster or cloud provider is available yet (open question Q-5).
- `apps/web`, `apps/admin`, `apps/api` skeletons; design system (`packages/ui`) with RTL; i18n infrastructure (FR-I18N-01…04); feature flags (FR-ADM-09).
- Full database schema baseline for IAM, workspaces, memberships, audit, outbox, feature flags; RLS framework and isolation test harness.
- Personal workspace creation on user creation (internal only; auth UI comes in P2).
- Long-lead items started: eNamad, payment gateway contract, cloud contract, SMS/email providers, GPU capacity (§7).

**Exit criteria**
- `pnpm dev` brings the full stack up on a fresh WSL2 machine in < 30 min following the Engineering Guide (PGlite mode without Docker; Compose mode once Docker is installed).
- Switching to FA flips the app shell to RTL; i18n check and pseudo-locale build pass with zero hard-coded strings.
- Tenant-isolation test suite runs in CI (`pnpm verify` locally, GitHub Actions on every PR).
- API emits structured logs with correlation IDs; OTLP tracing activates when an endpoint is configured.

**P0 status (2026-10-13):** implemented. Verified: `pnpm verify` green from a clean checkout (25/25 tasks, 118 tests), all gates proven to fail on planted violations. Not yet verified: Docker Compose stack (no Docker host), GitHub Actions run (no remote yet), browser screenshot/visual check (headless Chromium system libraries missing in WSL).

### P1 — Simulation engine

**Platform deployment track (moved from P0):** staging Kubernetes (Helm umbrella chart, gVisor RuntimeClass node pool), Argo CD, Harbor + Verdaccio mirrors, CloudNativePG with PITR, Valkey, OpenBao + External Secrets, observability stack (OTel Collector, Prometheus, Loki, Tempo, Grafana, GlitchTip), outbox relay worker on BullMQ. Exit: staging deploys from `main` via Argo CD; dashboards show RED metrics and traces for the API; tenant-isolation suite also passes against real PostgreSQL 16.

**Scope** (FR-WRK-01…03, FR-CIR-01…06, 10, FR-COD-01, 03, 06, FR-BLD-01…06, FR-SIM-01…07, 09…11, FR-ARN-01…09, 11 (engine), FR-SAF-01, 02 (rules 1–11), 04…06, FR-EXT-01…03, 06)
- `sim-core`: netlist, MNA solver, scheduler, component bus, world model, physics, sensors, success-condition engine, determinism (dmath, PRNG).
- Board: Uno (avr8js). Components: all P1 rows of [PRD §7.2](PRD.md#72-components).
- Build service with gVisor sandbox, cache, fair-share, SSE.
- Circuit canvas, Monaco editor, serial monitor, pin inspector.
- 2D renderer, 3D renderer, mounting editor, built-in arenas.
- Safety checker (static + runtime) and damage model.
- Grader service skeleton running golden traces headless (used by CI now, by learning in P3).

**Exit criteria**
- Starter line-follower completes a lap of the oval in 2D and 3D; toggling views mid-run keeps time and pose identical (US-ARN-02).
- Peripheral conformance suite and golden traces pass in Node, Chrome, and Firefox.
- Every GA safety rule (1–11) has trigger and clean fixtures passing.
- Sandbox escape suite passes; build p95 cold < 5 s and cached < 200 ms in staging load test.
- Simulation slice and frame budgets met on the reference laptop.
- Closed alpha: ≥ 20 of 30 invited makers complete the line-follower without help.

**P1 status (2026-10-14):** slices 1–3 of 7 done — `packages/sim-core` foundation: contracts, `dmath` (fdlibm ports, golden bit patterns), `xoshiro128**` PRNG with per-component forks, union-find netlist, dense-LU MNA with PWL diodes, MCU component bus (output resistance, pull-ups, VIL/VIH hysteresis), fixed 1 ms slice scheduler with 2 ms physics cadence, and wall-clock pacer. **Slice 2 done (2026-10-14):** `packages/boards/avr-uno` — avr8js adapter implementing `McuCore` (cycle-exact scheduled inputs, register-derived PWM for timers 0/1/2, cycle-stamped output edges, USART0 TX/RX, ADC channels), Intel HEX loader, Uno pin map and power tree; PWM loads use phase-averaged operating points. Measured ≈ 3.3× real time in Node with a toggling pin. **Slice 3 done (2026-10-14):** catalogue components (electrical P1 set): resistor, potentiometer, LDR, LED, push button (4-leg), on/off switch, active buzzer, 9 V and 4×AA alkaline batteries, L298N, TT gear motor, SG90 servo, half/full breadboard. Plus `packages/catalog` (registry with FA/EN names), `packages/test-fixtures` (bench), and `pnpm new:component`. A drive-train test runs Uno PWM → L298N → TT motor on 4×AA end to end. Completing the PRD §7.2 basic set: HC-SR04 (cycle-precise echo, sub-millimetre ranging), TCRT5000, the 3-channel line module, and the 2WD chassis definition (geometry, inertia, mount slots). They work against the `WorldModel` interface, tested with a deterministic `TestArena`; the catalog test asserts the P1 set equals PRD §7.2's basic tier. Next slices: world/physics + sensors → runtime safety + damage → success conditions → worker protocol, then build service, editors, and renderers.

### P2 — Individual product & commerce

**Scope** (FR-WRK-04…06, FR-CIR-09, FR-COD-02, 05, 07, FR-BLD-07, FR-SIM-07 (plotter), 08, FR-SAF-03, 07, FR-BOM-*, FR-PRJ-01…04, 06, FR-LRN-01 (2 projects), FR-BIL-01…06, 09, FR-SHP-01…06, 08, FR-AI-01…05, 07…10, FR-I18N-05, FR-EXT-04, 05, FR-IAM-01…03, 04, 07, FR-ADM-01…06, 08, 10, FR-NTF-*, FR-ANL-01, 04)
- Authentication (email/phone OTP, TOTP), minors' consent flow, sessions, data export/deletion.
- Projects, versions, sharing, import/export.
- Guided projects: Line-follower, Obstacle avoider; kits for both in the shop.
- BOM, wiring guide, server-rendered exports.
- Plans, trial, entitlements, paywall, Zarinpal, coupons, wallet, refunds, reconciliation.
- Shop: catalogue, inventory, cart from BOM, checkout, shipping, order lifecycle, fulfilment admin.
- AI assistant with platform model + BYOK adapters (enabled per legal review), evaluation harness.
- Admin back-office for users, catalogue, content CMS, commerce, finance, AI, audit.

**Exit criteria**
- Journey A and B pass as Playwright E2E in FA and EN.
- Moderated usability test: ≥ 80 % of ≥ 8 beginners complete Journey A in < 60 min in each language (NFR-UX-01).
- Payment: trial expiry (time-mocked) → Free fallback; gateway sandbox payment restores Maker within 5 s; duplicate callbacks idempotent; reconciliation report clean for a 7-day staging run.
- BOM → paid order → shipped flow completed end to end in staging with real fulfilment staff.
- AI eval baseline recorded; Persian quality accepted by product owner (Q-8).
- eNamad active; legal pages (terms, privacy, returns) published in FA/EN; external pen test of P2 scope with no open high/critical findings.

### P3 — Education & enterprise

**Scope** (FR-WRK-07, FR-PRJ-07, FR-LRN-01 (6 projects), 02…09, FR-IAM-02 (passkeys), 05, 06, FR-ORG-*, FR-BIL-07, 08, 10, FR-SHP-07, FR-AI-06, FR-ANL-02, 03, FR-ARN-11 (scoring))
- Organizations, members, roles, seats, branches, policies.
- SSO (OIDC/SAML), SCIM, passkeys.
- Classes, assignments, verified-run grading, gradebook, teacher live dashboard, guardian reports.
- Courses and certificates; four more guided projects.
- LTI 1.3 Advantage with Moodle.
- Organization billing: quotes, proforma, bank transfer, official invoices, Moodian adapter; second gateway.
- Org analytics and audit export; outbound webhooks.
- **Pilot programme:** 5–10 schools/academies from P3 week 4.

**Exit criteria**
- Journeys C and D pass E2E; LTI suite passes against Moodle 4.x.
- 40 simultaneous submissions graded in < 5 min p95; regrade reproduces identical scores.
- Cross-tenant isolation suite and SSO/SCIM conformance tests pass; external pen test of P3 scope clean (no high/critical).
- At least 3 pilot organizations used assignments with real classes and confirm readiness.
- Load test at NFR-SCALE-01 targets passes in staging; DR restore drill completed within RTO.
- Official invoice issued and accepted through the Moodian adapter in the test environment.

### P4 — Ecosystem (1.1 – 1.3)

| Release | Scope | Exit criteria |
|---|---|---|
| **1.1** (Nov 2027) | Blockly (FR-COD-04), Nano + Mega boards, hardware bridge (FR-HWB-*), code-aware rules complete, schematic view (FR-CIR-07) | Block programs match golden C++ behaviour; upload verified on real Uno/Nano/Mega in a hardware lab test rig |
| **1.2** (Jan 2028) | Community gallery, remix, moderation, competitions, badges (FR-CMY-*, FR-ADM-07), arena editor (FR-ARN-10), plagiarism signal (FR-LRN-10), replays (FR-SIM-12) | Moderation SLA tooling in place; minors' protections verified by test suite; first public competition run |
| **1.3** (Mar 2028) | Real-time collaboration (FR-PRJ-08), comments (FR-PRJ-05), Pico board (rp2040js), encoders + IMU, safety rules 12–13, displays and comms components | 2-user and 5-user collaboration E2E; offline merge test; Pico conformance suite |

### P5 — Expansion (2.0)

| Track | Description | Go/no-go criteria |
|---|---|---|
| ESP32 (research spike, 6 w) | Evaluate (a) server-side Espressif QEMU fork streaming pin/UART state to the browser, (b) any viable in-browser ESP32 emulation. | GPIO, LEDC PWM, ADC, UART, I²C supported; end-to-end latency < 100 ms at p95; cost per active session within budget; determinism achievable for grading. If no-go, ESP32 remains out of scope. |
| MicroPython on Pico | Run MicroPython firmware in rp2040js with a Python editor | Conformance + course content ready |
| Multi-robot arenas | FR-ARN-12 (sumo, races) | Deterministic multi-firmware scheduling |
| Private Cloud v2 | Self-service upgrades, multi-site HA | Two customer deployments upgraded without downtime |
| Mobile companion | Phone as Bluetooth controller panel for real robots | User research supports it |

## 4. Team and capacity

**Planning assumption [A-7]:** the team below is in place from P0. With fewer engineers, durations scale roughly linearly (e.g. 6 engineers instead of 9 → P1–P3 take about 1.5×).

| Role | FTE | Focus |
|---|---|---|
| Product owner / PM | 1 | Backlog, acceptance, pilots, launch |
| Product designer (bilingual UX, RTL) | 1 | Design system, journeys, usability tests |
| Simulation engineers | 3 | sim-core, boards, components, physics, renderers, circuit canvas |
| Frontend engineer | 1 | App shell, projects, learning, billing, shop UI |
| Backend engineers | 3 | IAM/org, billing/commerce, learning/LTI, AI, build service |
| DevOps / SRE | 1 | Infrastructure, CI/CD, sandbox, observability, on-prem packaging |
| QA engineer (automation) | 1 | E2E, visual, a11y, load, hardware test rig |
| Education content lead | 1 | Guided projects, courses, safety texts, FA/EN quality |
| Hardware/calibration technician | 0.5 | Calibration measurements, hardware lab rig |
| Security consultant | 0.2 | Reviews, threat models, pen-test coordination |
| Legal & finance | 0.3 | eNamad, terms, privacy, tax, invoicing |
| **Total** | **≈ 14** | |

Squads: **Simulation** (3 sim + designer share), **Platform & Commerce** (backend 2 + frontend), **Education** (backend 1 + content lead; ramps in P2), with SRE and QA shared.

## 5. Release governance

| Gate | Applies to | Checklist |
|---|---|---|
| Phase exit review | Every phase | Exit criteria evidence (CI runs, test reports, load/pen-test reports), open risks, go/no-go by PO + engineering lead + sponsor |
| Launch readiness | 1.0-Individual, 1.0 GA | Support staffed (FA/EN), help centre, status page, on-call rota, runbooks, legal pages, pricing approved, marketing site, analytics dashboards, backup/restore drill, rollback plan |
| Content readiness | Each release with content | All content in both locales reviewed by the education lead and a native reviewer |
| Security | Each phase | Threat models updated; pen test (P2, P3); no high/critical findings open |
| Private Cloud | LTS releases | Install and upgrade tested on the reference on-prem environment; air-gapped bundle verified |

Release channels: `alpha` (P1, invite-only), `beta` (feature flags for opted-in users), `stable` (SaaS weekly), `lts` (Private Cloud quarterly).

## 6. Risk register

Probability (P) and impact (I): H/M/L.

| ID | Risk | P | I | Mitigation | Trigger / early signal | Owner |
|---|---|---|---|---|---|---|
| R-01 | Simulated behaviour differs from real parts; users lose trust | M | H | Calibrate every sold part; "estimate" labelling; per-component feedback; hardware test rig in CI for key behaviours | Calibration error > 5 %; support tickets tagged "sim vs real" | Simulation lead |
| R-02 | Sandbox escape or abuse of build farm | L | H | §5 of Security; gVisor; isolated node pool; escape suite; bug bounty after GA | Sandbox anomaly alerts | SRE |
| R-03 | Simulation performance insufficient on low-end school PCs | M | H | Performance budgets in CI; 2D default; adaptive 3D quality; profiling on a low-end reference device from P1 | RTF < 1× on reference device | Simulation lead |
| R-04 | Determinism breaks across engines/versions, disputing grades | M | H | dmath, seeded PRNG, golden traces in CI across browsers; engine version pinning in grader; only verified runs count | Golden trace drift | Simulation lead |
| R-05 | eNamad/gateway onboarding delays block P2 launch | M | H | Start in P0; second gateway; `fake` provider keeps development unblocked | Not approved by P2 week 6 | Finance |
| R-06 | Network filtering/outages make the service unreachable for some users | M | M | Iran hosting, no foreign runtime dependencies, PWA offline simulation, local build cache | Regional error-rate spikes | SRE |
| R-07 | External AI providers unreachable or terms prohibit use | H | M | Platform-hosted open-weight model as default (ADR-009); BYOK only after legal review | Provider blocks/ToS change | Engineering lead |
| R-08 | GPU capacity for platform AI unavailable or costly in-region | M | M | Small efficient default model; CPU fallback; credits limit usage; AI optional to the core loop | Cost per user above budget | Engineering lead |
| R-09 | Scope of P1 (2D + 3D + electrical + physics) overruns | M | H | Shared world model (3D is view-only); vertical-slice sequencing (2D first inside P1); weekly burn-up; descoping candidates pre-agreed: logic analyzer (Should), plotter (P2) | Burn-up < 80 % of plan at P1 mid-point | Product owner |
| R-10 | Institutional sales cycle longer than planned | M | M | Pilot programme from P3 week 4; academies before universities; LTI/SSO ready at GA | < 3 pilots active by P3 week 8 | Sales |
| R-11 | Persian content quality or volume insufficient | M | M | Dedicated education lead; native review gate; content CMS from P2 | Content backlog > 4 weeks | Education lead |
| R-12 | Child-safety incident in community | L | H | No DMs; pre-moderation for minors; contact-info filters; moderation SLA; incident playbook | Reports volume spike | Trust & safety |
| R-13 | Tax/e-invoicing requirements change or are misinterpreted | M | M | Effective-dated tax settings; adapter for Moodian; accountant review per release | Rejected invoices | Finance |
| R-14 | Key-person dependency in simulation squad | M | H | Pairing, ADRs, design docs, ≥ 2 people per subsystem | Single reviewer for sim-core PRs | Engineering lead |
| R-15 | Upstream registry/package outages break CI/deploys | M | M | Harbor and Verdaccio mirrors; pinned versions; offline build caches | Pull failures in CI | SRE |
| R-16 | Real-time collaboration complexity delays 1.3 | M | L | Yjs/Hocuspocus proven stack; collab isolated behind flag; not a GA dependency | Merge bugs in beta | Platform lead |

## 7. Dependencies and long-lead items

| Item | Needed by | Start | Owner |
|---|---|---|---|
| Iranian cloud contract (Kubernetes, object storage, 2 sites) | P0 week 2 | Immediately | Engineering lead |
| eNamad application | P2 launch | P0 | Legal |
| Payment gateway contracts (primary + secondary) and sandbox access | P2 week 1 (sandbox), launch (production) | P0 | Finance |
| SMS and email providers | P2 week 1 | P0 | Engineering lead |
| GPU capacity for platform AI | P2 week 4 | P1 | Engineering lead |
| Calibration lab equipment and parts from the Mehrtronic catalogue | P1 week 4 | P0 | Simulation lead |
| Hardware test rig (Uno, Nano, Mega, Pico with USB hub) | P4 1.1 | P3 | QA |
| Pilot schools/academies (5–10) | P3 week 4 | P2 | Sales |
| Moodle test instance and LTI registration with a pilot institution | P3 week 6 | P2 | Backend lead |
| Moodian trusted-provider contract | P3 week 8 | P2 | Finance |
| External penetration testing vendor | P2 week 10, P3 week 12 | P1 | Security consultant |
