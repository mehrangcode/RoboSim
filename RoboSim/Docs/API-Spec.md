# RoboSim — API Specification

**Version:** 1.0 (API `v1`) · **Date:** 2026-10-13 · **Owner:** Backend lead
**Related:** [Technical Design](Technical-Design.md) · [Security](Security-Privacy-Compliance.md) · [PRD](PRD.md)

This document defines the contract style and the endpoint inventory. The **machine-readable source of truth** is the OpenAPI 3.1 document generated from the Zod schemas in `packages/shared/api` (`/api/v1/openapi.json`); CI fails if the generated spec and this inventory diverge in paths or methods.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `https://<host>/api/v1` (SaaS host TBD, Q-1) |
| Format | JSON (`application/json; charset=utf-8`); field names `camelCase`; enums `snake_case` strings |
| IDs | UUIDv7 strings; public human numbers for orders (`RS-140507-000123`) and invoices |
| Time | ISO 8601 UTC (`2026-10-13T08:30:00Z`); clients render Jalali/Gregorian |
| Money | Integer IRR in fields suffixed `Irr` (`priceIrr: 12500000`) |
| Localization | `Accept-Language: fa` or `en` selects message language for errors and localized fields; content endpoints return both locales when `?locales=all` |
| Workspace scope | Tenant-scoped endpoints require `X-Workspace-Id`; the server validates membership and sets RLS context |
| Pagination | Cursor-based: `?limit=50&cursor=<opaque>` → `{ "items": [...], "nextCursor": "…" \| null }`; max `limit` 200 |
| Filtering/sorting | `?filter[status]=active&sort=-createdAt` on list endpoints that document them |
| Idempotency | `Idempotency-Key: <uuid>` **required** on `POST` for payments, orders, submissions, builds; optional elsewhere; keys retained 24 h; replay returns the original response |
| Concurrency | Mutable resources return `ETag`; `PUT`/`PATCH` require `If-Match` → `412 precondition_failed` on mismatch |
| Versioning | URL major version; additive changes only within `v1`; deprecations announced with `Deprecation` and `Sunset` headers ≥ 6 months ahead |
| Streaming | Server-Sent Events (`text/event-stream`) for build progress, export progress, and AI chat |
| Rate limits | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers; `429` with `Retry-After` |
| Tracing | `traceparent` accepted; every response has `X-Request-Id` |

## 2. Authentication and authorization

| Client | Mechanism |
|---|---|
| Web / admin SPAs | Session cookie `__Host-rs_sid` (HttpOnly, Secure, SameSite=Lax, path `/`); CSRF token from `GET /auth/csrf` sent as `X-CSRF-Token` on all unsafe methods |
| SCIM clients | `Authorization: Bearer <scim token>` scoped to one organization |
| LTI platforms | OIDC login + signed `id_token` (JWT, RS256) per LTI 1.3; service calls to the platform use OAuth2 client credentials with the tool's private key |
| Webhook consumers | HMAC-SHA256 signature header (§8) |
| Internal services | mTLS inside the cluster + service tokens; never exposed through ingress |

Admin endpoints live under `/api/v1/admin/*` on the admin origin only, require a platform staff role and MFA (`mfa_level ≥ 2`), and are rejected from the public origin.

## 3. Errors

All errors use RFC 9457 Problem Details:

```json
{
  "type": "https://docs.robosim.example/errors/entitlement_required",
  "title": "This feature requires a higher plan",
  "status": 403,
  "code": "entitlement_required",
  "detail": "PDF export is available on the Maker plan and above.",
  "instance": "/api/v1/exports",
  "requestId": "01J9Z…",
  "params": { "entitlement": "export.pdf", "suggestedPlan": "maker" }
}
```

`title`/`detail` are localized by `Accept-Language`; clients must branch on `code`, never on text.

