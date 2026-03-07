# Bundle Latest Agent Prompts And Release 1.0.7

## Intent

- Sync the bundled default agent prompts with the latest prompt files currently used from `~/.config/opencode/prompts/`, then rebuild and publish a new `1.0.7` release.

## Acceptance Criteria

- The bundled prompt files in `packages/opencode/src/agent/prompt/` match the current user prompt files for these prompt names:
  - `pm.txt`
  - `orchestrator.txt`
  - `researcher.txt`
  - `investigator.txt`
  - `auditor.txt`
  - `compaction.txt`
  - `docs.txt`
- Bundled prompt files that do not currently have corresponding user prompt overrides remain unchanged:
  - `cleanup.txt`
  - `explore.txt`
  - `summary.txt`
  - `title.txt`
  - `pm-plan.txt`
- `packages/opencode/package.json` is bumped from `1.0.6` to `1.0.7`.
- `packages/opencode` builds successfully and produces `1.0.7` binaries and release archives.
- Git tag `oco-v1.0.7` is created and pushed.
- GitHub release `oco-v1.0.7` is published with the standard cross-platform asset set plus `SHA256SUMS.txt`.
- `AGENTS.md` documents the prompt-bundling release note/process guidance discovered during this work.

## Test Cases

- Given the seven in-use prompt names above, when comparing each bundled file against `~/.config/opencode/prompts/<name>`, then the contents match exactly.
- Given the rebuilt wrapper and Linux x64 binary, when running `--version`, then both report `1.0.7`.
- Given the release artifacts, when inspecting the GitHub release, then the tag, title, and attached assets follow the existing `oco-v1.x.y` release pattern.

## Out Of Scope

- Rewriting or improving prompt content beyond copying the current in-use prompt files.
- Updating bundled prompt files that do not currently have corresponding user overrides.
- Changing prompt-loading logic, agent wiring, or config semantics.
- Broader product or provider changes unrelated to prompt bundling.

## Scope

- Copy prompt content from `~/.config/opencode/prompts/` into `packages/opencode/src/agent/prompt/` for the seven in-use prompt files only.
- Update release/version metadata and any generated build outputs needed for a normal release.
- Build archives, generate checksums, push commit/tag, and publish the GitHub release.

## Constraints

- Preserve exact contents of the current in-use user prompt files for the seven synced prompts.
- Do not modify `.env` files, secrets, credentials, or tokens.
- Follow the established `oco-v<version>` release naming and asset pattern.

## Risks And Mitigations

- Risk: accidentally overwriting bundled prompt files that are not currently overridden by the user.
- Mitigation: limit synchronization to the seven prompt files explicitly listed in scope and verify the rest are untouched.

- Risk: release metadata or assets diverge from the recent `1.x` release pattern.
- Mitigation: inspect the latest GitHub release and reuse the same tag and asset conventions.

- Risk: build-generated files change unexpectedly during the version bump.
- Mitigation: rebuild, verify `--version`, and include resulting generated files in the release commit.

## Verification Commands

- `diff -u ~/.config/opencode/prompts/pm.txt packages/opencode/src/agent/prompt/pm.txt`
- `diff -u ~/.config/opencode/prompts/orchestrator.txt packages/opencode/src/agent/prompt/orchestrator.txt`
- `diff -u ~/.config/opencode/prompts/researcher.txt packages/opencode/src/agent/prompt/researcher.txt`
- `diff -u ~/.config/opencode/prompts/investigator.txt packages/opencode/src/agent/prompt/investigator.txt`
- `diff -u ~/.config/opencode/prompts/auditor.txt packages/opencode/src/agent/prompt/auditor.txt`
- `diff -u ~/.config/opencode/prompts/compaction.txt packages/opencode/src/agent/prompt/compaction.txt`
- `diff -u ~/.config/opencode/prompts/docs.txt packages/opencode/src/agent/prompt/docs.txt`
- `bun run build`
- `./bin/oco --version`
- `./dist/@skybluejacket/oco-linux-x64/bin/oco --version`
