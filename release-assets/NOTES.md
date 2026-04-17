# OCO v1.1.3 — Claude Opus 4.7 Support

Adds support for **Claude Opus 4.7** (released by Anthropic on Apr 16, 2026) and makes Claude adaptive thinking detection future-proof for all upcoming 4.x releases.

## Highlights

- **Claude Opus 4.7 works out of the box.** New models `anthropic/claude-opus-4-7` and the full 4.7 family use the correct adaptive thinking API format.
- **New `xhigh` effort variant** for Claude 4.7+ (Anthropic's new tier between `high` and `max`). Available in the thinking effort selector.
- **Future-proof version detection.** The previous `isClaude46()` check was pinned to 4.6 only, causing every new Claude release to fall through to a legacy format that Opus 4.7 rejects with HTTP 400. Replaced with a version parser that handles all Claude 4.6+ models — including 4.7, 4.8, 4.12, etc. — while correctly ignoring date-suffixed IDs like `claude-opus-4-20250514`.
- **`@ai-sdk/anthropic` updated** from 3.0.45 → 3.0.71 to include the `xhigh` effort enum in the SDK's validation schema.

## Upgrade Notes

If you have `anthropic/claude-opus-4-6` with `effort: "max"` in your `oco.jsonc` agent config, you can switch to Opus 4.7 by changing:

```jsonc
"model": "anthropic/claude-opus-4-7",
"thinking": { "type": "adaptive" },
"effort": "xhigh"   // or "high", "medium", "low", "max"
```

Existing 4.6 configs continue to work unchanged.

## Install

| Platform | Asset |
|----------|-------|
| macOS desktop | `OpenCodeOrchestra_1.1.3_aarch64.dmg` |
| Ubuntu / Debian | `OpenCodeOrchestra_1.1.3_amd64.deb` (`sudo dpkg -i <file>.deb`) |
| Fedora / RHEL | `OpenCodeOrchestra-1.1.3-1.x86_64.rpm` |
| macOS CLI (Apple Silicon) | `oco-darwin-arm64.tar.gz` |
| macOS CLI (Intel) | `oco-darwin-x64.tar.gz` |
| Linux CLI (terminal only) | `oco-linux-x64.tar.gz` |
| Windows CLI | `oco-windows-x64.zip` |
