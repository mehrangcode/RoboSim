# Context — Code-aware safety

## Status
2026-10-20: steps 1–6 done (slice complete, uncommitted). verify green (275), test:sim legs green; browser-checked EN/FA
(Lab safety demos + editor: list + 2 Monaco markers). Engine bump: sim-core 0.5.0, safety-rules 0.4.0, sim-runtime 0.6.0,
code-analysis@0.1.0 in ENGINE_PACKAGES; goldens re-recorded — only floating-input / outputs-fighting gained a static finding.
Follow-ups: static analysis runs at load (on Run), not debounced while typing (TD §5.6); Firefox frame-budget p95 flaky under load;
API was down during browser check, so editing + compiling a sketch with a new finding was not exercised end to end.

## Decisions (user, 2026-10-20)
- Parser: tree-sitter WASM (web-tree-sitter 0.27.0 — 0.27.1 < 2 weeks old; tree-sitter-cpp 0.23.4 ships tree-sitter-cpp.wasm, 3.3 MB / 273 KB gz), lazy.
- Findings computed in the loader → same in Lab, editor, grader; editor also shows Monaco markers.
- Rules: analogWrite non-PWM (warning), OUTPUT onto a driven net (error), floating input (warning), Servo vs Timer1 PWM 9/10 (warning).
- Constants: literals, A0–A5, LED_BUILTIN, #define, const/constexpr int/byte/uint8_t globals, + - * arithmetic; anything else = unknown pin → no finding.

## Design notes
- loadProject/grade are sync → tree-sitter init is async: `await initCodeAnalysis()` once at startup (worker, grader CLI, tests); analysis throws if not initialised (no silent skip).
- sim-core must not depend on code-analysis: CodeFacts type lives in sim-core safety types.
- Floating input statically: StaticProbe.netResistance(net) > 10 MΩ (same threshold as runtime SAF-FLOATING-INPUT).
- Pin ids: D0–D13, A0–A5; PWM = capability 'pwm' on BoardPinDef.
- Drive probes trust the facts only when complete (no unresolved, includes ⊆ Arduino/Servo/Wire/EEPROM); libraries keep worst case.
- Under jsdom a Node Buffer fails web-tree-sitter's instanceof check → initCodeAnalysis copies bytes into a local Uint8Array.
- Fix texts use {pinArg} ('2', 'A0') so advice is valid Arduino code.
