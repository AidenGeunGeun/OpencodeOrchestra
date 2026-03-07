# Codex FAST OAuth Canonical Model

## Intent

- Make ChatGPT/Codex OAuth treat FAST as official Codex does: a canonical OpenAI model slug plus a priority service tier, not a separate model slug.

## Acceptance Criteria

- Selecting `openai/gpt-5.4-fast` results in outbound requests using canonical model slug `gpt-5.4`.
- The same requests preserve FAST behavior by sending priority service tier settings.
- Existing non-OAuth OpenAI custom alias behavior continues to work.

## Test Cases

- Given a config alias `gpt-5.4-fast` that maps to canonical OpenAI model `gpt-5.4`, when provider state is built, then the resolved model has `api.id === "gpt-5.4"` and retains `options.serviceTier === "priority"`.
- Given OpenAI OAuth auth, when `gpt-5.4-fast` is selected for a session, then the outbound request uses `model: "gpt-5.4"` and includes priority service tier settings.
- Given OpenAI API-key auth, when the same alias is selected, then existing alias behavior remains unchanged.

## Out Of Scope

- Redesigning FAST as a first-class global model type.
- Adding picker-time validation for misconfigured custom Codex slugs.
- Pricing, labeling, or broader model catalog UX changes.

## Scope

- Investigate and update the OpenAI/Codex OAuth path in `packages/opencode/src/plugin/codex.ts`.
- Update any supporting model resolution or request-building logic involved in OAuth model selection.
- Add or update focused tests under `packages/opencode/test/` for provider/config behavior and the Codex OAuth path.

## Constraints

- Preserve existing OpenAI custom model alias support outside OAuth mode.
- Follow official Codex behavior: canonical model slug in request body, FAST represented via service tier.
- Do not broaden scope into unrelated provider or UI refactors.

## Risks And Mitigations

- Risk: fixing OAuth routing accidentally changes non-OAuth alias handling.
- Mitigation: include a regression test for API-key OpenAI alias behavior.

- Risk: OAuth path still leaks display model id instead of canonical API model id.
- Mitigation: verify request-construction tests assert against the exact outbound model field.

## Verification Commands

- `bun test packages/opencode/test/provider/provider.test.ts`
- `bun test` (run from `packages/opencode` if broader touched tests require it)
