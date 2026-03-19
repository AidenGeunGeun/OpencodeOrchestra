# Installation

## For Agents

> If you're an LLM agent helping set up OCO, follow these steps exactly.

### Step 1: Check Prerequisites

- Check if `oco` or `opencode` is installed by running `oco --version` or `opencode --version`.
- If neither is installed, tell the user they need to install the OCO binary first. Direct them to the GitHub Releases page at https://github.com/AidenGeunGeun/OpencodeOrchestra/releases or the "Build From Source" section below.
- If installed, confirm the version is `1.0.15` or newer.
- Throughout the rest of these steps, use whichever command name is available (`oco` or `opencode` — they are the same binary).

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

- Fetch the seven system prompts:

```bash
for f in pm orchestrator investigator auditor researcher docs compaction; do
  curl -fsSL "https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/${f}.txt" -o ~/.config/opencode/prompts/${f}.txt
done
```

### Step 4: Configure Provider Authentication

- Run `oco auth login` (or `opencode auth login`).
- The shipped default config only requires **Anthropic** (Claude). GPT is optional.
- If the user wants to use GPT models for some agents, they will need OpenAI access too — see `docs/customization.md` for how to swap models.

### Step 5: Verify Setup

- Start the app with `oco` (or `opencode`).
- Confirm the default entry agent is `build` (this is the PM).
- Confirm no missing-file errors appear on startup.
- Try a simple prompt like "What agents do you have available?" to verify the PM-style behavior is present.

### Step 6: Explain What They Have

Tell the user what was just installed:

- **PM** (`build`): the agent they talk to. It holds context, investigates, drafts specs, and delegates execution.
- **Orchestrator**: executes approved specs by spawning focused subagents.
- **Investigator**: reads and traces code without modifying anything.
- **Auditor**: reviews changes against the spec and returns PASS or FAIL.
- **Researcher**: fetches information from the web.
- **Docs**: updates documentation files.
- **Compaction**: internal agent for context compression (hidden, automatic).

Suggest a first task: ask the PM to investigate a codebase and draft a spec before implementing anything. That exercises the full hierarchy.

## For Humans

### Option A: Install From Release

1. Go to [GitHub Releases](https://github.com/AidenGeunGeun/OpencodeOrchestra/releases) and download the binary for your platform.

2. Put the binary on your PATH (e.g., `~/.local/bin/oco`).
   - **macOS**: the binary must be ad-hoc signed or macOS will silently kill it:
     ```bash
     codesign -f -s - ~/.local/bin/oco
     ```

3. Install the config files:

```bash
mkdir -p ~/.config/opencode/prompts

curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/opencode.jsonc -o ~/.config/opencode/opencode.jsonc

for f in pm orchestrator investigator auditor researcher docs compaction; do
  curl -fsSL "https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/${f}.txt" -o ~/.config/opencode/prompts/${f}.txt
done
```

4. Authenticate and launch:

```bash
oco auth login
oco
```

### Option B: Build From Source

Requires [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`).

```bash
git clone https://github.com/AidenGeunGeun/OpencodeOrchestra.git
cd OpencodeOrchestra && bun install
cd packages/opencode && bun run build --single --skip-install
```

The binary is at `dist/@skybluejacket/oco-<platform>-<arch>/bin/oco`. Copy it to your PATH:

```bash
cp dist/@skybluejacket/oco-darwin-arm64/bin/oco ~/.local/bin/oco
codesign -f -s - ~/.local/bin/oco   # macOS only
```

Then install the config files using the curl commands from Option A step 3, or copy directly from the repo:

```bash
mkdir -p ~/.config/opencode/prompts
cp config/opencode.jsonc ~/.config/opencode/opencode.jsonc
cp config/prompts/*.txt ~/.config/opencode/prompts/
```

### Verification Checklist

- `oco --version` reports `1.0.15+`
- `~/.config/opencode/opencode.jsonc` exists
- `~/.config/opencode/prompts/` contains 7 `.txt` files
- `oco` opens without errors
- The default session starts with the `build` agent (the PM)

## Troubleshooting

- **Binary killed on macOS with no error**: run `codesign -f -s - ~/.local/bin/oco`. Unsigned binaries are silently killed by Gatekeeper (exit code 137).
- **Missing prompt file errors**: re-download the prompt files using the curl loop above.
- **Wrong default model or provider unavailable**: edit `~/.config/opencode/opencode.jsonc` — see [customization.md](customization.md).
- **Config conflicts with existing setup**: restore your backup, confirm OCO works with the shipped config first, then merge your custom entries back in.
