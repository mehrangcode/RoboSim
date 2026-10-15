# RoboSim — Engineering Guide

**Version:** 1.0 · **Date:** 2026-10-13 · **Owner:** Engineering lead
**Audience:** Every engineer and every AI coding agent working in the RoboSim repository.
**Related:** [Technical Design](Technical-Design.md) (architecture, repo layout) · [API Spec](API-Spec.md) · [Security](Security-Privacy-Compliance.md) · [ADRs](decisions.md)

---

## 1. Golden rules

1. **Requirements first.** Every change references a requirement or story ID (`FR-SIM-05`, `US-ARN-02`) in its commit, PR, and test names. No ID → clarify before coding.
2. **One source of truth.** Netlist for electrical facts, world model for physical facts, Zod schemas in `packages/shared` for contracts. Never duplicate them.
3. **`sim-core` stays pure.** No DOM, React, timers, `Math.random`, or wall-clock inside it. It must run identically in a worker, in Node, and in tests.
4. **Server enforces, UI mirrors.** Every permission, entitlement, quota, and policy is checked in the API; UI checks are for UX only.
5. **Never run user code on a host.** User C++ is compiled only inside the sandbox ([Security §5](Security-Privacy-Compliance.md#5-untrusted-code-execution-sandbox)).
6. **Both languages, always.** No hard-coded user-facing string; every key exists in `en` and `fa`; layouts use logical CSS properties.
7. **Self-hosted only.** No runtime calls to third-party CDNs, fonts, analytics, or SaaS.
8. **Ambiguity → simplest compliant option + ADR.** Record the assumption in [decisions.md](decisions.md) (or a short note in the PR if trivial) and continue.

## 2. Development environment (Windows + WSL2)

### 2.1 Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Windows 11 + WSL2 | Ubuntu 24.04 distro | RoboSim lives in the `RoboSim/` folder of the Mehrtronic repo. A checkout under `/mnt/c` or `/mnt/d` works but is slower (`pnpm install` ≈ 1 min, `pnpm verify` ≈ 1.5 min); a clone inside the WSL filesystem is faster |
| Docker | Docker Desktop with WSL2 backend, or Docker Engine inside WSL | Compose v2 |
| Node.js | 24 LTS via `fnm` or `nvm` | Version pinned in `.nvmrc` / `package.json#engines` |
| pnpm | via Corepack (`corepack enable`) | Version pinned in `package.json#packageManager` |
| Ollama | Windows or WSL host | For the AI assistant in dev (`ollama pull <platform-dev-model>`) |
| Browsers | Chrome/Edge (Web Serial testing), Firefox | Playwright installs its own browsers |

### 2.2 First run

**Mode A — no Docker (PGlite).** Works on a fresh WSL2 machine with only Node and pnpm. The API runs an in-process PostgreSQL (PGlite, [ADR-019](decisions.md#adr-019--pglite-for-docker-free-development-and-database-tests)) and migrates it automatically on start.

```bash
git clone <mehrtronic-repo-url> && cd Mehrtronic/RoboSim
corepack enable
pnpm install
sed -e 's/^DATABASE_DRIVER=postgres/DATABASE_DRIVER=pglite/' \
    -e 's#^PGLITE_DATA_DIR=.*#PGLITE_DATA_DIR=../../.local/pglite#' .env.example > .env
sudo apt install -y gcc-avr avr-libc binutils-avr   # AVR toolchain for the build service (ADR-022)
pnpm compiler:setup                  # pinned Arduino core + libraries → .local/toolchain
pnpm build                           # shared packages + apps (first time)
pnpm db:seed                         # demo users and feature flags
pnpm dev                             # web (5173), admin (5174), api (3000)
```

**Mode B — full local infrastructure (Docker).** Same as above, but keep `DATABASE_DRIVER=postgres` in `.env` and start the services first:

```bash
pnpm dev:infra                       # docker compose: postgres, valkey, minio, openbao (dev), mailpit
pnpm db:migrate && pnpm db:seed
pnpm dev
```

If port 3000 is already used on your machine, set `API_PORT` in `.env`; the Vite dev proxies read the same file and follow it.

On a checkout under `/mnt/c` or `/mnt/d`, WSL gets no file-change events, so the Vite configs switch to polling there; the API's `tsc --watch` may still need a restart after edits.

Run every `pnpm` command from WSL, never from Windows PowerShell/cmd on the same checkout: a Windows install swaps the platform-specific binaries (esbuild, swc, rollup, lightningcss) and breaks the WSL setup. `pnpm install`, `pnpm dev`, and `pnpm verify` refuse to run on Windows (`tools/require-wsl.ts`).

| URL | Service | Available from |
|---|---|---|
| http://localhost:5173 | Web app | P0 |
| http://localhost:5173/lab | Simulator Lab: live engine demos (arena, component bench, safety, your code) and the circuit canvas (Design tab) | P1 |
| http://localhost:5174 | Admin app | P0 |
| http://localhost:3000/api/v1/health/ready | API readiness | P0 |
| http://localhost:3000/api/v1/feature-flags | Evaluated feature flags | P0 |
| http://localhost:3000/api/v1/openapi.json | API spec | P2 (with the first public endpoints) |
| http://localhost:8025 | Mailpit | Mode B |
| http://localhost:9001 | MinIO console | Mode B |

Seed users (`learner@dev.local`, `teacher@dev.local`, `admin@dev.local` with the `platform_admin` staff role) exist from P0; passwords and login arrive with authentication in P2.

### 2.3 Environment variables (excerpt)

| Variable | Dev default | Purpose |
|---|---|---|
| `DATABASE_DRIVER` | `postgres` (`pglite` in Mode A) | Database driver; `pglite` is rejected when `APP_ENV=production` |
| `PGLITE_DATA_DIR` | `memory://` | PGlite data directory (Mode A) |
| `DATABASE_URL` | `postgres://robosim:robosim@localhost:5432/robosim` | PostgreSQL (Mode B) |
| `REDIS_URL` | `redis://localhost:6379` | Valkey |
| `S3_ENDPOINT` / `S3_BUCKET` | `http://localhost:9000` / `robosim-dev` | Object storage |
| `BAO_ADDR` | `http://localhost:8200` | OpenBao (dev mode) |
| `COMPILER_RUNTIME` | `local` (dev) · `gvisor` (staging/prod) | Build sandbox. `local` runs avr-gcc in Linux namespaces on the host ([ADR-022](decisions.md#adr-022--build-service-drives-avr-gcc-directly-linux-namespace-sandbox-for-development)); refused in staging/production |
| `COMPILER_TOOLCHAIN_DIR` / `COMPILER_CACHE_DIR` | `.local/toolchain` / `.local/compiler-cache` | Pinned core + libraries (`pnpm compiler:setup`); content-addressed builds |
| `COMPILER_MAX_CONCURRENCY` · `BUILD_RATE_LIMIT_PER_MIN` | `2` · `20` | Parallel builds per API process; builds per client per minute |
| `PAYMENT_PROVIDER` | `fake` | `fake` simulates success/failure/timeout; `zarinpal_sandbox` in staging |
| `SMS_PROVIDER` / `EMAIL_PROVIDER` | `console` / `smtp` (Mailpit) | Notifications |
| `AI_DEFAULT_PROVIDER` | `ollama` | Server-level default provider in dev |
| `OLLAMA_BASE_URL` | `http://localhost:11434` (native) · `http://host.docker.internal:11434` (from containers under WSL2) | FR-AI-10 |
| `FEATURE_FLAGS_OVERRIDE` | empty | e.g. `collab.realtime=on,blocks=on` |

## 3. Everyday commands

| Command | What it does |
|---|---|
| `pnpm verify` | Everything CI runs: format, i18n, architecture, lint, typecheck, test, build, bundle budget (`pnpm ci` is a pnpm built-in, so the script is named `verify`) |
| `pnpm dev` | Run all apps with hot reload |
| `pnpm dev --filter web` | Run one app (plus its dependencies) |
| `pnpm build` | Build everything (Turborepo cache) |
| `pnpm lint` · `pnpm typecheck` · `pnpm format` | ESLint, `tsc --noEmit`, Prettier |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:int` | Integration tests against real services via Testcontainers (P1; until then DB integration tests run on PGlite inside `pnpm test`) |
| `pnpm test:e2e` | Playwright E2E (EN + FA projects, Chrome + Firefox) |
| `pnpm test:sim` | Simulation conformance + golden traces (Node and browser; browser leg planned) |
| `pnpm golden:update` | Record missing golden traces, or re-record after an `engineVersion` bump (refuses otherwise) |
| `pnpm compiler:setup` | Fetch the pinned Arduino core and libraries (`apps/compiler/toolchain.lock.json`) into `.local/toolchain`; checks avr-gcc |
| `pnpm firmware:gen` | Recompile the Lab demo sketches (`packages/sim-runtime/src/firmware/sketches.ts`) into `generated.ts` |
| `pnpm --filter @robosim/compiler compile <main.ino> [files…]` | Compile a sketch from the command line (diagnostics with explanation keys, `--out firmware.hex`) |
| `pnpm bench` | Performance benchmarks (§17 of Technical Design) |
| `pnpm bundle:check` | Initial-JS budget for web and admin (NFR-PERF-04) |
| `pnpm i18n:check` | Missing/unused keys, ICU syntax, FA/EN parity |
| `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` | Drizzle migrations |
| `pnpm new:component <slug> <type-id> <category> <Class>` · `pnpm new:rule <id>` (planned) · `pnpm new:board <slug>` (planned) | Scaffolders (§8) |
| `pnpm ai:eval` | AI evaluation harness (FR-AI-09) |
| `pnpm arch:check` | dependency-cruiser boundary rules |

## 4. Git workflow

- **Trunk-based** on `main`, short-lived branches: `feat/US-ARN-02-switch-views`, `fix/FR-BLD-03-cache-key`.
- **Conventional Commits** with requirement IDs:
  ```
  feat(arena): keep sim time on 2D/3D switch (FR-ARN-01, US-ARN-02)
  fix(build): include toolchain digest in cache key (FR-BLD-03)
  ```
- PRs: ≤ 400 changed lines where possible; template requires: linked IDs, test evidence, screenshots in **both** FA and EN for UI, migration notes, security checklist for sensitive modules.
- Reviews: 1 approval; **2** for `iam`, `billing`, `entitlements`, `compiler`, `ai` keys, RLS migrations, `sim-core` determinism-affecting changes.
- `main` is always releasable; incomplete features ship behind feature flags.

## 5. Coding standards

### 5.1 TypeScript (all packages)

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- No `any`; if unavoidable, `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>`.
- Prefer discriminated unions and exhaustive `switch` with `assertNever`.
- Validate all external data (HTTP, files, storage, workers, LLM output) with Zod at the boundary.
- Errors: domain errors are typed classes mapped to API problem codes; never throw strings; never swallow errors.
- Comments explain *why*, not *what*.

### 5.2 Frontend

- Components are function components; server state only via TanStack Query; editor state via Zustand stores; no ad-hoc global state.
- Styling with Tailwind **logical utilities only** (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`); lint rule bans `ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`, `text-left`, `text-right`.
- LTR islands (`dir="ltr"`) for code, pin labels, canvas, schematic, numeric technical values; wrap mixed text with `<bdi>`.
- All text through `t('namespace:key')`; numbers/dates via `formatNumber`/`formatDate` helpers (Persian digits + Jalali in FA).
- Accessibility: every interactive element keyboard-reachable with visible focus; ARIA live region announces run status and safety findings; colour is never the only signal.
- Heavy modules (Monaco, Blockly, three.js, board emulators) are lazy-loaded; check bundle size output in CI.

### 5.3 Backend

- Module boundaries per [Technical Design §7.1](Technical-Design.md#71-module-structure); import other modules only through their `index.ts`.
- Controllers are thin: validate → call use case → map result.
- Every mutating use case: authorization check → entitlement check → transaction → outbox event → audit entry (if privileged).
- Queries scoped by workspace; never accept `workspaceId` from the body when the header context exists.
- External providers (payment, SMS, email, AI, tax, shipping, commerce backend) only through interfaces with a `fake` implementation for tests and dev.

### 5.4 Database

- Migrations are forward-only, generated by Drizzle and reviewed by hand; each migration is **backward-compatible with the previous release** (expand → migrate → contract over two releases).
- New tenant table ⇒ `workspace_id`, RLS policy, and an isolation test in the same PR.
- Indexes for every foreign key and every documented filter/sort.
- No JSONB without a Zod schema in `packages/shared`.

### 5.5 Simulation code

- Fixed step only; time passed as parameters; use `dmath` and the seeded PRNG.
- Every component model has: unit tests for its electrical stamp and `step`, a fault test, and (if a product is sold) a calibration test.
- Any change that alters golden traces requires bumping `engineVersion` and a note in the PR explaining the behavioural change.

## 6. Testing strategy

| Level | Tooling | Scope | Gate |
|---|---|---|---|
| Unit | Vitest | Pure logic: sim-core, component models, safety rules, entitlement resolution, pricing/VAT, state machines, schema migrations | Coverage ≥ 80 % lines for `sim-core`, `safety-rules`, `entitlements`, `billing`, `commerce` domain |
| Simulation conformance | Vitest + firmware fixtures (`packages/test-fixtures`) | Peripheral behaviour per board (timers, PWM frequencies, ADC, UART, I²C, SPI, interrupts, EEPROM) | 100 % pass |
| Golden traces | Node + Playwright (Chrome, Firefox) | Fixture projects (line follower, obstacle avoider, sumo…) produce identical traces in grader; browser within tolerance | 100 % pass; change requires `engineVersion` bump |
| Calibration | Vitest | Simulated vs. measured data for sold parts within ± 5 % | Pass for components with calibration data |
| Integration | Vitest + Testcontainers | API modules with real Postgres/Valkey/MinIO; RLS isolation; outbox; build service with real sandbox image | Pass |
| Contract | OpenAPI diff + generated client compile | API backward compatibility within `v1` | No breaking diff |
| E2E | Playwright | User journeys A–F in FA and EN; payment via `fake` and gateway sandbox (staging) | Journeys pass in both locales |
| Visual regression | Playwright screenshots | Key screens and PDF exports in FA/EN, RTL correctness | Reviewed diffs only |
| Accessibility | axe-core in Playwright | All non-canvas screens | No serious/critical violations |
| Performance | Benchmarks + Playwright traces + k6 | Budgets in Technical Design §17; build and API load | Within budget |
| Security | Semgrep, Trivy, secret scan, sandbox escape suite, tenant isolation suite, ZAP baseline (staging) | Per [Security §10](Security-Privacy-Compliance.md#10-secure-development-lifecycle) | No high/critical open |
| LTI | Moodle 4.x container | Launch, deep link, NRPS, AGS | Pass |
| AI | `pnpm ai:eval` | 200+ FA/EN tasks; tutor-mode leakage | No regression > 2 points; leakage ≤ 2 % |

Naming: `describe('FR-ARN-01 world model shared by 2D/3D', …)`, `test('US-ARN-02 AC1 keeps sim time on toggle', …)`.

## 7. CI/CD

```mermaid
flowchart LR
  pr[Pull request] --> s1[Install + cache]
  s1 --> s2[Lint · typecheck · arch check · i18n check]
  s2 --> s3[Unit + sim conformance + golden traces]
  s3 --> s4["Integration (Testcontainers)"]
  s4 --> s5[Build images · SBOM · Trivy · sign]
  s5 --> s6["E2E (FA/EN) · a11y · visual"]
  s6 --> merge[Merge to main]
  merge --> stg[Argo CD → staging]
  stg --> s7[Smoke · k6 · ZAP · payment sandbox]
  s7 --> tag[Release tag]
  tag --> prod["Argo CD → production (progressive 10 % → 50 % → 100 %)"]
```

- CI runners: self-hosted runners in-region (dependencies from Verdaccio/Harbor mirrors) so CI is not blocked by upstream outages.
- Releases: weekly train for SaaS; quarterly LTS for Private Cloud; hotfixes cherry-picked to the LTS branch.
- Rollback: Argo CD revert to previous tag; DB migrations are backward-compatible, so rollback does not require down-migrations.

## 8. Extension recipes

### 8.1 Add a component

1. `pnpm new:component <slug> <type-id> <category> <ModelClass>`, e.g. `pnpm new:component tb6612fng driver.tb6612fng driver Tb6612fng`, creates `packages/components/tb6612fng/` (package `@robosim/component-tb6612fng`) with `src/manifest.json`, `src/model.ts`, `src/model.test.ts`, and `src/index.ts` exporting `definition`. Then run `pnpm install`.
2. Fill in the manifest (`ComponentManifest` in `sim-core/contracts.ts`, checked by `validateManifest`): pins with electrical kinds, `props` with defaults and ranges, user `inputs`, `limits` (abs-max voltages and currents), and mass. *Planned:* mounting footprint, 2D SVG, 3D GLB (Draco, ≤ 300 KB), `calibration.json`, product SKU links.
3. Implement `model.ts`: `stamp` (MNA elements), `step` (read the operating point, `io.pwm()`, `io.edges()`), `faults`, `snapshot`, and `input` if users interact with it. Keep stamps pure: with PWM present the scheduler stamps several times per solve.
4. Write tests with `bench()` from `@robosim/test-fixtures` (wiring is `part.pin`, plus `dcSupply`/`fixedResistor` helpers). Cover the manifest, the electrical behaviour against hand calculations, and each fault. Component packages never import each other, not even in tests. Multi-component scenarios go in `packages/catalog`.
5. Add the name key `components:<type-id>.name` in `packages/i18n/locales/{en,fa}/components.json`.
6. Register the definition in `packages/catalog/src/index.ts`. The catalog tests then check the manifest, uniqueness, and the FA/EN names.
7. Run `pnpm verify`. `pnpm arch:check` enforces that the component depends only on `sim-core`/`shared`.

### 8.2 Add a safety rule

`pnpm new:rule SAF-I2C-NO-PULLUP` → implement `check()`, add `fixtures/triggers.json` and `fixtures/clean.json`, messages with *why* and *how to fix* in FA/EN, a learning article slug. Generic rules are preferred over component-specific rules.

### 8.3 Add a board

`pnpm new:board rp2040-pico` → implement `Board` (emulator adapter, pin map with capabilities, power tree, FQBN, upload protocol), add the core to the compiler image (pinned version), add peripheral conformance fixtures, and register it in `boards.allowed` plan configuration.

### 8.4 Add an arena or guided project

Prefer the admin CMS. For built-in content, add JSON + assets under `packages/content/` validated by the content schema; arenas need a floor texture (PNG, 1 px = 1 mm, ≤ 4096²) and checkpoints for lap counting.

### 8.5 Add an external provider (payment, SMS, AI, shipping, tax)

Implement the interface in the owning module's `infra/`, add a `fake` behaviour test suite shared by all implementations (contract tests), configuration via OpenBao secrets, and — for AI providers — the legal approval flag before enablement ([ADR-009](decisions.md#adr-009--platform-hosted-open-weight-models-as-the-default-ai)).

### 8.6 Add an API endpoint

Define request/response Zod schemas in `packages/shared/api`, add the controller in the module's `http/`, the use case in `application/`, permission and entitlement decorators, tests (unit + integration), and regenerate the client (`pnpm api:generate`). Update [API-Spec §4](API-Spec.md#4-endpoint-inventory) in the same PR.

## 9. Feature flags and configuration

- Flags are created with an owner and removal date; flags older than 90 days after 100 % rollout fail CI (`tools/flags-audit`).
- Configuration precedence: defaults in code → Helm values → environment → OpenBao secrets; no environment-specific code paths except via configuration.

## 10. Definition of Done

A story is done when **all** of the following are true:

- [ ] Acceptance criteria implemented and covered by automated tests named with the story ID.
- [ ] Works in FA (RTL) and EN (LTR); i18n check passes; screenshots of both in the PR for UI changes.
- [ ] Permissions, entitlements, org policies, and age-band rules enforced server-side and tested.
- [ ] Accessibility: keyboard path works; axe has no serious/critical issues.
- [ ] Performance budgets unaffected (bench/bundle checks pass).
- [ ] Observability: logs with correlation IDs, metrics for new endpoints/jobs, errors reported.
- [ ] Security checklist completed for sensitive modules; no secrets or PII in logs.
- [ ] Docs updated in the same PR: PRD/User Stories (if behaviour changed), API Spec (if contract changed), Technical Design or ADR (if architecture changed).
- [ ] Feature flag in place if the feature is not complete for users.
- [ ] Reviewed and merged with green CI; deployed to staging and smoke-tested.

## 11. Rules for AI coding agents

AI agents follow everything above, plus:

1. **Read before writing.** Start each task by reading the referenced `FR-*`/`US-*` entries, the relevant Technical Design section, and existing code in the target package.
2. **Stay inside the task's package boundaries.** If a change requires editing another module's internals, stop and propose an interface change instead.
3. **Tests first** for domain logic, sim models, safety rules, entitlements, and billing: write the failing test from the acceptance criteria, then implement.
4. **Never weaken a gate** (tests, lint, coverage, arch rules, security checks, i18n checks) to make CI pass.
5. **Never add dependencies** without stating why in the PR, checking licence compatibility, and confirming the package can be mirrored (no runtime CDN, no telemetry).
6. **Never invent API fields, entitlement keys, error codes, or table columns**; use those defined in API Spec / Technical Design, or add them there in the same PR.
7. **Determinism-sensitive code** (`sim-core`, boards, components): no `Math.random`, `Date.now`, `performance.now`, `Math.sin`-family, or iteration over unordered collections.
8. **Record assumptions** in [decisions.md](decisions.md) (new ADR, status *Proposed*) when a requirement is ambiguous, and continue with the simplest compliant option.
9. **Scripts must work in WSL2** (bash, no macOS-only tools); paths case-sensitive.
10. **Commit messages** follow §4 and reference requirement IDs.
