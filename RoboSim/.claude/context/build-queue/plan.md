# Plan — build queue + SSE (TD §6 async half; API Spec §4.5)

Goal: `POST /builds` answers `200 BuildResult` on a cache hit, otherwise `202 {buildId, position}`; jobs run through a
fair-share queue; progress streams over SSE; per-user scoping, daily quota; the editor and Lab show queue status.

## Steps
- [x] 1. Shared: `buildAcceptedSchema`, `buildStatusSchema` (GET /builds/:id), `buildEventSchema` (SSE), constants.
- [x] 2. Compiler: `cached(request)` lookup without compiling.
- [x] 3. API ports + in-process adapters: `BuildQueue` (DRR per workspace, weight `build.priority`, per-user
      concurrency 2, global slots, positions, retry once on crash, job TTL), `ArtifactStore` (FS, content-addressed),
      `BuildQuota` (daily, UTC day). Unit tests (pure, injected runner + clock).
- [x] 4. API HTTP: POST 200/202 + Location, idempotency stores {status, body}, per-caller rate limit (guest 5/min),
      quota 429 `build_quota_exceeded` + Retry-After, GET /builds/:id (owner-scoped, else 404),
      GET /builds/:id/events (SSE: id/event/data, snapshot first, heartbeat, close on terminal), auto-version on success.
      Env: BUILD_DAILY_QUOTA, BUILD_USER_CONCURRENCY, BUILD_GUEST_RATE_LIMIT_PER_MIN, ARTIFACT_STORE_DIR, BUILD_JOB_TTL.
- [x] 5. Web: build client (POST → 200 | 202 → EventSource, polling fallback, AbortSignal), progress in BuildState,
      editor status bar + Lab panel "Queued #n / Compiling" FA/EN.
- [x] 6. Docs: TD §6, API-Spec §4.5, Release Plan, EG env table, .env.example, README if needed.
- [x] 7. `pnpm verify`; browser check (FA) of queued → running → done.

## Acceptance
- Cache hit → 200; miss → 202 then SSE `queued{position}` → `running` → `succeeded{result}` / `failed{result}`.
- Two workspaces flooding the queue are served round-robin; a user never has > 2 running builds.
- Quota exhaustion → 429 `build_quota_exceeded` with `params.limit/resetAt`; cache hits don't count.
- Another user cannot read someone's build (404).