### 3.1 Error code catalogue

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `validation_failed` | Body/query invalid; `params.errors[]` with JSON pointers |
| 401 | `unauthenticated` | No/expired session |
| 401 | `mfa_required` | Step-up MFA needed |
| 403 | `forbidden` | Role/ownership/policy denies the action |
| 403 | `entitlement_required` | Plan does not include the feature (`params.entitlement`, `params.suggestedPlan`) |
| 403 | `quota_exceeded` | Count quota reached (`params.quota`, `params.limit`) |
| 403 | `policy_restricted` | Org policy or age-band restriction (`params.policy`) |
| 403 | `consent_pending` | Minor account awaiting guardian consent |
| 404 | `not_found` | Resource absent or not visible to caller |
| 409 | `conflict` | State conflict (e.g. duplicate slug, order not in a cancellable state) |
| 409 | `idempotency_conflict` | Same key reused with a different body |
| 410 | `gone` | Expired token/link |
| 412 | `precondition_failed` | `If-Match` mismatch |
| 413 | `payload_too_large` | Size limits (e.g. build sources > 100 KB) |
| 422 | `safety_errors_present` | Action blocked by unresolved safety Errors (`params.findings[]`) |
| 422 | `build_failed` | Compile failed (diagnostics attached) — returned in build results, not as transport error |
| 429 | `rate_limited` | Request rate exceeded |
| 429 | `build_quota_exceeded` | Daily build quota exceeded (`params.resetAt`) |
| 429 | `ai_credits_exhausted` | Platform AI credits used up |
| 502 | `provider_error` | Payment/AI/SMS provider failure (`params.provider`) |
| 503 | `maintenance` | Planned maintenance (`Retry-After`) |
| 500 | `internal_error` | Unexpected; includes `requestId` |

## 4. Endpoint inventory

Legend: **Auth** — `pub` public, `ses` session, `ws` session + `X-Workspace-Id`, `adm` platform staff, `scim`, `lti`. **Ent** — entitlement/quota checked.

### 4.1 Identity (IAM)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /auth/csrf` | pub | Issue CSRF token |
| `POST /auth/register` | pub | Email+password or phone sign-up (`dateOfBirth`, `locale`, guardian contact if minor) |
| `POST /auth/otp/request` · `POST /auth/otp/verify` | pub | SMS OTP login/sign-up |
| `POST /auth/login` | pub | Email/phone + password; returns `mfa_required` when applicable |
| `POST /auth/mfa/verify` | pub* | Complete MFA (TOTP/WebAuthn/recovery) |
| `POST /auth/logout` | ses | End current session |
| `POST /auth/password-reset/request` · `/confirm` | pub | Reset flow |
| `POST /auth/email/verify` | pub | Verify email token |
| `GET /auth/sso/discover?email=` | pub | Find enforced SSO for a domain |
| `GET /auth/sso/:connectionId/start` · `POST /auth/sso/:connectionId/callback` | pub | OIDC/SAML login |
| `POST /auth/guardian-consent/:token` | pub | Guardian grants/denies consent |
| `GET /me` · `PATCH /me` | ses | Profile, locale, preferences |
| `GET /me/workspaces` | ses | Personal + org workspaces with roles |
| `GET /me/sessions` · `DELETE /me/sessions/:id` · `DELETE /me/sessions` | ses | Session management |
| `GET /me/mfa` · `POST /me/mfa/totp` · `POST /me/mfa/webauthn/register` · `DELETE /me/mfa/:id` | ses | MFA factors |
| `POST /me/data-export` · `POST /me/deletion` · `DELETE /me/deletion` | ses | Data export; schedule/cancel deletion |
| `GET /me/entitlements` | ws | Effective entitlements and remaining quotas |
| `GET /me/owned-parts` · `PUT /me/owned-parts` | ses | "I already own" inventory |

