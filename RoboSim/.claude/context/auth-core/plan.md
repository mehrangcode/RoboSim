# Plan — authentication core + recovery (FR-IAM-01 email half, FR-IAM-03; API Spec §2, §4.1; Security §5)

Goal: real users sign up, log in and out with email + password over cookie sessions; verify email, reset password,
see and revoke sessions. The dev identity becomes opt-in.

Acceptance:
- Shared contracts (`packages/shared/src/auth-api.ts`): register/login/me/session/reset/verify schemas, password policy.
- Migration 0003: `sessions`, `auth_tokens` (TD §8 subset) + login-failure columns on `users`; RLS/grants like 0001.
- argon2id via `node:crypto` (m=64 MiB, t=3, p=1, Security §7); small offline common-password deny list.
- Sessions: opaque 256-bit token in `__Host-rs_sid` (HttpOnly, Secure, SameSite=Lax, path /), SHA-256 hash stored,
  30 days idle, rotated on login and password change; revoke one/all; revoked session → 401 on next request (US-IAM-02 AC2).
- CSRF: double-submit — `GET /auth/csrf` sets `__Host-rs_csrf` + returns token; unsafe requests that carry a session
  cookie, and every unsafe `/auth/*` request, need a matching `X-CSRF-Token` (403 `csrf_failed` otherwise).
- Throttling: auth endpoints 10/min per IP (429 + Retry-After); 5 failed logins → account locked 15 min; generic
  `invalid_credentials` (no account enumeration); reset request always answers 202.
- Endpoints: `GET /auth/csrf`, `POST /auth/register|login|logout`, `POST /auth/email/verify`, `POST /auth/email/resend`,
  `POST /auth/password-reset/request|confirm`, `GET/PATCH /me`, `GET /me/sessions`, `DELETE /me/sessions/:id`,
  `DELETE /me/sessions`, `POST /me/password`.
- Mailer port; dev sink keeps messages in memory and serves `GET /dev/mail` (local/test only); templates FA/EN.
- CallerGuard: session first, then dev identity only if `DEV_IDENTITY=true` (now default off; tests set it).
- Web: /login, /register, /forgot-password, /reset-password, /verify-email, /account (profile, password, sessions),
  /dev/mail; shell user menu; CSRF in api client; 401 on /projects and the editor → login with return path.
- i18n en+fa, docs (TD/API-Spec/Security/EG/Release Plan/README/.env.example), `pnpm verify` green, browser check FA.

Steps:
- [x] 1 Shared contracts + tests
- [x] 2 Migration 0003 + schema + password hashing/policy + tests
- [x] 3 Sessions, CSRF hook, CallerGuard, dev identity opt-in; tests
- [x] 4 Auth controller/service (register/login/logout/verify/reset/me/sessions), mailer + dev sink; HTTP tests
- [x] 5 Web: api client CSRF, auth context, pages, shell menu, 401 redirects; tests
- [x] 6 i18n, docs, verify, browser check
