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
- 1M context beta support (`context-1m-2025-08-07` header)

---

## Upstream Tracking

- [x] ~~When upstream opencode adopts `@ai-sdk/anthropic` v3.x, port their implementation and reconcile with our fork changes.~~ Done — we upgraded independently to AI SDK 6.x.
- [x] ~~Track `ai` core package major version bumps (currently v5.x)~~ Done — upgraded to `ai@6.0.90`.
- [ ] Monitor upstream for AI SDK 6.x adoption — reconcile when they catch up.
- [ ] Monitor upstream for 1M context support in main `provider.ts`.
