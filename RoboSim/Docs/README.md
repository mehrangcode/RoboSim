# RoboSim — Product Documentation Set

**Product:** RoboSim (working name) — a Mehrtronic product
**Edition:** Enterprise (full product scope; supersedes the v0.1 MVP PRD)
**Version:** 1.0 · **Status:** Approved for planning · **Date:** 2026-10-13 · **Owner:** @MehranG

RoboSim is a bilingual (English/Persian) web platform where learners, makers, and schools design robot circuits, program them in Arduino C++ or blocks, simulate them in a physical 2D/3D arena, verify them for hardware safety, and turn the result into a priced, purchasable parts kit.

---

## Document map

Read in this order. Each document owns one concern; others link to it instead of repeating it.

| # | Document | Owns | Primary readers |
|---|---|---|---|
| 1 | [BRD.md](BRD.md) | Why: business case, market, revenue model, Mehrtronic positioning, business requirements (`BR-*`), KPIs | Management, finance, sales |
| 2 | [PRD.md](PRD.md) | What: editions, personas, functional requirements (`FR-*`), non-functional requirements (`NFR-*`) | Product, design, engineering, QA |
| 3 | [User-Stories.md](User-Stories.md) | Who does what: epics and stories (`US-*`) with acceptance criteria | Engineering, QA, design |
| 4 | [Technical-Design.md](Technical-Design.md) | How: architecture, simulation engine, services, data model, deployment | Engineering, SRE |
| 5 | [API-Spec.md](API-Spec.md) | Contracts: REST/WebSocket API, schemas, error codes, webhooks | Frontend, backend, integrators |
| 6 | [Security-Privacy-Compliance.md](Security-Privacy-Compliance.md) | Threat model, RBAC matrix, sandboxing, minors' privacy, Iranian legal/commercial compliance | Engineering, legal, management |
| 7 | [Engineering-Guide.md](Engineering-Guide.md) | Dev setup (WSL2), repo conventions, coding standards, testing, CI/CD, extension recipes, AI-agent rules | Engineers, AI coding agents |
| 8 | [Release-Plan.md](Release-Plan.md) | When: phases P0–P5, exit criteria, team, timeline, risk register | Management, product, engineering |
| 9 | [decisions.md](decisions.md) | Architecture Decision Records (`ADR-*`) | Engineering |
| — | [archive/RoboSim-PRD-v0.1-mvp.md](archive/RoboSim-PRD-v0.1-mvp.md) | Superseded MVP PRD (history only) | — |

## Identifier scheme

| Prefix | Meaning | Defined in | Example |
|---|---|---|---|
| `BR-NN` | Business requirement | BRD | `BR-04` |
| `FR-<MOD>-NN` | Functional requirement | PRD | `FR-SIM-05` |
| `NFR-<AREA>-NN` | Non-functional requirement | PRD §8 | `NFR-PERF-01` |
| `US-<MOD>-NN` | User story | User-Stories | `US-ARN-03` |
| `ADR-NNN` | Architecture decision | decisions.md | `ADR-004` |
| `P0`–`P5` | Delivery phase | Release-Plan | `P3` |
| `R-NN` | Risk | Release-Plan §6 | `R-02` |

**Module codes** (shared by `FR`, `US`, code packages, and API route groups):

| Code | Module | Code | Module |
|---|---|---|---|
| `IAM` | Identity & access | `BOM` | Bill of materials, wiring guide, exports |
| `ORG` | Organizations, tenancy, seats | `PRJ` | Projects, versions, sharing, collaboration |
| `WRK` | Workspace shell & UX | `LRN` | Learning: courses, classes, assignments, grading, LTI |
| `CIR` | Circuit editor | `CMY` | Community, gallery, competitions, moderation |
| `COD` | Code editor, C++ & blocks | `BIL` | Plans, entitlements, payments, invoicing |
| `BLD` | Build (compile) service | `SHP` | Parts shop & fulfilment |
| `SIM` | MCU & electrical simulation | `AI` | AI assistant |
| `ARN` | Arena, physics, 2D/3D | `HWB` | Hardware bridge (upload to a real board) |
| `SAF` | Safety checker | `I18N` | Internationalization |
| `EXT` | Extensibility & content registry | `ADM` | Admin & back-office |
| `NTF` | Notifications | `ANL` | Analytics & reporting |

**Priority labels:** `Must` (blocks the phase exit), `Should` (planned in the phase, may slip one phase), `Could` (scheduled opportunistically).

## Glossary

| Term | Meaning |
|---|---|
| **Netlist** | The set of electrical nets: groups of component pins that are connected by wires. Single source of truth for the simulator, safety checker, BOM, and wiring guide. |
| **Component model** | Code (`model.ts`) that simulates one component type's electrical and physical behaviour. |
| **Board** | A microcontroller board definition: emulator core, pin map, compile FQBN, upload protocol. |
| **FQBN** | Fully Qualified Board Name used by `arduino-cli` (e.g. `arduino:avr:uno`). |
| **HEX / UF2** | Compiled firmware images (AVR Intel HEX; RP2040 UF2). |
| **World model** | The single physical state of the arena (bodies, floor, obstacles) rendered by both the 2D and 3D views. |
| **Success condition** | Declarative rule evaluated on simulation state (e.g. "complete one lap in < 60 s") used by guided projects, assignments, and competitions. |
| **Verified run** | A simulation executed server-side by the grader service; the only kind of run whose result counts for grades and competitions. |
| **Workspace** | The billing and data-ownership container. Every user has a personal workspace; organizations are workspaces with members. |
| **Entitlement** | A server-enforced capability or quota derived from a workspace's plan (e.g. `compile.daily_quota`). |
| **BYOK** | Bring Your Own Key — a user's own API key for an external AI provider. |
| **Seat** | A licensed member slot in an organization workspace. |
| **LTI 1.3** | Learning Tools Interoperability standard for embedding RoboSim in an LMS such as Moodle. |
| **eNamad** | Iranian e-commerce trust seal (اینماد) required by Iranian payment gateways. |
| **Moodian** | Iranian Tax Administration's e-invoicing system (سامانه مودیان). |

## Changes from v0.1 (MVP PRD)

1. Scope is now the **full enterprise product**: multi-tenant organizations, classrooms, LMS integration, SSO, grading, community, collaboration, block coding, more boards, hardware upload, on-premise deployment.
2. All nine review gaps are resolved; see [PRD Appendix A](PRD.md#appendix-a--resolution-of-v01-review-gaps).
3. Delivery is organized as phases **P0–P5** of one product, not as an MVP followed by a rewrite; every phase ships production-grade quality ([Release-Plan.md](Release-Plan.md)).
4. Requirement IDs moved from `FR-x.y` to module-based `FR-<MOD>-NN`.