### 4.2 Organizations (ORG)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /orgs` | ses | Create organization (starts pilot) |
| `GET /orgs/:id` · `PATCH /orgs/:id` · `DELETE /orgs/:id` | ws | Profile; delete requires `org_owner` + MFA |
| `GET /orgs/:id/members` · `PATCH /orgs/:id/members/:userId` · `DELETE …` | ws | List, change role/seat/branch, deactivate |
| `POST /orgs/:id/invitations` · `POST /orgs/:id/invitations/bulk` (CSV) · `DELETE /orgs/:id/invitations/:invId` | ws | Invitations |
| `POST /invitations/:token/accept` | ses | Accept invitation |
| `GET/POST/PATCH/DELETE /orgs/:id/groups[/:groupId]` | ws | Groups |
| `GET/POST /orgs/:id/branches` | ws | Sub-units |
| `GET/POST /orgs/:id/domains` · `POST /orgs/:id/domains/:domainId/verify` | ws | Domain verification (DNS TXT) |
| `GET/PUT /orgs/:id/sso` | ws | SSO connection config (Institution) |
| `POST /orgs/:id/scim-tokens` · `DELETE …/:tokenId` | ws | SCIM tokens |
| `GET/PUT /orgs/:id/policies` | ws | Org policies (versioned, `If-Match`) |
| `GET /orgs/:id/seats` | ws | Seat usage |
| SCIM 2.0: `/scim/v2/Users`, `/scim/v2/Groups`, `/scim/v2/ServiceProviderConfig`, `/scim/v2/Schemas`, `/scim/v2/ResourceTypes` | scim | RFC 7643/7644 provisioning |

### 4.3 Catalogue & content (EXT, LRN content)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /boards` | pub | Boards available (with `allowed` flag per entitlements when authenticated) |
| `GET /components?category=&q=&board=` | pub | Component catalogue (manifests without heavy assets) |
| `GET /components/:id/versions/:version` | pub | Full manifest |
| `GET /libraries?board=` | pub | Allow-listed libraries |
| `GET /arenas` · `GET /arenas/:id` | pub/ws | Platform + workspace arenas |
| `POST /arenas` · `PUT /arenas/:id` · `DELETE /arenas/:id` | ws | Custom arenas (**Ent** `arena.custom`) |
| `GET /guided-projects` · `GET /guided-projects/:slug` | pub | Guided projects (gated content returns teaser + `entitlement_required` for full body) |
| `GET /courses` · `GET /courses/:slug` · `POST /courses/:slug/enroll` | pub/ses | Courses |
| `PUT /progress/guided/:contentVersionId` · `PUT /progress/lessons/:lessonId` | ws | Progress |
| `GET /certificates/:code` | pub | Verify certificate |

### 4.4 Projects (PRJ)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /projects?q=&tag=&sort=` | ws | List workspace projects |
| `POST /projects` | ws | Create (blank / template / guided) — **Ent** `projects.cloud_max` |
| `GET /projects/:id` | ws/share | Project with current version document |
| `PATCH /projects/:id` | ws | Rename, tags, visibility (`If-Match`) |
| `PUT /projects/:id/document` | ws | Save current document (`If-Match`); validates schema, components tier, org policy |
| `DELETE /projects/:id` · `POST /projects/:id/restore` | ws | Soft delete / restore |
| `POST /projects/:id/duplicate` · `POST /projects/:id/move` | ws | Duplicate; move between own workspaces (policy) |
| `GET /projects/:id/versions` · `POST /projects/:id/versions` | ws | List; create named checkpoint |
| `GET /projects/:id/versions/:vid` · `GET /projects/:id/versions/:a/diff/:b` | ws | Version, diff |
| `POST /projects/:id/versions/:vid/restore` | ws | Restore (creates new version) |
| `GET/PUT/DELETE /projects/:id/shares[/:principal]` · `POST /projects/:id/share-link` | ws | Sharing |
| `GET /shared/:token` | pub | Open link-shared project (read-only) |
| `POST /projects/:id/remix` | ws | Remix a shared/public project |
| `GET/POST /projects/:id/comments` · `PATCH/DELETE …/:commentId` | ws | Comments |
| `POST /projects/import` (multipart `.robosim`) · `GET /projects/:id/export.robosim` | ws | Import/export |
| `GET /projects/:id/bom` | ws | BOM (prices/stock as of now) |
| `GET /projects/:id/wiring-guide` | ws | Wiring guide (JSON) |

### 4.5 Builds (BLD)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /builds` | ws/guest | Body `BuildRequest` → `200 BuildResult` (cache hit) or `202 {buildId}` — **Ent** `boards.allowed`, `build.daily_quota` |
| `GET /builds/:id` | ws | Status/result |
| `GET /builds/:id/events` | ws | SSE: `queued{position}`, `running`, `succeeded{result}`, `failed{diagnostics}` |
| `GET /artifacts/:id` | ws | Signed redirect to firmware (HEX/UF2) |

