# Installation

## For Agents

> If you're an LLM agent helping set up OCO, follow these steps exactly.

### Step 1: Check Prerequisites

- Check if `oco` is installed by running `oco --version`.
- If it is not installed, tell the user they need to install the OCO binary first. Direct them to the GitHub Releases page at https://github.com/AidenGeunGeun/OpencodeOrchestra/releases or the "Build From Source" section below.
- **Version check — this is critical**: the version string **must start with `1.0.`** (e.g., `1.0.15`, `1.0.28`). If `oco --version` returns `1.1.x`, `1.2.x`, `1.3.x`, or any version that does NOT start with `1.0.`, that is the upstream opencode binary — not OCO. Remove it and install the OCO binary from GitHub Releases before continuing. OCO and upstream opencode are different projects with different sidecar code and agent architecture; layering OCO config on top of the wrong binary will not work.
- The OCO binary is always called `oco`. Do not substitute `opencode`.

### Step 2: Handle Existing Config

- If `~/.config/oco/oco.jsonc` already exists, back it up before replacing it:

```bash
cp ~/.config/oco/oco.jsonc ~/.config/oco/oco.jsonc.bak.$(date +%Y%m%d%H%M%S)
```

- If the user already has `~/.config/opencode/opencode.jsonc`, explain that OCO now uses `~/.config/oco/oco.jsonc` but still reads the old file as a read-only fallback.
- To migrate explicitly, run `./scripts/migrate-config.sh` from the repo. It copies `config`, `data`, `cache`, and `state` into the `oco` namespace, duplicates `opencode.jsonc`/`opencode.json` as `oco.jsonc`/`oco.json`, and does not delete the old paths.
- If the user is unsure, recommend keeping the fallback first, verifying OCO works, then running the migration script.

### Step 3: Migrate Chat History

**Always perform this check** — do not skip it, even on a fresh install.

1. Inspect both data directories:

```bash
ls ~/.local/share/opencode/ 2>/dev/null && echo "opencode data exists"
ls ~/.local/share/oco/      2>/dev/null && echo "oco data exists"
```

2. If data exists under `~/.local/share/opencode/` and not yet under `~/.local/share/oco/`, migrate it now:

```bash
rsync -a ~/.local/share/opencode/ ~/.local/share/oco/
```

3. OCO 1.0.28+ looks for `oco.db` specifically. Copy the database file with the new name:

```bash
cp ~/.local/share/oco/opencode.db ~/.local/share/oco/oco.db
```

4. Do **not** delete the originals. The source files in `~/.local/share/opencode/` are left in place as a backup.

If both directories already exist and `~/.local/share/oco/` already has data, skip this step.

### Step 4: Download Config Files

- Create the config directories if they do not exist:

```bash
mkdir -p \
  ~/.config/oco/prompts \
  ~/.config/oco/skills/agents-md/references \
  ~/.config/oco/skills/skill-creator/references
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
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/SKILL.md -o ~/.config/oco/skills/agents-md/SKILL.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/references/examples.md -o ~/.config/oco/skills/agents-md/references/examples.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/references/detection-patterns.md -o ~/.config/oco/skills/agents-md/references/detection-patterns.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/skill-creator/SKILL.md -o ~/.config/oco/skills/skill-creator/SKILL.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/skill-creator/references/schemas.md -o ~/.config/oco/skills/skill-creator/references/schemas.md
```

### Step 5: Configure Provider Authentication

- Run `oco auth login`.
- The shipped default config uses **OpenAI** models for every agent.
- Claude remains supported, but it is now an optional customization rather than the default.

### Step 6: Verify Setup

- Start the app with `oco`.
- Confirm the default entry agent is `build` (this is the PM).
- Confirm no missing-file errors appear on startup.
- Try a simple prompt like "What agents do you have available?" to verify the PM-style behavior is present.

### Step 7: Explain What They Have

Tell the user what was just installed:

- **PM** (`build`): the agent they talk to. It holds context, investigates, drafts specs, and delegates execution.
- **Orchestrator**: executes approved specs by spawning focused subagents.
- **Investigator**: reads and traces code without modifying anything.
- **Auditor**: reviews changes against the spec and returns PASS or FAIL.
- **Web-Search**: searches the web and returns evidence with citations.
- **Docs**: updates documentation files.
- **Compaction**: internal agent for context compression (hidden, automatic).
- **Bundled skills**: `agents-md` and `skill-creator` are installed into `~/.config/oco/skills/`.

Suggest a first task: ask the PM to investigate a codebase and draft a spec before implementing anything. That exercises the full hierarchy.

### Step 8: Explain How to Update

- OCO does not auto-update. Tell the user to check GitHub Releases manually: https://github.com/AidenGeunGeun/OpencodeOrchestra/releases
- CLI installs update by downloading the new archive, extracting it, and replacing the existing `oco` binary.
- Desktop installs update by reinstalling the new desktop artifact for that platform: `.dmg` on macOS, `.deb` on Ubuntu/Debian, `.rpm` on Fedora/RHEL.
- Config, skills, prompts, and chat history under `~/.config/oco/` and `~/.local/share/oco/` are not removed by reinstalling the binary or desktop app.

## For Humans

