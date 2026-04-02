# Customization

OpenCodeOrchestra is opinionated about workflow, not about one provider stack. The distributed config is meant to be a strong default and a readable starting point.

## Config Merge Order

Lowest to highest precedence:

1. Remote well-known config, when a provider exposes `/.well-known/opencode`
2. Global user config: `~/.config/oco/oco.json` or `~/.config/oco/oco.jsonc`
3. `OCO_CONFIG` or `OPENCODE_CONFIG`, if set (`OCO_` wins when both are present)
4. Project config files discovered from parent directories: `oco.jsonc` then `oco.json`
5. `OCO_CONFIG_CONTENT` or `OPENCODE_CONFIG_CONTENT`, if set (`OCO_` wins when both are present)
6. Managed config loaded from the managed config directory, if present

Project-local config usually wins over global config, but the environment variable overrides are even higher priority. If `~/.config/oco/oco.jsonc` does not exist yet, OCO falls back to `~/.config/opencode/opencode.jsonc` for read-only compatibility.

## Swapping Models

### OpenAI-First Setup

- Keep the shipped defaults.
- PM, Orchestrator, and Auditor stay on `openai/gpt-5.4`.
- Investigator, Web-Search, Docs, and Compaction stay on `openai/gpt-5.4-mini`.
- Use GPT-style fields:

```jsonc
"reasoningEffort": "high"
```

### Claude + OpenAI Setup

- Keep the shipped OpenAI defaults if you want the simplest setup.
- Move any role back to Claude if you prefer Anthropic for planning or writing.
- Use Claude-style fields:

```jsonc
"model": "anthropic/claude-sonnet-4-6",
"thinking": { "type": "adaptive" },
"effort": "high"
```

Do not mix `reasoningEffort` into Claude configuration or Claude `thinking`/`effort` into GPT configuration.

### OpenAI Subscription Models

- The built-in OpenAI/Codex OAuth path supports the GPT-5.4 family directly.
- Canonical upstream slugs such as `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.4-nano` are allowed on the subscription-backed path.
- Custom aliases should still resolve to a real upstream model via `api.id`.
- If you want a fast lane alias such as `openai/gpt-5.4-fast`, keep the upstream model canonical and express the difference through provider options like `serviceTier: "priority"`.

Example:

```jsonc
"provider": {
  "openai": {
    "models": {
      "gpt-5.4-fast": {
        "id": "gpt-5.4",
        "name": "GPT-5.4 Fast",
        "options": {
          "serviceTier": "priority"
        }
      }
    }
  }
}
```

## Adjusting Permissions

- Global permission entries in `config/oco.jsonc` apply to every agent.
- Agent-level permission blocks then tighten or extend that baseline.
- Use the shipped secret deny list as a floor, not a suggestion.

Example: allow the Docs agent to use an extra tool.

```jsonc
"agent": {
  "docs": {
    "permission": {
      "bash": "allow",
      "apply_patch": "allow"
    }
  }
}
```

## Adding Custom Models

Define them under `provider.<provider>.models.<name>`.

Example:

```jsonc
"provider": {
  "openai": {
    "models": {
      "gpt-5-fast": {
        "id": "gpt-5",
        "name": "GPT-5 Fast",
        "limit": { "context": 400000, "output": 128000 },
        "variants": {
          "high": { "reasoningEffort": "high" }
        }
      }
    }
  }
}
```

Then reference it from an agent with `"model": "openai/gpt-5-fast"`.

## Adding Plugins

Plugins load from the top-level `plugin` array.

```jsonc
"plugin": [
  "github:your-org/your-plugin#main"
]
```

Add them after OCO is already working so debugging remains straightforward.

## Adding MCP Servers

Define MCP servers under the top-level `mcp` object.

```jsonc
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp",
    "enabled": false
  }
}
```

Start disabled, then enable only after credentials and network assumptions are correct.

## Adding Skills And Commands

- Skills go in `~/.config/oco/skill/<name>/SKILL.md`. Each skill is a directory with a `SKILL.md` file that describes when and how the skill should be loaded.
- Commands go in `~/.config/oco/command/<name>.md`. Each command is a markdown file that defines a slash command template.
- OCO does not change the skill or command model — it changes the agent hierarchy and workflow.

## Common Recipes

### "I only have Claude"

- Swap the shipped OpenAI defaults to Claude models in `config/oco.jsonc`.
- Authenticate Anthropic.
- Use Claude adaptive thinking fields on any agent you move.
- Claude Pro/Max OAuth support is bundled in OCO; no extra local Anthropic plugin is required.
- OCO's bundled Anthropic OAuth flow now uses OAuth-style form-urlencoded token requests instead of JSON, avoids the toxic OpenCode auth fingerprint, and sends a Claude CLI-style auth `User-Agent` on token exchange / refresh.
- The bundled flow also sends the original PKCE verifier back as the exchange `state`, which avoids broken plain-code pastes where no `#...` suffix is present.
- If Claude Pro/Max auth was already failing before an OCO update, re-run `oco auth login -p anthropic -m "Claude Pro/Max"` after upgrading so the stored auth state is refreshed.

### "I have Claude + GPT"

- Keep the shipped OpenAI defaults unless you have a reason to override them.
- Move PM or Docs to Claude if you prefer Anthropic's style for planning or writing.
- Use `reasoningEffort` on GPT-backed agents and `thinking`/`effort` on Claude-backed agents.

### "I want to add a custom agent"

- Add a new entry under `agent`.
- Choose `mode: "subagent"` or `mode: "primary"`.
- Point it at a prompt file.
- Define the minimum permissions it needs.
- If it is meant to persist like the Orchestrator, set `single_shot: false`; otherwise leave it single-shot.

Steps:

1. Create the prompt file at `~/.config/oco/prompts/security-reviewer.txt` with the agent's system prompt.
2. Add the agent definition in your `oco.jsonc`:

```jsonc
"agent": {
  "security-reviewer": {
    "mode": "subagent",
    "description": "Security-focused review pass.",
    "model": "anthropic/claude-sonnet-4-6",
    "prompt": "{file:prompts/security-reviewer.txt}",
    "thinking": { "type": "adaptive" },
    "effort": "high",
    "permission": {
      "grep": "allow",
      "glob": "allow",
      "edit": "deny"
    }
  }
}
```

3. Restart `oco`. The new agent will be available as a subagent that the Orchestrator can spawn.

## Prompt Overrides

- The distributed config points agents at files in `~/.config/oco/prompts/`.
- To customize behavior, copy a prompt file, edit it, and keep the config path stable.
- For team-wide distribution, check both the config and prompt files into your own repo or dotfiles setup.
