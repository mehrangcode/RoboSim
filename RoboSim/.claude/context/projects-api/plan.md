# Plan — server projects API (P1 open item from slice 11; FR-PRJ-01/02/03 thin, API-Spec §4.4)

Goal: projects live on the server (Postgres, RLS per workspace) and the editor is cloud-first with a local cache.

Acceptance:
- Shared contracts in `packages/shared` (request/response Zod, ETag helpers, limits).
- Tables `projects` + `project_versions` (TD §8.4 subset), RLS on workspace, migration 0002.
- Dev identity guard: seeded dev user + personal workspace, `X-Workspace-Id` honoured, refused in production.
- Endpoints: `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `POST /projects/:id/restore`, `POST /projects/:id/duplicate`,
  `PUT /projects/:id/document` (If-Match → 412, ≤ 1 MiB → 413, schema-validated), `GET/POST /projects/:id/versions`,
  `GET /projects/:id/versions/:vid`, `POST /projects/:id/versions/:vid/restore`; auto snapshot on successful build with `projectId`.
- Editor: `/projects` page (list/search/sort, new, open, rename, duplicate, delete+undo); `/editor/:id` loads from server, autosave 30 s + Ctrl+S, localStorage cache, 412 → reload/overwrite dialog; versions panel (checkpoint, restore). Demos/import still work.
- i18n en+fa, docs (TD/API-Spec/Release Plan/README/EG), `pnpm verify` green, browser check FA.

Steps:
- [x] 1 Shared contracts + tests
- [x] 2 DB schema + migration 0002 (RLS) + dev identity guard/seed
- [x] 3 Projects service/controller + HTTP/RLS tests
- [x] 4 Versions + build auto-snapshot + tests
- [x] 5 Web API client (put/patch/delete, ETag) + /projects page
- [x] 6 Editor cloud-first save/load, conflict dialog, versions panel; tests
- [x] 7 i18n, docs, verify, browser check
