# Installation

## For Agents

> If you're an LLM agent helping set up OCO, follow these steps exactly.

### Step 1: Check Prerequisites

- Verify `oco` or `opencode` is installed.
- Run `oco --version` or `opencode --version`.
- Confirm the installed version is `1.0.15` or newer.

### Step 2: Handle Existing Config

- If `~/.config/opencode/opencode.jsonc` already exists, back it up before replacing it:

```bash
cp ~/.config/opencode/opencode.jsonc ~/.config/opencode/opencode.jsonc.bak.$(date +%Y%m%d%H%M%S)
```

- If the user already has a custom OpenCode setup, ask whether to merge or replace.
- If the user is unsure, recommend backing up and replacing first, then reapplying custom MCP/plugin/model entries after OCO is working.

### Step 3: Download Config Files

- Create the config directories if they do not exist:

```bash
mkdir -p ~/.config/opencode/prompts
```

- Fetch the main config file:

```bash
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/opencode.jsonc -o ~/.config/opencode/opencode.jsonc
```

- Fetch the seven shipped prompts:

```bash
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/pm.txt -o ~/.config/opencode/prompts/pm.txt
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/orchestrator.txt -o ~/.config/opencode/prompts/orchestrator.txt
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/investigator.txt -o ~/.config/opencode/prompts/investigator.txt
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/auditor.txt -o ~/.config/opencode/prompts/auditor.txt
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/researcher.txt -o ~/.config/opencode/prompts/researcher.txt
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/docs.txt -o ~/.config/opencode/prompts/docs.txt
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/compaction.txt -o ~/.config/opencode/prompts/compaction.txt
```

### Step 4: Configure Provider Authentication

- Run `oco auth login` or `opencode auth login`.
- Support either of these setups:
  - Anthropic only
  - OpenAI only
  - Anthropic + OpenAI mixed setup
- If using the shipped default config, Anthropic access is sufficient because PM and subagents default to Claude models.

### Step 5: Verify Setup

- Start the app:

```bash
oco
```

- Confirm the default entry agent is `build`.
- Confirm the prompt files load without missing-file errors.
- Create a session and verify the PM-style behavior is present.

### Step 6: Explain What They Have

- PM agents: `build` and hidden `plan`
- Execution agent: `orchestrator`
- Specialist subagents: `investigator`, `auditor`, `researcher`, `docs`
- Internal utility agent: `compaction`
- Point them to `docs/agents.md` for role details.
- Suggest a simple first task: ask the PM to investigate a repo and draft a spec before implementing.

## For Humans

### Install From Release

1. Download the latest release for your platform from GitHub Releases.
2. Install the binary or app.
3. Create the config directory:

```bash
mkdir -p ~/.config/opencode/prompts
```

4. Back up any existing config before replacing it:

```bash
cp ~/.config/opencode/opencode.jsonc ~/.config/opencode/opencode.jsonc.bak.$(date +%Y%m%d%H%M%S) 2>/dev/null || true
```

5. Copy the shipped files from this repo:

```bash
cp config/opencode.jsonc ~/.config/opencode/opencode.jsonc
cp config/prompts/*.txt ~/.config/opencode/prompts/
```

6. Authenticate providers:

```bash
oco auth login
```

7. Start OCO:

```bash
oco
```

### Build From Source

```bash
git clone https://github.com/AidenGeunGeun/OpencodeOrchestra.git
cd OpencodeOrchestra
bun install
cd packages/opencode
bun run build --single --skip-install
```

Then copy the built `oco` binary into your preferred location and install the config files as shown above.

### Quick Verification Checklist

- `oco --version` reports `1.0.15+`
- `~/.config/opencode/opencode.jsonc` exists
- `~/.config/opencode/prompts/` contains 7 files
- `oco` opens successfully
- The default session starts in the PM-facing `build` agent

## Troubleshooting

- Missing prompt file errors: recopy `config/prompts/*.txt` into `~/.config/opencode/prompts/`
- Wrong default model or unavailable provider: edit `~/.config/opencode/opencode.jsonc` and see `docs/customization.md`
- Existing custom config conflicts: restore your backup, then merge only the parts you need after confirming OCO works with the shipped files
