# Context — RoboSim enterprise documentation

**Status:** Complete (2026-10-13). Awaiting owner review.

**Key decisions**
- Scope rewritten from MVP to full enterprise product; delivery as phases P0–P5 of one product (no MVP rewrite).
- Paywall principle: gate only server-enforceable value (ADR-006) — resolves v0.1 gaps 3 and 4.
- PDFs rendered server-side via headless Chromium (ADR-008) — resolves gap 2 and Persian shaping.
- Default AI = platform-hosted open-weight models; external providers BYOK only after legal review (ADR-009).
- Stack changes vs v0.1: NestJS on Fastify + Drizzle (was Fastify + Prisma), Node 24 LTS, gVisor sandbox, CloudNativePG, OpenBao.

**Open items for the owner** (PRD §10): product name, built-in shop vs existing Mehrtronic store, prices, gateways/eNamad, cloud provider, AI model, pilot schools. BRD assumptions A-1…A-7 need management confirmation; Security §8 items marked [confirm] need legal/accountant review.
