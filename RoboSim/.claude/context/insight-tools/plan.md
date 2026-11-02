# Plan — Insight & tooling track (IT-1 … IT-20)

Goal: implement the 20 IT slices one at a time. Each slice is self-contained: read its PRD row, user story,
Technical-Design §18.<n> and the Release-Plan IT table row before starting.

## Per-slice procedure (repeat for every slice)
1. Read: PRD row (FR id) · User-Stories (US id) · Docs/Technical-Design.md §18.<n> · ADRs it cites · Release-Plan §3 IT row.
2. Write failing tests from the story's ACs and the TD **Tests** list (TDD).
3. Implement behind the slice's feature flag; FA + EN i18n keys; RTL; a11y.
4. `pnpm verify` green; goldens unchanged unless the slice says otherwise; browser check FA/EN (WSL only, API_PORT=3001).
5. Docs sync: PRD status note on the FR row, TD §18.<n> *Implemented* note, Release-Plan row, README; tick the box below; update context.md.

## Slices (recommended order)
- [ ] IT-1 — Wiring ↔ sketch consistency check · FR-SAF-08 · US-SAF-06 · TD §18.1
- [ ] IT-2 — Virtual multimeter + measure channel (ADR-026) · FR-SIM-13 · US-SIM-09 · TD §18.2
- [ ] IT-3 — Analog oscilloscope · FR-SIM-14 · US-SIM-10 · TD §18.3 · after IT-2
- [ ] IT-4 — Power budget and battery life · FR-SIM-15 · US-SIM-11 · TD §18.4 · after IT-2
- [ ] IT-5 — Serial log export and diff · FR-SIM-21 · US-SIM-17 · TD §18.5
- [ ] IT-6 — Find a part by function (ADR-028 manifest extensions) · FR-CIR-12 · US-CIR-09 · TD §18.6
- [ ] IT-7 — Wiring hints and auto-tidy · FR-CIR-11 · US-CIR-08 · TD §18.7
- [ ] IT-8 — Damage post-mortem · FR-SIM-16 · US-SIM-12 · TD §18.8 · after IT-2, IT-3
- [ ] IT-9 — Time-travel scrubber (ADR-027) · FR-SIM-17 · US-SIM-13 · TD §18.9
- [ ] IT-10 — Ghost run and A/B · FR-ARN-13 · US-ARN-09 · TD §18.10
- [ ] IT-11 — Shareable run links (ADR-031) · FR-SIM-12 · US-SIM-08 · TD §18.11
- [ ] IT-12 — Fault injection (ENGINE_VERSION bump) · FR-SIM-19 · US-SIM-15 · TD §18.12
- [ ] IT-13 — Tolerance mode (ENGINE_VERSION bump) · FR-SIM-20 · US-SIM-16 · TD §18.13
- [ ] IT-14 — Sketch tests (project schema v5) · FR-COD-09 · US-COD-08 · TD §18.14
- [ ] IT-15 — Explain this net · FR-AI-11 · US-AI-07 · TD §18.15 · after IT-2
- [ ] IT-16 — Cost and substitute optimizer · FR-BOM-07 · US-BOM-06 · TD §18.16
- [ ] IT-17 — Parameter sweep and PID tuner (ADR-029) — P4 · FR-SIM-18 · US-SIM-14 · TD §18.17
- [ ] IT-18 — Seeded random arenas — P4 · FR-ARN-14 · US-ARN-10 · TD §18.18
- [ ] IT-19 — Spectator / projector mode — P4 · FR-WRK-08 · US-WRK-06 · TD §18.19 · after IT-11
- [ ] IT-20 — Source-level debugger (ADR-030) — P4 · FR-COD-08 · US-COD-07 · TD §18.20

## Acceptance (track)
- All 20 stories' ACs automated and passing; common exit criteria in Release-Plan §3 IT met per slice.