### Option A: Install From Release

1. Go to [GitHub Releases](https://github.com/AidenGeunGeun/OpencodeOrchestra/releases) and download the recommended file for your platform:

   | Platform | Recommended download |
   | --- | --- |
   | macOS | Desktop `.dmg` |
   | Ubuntu / Debian | `.deb` |
   | Fedora / RHEL | `.rpm` |
   | Windows | CLI `.zip` |
   | Linux terminal-only | CLI `.tar.gz` |

2. If you downloaded a desktop app (`.dmg`, `.deb`, `.rpm`), install/open that and you are done.
   - **macOS `.dmg` only**: before the first launch, run:
     ```bash
     xattr -cr /Applications/OpenCodeOrchestra.app
     ```
     The desktop app is unsigned, so Gatekeeper blocks it unless you clear the quarantine attribute first.

3. If you downloaded the CLI instead, put the binary on your PATH (e.g., `~/.local/bin/oco`).
   - **macOS**: the binary must be ad-hoc signed or macOS will silently kill it:
     ```bash
     codesign -f -s - ~/.local/bin/oco
     ```

4. Install the config files:

```bash
mkdir -p \
  ~/.config/oco/prompts \
  ~/.config/oco/skills/agents-md/references \
  ~/.config/oco/skills/skill-creator/references

curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/oco.jsonc -o ~/.config/oco/oco.jsonc

for f in pm orchestrator investigator auditor web-search docs compaction; do
  curl -fsSL "https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/${f}.txt" -o ~/.config/oco/prompts/${f}.txt
done

curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/SKILL.md -o ~/.config/oco/skills/agents-md/SKILL.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/references/examples.md -o ~/.config/oco/skills/agents-md/references/examples.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/references/detection-patterns.md -o ~/.config/oco/skills/agents-md/references/detection-patterns.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/skill-creator/SKILL.md -o ~/.config/oco/skills/skill-creator/SKILL.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/skill-creator/references/schemas.md -o ~/.config/oco/skills/skill-creator/references/schemas.md
```

5. Authenticate and launch:

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

Then install the config files using the curl commands from Option A step 4, or copy directly from the repo:

```bash
mkdir -p ~/.config/oco/prompts ~/.config/oco/skill
cp config/oco.jsonc ~/.config/oco/oco.jsonc
cp config/prompts/*.txt ~/.config/oco/prompts/
cp -R config/skills/* ~/.config/oco/skills/
```

## How to Update

There is no auto-update flow for OCO today. To update, check [GitHub Releases](https://github.com/AidenGeunGeun/OpencodeOrchestra/releases), download the newest release for your platform, and reinstall it.

### CLI Binary Update

1. Download the newest CLI archive for your platform from GitHub Releases.
2. Extract it and replace your existing `oco` binary (for example `~/.local/bin/oco`).
3. On macOS, re-run:

```bash
codesign -f -s - ~/.local/bin/oco
```

### Desktop Update on macOS

1. Download the newest `.dmg`.
2. Open it and drag `OpenCodeOrchestra.app` to `/Applications` again to replace the old app.
3. Before launching the new version, run:

```bash
xattr -cr /Applications/OpenCodeOrchestra.app
```

### Desktop Update on Ubuntu / Debian

1. Download the newest `.deb`.
2. Install it in place:

```bash
sudo dpkg -i <new-file>.deb
```

`dpkg` upgrades the existing installation in place.

### What Updates Do Not Change

- Replacing the CLI binary or reinstalling the desktop app does not remove your config or chat history. Those live separately in `~/.config/oco/` and `~/.local/share/oco/`.
- Skills and prompts under `~/.config/oco/` are also left alone. If you want the latest shipped versions, you can re-run the `curl` install commands from this guide.

### Verification Checklist

- `oco --version` reports `1.0.x` (must start with `1.0.` — any other prefix means you have the upstream opencode binary, not OCO)
- `~/.config/oco/oco.jsonc` exists
- `~/.config/oco/prompts/` contains 7 `.txt` files
- `~/.config/oco/skills/agents-md/` and `~/.config/oco/skills/skill-creator/` exist
- `oco` opens without errors
- The default session starts with the `build` agent (the PM)

## Troubleshooting

- **`oco --version` shows a version like `1.2.x` or `1.3.x`**: that is the upstream opencode binary, not OCO. Remove it (`rm $(which oco)`), then install the OCO binary from GitHub Releases. OCO versions always start with `1.0.`
- **Binary killed on macOS with no error**: run `codesign -f -s - ~/.local/bin/oco`. Unsigned binaries are silently killed by Gatekeeper (exit code 137).
- **Missing prompt or skill file errors**: re-download the prompt files and bundled skill files using the commands above.
- **Wrong default model or provider unavailable**: edit `~/.config/oco/oco.jsonc` — see [customization.md](customization.md).
- **Old session history missing after upgrade**: run `scripts/migrate-config.sh` so `~/.local/share/opencode/` is copied into `~/.local/share/oco/`. Also copy `opencode.db` to `oco.db` inside `~/.local/share/oco/` for OCO 1.0.28+.
- **Config conflicts with existing setup**: restore your backup, confirm OCO works with the shipped config first, then merge your custom entries back in.
