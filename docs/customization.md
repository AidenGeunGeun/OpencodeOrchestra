# Customization

OpenCodeOrchestra is opinionated about workflow, not about one provider stack. The distributed config is meant to be a strong default and a readable starting point.

## Config Merge Order

Lowest to highest precedence:

1. Remote well-known config, when a provider exposes `/.well-known/opencode`
2. Global user config: `~/.config/opencode/opencode.json` or `~/.config/opencode/opencode.jsonc`
3. `OPENCODE_CONFIG`, if set
4. Project config files discovered from parent directories: `opencode.jsonc` then `opencode.json`
5. `OPENCODE_CONFIG_CONTENT`, if set
6. Managed config loaded from the managed config directory, if present

Project-local config usually wins over global config, but the environment variable overrides are even higher priority.

## Swapping Models

### Claude-Only Setup

- Keep the shipped defaults.
- PM agents stay on `anthropic/claude-opus-4-6`.
- Subagents stay on `anthropic/claude-sonnet-4-6`.
- Use Claude-style fields:

```jsonc
"thinking": { "type": "adaptive" },
"effort": "high"
```

### Claude + GPT Setup

- Keep PM on Claude Opus.
- Move execution or review roles to GPT if you prefer.
- Use GPT-style fields:

```jsonc
"model": "openai/gpt-5",
"reasoningEffort": "high"
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

- Global permission entries in `config/opencode.jsonc` apply to every agent.
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

- Skills go in `~/.config/opencode/skill/<name>/SKILL.md`. Each skill is a directory with a `SKILL.md` file that describes when and how the skill should be loaded.
- Commands go in `~/.config/opencode/command/<name>.md`. Each command is a markdown file that defines a slash command template.
- OCO does not change the skill or command model — it changes the agent hierarchy and workflow.

## Common Recipes

### "I only have Claude"

- Use the shipped config unchanged.
- Authenticate Anthropic.
- Keep Claude adaptive thinking fields on PM and subagents.
- Claude Pro/Max OAuth support is bundled in OCO; no extra local Anthropic plugin is required.
- OCO's bundled Anthropic OAuth flow now uses OAuth-style form-urlencoded token requests instead of JSON.
- If Claude Pro/Max auth was already failing before an OCO update, re-run `oco auth login -p anthropic -m "Claude Pro/Max"` after upgrading so the stored auth state is refreshed.

### "I have Claude + GPT"

- Keep PM on Claude Opus.
- Move `orchestrator` and `auditor` to GPT if you want stronger GPT-style reasoning.
- Use `reasoningEffort` on those GPT-backed agents.

### "I want to add a custom agent"

- Add a new entry under `agent`.
- Choose `mode: "subagent"` or `mode: "primary"`.
- Point it at a prompt file.
- Define the minimum permissions it needs.
- If it is meant to persist like the Orchestrator, set `single_shot: false`; otherwise leave it single-shot.

Steps:

1. Create the prompt file at `~/.config/opencode/prompts/security-reviewer.txt` with the agent's system prompt.
2. Add the agent definition in your `opencode.jsonc`:

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

- The distributed config points agents at files in `~/.config/opencode/prompts/`.
- To customize behavior, copy a prompt file, edit it, and keep the config path stable.
- For team-wide distribution, check both the config and prompt files into your own repo or dotfiles setup.
