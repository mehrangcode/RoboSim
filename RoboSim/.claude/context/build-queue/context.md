# Context — build queue + SSE

Status: DONE 2026-10-21. Uncommitted — user commits.

User decisions (2026-10-21): slice = build queue + SSE; in-process queue + FS artifact store behind ports (Redis/S3
adapters with the deployment track); web consumes SSE with status UI + polling fallback; quotas from env defaults
(no plan entitlements yet; boards.allowed = schema enum `avr-uno`).

## State
- All steps done. `pnpm verify` green (275 tasks, bundle 276/300 KB). New tests: shared 2, compiler 1, API queue/quota/store
  10 + HTTP 16 (rewritten for 202/SSE, quota, scoping, guests, auto-version both paths), web client 6 + editor 1.
- Browser check (Chromium, FA, Vite proxy, API with COMPILER_MAX_CONCURRENCY=1, 5 background builds of another user):
  editor showed «در صف، نوبت ۲» then ran the firmware; SSE 200 text/event-stream through the proxy; no page errors.

## Decisions
- `202` body = `BuildStatus` + statusUrl/eventsUrl (job may already be `running`), plus `Location`.
- SSE: event name = state, data = full `BuildStatus`, id = job seq; every connection starts with a snapshot (resume
  without replay buffer); 15 s heartbeat; close after terminal. `error` state shares the EventSource `error` event name —
  client tells them apart by `MessageEvent.data`.
- DRR positions are a simulation of dispatch order ignoring per-user caps (estimate). Runner crash retried once;
  `compiler_unavailable` not retried. Finished jobs readable 1 h; jobs in memory only.
- Artifacts copied from compiler cache into `ARTIFACT_STORE_DIR` (default `.local/artifacts`) before results publish.
- Guests (no dev identity): scoped `guest:<ip>`, 5/min. Quota counts queued builds only, UTC day.

## Follow-ups
- Redis/S3 adapters + shared rate/quota/idempotency store (deployment track); cancellation; per-IP limit for users.
