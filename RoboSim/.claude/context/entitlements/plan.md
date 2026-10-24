# Plan — plans & entitlements (FR-BIL-01 thin, FR-BIL-04, FR-BIL-05; FR-ADM-02/06 thin; US-BIL-04)

Goal: every enforcement point asks one entitlements service (plan version ⊕ overrides) instead of env defaults;
plans and overrides are managed by staff in apps/admin; users see limits, usage and a paywall. No payments, no trial.

## Steps
- [x] 1. Shared contracts (`packages/shared/src/entitlements.ts`, `plans-api.ts`): plan codes, entitlement values
      + per-plan defaults (PRD §3), resolver merge (⊕ overrides), `MeEntitlements`, `/plans`, admin schemas,
      Tehran quota day helper, `proPartsIn(doc)` lives in API (needs catalog).
- [x] 2. Migration `0005_entitlements`: plans, plan_versions, subscriptions, entitlement_overrides; RLS
      (catalog tables read-only; subscriptions/overrides readable by workspace); seed free/maker/classroom/institution v1.
- [x] 3. API `entitlements` module: EntitlementsService (60 s cache, invalidate), QuotaService (in-process, Tehran
      day), `GET /me/entitlements`, `GET /plans`; StaffGuard; admin endpoints (plans, plan versions, workspace
      lookup/subscription, overrides); RetentionService (daily, dry-run, audited) + CLI; `pnpm admin:grant`.
- [x] 4. Enforcement: builds (daily quota, priority, boards.allowed; guests 10/day), projects (cloud_max on
      create/copy/restore, over-cap read-only, components.tier on save/create), auto versions skip locked projects.
      Remove `BUILD_DAILY_QUOTA` env.
- [x] 5. Web: entitlements client/context, `/plans` page, Account → Plan & usage, paywall dialog (entitlement_required,
      quota_exceeded, build_quota_exceeded), projects page lock badges + create paywall, editor read-only for locked
      projects with banner, Pro badge in library, pro-part save paywall (save locally / upgrade). FA/EN.
- [x] 6. Admin app: router, API client, staff sign-in, Plans (versions, entitlements editor), Workspaces (search,
      plan, overrides). FA/EN, RTL.
- [x] 7. Tests (API HTTP + unit, web, admin) and `pnpm verify` green. [ ] Browser check FA (not done yet).
- [x] 8. Docs: PRD/TD/API-Spec/Release-Plan/Engineering-Guide/decisions (ADR if needed), CLAUDE.md/README sync.

## Acceptance
- Free user: 4th cloud project → 403 quota_exceeded + paywall; 31st queued build/day (Tehran) → 429 + paywall;
  save with a pro part → 403 entitlement_required listing parts; over-cap projects open read-only.
- Admin sets workspace to Maker → limits lift within the request after (cache invalidated).
- Retention purge keeps named checkpoints and latest version; dry-run reports without deleting.
- `pnpm verify` green.
