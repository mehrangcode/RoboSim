# Plan — AI assistant (P2: FR-AI-01…05, 07…09, FR-ADM-08; US-AI-01…04, 06)

Goal: a workspace chat assistant that knows the project, streams answers in the UI language from the platform
model (Ollama/vLLM) or the user's own key, proposes code and circuit changes the user applies or rejects, and
is metered, rate limited, guarded, administered and evaluated. One pass, single verify at the end.

## Steps
- [x] 1. Shared contracts (`packages/shared`): chat request/SSE events, proposals (code_patch, circuit_change),
      provider/key/usage/conversation DTOs, behaviour summary; placeholder credits per plan.
- [x] 2. API data: migration 0009 — `ai_provider_configs`, `ai_keys`, `ai_conversations`, `ai_messages`,
      `ai_usage`, credit ledger; RLS (owner/workspace), retention (`expires_at`: 30 d minors / 90 d adults).
- [x] 3. `LLMProvider` port + adapters: OpenAI-compatible (platform Ollama/vLLM, OpenAI, OpenRouter, generic),
      Anthropic, Gemini, scripted fake. Streaming, model list, key validation, token counting, tool calls.
- [x] 4. Keys: `KeyWrapper` port (AES-256-GCM DEK per key, KEK from env in dev); test call → active/invalid;
      last4 only; redaction in logs.
- [x] 5. Chat service: entitlements (`ai.*`), credits, rate limit (10/min/user → 429 + Retry-After), policy
      (minors → platform model only), context builder (12k budget, untrusted-data wrapping), tools
      `propose_code_patch` / `propose_circuit_change` with validation, output filter (FA/EN, stricter for minors),
      metering after the stream; SSE `delta|proposal|usage|done|error`.
- [x] 6. API routes §4.11: providers, keys, models, chat, conversations (list/get/delete), usage.
- [x] 7. Admin: AI page — providers (enable, legal approval ref, reachability check), model catalogue, usage/cost.
- [x] 8. Web: AI dock/pane in the editor — chat with streaming, context chips, proposals as diff / change list
      with Apply (creates a version) / Reject, history, credits meter, provider/model picker, BYOK keys in Account,
      paywall at zero credits, sign-in prompt for guests; FA/EN, RTL.
- [x] 9. Eval harness `tools/ai-eval`: ≥ 200 FA/EN tasks with rubrics, runner, score report, CI gate (> 2 pt drop).
- [x] 10. Dev model: Ollama in WSL (CPU) + small multilingual tool-calling model; `AI_DEFAULT_PROVIDER`,
      `OLLAMA_BASE_URL` (FR-AI-10).
- [ ] 11. `pnpm verify` + browser check (FA/EN) + docs (PRD, TD, API-Spec, User-Stories, Release-Plan, README).

## Acceptance
- US-AI-01 AC1: inverted sensor condition identified with line citation (eval item + fake-provider test of context).
- US-AI-02 AC1: proposal shown as diff with Apply/Reject; Apply creates a version.
- US-AI-03 AC1–3: streaming within credits, meter updates, paywall at zero; 11th request/min → 429 Retry-After;
  deleted conversation gone from history and storage.
- US-AI-04 AC1–2: valid key test call → selectable; invalid → provider error; full key never in any response.
- US-AI-06: eval runner with ≥ 200 items, gate rule implemented.
- `pnpm verify` green; goldens unchanged; bundle budget held (AI pane lazy).
