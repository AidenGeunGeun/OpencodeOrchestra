# Installation

## For Agents

> If you're an LLM agent helping set up OCO, follow these steps exactly.

### Step 1: Check Prerequisites

- Check if `oco` or `opencode` is installed by running `oco --version` or `opencode --version`.
- If neither is installed, tell the user they need to install the OCO binary first. Direct them to the GitHub Releases page at https://github.com/AidenGeunGeun/OpencodeOrchestra/releases or the "Build From Source" section below.
- If installed, confirm the version is `1.0.15` or newer.
- Throughout the rest of these steps, use whichever command name is available (`oco` or `opencode` — they are the same binary).

### Step 2: Handle Existing Config

- If `~/.config/oco/oco.jsonc` already exists, back it up before replacing it:

```bash
cp ~/.config/oco/oco.jsonc ~/.config/oco/oco.jsonc.bak.$(date +%Y%m%d%H%M%S)
```

- If the user already has `~/.config/opencode/opencode.jsonc`, explain that OCO now uses `~/.config/oco/oco.jsonc` but still reads the old file as a read-only fallback.
- To migrate explicitly, run `./scripts/migrate-config.sh` from the repo. It copies `config`, `data`, `cache`, and `state` into the `oco` namespace, duplicates `opencode.jsonc`/`opencode.json` as `oco.jsonc`/`oco.json`, and does not delete the old paths.
- If the user is unsure, recommend keeping the fallback first, verifying OCO works, then running the migration script.

### Step 3: Download Config Files

- Create the config directories if they do not exist:

```bash
mkdir -p \
  ~/.config/oco/prompts \
  ~/.config/oco/skill/agents-md/references \
  ~/.config/oco/skill/skill-creator/references
```

- Fetch the main config file:

```bash
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/oco.jsonc -o ~/.config/oco/oco.jsonc
```

- Fetch the seven system prompts:

```bash
for f in pm orchestrator investigator auditor web-search docs compaction; do
  curl -fsSL "https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/${f}.txt" -o ~/.config/oco/prompts/${f}.txt
done
```

- Fetch the bundled skills:

```bash
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/SKILL.md -o ~/.config/oco/skill/agents-md/SKILL.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/references/examples.md -o ~/.config/oco/skill/agents-md/references/examples.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/references/detection-patterns.md -o ~/.config/oco/skill/agents-md/references/detection-patterns.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/skill-creator/SKILL.md -o ~/.config/oco/skill/skill-creator/SKILL.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/skill-creator/references/schemas.md -o ~/.config/oco/skill/skill-creator/references/schemas.md
```

### Step 4: Configure Provider Authentication

- Run `oco auth login` (or `opencode auth login`).
- The shipped default config uses **OpenAI** models for every agent.
- Claude remains supported, but it is now an optional customization rather than the default.

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
- **Web-Search**: searches the web and returns evidence with citations.
- **Docs**: updates documentation files.
- **Compaction**: internal agent for context compression (hidden, automatic).
- **Bundled skills**: `agents-md` and `skill-creator` are installed into `~/.config/oco/skill/`.

### Step 7: Optional Migration

- If the user is upgrading from an older OpenCode/OpenCodeOrchestra install, point them at `scripts/migrate-config.sh`.
- The script copies these trees without deleting the originals:
  - `~/.config/opencode/` -> `~/.config/oco/`
  - `~/.local/share/opencode/` -> `~/.local/share/oco/`
  - `~/.cache/opencode/` -> `~/.cache/oco/`
  - `~/.local/state/opencode/` -> `~/.local/state/oco/`
- It also copies `~/.config/opencode/opencode.jsonc` to `~/.config/oco/oco.jsonc` and `~/.config/opencode/opencode.json` to `~/.config/oco/oco.json` when the new filenames are missing.
- Session history only moves if the user runs the script, because the new namespace is intentionally separate.

Suggest a first task: ask the PM to investigate a codebase and draft a spec before implementing anything. That exercises the full hierarchy.

## For Humans

### Option A: Install From Release

1. Go to [GitHub Releases](https://github.com/AidenGeunGeun/OpencodeOrchestra/releases) and download the recommended file for your platform:

   | Platform | Recommended download |
   | --- | --- |
   | macOS | Desktop `.dmg` |
   | Ubuntu / Debian | Desktop `.AppImage` first, `.deb` second |
   | Fedora / RHEL | Desktop `.AppImage` first, `.rpm` second |
   | Windows | CLI `.zip` |
   | Linux terminal-only | CLI `.tar.gz` |

2. If you downloaded a desktop app (`.dmg`, `.AppImage`, `.deb`, `.rpm`), install/open that and you are done.

3. If you downloaded the CLI instead, put the binary on your PATH (e.g., `~/.local/bin/oco`).
   - **macOS**: the binary must be ad-hoc signed or macOS will silently kill it:
     ```bash
     codesign -f -s - ~/.local/bin/oco
     ```

4. Install the config files:

```bash
mkdir -p \
  ~/.config/oco/prompts \
  ~/.config/oco/skill/agents-md/references \
  ~/.config/oco/skill/skill-creator/references

curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/oco.jsonc -o ~/.config/oco/oco.jsonc

for f in pm orchestrator investigator auditor web-search docs compaction; do
  curl -fsSL "https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/${f}.txt" -o ~/.config/oco/prompts/${f}.txt
done

curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/SKILL.md -o ~/.config/oco/skill/agents-md/SKILL.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/references/examples.md -o ~/.config/oco/skill/agents-md/references/examples.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/references/detection-patterns.md -o ~/.config/oco/skill/agents-md/references/detection-patterns.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/skill-creator/SKILL.md -o ~/.config/oco/skill/skill-creator/SKILL.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/skill-creator/references/schemas.md -o ~/.config/oco/skill/skill-creator/references/schemas.md
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
mkdir -p ~/.config/oco/prompts ~/.config/oco/skill
cp config/oco.jsonc ~/.config/oco/oco.jsonc
cp config/prompts/*.txt ~/.config/oco/prompts/
cp -R config/skills/* ~/.config/oco/skill/
```

### Verification Checklist

- `oco --version` reports `1.0.15+`
- `~/.config/oco/oco.jsonc` exists
- `~/.config/oco/prompts/` contains 7 `.txt` files
- `~/.config/oco/skill/agents-md/` and `~/.config/oco/skill/skill-creator/` exist
- `oco` opens without errors
- The default session starts with the `build` agent (the PM)

## Troubleshooting

- **Binary killed on macOS with no error**: run `codesign -f -s - ~/.local/bin/oco`. Unsigned binaries are silently killed by Gatekeeper (exit code 137).
- **Missing prompt or skill file errors**: re-download the prompt files and bundled skill files using the commands above.
- **Wrong default model or provider unavailable**: edit `~/.config/oco/oco.jsonc` — see [customization.md](customization.md).
- **Old session history missing after upgrade**: run `scripts/migrate-config.sh` so `~/.local/share/opencode/` is copied into `~/.local/share/oco/`.
- **Config conflicts with existing setup**: restore your backup, confirm OCO works with the shipped config first, then merge your custom entries back in.
