# /upstream

Check for upstream opencode updates and download for comparison.

## What This Command Does

1. Fetches the latest release info from `anomalyco/opencode`
2. Compares against our current base version (v1.1.36)
3. If newer version exists, downloads source to `./upstream-compare/{version}/`
4. Shows a summary of what files changed

## Instructions

When the user runs `/upstream`, perform these steps:

### Step 1: Check Latest Release
```bash
curl -s https://api.github.com/repos/anomalyco/opencode/releases/latest | grep -E '"tag_name"|"name"|"published_at"'
```

### Step 2: Report Status
Tell the user:
- Current base version: **v1.1.36**
- Latest upstream version: (from API)
- Whether we're behind

### Step 3: Download (if user confirms)
If there's a new version and user wants to download:

```bash
mkdir -p ./upstream-compare
cd ./upstream-compare
curl -L https://github.com/anomalyco/opencode/archive/refs/tags/{VERSION}.zip -o {VERSION}.zip
unzip {VERSION}.zip
rm {VERSION}.zip
```

### Step 4: Quick Diff Summary
Show which key files differ between our code and upstream:
- `packages/opencode/src/agent/agent.ts` (we modified: removed explore/general, added singleShot)
- `packages/opencode/src/tool/task.ts` (we modified: orchestrator behavior)
- `packages/opencode/src/tool/finish-task.ts` (we added)
- `packages/opencode/src/tool/project-state.ts` (we added)

Use this to diff:
```bash
diff -rq ./packages/opencode/src ./upstream-compare/opencode-{VERSION}/packages/opencode/src | head -50
```

## Our Customizations to Preserve
When reviewing diffs, remember these are OUR changes that must be preserved:
1. **agent.ts**: Removed `explore` and `general` agents, added `singleShot` config
2. **task.ts**: Modified for orchestrator vs subagent behavior, depth tracking
3. **finish-task.ts**: New file - orchestrator completion tool
4. **project-state.ts**: New file - PM-only project state tools
5. **registry.ts**: Added our new tools
6. **config.ts**: Added `single_shot` config option
