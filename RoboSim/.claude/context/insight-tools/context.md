# Context — Insight & tooling track

**Status (2026-11-02):** documentation only. Nothing implemented yet. Next: IT-1.

## Where the spec lives
- PRD §6: FR-SAF-08, FR-SIM-12 (status note), FR-SIM-13…21, FR-CIR-11/12, FR-COD-08/09, FR-ARN-13/14, FR-BOM-07, FR-AI-11, FR-WRK-08; PRD §9 row "IT".
- User-Stories: US-SIM-08 (extended), US-SIM-09…17, US-CIR-08/09, US-COD-07/08, US-ARN-09/10, US-SAF-06, US-BOM-06, US-AI-07, US-WRK-06.
- Technical-Design §18 (one subsection per slice), API-Spec (run shares, build symbol/debug artifacts), decisions.md ADR-026…031.
- Release-Plan §3 "IT — Insight & tooling track" (slice table, flags, exit criteria), risks R-17…19.

## Key decisions
- View-only instruments never enter the input log and never bump ENGINE_VERSION (ADR-026), like the logic-analyzer probe.
- Fault injection and tolerance change behaviour → recorded in input log, ENGINE_VERSION bump.
- Instruments are free in every plan (ADR-006); only storage (run shares), builds (debug/sweep fallback) and AI are gated.
- Optional manifest extensions (functions, substitutes, tolerance, faults, typicalCurrentMa) follow one contract (ADR-028).

- Owner decisions (2026-11-02): all IT tools free (ADR-006); phasing IT-1…16 P2, IT-17…20 P4 (1.1); `@robosim/content` joins ENGINE_PACKAGES (one golden:update); `runs.cloud_max` Free 5 / Maker 200 / Classroom 50 per seat / Institution ∞, no run links for u13.

## Blockers / open points
- See each TD §18.<n> "Risks & open points".
