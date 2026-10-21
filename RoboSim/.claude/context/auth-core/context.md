# Context — auth-core

Status: DONE 2026-10-21. Uncommitted — user commits. verify green (275/275, bundle 284 KB gz); API 125 tests, web 103;
browser check FA passed (register → dev mail verify → 2 devices → revoke → gate → sign-in redirect → reset → new password).

User decisions (2026-10-21): skip 3D (slice 17) for now; scope = core + recovery (no TOTP, no SMS OTP, no guardian
consent); dev mail sink (Mailer port, in-memory, /dev/mail page); dev identity → opt-in fallback (off by default).

Design decisions:
- argon2id from `node:crypto` (Node ≥ 24.7) — no native dep; engines bumped.
- Cookies parsed/serialised by hand (two cookies only) — no @fastify/cookie.
- Login allowed with unverified email (banner + resend); verification required later for commerce.
- 13–15 self-signup keeps `pending_consent` status (existing rules); consent flow deferred — UI shows a notice.
- Breached-password check: small embedded deny list now; k-anonymity list with deployment track.

Open: projects-API review findings from S485 — unverified whether fixed.

Docs fixed in passing: API-Spec §4.4 had the "Implemented" note splitting the projects table (wiring-guide row moved up).
Follow-ups: SMS OTP, TOTP, guardian consent, SMTP adapter, breached-password list, Jalali DOB picker, /me/workspaces.