```ts
type BuildRequest = {
  board: string;                                   // 'avr-uno'
  files: Array<{ name: string; content: string }>; // ≤ 20 files, ≤ 100 KB total
  libraries: Array<{ name: string; version: string }>;
  projectId?: string;                              // links build to project versions
};
type BuildResult = {
  buildId: string; status: 'succeeded' | 'failed'; cacheHit: boolean;
  artifact?: { id: string; format: 'ihex' | 'uf2'; sha256: string; sizeBytes: number; flashPct: number; ramPct: number; url: string };
  diagnostics: Array<{ file: string; line: number; column: number; severity: 'error' | 'warning' | 'note';
                       message: string; explanationKey?: string }>;
  durationMs: number;
};
```

### 4.6 Learning (LRN) and grading

| Method & path | Auth | Purpose |
|---|---|---|
| `GET/POST /classes` · `GET/PATCH/DELETE /classes/:id` | ws | Classes (**Ent** `org.classes`) |
| `POST /classes/:id/join-code` · `POST /classes/join` `{code}` | ws | Join codes |
| `GET/POST/DELETE /classes/:id/members` · `POST /classes/:id/roster` (CSV) | ws | Roster |
| `GET/POST /classes/:id/assignments` · `GET/PATCH/DELETE /assignments/:id` · `POST /assignments/:id/publish` | ws | Assignments |
| `POST /assignments/:id/start` | ws | Create the student's working project from the template |
| `POST /assignments/:id/submissions` | ws | Submit current project version (`Idempotency-Key`) → triggers verified run |
| `GET /assignments/:id/submissions` · `GET /submissions/:id` | ws | Teacher list / detail |
| `PATCH /submissions/:id` | ws | Rubric marks, feedback (teacher) |
| `POST /assignments/:id/release` · `POST /submissions/:id/regrade` | ws | Release grades; regrade |
| `GET /classes/:id/gradebook` · `GET /classes/:id/gradebook.xlsx` | ws | Gradebook |
| `GET /classes/:id/live` | ws | SSE live dashboard |
| `POST /verified-runs` · `GET /verified-runs/:id` · `GET /verified-runs/:id/replay` | ws | Manual verified run (**Ent** `org.verified_grading`); result; replay data |

### 4.7 LTI 1.3

| Method & path | Auth | Purpose |
|---|---|---|
| `GET/POST /lti/login` | lti | OIDC third-party initiated login |
| `POST /lti/launch` | lti | Resource link / deep linking launch (`id_token`) |
| `POST /lti/deep-link/response` | ses | Return selected assignment to the platform |
| `GET /lti/jwks` | pub | Tool public keys |
| `GET/POST /orgs/:id/lti-platforms` | ws | Register Moodle platform (**Ent** `org.lti`) |

### 4.8 Community (CMY)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /gallery?q=&tag=&sort=` · `GET /gallery/:id` | pub | Browse |
| `POST /gallery` · `PATCH/DELETE /gallery/:id` | ws | Publish (**Ent** `community.publish`, policy) |
| `POST/DELETE /gallery/:id/like` · `POST/DELETE /users/:id/follow` | ses | Social |
| `GET/POST /gallery/:id/comments` | ses | Public comments (adults or org-allowed) |
| `POST /reports` | ses | Report content |
| `GET /competitions` · `GET /competitions/:id` · `GET /competitions/:id/leaderboard` | pub | Competitions |
| `POST /competitions` · `PATCH /competitions/:id` · `POST /competitions/:id/freeze` | ws | Organizer |
| `POST /competitions/:id/entries` | ws | Submit entry (`Idempotency-Key`) |

