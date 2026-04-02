# Schemas Reference

JSON schemas used throughout the skill creation and testing workflow.

## Table of Contents

- [Eval Set (evals.json)](#eval-set)
- [Eval Metadata (eval_metadata.json)](#eval-metadata)
- [Assertions](#assertions)
- [Grading Results (grading.json)](#grading-results)
- [Trigger Test Queries](#trigger-test-queries)
- [Workspace Layout](#workspace-layout)

---

## Eval Set

Master file for all test cases. Lives at `<skill-name>-workspace/evals.json`.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "The user's task prompt — realistic and detailed",
      "expected_output": "Description of what a good result looks like",
      "files": [],
      "assertions": [
        {
          "name": "output-file-exists",
          "type": "file_exists",
          "target": "outputs/result.json"
        }
      ]
    }
  ]
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill_name` | string | yes | Name matching the skill's frontmatter |
| `evals` | array | yes | List of test cases |
| `evals[].id` | number | yes | Unique identifier |
| `evals[].prompt` | string | yes | The test prompt to run |
| `evals[].expected_output` | string | yes | Human-readable description of expected result |
| `evals[].files` | array | no | Input files the test needs (paths relative to workspace) |
| `evals[].assertions` | array | no | Automated checks to run against outputs |

---

## Eval Metadata

Per-test-case metadata. Lives at `<workspace>/iteration-N/eval-<name>/eval_metadata.json`.

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "assertions": [
    {
      "name": "has-title-section",
      "type": "content_contains",
      "target": "outputs/report.md",
      "pattern": "^# .+"
    }
  ]
}
```

Give each eval a descriptive name based on what it tests — not generic labels like "eval-0". Use this name for the directory too.

---

## Assertions

Each assertion checks one specific thing about the output.

### Assertion Types

**`file_exists`** — Check that a file was created:

```json
{
  "name": "output-file-created",
  "type": "file_exists",
  "target": "outputs/result.json"
}
```

**`content_contains`** — Check that a file contains a regex pattern:

```json
{
  "name": "has-header-row",
  "type": "content_contains",
  "target": "outputs/data.csv",
  "pattern": "^name,email,role"
}
```

**`content_not_contains`** — Check that a file does NOT contain a pattern:

```json
{
  "name": "no-placeholder-text",
  "type": "content_not_contains",
  "target": "outputs/report.md",
  "pattern": "TODO|FIXME|placeholder"
}
```

**`json_valid`** — Check that a file is valid JSON:

```json
{
  "name": "valid-json-output",
  "type": "json_valid",
  "target": "outputs/config.json"
}
```

**`json_field`** — Check a specific field in a JSON file:

```json
{
  "name": "has-version-field",
  "type": "json_field",
  "target": "outputs/package.json",
  "field": "version",
  "pattern": "^\\d+\\.\\d+\\.\\d+$"
}
```

**`line_count`** — Check that a file has a number of lines within a range:

```json
{
  "name": "reasonable-length",
  "type": "line_count",
  "target": "outputs/summary.md",
  "min": 10,
  "max": 200
}
```

**`command`** — Run a shell command and check exit code:

```json
{
  "name": "typescript-compiles",
  "type": "command",
  "command": "npx tsc --noEmit outputs/index.ts",
  "expected_exit_code": 0
}
```

**`custom`** — Free-form check with a description for manual/LLM grading:

```json
{
  "name": "follows-coding-style",
  "type": "custom",
  "description": "Code should use 2-space indentation and single quotes"
}
```

### Assertion Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Descriptive name (shows in results) |
| `type` | string | yes | One of the types above |
| `target` | string | depends | File path relative to the run's output directory |
| `pattern` | string | depends | Regex pattern for content checks |
| `field` | string | depends | JSON field path for `json_field` type |
| `min` / `max` | number | depends | Bounds for `line_count` type |
| `command` | string | depends | Shell command for `command` type |
| `expected_exit_code` | number | no | Expected exit code (default: 0) |
| `description` | string | depends | Human-readable description for `custom` type |

---

## Grading Results

Per-run grading output. Lives at `<workspace>/iteration-N/eval-<name>/<run-type>/grading.json`.

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name",
  "run_type": "with_skill",
  "expectations": [
    {
      "text": "output-file-created",
      "passed": true,
      "evidence": "File exists at outputs/result.json (2.3 KB)"
    },
    {
      "text": "has-header-row",
      "passed": false,
      "evidence": "First line of outputs/data.csv is 'id,username,email' — expected 'name,email,role'"
    }
  ],
  "pass_rate": 0.5,
  "timestamp": "2026-03-19T10:30:00Z"
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `eval_id` | number | Matches eval_metadata |
| `eval_name` | string | Matches eval_metadata |
| `run_type` | string | `"with_skill"`, `"without_skill"`, or `"old_skill"` |
| `expectations` | array | One entry per assertion |
| `expectations[].text` | string | The assertion name |
| `expectations[].passed` | boolean | Whether it passed |
| `expectations[].evidence` | string | What was observed |
| `pass_rate` | number | Fraction of assertions that passed (0-1) |
| `timestamp` | string | ISO 8601 timestamp |

---

## Trigger Test Queries

For description optimization. Save as `<workspace>/trigger-eval.json`.

```json
[
  {
    "query": "ok so my boss just sent me this xlsx file and she wants me to add a profit margin column",
    "should_trigger": true
  },
  {
    "query": "write a fibonacci function in python",
    "should_trigger": false
  }
]
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | A realistic user prompt |
| `should_trigger` | boolean | Whether this skill should activate for this query |

---

## Workspace Layout

Full workspace directory structure for reference:

```
<skill-name>-workspace/
├── evals.json                          # Master eval set
├── trigger-eval.json                   # Trigger test queries (Phase 5)
├── skill-snapshot/                     # Copy of skill before editing (updates only)
├── iteration-1/
│   ├── eval-descriptive-name/
│   │   ├── eval_metadata.json
│   │   ├── with_skill/
│   │   │   ├── outputs/                # Files produced by the skill run
│   │   │   └── grading.json
│   │   └── without_skill/
│   │       ├── outputs/                # Files produced by the baseline run
│   │       └── grading.json
│   └── eval-another-test/
│       └── ...
├── iteration-2/
│   └── ...
└── iteration-N/
    └── ...
```
