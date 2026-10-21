# Plan — project sharing (FR-PRJ-04 minus org policy; US-PRJ-03; API Spec §4.4 shares/share-link/shared/remix)

Goal: owners share a project by read-only link (optionally remixable) and with specific users as viewer or
editor; recipients find it under "Shared with me"; link visitors run it in a read-only editor and can remix.

Acceptance:
- Migration 0004: `project_shares` (TD §8.4: project_id, principal_kind, principal_id, role, workspace_id,
  created_by, created_at); `projects` + share_link_nonce, share_token_hash (unique), link_remixable,
  remixed_from_id / _name / _author. RLS: sharees SELECT (view/edit), UPDATE (edit, not deleted);
  versions SELECT (sharees) / INSERT (edit); shares visible to owner workspace and to the principal.
- Link token = HMAC-SHA256(SHARE_LINK_SECRET, id.nonce), only SHA-256 stored; regenerate = new nonce;
  secret required (non-default) in staging/production.
- API: `GET /projects/:id/shares`, `PUT /projects/:id/shares` {email, role}, `DELETE /projects/:id/shares/:userId`
  (owner, or the sharee leaving), `POST /projects/:id/share-link` {remixable, regenerate?}, `DELETE …/share-link`,
  `GET /projects/shared`, `GET /shared/:token` (pub), `POST /shared/:token/remix` (ses).
  Project responses carry `access` (owner|edit|view), `ownerName`, `remixedFrom`. Editors: save/rename/versions;
  viewers: read, versions read, duplicate (= copy with attribution). Owner-only: delete/restore/tags/sharing.
  Share notifies the recipient by email (FA/EN). Audit every sharing change.
- Web: Share dialog in the editor (owner): link on/off, remixable, copy, regenerate; people by email with role,
  change/remove. Projects page: "My projects" | "Shared with me". `/s/$token`: read-only editor with banner
  (owner, Remix → sign-in if needed). View-role cloud projects open read-only with "Make a copy".
  Read-only workspace: canvas view mode, no parts/properties, code read-only, no autosave/save/import/demos.
- i18n en+fa, docs (API-Spec, TD, Security §4.3 note, EG env, Release Plan, README), verify green, FA browser check.

Steps:
- [x] 1 Shared contracts (sharing schemas, Project access fields) + tests
- [x] 2 Migration 0004 + schema + RLS
- [x] 3 Service: access levels in ProjectsService, SharingService (shares, link, shared-with-me, open/remix), mail
- [x] 4 Controllers + HTTP/RLS tests
- [x] 5 Web: client, read-only workspace, share dialog, shared-with-me, /s/$token; tests
- [x] 6 i18n, docs, verify, browser check