### 4.9 Billing (BIL)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /plans` | pub | Public plans and prices |
| `GET /billing/subscription` | ws | Current subscription |
| `POST /billing/checkout` | ws | Start payment for plan/seats/wallet/addon (`Idempotency-Key`) → `{redirectUrl, paymentId}` |
| `GET /billing/callback/:provider` | pub | Gateway return URL → verifies → redirects to result page |
| `POST /billing/coupons/validate` | ws | Price preview with coupon |
| `GET /billing/payments` · `GET /billing/invoices` · `GET /billing/invoices/:id.pdf` | ws | History |
| `GET /billing/wallet` · `PATCH /billing/subscription` `{autoRenewFromWallet}` | ws | Wallet and renewal |
| `POST /billing/quotes` · `GET /billing/quotes/:id` · `POST /billing/quotes/:id/accept` | ws | Organization quotes |
| `PUT /billing/buyer-profile` | ws | Economic code, national ID, address for official invoices |

### 4.10 Commerce (SHP)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /products?q=&kind=&component=` · `GET /products/:id` | pub | Catalogue |
| `GET /cart` · `PUT /cart/items/:productId` · `DELETE /cart/items/:productId` | ses | Cart |
| `POST /cart/from-bom` `{projectVersionId, excludeOwned}` | ws | Cart from BOM (422 `safety_errors_present` if Errors) |
| `GET /shipping/quote?addressId=` | ses | Methods and rates |
| `GET/POST/PATCH/DELETE /me/addresses[/:id]` | ses | Address book |
| `POST /orders` `{addressId, shippingMethodId, couponCode?}` | ses | Create order + reservation → payment redirect (`Idempotency-Key`) |
| `GET /orders` · `GET /orders/:id` · `POST /orders/:id/cancel` · `POST /orders/:id/returns` | ses | Orders |
| `POST /products/:id/notify-back-in-stock` | ses | Stock alert |
| `POST /orgs/:id/kit-quotes` | ws | Bulk kit quote request |

### 4.11 AI (AI)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /ai/providers` | ws | Providers available to the caller (platform + validated BYOK) |
| `PUT /ai/keys/:provider` `{key, baseUrl?, scope: 'user'\|'workspace'}` | ws | Add/replace key → test call → `active` or `invalid` |
| `DELETE /ai/keys/:provider` | ws | Delete key |
| `GET /ai/models?provider=` | ws | Model list |
| `POST /ai/chat` | ws | SSE stream: `delta`, `proposal` (patch), `usage`, `done`, `error` — **Ent** `ai.*`, rate limited |
| `GET /ai/conversations?projectId=` · `DELETE /ai/conversations/:id` | ws | History |
| `GET /ai/usage` | ws | Credits and usage |

```ts
type ChatRequest = {
  projectId: string; projectVersionId?: string;
  conversationId?: string;
  provider?: string; model?: string;               // default: platform model
  message: string;
  context: { serialTail?: string[]; behaviourSummary?: BehaviourSummary; activeFindingIds?: string[]; guidedStepId?: string };
};
// SSE event "proposal": { kind: 'code_patch', file: string, unifiedDiff: string } | { kind: 'circuit_change', jsonPatch: JsonPatchOp[] }
```

