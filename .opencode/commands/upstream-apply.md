# /upstream-apply

Intelligently merge upstream changes into our codebase.

## Prerequisites
- Run `/upstream` first to download the new version to `./upstream-compare/`

## What This Command Does

1. Identifies files that differ between our code and upstream
2. Categorizes them: (a) files WE modified, (b) files only upstream changed, (c) new upstream files
3. Helps merge changes file-by-file with user approval

## Instructions

When the user runs `/upstream-apply [optional: specific file path]`:

### Step 1: Verify Upstream Download Exists
Check that `./upstream-compare/` contains a downloaded version.

### Step 2: Categorize Changes

**Category A - Files WE Modified (CAREFUL)**
These need intelligent merging - upstream changes + our customizations:
- `packages/opencode/src/agent/agent.ts`
- `packages/opencode/src/tool/task.ts`
- `packages/opencode/src/tool/registry.ts`
- `packages/opencode/src/config/config.ts`

**Category B - Files Only Upstream Changed (SAFE)**
These can usually be copied directly:
- Any file not in Category A that differs

**Category C - New Upstream Files (REVIEW)**
New files upstream added that we don't have.

**Category D - Our New Files (KEEP)**
Files we created that don't exist upstream - never touch:
- `packages/opencode/src/tool/finish-task.ts`
- `packages/opencode/src/tool/project-state.ts`

### Step 3: For Each File to Merge

If user specifies a file, or for each file in sequence:

1. **Show the diff** between our version and upstream version
2. **Identify what upstream changed** (new features, bug fixes)
3. **Identify our customizations** that must be preserved
4. **Propose a merged version** that includes both
5. **Wait for user approval** before applying

### Step 4: Apply with @TODO Markers

When applying changes, use @TODO markers for anything uncertain:
```typescript
// @TODO: Verify this upstream change doesn't break our orchestration logic
```

### Step 5: After Applying

Remind user to:
1. Run `bun run typecheck` to verify no type errors
2. Test the affected functionality
3. Commit the changes

## Our Customizations Reference

### agent.ts
- Removed `explore` agent definition
- Removed `general` agent definition  
- Added `singleShot: boolean` to Agent.Info schema
- Built-in agents: `build` and `plan` have `singleShot: false`
- Hidden agents: `compaction`, `title`, `summary` have `singleShot: true`
- Custom agents default to `singleShot: true`

### task.ts
- Added depth calculation via parentID chain traversal
- Depth 2+ always forces singleShot regardless of config
- Non-singleShot agents: starts prompt without awaiting, subscribes to Bus for finish_task tool completion
- Returns finish_task metadata (status, summary, learnings) to caller

### config.ts
- Added `single_shot` to agent config schema

### registry.ts
- Added `FinishTaskTool`
- Added `ProjectStateReadTool`
- Added `ProjectStateWriteTool`

## Example Usage

```
User: /upstream-apply packages/opencode/src/agent/agent.ts

Agent: I'll help merge upstream changes to agent.ts.

**Upstream changes (v1.1.36 → v1.1.39):**
- Added new `reasoning` agent type
- Fixed memory leak in agent cleanup
- Updated default system prompts

**Our customizations to preserve:**
- Removed explore/general agents
- Added singleShot config
- Modified agent creation logic

**Proposed merge:**
[shows merged code]

Apply this change? (yes/no)
```
