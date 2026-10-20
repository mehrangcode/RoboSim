# Plan — Code-aware safety (FR-COD-06 + FR-SAF-03)

**Goal:** extract pin usage from the sketch (tree-sitter C++) and cross-check it against the wiring with four
static rules; findings appear in Lab, editor (Monaco markers on the code line + findings panel) and grader alike.

**Acceptance:** US-COD-06 AC1/AC2 (analogWrite(7) → pin 7 PWM output; const int / #define resolved);
US-SAF-02 AC1 (analogWrite(7, …) → Warning "pin 7 has no PWM; use 3, 5, 6, 9, 10 or 11" on the code line and pin);
trigger + clean fixtures per rule; goldens re-recorded only if results change (engineVersion bump then);
`pnpm verify` + `pnpm test:sim` green; browser check FA/EN.

## Steps
- [x] 1. `packages/code-analysis`: web-tree-sitter 0.27.0 + tree-sitter-cpp 0.23.4 (WASM), async `initCodeAnalysis()`,
      sync `analyzeSketch(files) → CodeFacts` (pin uses with file/line/col, modes, servo, unresolved calls); const resolution
- [x] 2. sim-core: `CodeFacts` type, `StaticContext.code?`, `Finding.codeRefs?`, `StaticProbe.netResistance`
- [x] 3. safety-rules: SAF-CODE-PWM-PIN, SAF-CODE-OUTPUT-CONFLICT, SAF-CODE-FLOATING-INPUT, SAF-CODE-SERVO-PWM;
      drive probes use real modes when code facts are complete
- [x] 4. Loader runs analysis (init required in worker, grader CLI, verify worker, tests)
- [x] 5. Web: Monaco markers, findings panel code line link, i18n FA/EN
- [x] 6. Goldens / engineVersion, docs (PRD status, TD §5.6, Release Plan, EG), verify