### 4.12 Exports, notifications, misc

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /exports` `{kind: 'bom_csv'\|'bom_xlsx'\|'bom_pdf'\|'wiring_pdf'\|'project_report_pdf'\|'circuit_svg'\|'circuit_png', projectVersionId, locale}` | ws | Create export job — **Ent** `export.pdf` for PDFs |
| `GET /exports/:id` · `GET /exports/:id/events` | ws | Status (SSE), signed download URL |
| `GET /notifications` · `POST /notifications/read` | ses | In-app notifications |
| `GET/PUT /me/notification-preferences` | ses | Preferences |
| `GET /analytics/org/:id/*` | ws | Org analytics (**Ent** `org.analytics`) |
| `GET /orgs/:id/audit-logs` · `GET /orgs/:id/audit-logs.csv` | ws | Org audit (**Ent** `org.audit_export`) |
| `GET /health/live` · `GET /health/ready` | internal | Probes |
| `GET /openapi.json` | pub | OpenAPI document |

### 4.13 Admin (`/api/v1/admin`, admin origin only)

| Group | Endpoints (CRUD unless noted) |
|---|---|
| Users & orgs | `/admin/users`, `/admin/users/:id/suspend`, `/admin/orgs`, `/admin/orgs/:id/subscription`, `/admin/overrides`, `/admin/impersonations` (requires user consent token) |
| Catalogue | `/admin/components` (enable, tier), `/admin/components/:id/calibrations`, `/admin/libraries`, `/admin/boards` |
| Content | `/admin/content` (draft → review → publish), `/admin/arenas`, `/admin/templates/messages` |
| Commerce | `/admin/products`, `/admin/kits`, `/admin/stock`, `/admin/warehouses`, `/admin/shipping`, `/admin/orders` (status transitions, labels), `/admin/returns` |
| Finance | `/admin/plans`, `/admin/plan-versions`, `/admin/coupons`, `/admin/payments`, `/admin/reconciliation?date=`, `/admin/refunds`, `/admin/invoices`, `/admin/quotes`, `/admin/tax-settings` |
| Trust & safety | `/admin/moderation/queue`, `/admin/moderation/actions`, `/admin/reports` |
| AI | `/admin/ai/providers`, `/admin/ai/credits`, `/admin/ai/usage`, `/admin/ai/evals` |
| Platform | `/admin/feature-flags`, `/admin/audit-logs`, `/admin/kpis` |

## 5. Real-time channels

| Channel | Protocol | Auth | Payload |
|---|---|---|---|
| Collaboration | WebSocket `wss://<host>/collab/:projectId` (Hocuspocus/Yjs sync protocol) | Session cookie checked in `onAuthenticate` | Yjs updates, awareness (cursor, selection, name, colour); stateless `sim.snapshot` messages at 10 Hz from the host |
| Build / export / live class / AI | SSE (see endpoints) | Session | JSON events with `event:` name and `id:` for resume (`Last-Event-ID`) |

## 6. Shared schemas (excerpt)

```ts
type Entitlements = {
  workspaceId: string;
  plan: { code: 'free' | 'maker' | 'classroom' | 'institution' | 'private_cloud'; status: 'trialing' | 'active' | 'expired'; trialEndsAt?: string; periodEnd?: string };
  features: Record<string, boolean>;                  // 'export.pdf': true
  quotas: Record<string, { limit: number | null; used: number; resetsAt?: string }>; // 'build.daily_quota'
  restrictions: { ageBand: 'u13' | '13_15' | '16_17' | 'adult'; policy: OrgPolicySummary | null };
};

type SafetyFinding = {
  ruleId: string; severity: 'error' | 'warning';
  componentIds: string[]; wireIds: string[]; pinIds: string[];
  messageKey: string; params: Record<string, string | number>; learnMoreSlug: string;
};

type VerifiedRun = {
  id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout';
  engineVersion: string; seed: string;
  result?: { conditions: Array<{ id: string; type: string; met: boolean; value?: number }>;
             metrics: { simSeconds: number; collisions: number; onLineRatio?: number; laps?: number } };
  score?: number; replayUrl?: string;
};

type BomLine = {
  componentId: string; variant?: string; quantity: number; owned: number;
  product?: { id: string; sku: string; nameFa: string; nameEn: string; unitPriceIrr: number; stock: 'in_stock' | 'low' | 'out_of_stock' };
  lineTotalIrr: number; notes?: string;
};
```

## 7. Rate limits (defaults, configurable)

| Scope | Limit |
|---|---|
| Unauthenticated per IP | 60 req/min; auth endpoints 10/min; OTP request 3 per 10 min per phone |
| Authenticated per user | 600 req/min |
| `POST /builds` | 20/min per user, 60/min per IP, guests 5/min; plus daily quota |
| `POST /ai/chat` | 10/min and 200/day per user (plan-configurable); per-org ceiling |
| `POST /exports` | 10/min per user |
| SCIM | 300 req/min per org |

## 8. Outbound webhooks (Institution)

Organizations can subscribe an HTTPS endpoint to events. Delivery: `POST` JSON with headers `RoboSim-Event`, `RoboSim-Delivery`, `RoboSim-Timestamp`, `RoboSim-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`; retries with exponential backoff for 24 h; receivers must reject timestamps older than 5 min.

| Event | When |
|---|---|
| `member.joined`, `member.deactivated` | Membership changes |
| `submission.graded`, `grades.released` | Grading |
| `subscription.renewed`, `subscription.expiring` | Billing lifecycle |
| `order.status_changed` | Org bulk orders |
