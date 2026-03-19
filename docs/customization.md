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

- Add skills in your normal OpenCode skill directories.
- Add commands using your standard OpenCode command config paths.
- OCO does not change the basic extension model; it changes the agent hierarchy and workflow.

## Common Recipes

### "I only have Claude"

- Use the shipped config unchanged.
- Authenticate Anthropic.
- Keep Claude adaptive thinking fields on PM and subagents.

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

Example:

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

## Prompt Overrides

- The distributed config points agents at files in `~/.config/opencode/prompts/`.
- To customize behavior, copy a prompt file, edit it, and keep the config path stable.
- For team-wide distribution, check both the config and prompt files into your own repo or dotfiles setup.
