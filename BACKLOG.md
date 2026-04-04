# BACKLOG — OpenCode Orchestra

Tracked items for future work. Ordered by priority.

---

## Completed

### AI SDK 6.x Full Ecosystem Upgrade (v1.0.0)

**Goal:** Upgrade entire AI SDK ecosystem to support adaptive thinking, `effort` parameter, and Claude 4.6 models.

**Status:** ✅ Complete (v1.0.0)

**What was done:**
- `ai` 5.0.124 → 6.0.90, `@ai-sdk/anthropic` 2.0.62 → 3.0.45, all 15+ providers upgraded
- `finishReason` and `usage` normalization for SDK 6 object formats
- Claude 4.6 adaptive thinking variants (`isClaude46()`, `claude46Variants()`)
- `toModelMessages` became async, `wrapLanguageModel` middleware removed

---

## 1.1.0 Candidates

### Per-Agent Todo Lists

Shared PM-level todo list plus per-session ephemeral todo lists. The PM would maintain a persistent cross-session task list; individual sessions get their own scoped list. Blocked until Fix 3 from `oco-1.1.0-upstream-sync.md` ships (the `todowrite` deny in `task.ts` must be made conditional on agent permission config before per-agent grants can work).

### Effect Service Refactor (Upstream v1.3.x Sync)

Upstream v1.3.x refactored significant portions of the session pipeline onto the Effect service abstraction. Tracking for a targeted sync once upstream stabilizes. **Not included in the 1.1.0 spec** — the changes are too large and invasive to cherry-pick safely alongside the surgical 1.1.0 fixes. Revisit after 1.1.0 ships.

### TUI Plugin System Adoption (Deferred)

Upstream introduced a TUI plugin hook system. Adoption deferred — the OCO TUI already diverges heavily (sibling nav, agent cycle lock, effectiveAgent memo) and merging the plugin surface without breaking those would require a dedicated sync pass. Noted here as a future tracking item.

### Cross-Process Session Sync: TUI ↔ Desktop (Deferred)

When both TUI and Desktop are open against the same server, session state is broadcast to both via SSE, but the TUI and Desktop each maintain independent local ephemeral state (selected model, agent, etc.). True cross-process sync would require reconciling those independently. **Deferred** — the intended usage model is one active client per server instance. If a user opens both, they should expect minor UI divergence. Revisit only if this becomes a reported pain point.

### Prompt Repetition Experiment (Scrapped)

Explored whether repeating key instructions mid-context improves recall for non-reasoning models. Scrapped for now — initial results were inconsistent and the added token cost is hard to justify without a controlled eval. Research reference for future revisit: *"Prompt Repetition Improves Non-Reasoning LLMs"*, Leviathan et al., Google Research, Dec 2025.

---

## Upstream Tracking

- [x] ~~When upstream opencode adopts `@ai-sdk/anthropic` v3.x, port their implementation and reconcile with our fork changes.~~ Done — we upgraded independently to AI SDK 6.x.
- [x] ~~Track `ai` core package major version bumps (currently v5.x)~~ Done — upgraded to `ai@6.0.90`.
- [ ] Monitor upstream for AI SDK 6.x adoption — reconcile when they catch up.
- [x] ~~Monitor upstream for 1M context support in main `provider.ts`.~~ Done — 1M context is GA as of March 2026; no beta header needed, models.dev already reflects 1M limits for Opus 4.6 and Sonnet 4.6.
