# Context — plans & entitlements

Status: DONE 2026-10-24 (uncommitted). pnpm verify green (275 tasks); API 156 tests, web 121+, admin 10. Browser check in FA still open.

User decisions (2026-10-24):
- Admin: admin API (/admin/plans, plan-versions, overrides, workspace subscription) + first real apps/admin UI.
- Staff auth: same accounts/sessions + `staff_roles` row; `pnpm admin:grant <email> <role>` bootstraps; admin actions audited.
- Pro parts on Free: usable/runnable locally; cloud save with pro parts → 403 entitlement_required; paywall lists them
  (save locally / upgrade); library shows a Pro badge.
- No trial yet: everyone (existing + new) is Free. Trial comes with checkout.
- Over cap (projects.cloud_max = 3 on Free): 3 most recently updated stay editable, others read-only (view/export/run,
  banner: duplicate locally / delete / upgrade); 4th create → 403 quota_exceeded.
- Retention: daily system purge of automatic build versions older than plan retention; named checkpoints and each
  project's latest version always kept; audited; dry-run flag.
- Upgrade CTA → public /plans page (GET /plans), Upgrade disabled "Payments coming soon"; Account → Plan & usage.
- Daily quotas reset at 00:00 Asia/Tehran (TD §9.1); fix API Spec + code (was UTC).

Design decisions (mine, defaults):
- Plan values from PRD §3 (Free build.daily_quota 30, Maker 500, …). Prices placeholder, admin-editable.
- No Redis in dev: in-process 60 s cache per (workspace,user), invalidated in-process on subscription/override/plan change.
- Workspace without subscription row ⇒ Free (no backfill rows needed).
- Cap/tier checks use the project's workspace entitlements (owner's), not the sharee's.

Blockers: none.
