# Anthropic Max Routing Alignment

## Intent

Bring OpenCode Orchestra's built-in Anthropic OAuth path into line with the current Claude Code-compatible request shape so Claude Pro/Max traffic has the best chance of being recognized as subscription-backed usage instead of falling into Anthropic's "Extra Usage" bucket.

This work must stay fully in-tree. Do not add `@ex-machina/opencode-anthropic-auth` or any other external plugin/runtime dependency.

## Why This Matters

OCO already has a built-in Anthropic auth plugin, but it is clearly behind the behavior implemented in the community plugin release `v1.6.1`. The current in-tree behavior still uses older OAuth endpoints/headers and a coarse prompt rewrite approach, while the community plugin now focuses on more exact Claude Code request fingerprinting.

The external plugin's recent changes strongly suggest that Anthropic's routing is sensitive to request-level details beyond simply using OAuth. In practice, the likely levers are:

- current OAuth endpoints, callback handling, and scopes
- current `user-agent` and required beta headers
- Claude Code-like system block layout
- billing header / content consistency metadata
- Claude Code-compatible tool naming conventions
- stable token refresh behavior under concurrent requests

## Current State

- OCO's built-in Anthropic plugin lives in `packages/opencode/src/plugin/anthropic.ts`.
- Anthropic provider/auth loader integration is wired through `packages/opencode/src/plugin/index.ts` and `packages/opencode/src/provider/provider.ts`.
- The current built-in plugin already owns the right surface area for an in-tree fix: auth methods, OAuth token exchange/refresh, request fetch wrapping, header injection, request body mutation, and model cost overrides.
- The current implementation appears to reflect an older generation of the community plugin rather than the current `v1.6.1` behavior.

## Scope

Update the built-in Anthropic OAuth flow and request shaping behavior used for Claude Pro/Max authentication so that:

1. OCO's Anthropic OAuth mode matches the current Claude Code-compatible flow closely enough to avoid obvious fingerprint mismatches.
2. The emitted Anthropic requests preserve user and project instructions while removing or rewriting only the OCO-specific identity/branding that is likely to break subscription routing.
3. Concurrent Anthropic OAuth requests remain stable when access tokens expire.
4. The behavior is covered by focused tests inside the OCO repo.

## Requirements

### 1. OAuth flow parity

Anthropic OAuth in OCO must support the currently expected hosted authorization/token flow and callback formats used by Claude Pro/Max and console-based API-key creation.

The flow must correctly handle modern callback input formats, reject invalid or mismatched callback state, and persist refreshed credentials after successful token exchange/refresh.

### 2. Claude Code-compatible request fingerprinting

When Anthropic auth is operating in OAuth mode, outgoing requests must present the same class of identifying signals that the current community fix relies on:

- current OAuth/beta header expectations
- current Claude CLI-style `user-agent`
- Claude Code-compatible billing metadata
- Claude Code-compatible system prompt identity/layout
- Claude Code-compatible tool naming on the wire, with user-visible tool names unchanged in OCO's own UX

This should be treated as behaviorally required for OAuth mode, not a cosmetic cleanup.

### 3. Prompt rewrite precision

The Anthropic OAuth path must stop relying on broad global string replacement of `OpenCode`/`opencode` across the system prompt.

Instead, the final request must preserve as much of the existing OCO system guidance as possible while only removing or rewriting the specific OCO-branded identity/help text that creates Claude Code incompatibility.

User-configured instructions, project instructions, environment blocks, and other behavioral guidance must remain intact unless they are directly part of the incompatible OCO identity/help material.

### 4. Token refresh robustness

Expired Anthropic OAuth credentials must refresh safely under concurrent requests.

The implementation must avoid refresh stampedes and avoid cascaded failures when Anthropic rotates refresh tokens.

Transient refresh failures should be handled more gracefully than the current one-shot behavior.

### 5. Cost and auth behavior

For Anthropic OAuth usage, model costs should continue to appear as zero-cost subscription-backed usage inside OCO.

Manual Anthropic API-key auth must continue to work and must not inherit Claude Pro/Max-only request shaping that would be inappropriate for standard API-key traffic.

### 6. No new external dependency

The solution must be implemented directly inside OCO's existing codebase.

Using the external plugin as a reference is fine. Shipping it as a plugin dependency is not.

If any code is copied substantially from the MIT-licensed upstream plugin, preserve any attribution/license obligations required by that license.

## Non-Goals

- No general provider refactor.
- No unrelated Anthropic model catalog changes.
- No attempt to guarantee Anthropic billing behavior permanently; this is an undocumented external heuristic and may change again.
- No requirement to add proxy/custom-base-URL support unless it is a low-risk byproduct of aligning the OAuth request path.

## Acceptance Criteria

- OCO's built-in Anthropic OAuth path reflects the current Claude Code-compatible auth/request behavior closely enough that the obvious gaps vs `opencode-anthropic-auth@1.6.1` are closed.
- The OAuth flow accepts modern callback input formats and rejects invalid callback state.
- Anthropic OAuth requests include the expected modern headers/metadata and Claude Code-compatible system/tool formatting.
- The request rewrite preserves user/project instructions and removes only the incompatible OCO identity/help material.
- Concurrent expired-token requests result in one coordinated refresh path rather than multiple competing refreshes.
- Manual Anthropic API-key auth still works as before.
- Automated tests cover the Anthropic OAuth auth flow, request rewriting, and concurrent refresh behavior.

## Verification

- Run the relevant unit tests covering Anthropic auth/request transformation behavior.
- Verify that Anthropic OAuth requests produced by OCO match the intended Claude Code-compatible shape at a behavioral level.
- Verify that non-OAuth Anthropic auth still follows the normal API-key path.

## Completion Standard

The work is done when OCO has an internal, tested Anthropic OAuth implementation that no longer depends on the old coarse fingerprinting behavior and no longer requires the external community plugin to achieve modern Claude Pro/Max-compatible routing behavior.
