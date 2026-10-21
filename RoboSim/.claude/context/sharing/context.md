# Context — sharing

Status: DONE 2026-10-21. Uncommitted — user commits (auth committed as 208b14f). verify green 275/275; API 140 tests,
web 112; FA browser check passed (share dialog, shared-with-me, viewer read-only, guest link + run, remix, regenerate).

User decisions (2026-10-21): login is enough (no TOTP/SMS now); sharing scope = link + people (viewer/editor),
no comment role, no org policy; link visitors get the read-only editor (not a separate viewer page).

Design decisions:
- Cross-workspace access via extra RLS policies (defence in depth, ADR-007) + service-level access checks.
- Link token derivable by the server (HMAC of id + nonce) so the owner can copy it again; DB stores only SHA-256.
- Invites only to existing accounts (`404 not_found {field: email}`); invitations for unknown emails later.
- `principal_kind` kept (TD) but only `user` is used now.

Follow-ups: comment role (P4), workspace/org sharing + policy (P3), invitations for unknown emails, real-time co-edit.
