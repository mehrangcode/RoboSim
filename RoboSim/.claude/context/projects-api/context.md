# Context — server projects API

Status: DONE 2026-10-21. Uncommitted — user commits.

User decisions (2026-10-21): dev identity (seeded dev user, guard disabled in production); scope = core + versions
(+ auto snapshot on build); editor cloud-first + local cache with /projects page; size limits only (no plan quotas).

## Notes
- API: NestJS 12 + Fastify, prefix api/v1, body limit 1 MiB global, onSend sets cache-control no-store.
- RLS via `withScope(db,{userId,workspaceId},fn)`; pattern in drizzle/migrations/0001_rls.sql. Tests use PGlite + real migrations.
- Errors: throw `DomainError(code, params)`; codes conflict/precondition_failed/payload_too_large/not_found/validation_failed exist.
- Web: TanStack Router + Query; `lib/api.ts` has apiGet/apiPost only; editor store `editor/project-store.ts` (localStorage).

## State
- Steps 1–6 DONE: API 83 tests, web 81 tests (new: editor-cloud 10, projects-page 5), lint/typecheck/format clean.
- Step 7: docs updated (TD §3 editor-state row + §8.4 note, API-Spec §2 dev identity + §4.4 implemented, Release Plan block, README, EG §2.3/§5.4). pnpm verify green (275 tasks, bundle 276/300 KB). Browser check FA in Chromium (Playwright script): new project → Ctrl+S → Run (real build → auto version #1) → checkpoint #2 → 2-tab conflict → keep mine → delete + undo; no page errors. Local PGlite now holds one test project of learner@dev.local.

## Decisions
- Working copy on `projects.document` + `revision` (ETag `"r<n>"`, If-Match required on PUT/PATCH/version-restore → 412; DELETE If-Match optional). Versions = immutable snapshots (deviation from TD current_version_id; document in TD).
- Project name ≡ document.meta.title (PUT sets name from title; PATCH name rewrites title). Identical save = no-op (same revision).
- Timestamps set from JS Date (ms) so keyset cursors (base64url [value,id]) are exact.
- Dev identity: `CallerGuard` (iam/caller.guard.ts), env DEV_IDENTITY (default on for APP_ENV local/test, refused staging/prod), DEV_IDENTITY_EMAIL default learner@dev.local, X-Dev-User override, auto-provisions user. X-Workspace-Id checked against listMine → 403.
- Auto build snapshot: build controller → `snapshotBuild` only when built files == saved code; dedup by sha; never throws.
- Limits: doc ≤ 1 MiB (413), ≤ 500 versions (quota_exceeded; restore forced), trash 30 days (no purge job yet).
- Web: `useCloudSync` (editor/use-cloud-sync.ts) — draft key `robosim.editor.cloud.v1.<id>` {document, baseRevision}; open reconciles draft vs server (same base → draft; older base → conflict dialog 'draft'); 412 → conflict 'saved'. Latest-values ref updated in useLayoutEffect (lint forbids ref writes in render).
- EditorPage = wrapper (useParams projectId) → CloudWorkspace (loads) → Workspace (old body). Cloud Run wraps compileSketch: flush save, add projectId.
- Client `projectsApi(() => i18n.language)` (locale getter; injectable `projects` prop for tests; FakeProjects in src/testing).
