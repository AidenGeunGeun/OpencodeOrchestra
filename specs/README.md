# specs/

Design and implementation specs for OpenCodeOrchestra. Completed specs are kept here as architectural reference — they document *why* things were built the way they were, not just what was done.

---

## Active Specs

These are open work items or recently shipped features whose implementation may not yet be fully reflected in AGENTS.md.

| File | Version | Topic |
|------|---------|-------|
| `oco-1.0.32-model-variant-fixes.md` | 1.0.32 | Three targeted fixes for desktop model/variant state (effort→variant alias, session state init, `variant.selected()` fallback) |
| `oco-1.0.32-model-resolution-revamp.md` | 1.0.32 | Full replacement of effect-based model sync with a single derived computation in `local.tsx` and `session.tsx` |
| `oco-1.1.0-upstream-sync.md` | 1.1.0 | Six surgical fixes cherry-picked from upstream v1.3.x plus one OCO-specific desktop rendering fix |

---

## Historical / Completed Specs

Kept as architectural reference. Do not modify these — they are a record of decisions made, not living documents.

| File | What it covers |
|------|---------------|
| `a03b153d-bundle-latest-agent-prompts-and-release-1.0.7.md` | Agent prompt bundling process for the 1.0.7 release |
| `subagent-sidebar.md` | Right-panel subagent list with SSE live updates and context health |
| `right-panel-overlay-animation.md` | Overlay/panel animation for the subagent sidebar |
| `skip-local-server.md` | `skipLocalServer` feature for remote-first desktop connections |
| `upstream-v1225-migration.md` | Migration guide from upstream opencode 1.2.25 to OCO fork |
| `animation-system.md` | Motion token system and shared CSS transition utilities |
| `animation-conventions-and-normalization.md` | Normalization pass on animation across frontend components |
| `ci-cleanup-and-desktop-build.md` | GitHub Actions cleanup and Tauri desktop CI setup |
| `639d712b-codex-fast-oauth-canonical-model.md` | Codex/GPT OAuth fast-lane model and canonical slug handling |
| `0fbe2367-upstream-selective-sync.md` | Selective upstream sync strategy from opencode |
| `perf-roadmap.md` | Frontend performance roadmap (payload limits, cache eviction, throttling, scroll-spy) |
| `directional-session-transitions.md` | Slide transitions between session hierarchy levels |
| `project.md` | Project-level architecture and scope notes |
| `local-web-ui-and-responsive-fix.md` | Local frontend serving and responsive layout fix |
| `orchestration-webui-spike.md` | Initial spike for multi-agent orchestration visibility in the web UI |
| `animation-performance-safe-pass.md` | Safe-pass animation performance audit |
| `01-persist-payload-limits.md` | Payload size limits for session persistence |
| `02-cache-eviction.md` | Message cache eviction policy |
| `03-request-throttling.md` | API request throttling |
| `04-scroll-spy-optimization.md` | Scroll-spy optimization for long message threads |
| `05-modularize-and-dedupe.md` | Frontend modularization and deduplication |
| `06-app-i18n-audit.md` | i18n audit for the web app |
| `07-ui-i18n-audit.md` | i18n audit for the shared UI package |
| `08-app-e2e-smoke-suite.md` | End-to-end smoke test suite for the app |
