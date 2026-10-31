# Context — AI assistant

Status (2026-10-31): steps 1–6 + 10 done (shared contracts, packages/ai-providers, migration 0009, API module
`apps/api/src/modules/ai`, 23 API tests green; Ollama v0.40.5 in ~/.local/ollama serving qwen2.5:3b). Next: admin page,
web chat pane, eval harness, docs, verify.

## Decisions (user, 2026-10-31)
- Next P2 slice = AI assistant (track D). One pass, single verify at the end.
- Dev model: Ollama installed in WSL, CPU only (no GPU, 11 GB RAM) — small multilingual tool-calling model
  (qwen2.5:3b candidate). Tests use a scripted fake provider.
- Proposals: code patches (unified diff) AND circuit changes (JSON Patch over ProjectDocument).
- Credits: placeholder values per plan (user sets real numbers in admin later).
- Extras in scope: admin AI page (FR-ADM-08), eval harness ≥ 200 FA/EN items (FR-AI-09), all BYOK adapters
  (OpenAI, Anthropic, Gemini, OpenRouter, generic OpenAI-compatible), bilingual output filter (FR-AI-07).

## Defaults (Claude, announced)
- No OpenBao/Docker: `KeyWrapper` port, AES-256-GCM DEK per key wrapped by a KEK from env in dev.
- Egress allow-list proxy deferred to the deployment track (like Redis/S3 adapters).
- Minors (< 18 by DOB): platform model only, 30-day history; adults 90 days. No org policy yet (P3).
- Guests: no AI, sign-in prompt. Credit packs: "coming soon" (no payments yet).

## Findings
- Already present: entitlements `ai.byok` / `ai.platform_credits_monthly` (in QUOTA_ENTITLEMENTS), errors
  `ai_credits_exhausted` 429 / `provider_error` 502 / `policy_restricted` 403, `.env.example` AI_DEFAULT_PROVIDER +
  OLLAMA_BASE_URL (not parsed by env.ts yet), depcruise forbids browser → `packages/ai-providers/` (TD:160 puts adapters
  there). API-Spec:400 rate limit 10/min + 200/day per user.
- API = NestJS 12 + Fastify, Drizzle/PG (PGlite tests). Patterns: module dir + index.ts; `CallerGuard`/`@CallerScope`;
  `StaffGuard` + `requireStaff(staff,'perm')` (ADMIN_PERMISSIONS in shared/admin-api.ts); `DomainError(code, params)`;
  SSE hand-rolled in build-gateway.controller `events()` (hijack, headers, retry, ping); `FixedWindowRateLimiter`
  (common/rate-limiter.ts); `QuotaService` is daily in-process → credits need a DB ledger (monthly);
  `withScope`/`withSystem` (db/scope.ts); RLS template in 0007_guided.sql; `pnpm db:generate` then hand-append RLS.
- Env: config/env.ts Zod + superRefine refusing dev secrets in staging/prod (copy for AI_KEK).
- Age: users.ageBand (`u13|13_15|16_17|adult`), helper `ageBandOn` in iam/identity-rules.ts.
- Web: editor-page.tsx DockTab (l.68), dockTabs (~688); `current` = full ProjectDocument; `editor.apply/replace`;
  `sim.serialLog`, `findings`, `live.challenge`, `run.build`; `cloud.checkpoint(label)` creates a version.
  POST SSE needs fetch-stream helper (csrf() in lib/api.ts not exported). Paywall: plans/paywall-reason.ts.
- Admin: router.tsx lazyRouteComponent + root.tsx nav `staffCan`; client lib/admin-api.ts; fake testing/fake-admin.ts.
- i18n: NAMESPACES in packages/i18n/src/index.ts (+ browser.ts?), dynamic-keys.json for prefixes.
- No diff/JSON-patch lib in deps. Doc validation: `parseProjectDocument` (shared/project-schema.ts).
- tools/ are plain node scripts (not in workspace).
- Specs: PRD §6.14, API-Spec §4.11, TD §13 + §8.9 tables, Security §6.4/§7, ADR-009, User-Stories E16.
- Entitlement keys exist: `ai.byok` (Free false), `ai.platform_credits_monthly` (0 everywhere) —
  `packages/shared/src/entitlements.ts`, seeded in migration 0005.

## Implementation notes (2026-10-31)
- Ollama: `~/.local/ollama/bin/ollama serve` (log ~/.ollama/serve.log), no sudo; first chunk ≈ 13 s on CPU.
- Circuit proposals use high-level ops (add/remove component, set_prop, add/remove wire), not JSON Patch: small
  models cannot index arrays. API-Spec §4.11 must be updated accordingly (deviation).
- Code proposals = exact find/replace edits (+ server-made unified diff for display); re-applied on Apply.
- qwen2.5:3b flattens single edits (`find`/`replace` top-level) → normalizer in proposals.ts accepts it.
- Tests replace the provider via `app.get(PROVIDER_FACTORY).create`; test env AI_DEFAULT_PROVIDER=fake.
- Filter: Persian is SOV — needs noun→verb patterns; «مین» removed (substring of «زمین» = GND).
- Context `nets` sent by the editor (server has no browser-free net builder).
