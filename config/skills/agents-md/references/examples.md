# AGENTS.md Examples

Real-world patterns extracted from notable open-source projects. Read this file when you need inspiration for specific section styles or project types.

---

## Example 1: CLI Tool in Rust (based on OpenAI Codex)

Strong example of language-specific conventions, testing patterns, and architectural boundaries.

```markdown
# AGENTS.md

## Setup
- Install dependencies: `cargo build`
- Install dev tools: `cargo install cargo-insta just`
- Format after changes: `just fmt`

## Code style
- Inline format! args when possible: `format!("{x}")` not `format!("{}", x)`
- Collapse if statements per clippy::collapsible_if
- Use method references over closures when possible
- Prefer exhaustive match statements — avoid wildcard arms
- Avoid bool parameters that force callers to write `foo(false)` — prefer enums
- Do not create helper methods referenced only once
- Target modules under 500 LoC (excluding tests). If a file exceeds 800 LoC, add new code in a new module.

## Testing
- Run package tests: `cargo test -p <crate-name>`
- Run full suite: `cargo test` (ask before running — it's slow)
- Snapshot tests use `insta`. After UI changes:
  - `cargo test -p <crate>` to generate snapshots
  - `cargo insta pending-snapshots -p <crate>` to review
  - `cargo insta accept -p <crate>` to accept
- Use `pretty_assertions::assert_eq` for clearer diffs
- Prefer deep equals on entire objects, not individual fields
- Do not mutate process environment in tests

## Linting
- Run `just fix -p <project>` before finalizing changes
- Scope with `-p` to avoid slow workspace-wide Clippy builds

## Dependencies
- If you change `Cargo.toml` or `Cargo.lock`, run `just bazel-lock-update` from repo root
- After dependency changes, run `just bazel-lock-check`

## Architecture
- Crate names are prefixed with `codex-` (e.g., `core/` → `codex-core`)
- If you add `include_str!` or similar build-time file reads, update the crate's `BUILD.bazel`
```

**Key patterns:**
- Exact commands with package scoping
- Clippy rules by name with links
- Module size limits as concrete numbers
- Dependency change workflow

---

## Example 2: Large Python Monorepo (based on Apache Airflow)

Strong example of monorepo structure, test isolation, and PR guidelines.

```markdown
# AGENTS.md

## Environment Setup
- Install prek: `uv tool install prek`
- Enable commit hooks: `prek install`
- Never run pytest or python directly on the host — always use `breeze`
- Place temporary scripts in `dev/` (mounted as `/opt/airflow/dev/` inside Breeze)

## Commands
- Run single test: `uv run --project <PROJECT> pytest path/to/test.py::TestClass::test_method -xvs`
- Run test file: `uv run --project <PROJECT> pytest path/to/test.py -xvs`
- If uv tests fail with missing system deps: `breeze run pytest <tests> -xvs`
- Type-check: `breeze run mypy path/to/code`
- Lint: `prek run ruff --from-ref <target_branch>`
- Format: `prek run ruff-format --from-ref <target_branch>`
- Static checks: `prek run --from-ref <target_branch> --stage pre-commit`

## Repository Structure
UV workspace monorepo. Key paths:
- `airflow-core/src/airflow/` — core scheduler, API, CLI, models
- `task-sdk/` — lightweight SDK for DAG authoring
- `providers/` — 100+ provider packages, each with own pyproject.toml
- `chart/` — Helm chart for Kubernetes deployment

## Architecture Boundaries
1. Users author DAGs with the Task SDK (`airflow.sdk`)
2. Scheduler reads serialized DAGs — never runs user code
3. Workers execute via Task SDK, communicate through Execution API — never access metadata DB directly
4. API Server handles all client-database interactions

## Coding Standards
- Format and lint immediately after editing: `uv run ruff format <file>` && `uv run ruff check --fix <file>`
- No `assert` in production code
- `time.monotonic()` for durations, not `time.time()`
- Functions with `session` parameter must not call `session.commit()`
- Apache License header on all new files

## Testing Standards
- Use pytest patterns, not unittest.TestCase
- Use `spec`/`autospec` when mocking
- Use `time_machine` for time-dependent tests
- Use `@pytest.mark.db_test` for tests that require database access
- Test location mirrors source: `airflow/cli/cli_parser.py` → `tests/cli/test_cli_parser.py`

## Commits and PRs
- Write commit messages focused on user impact, not implementation details
  - Good: `Fix airflow dags test command failure without serialized DAGs`
  - Bad: `Initialize DAG bundles in CLI get_dag function`
- Never add Co-Authored-By with yourself as co-author
- Always push to the user's fork, not upstream
- Title format: short, under 70 chars

## Boundaries
- Ask first: large refactors, new dependencies, destructive migrations
- Never: commit secrets, edit generated files by hand, destructive git operations
```

**Key patterns:**
- Explicit "never run X directly" safety rails
- Architecture as numbered data flow
- Commit message good/bad examples
- Fork workflow for PRs

---

## Example 3: TypeScript Monorepo (Turbo/pnpm)

Compact example for a typical modern web project.

```markdown
# AGENTS.md

## Setup
- Install deps: `pnpm install`
- Use `pnpm dlx turbo run where <project>` to locate packages

## Dev environment
- Run `pnpm install --filter <project>` to add a package to your workspace
- Use `pnpm create vite@latest <project> -- --template react-ts` for new React packages
- Check the `name` field in each package's `package.json` for the correct name

## Testing
- Run package tests: `pnpm turbo run test --filter <project>`
- From package root: `pnpm test`
- Focus on one test: `pnpm vitest run -t "<test name>"`
- Fix all test and type errors before merging
- After moving files or changing imports: `pnpm lint --filter <project>`
- Add or update tests for changed code, even if nobody asked

## PRs
- Title format: `[<project>] <Title>`
- Always run `pnpm lint` and `pnpm test` before committing
```

**Key patterns:**
- Workspace navigation tips
- Package-scoped commands with filter syntax
- Brief but complete

---

## Example 4: Go Service

Clean example of Go conventions, test patterns, and API guidelines.

```markdown
# AGENTS.md

## Setup
- Install dependencies: `go mod download`
- Run dev server: `go run ./cmd/server`
- Required: Go 1.22+, Docker (for integration tests)

## Commands
- Build: `go build ./...`
- Vet: `go vet ./...`
- Lint: `golangci-lint run`
- Format: `goimports -w .`

## Testing
- Run all tests: `go test ./...`
- Run single test: `go test -run TestName ./path/to/package`
- Run with verbose output: `go test -v -count=1 ./path/to/package`
- Integration tests (require Docker): `go test -tags=integration ./...`
- Always use table-driven tests for multiple inputs
- Use `testify/assert` for assertions, `testify/require` for fatal checks

## Code style
- Follow standard Go conventions (Effective Go)
- Use `context.Context` as first parameter for any function that does I/O
- Errors must be wrapped with `fmt.Errorf("doing X: %w", err)` — never bare returns
- No `init()` functions except in `main` package
- Unexported types by default — export only when needed by another package
- Handler functions take `(w http.ResponseWriter, r *http.Request)` — no custom wrappers

## Architecture
- `cmd/server/` — main entrypoint
- `internal/api/` — HTTP handlers and middleware
- `internal/domain/` — business logic (no HTTP, no DB imports)
- `internal/store/` — database access (implements domain interfaces)
- `pkg/` — shared libraries safe for external use

Domain must not import from api or store. Store implements domain interfaces.

## Database
- Migrations in `migrations/` using golang-migrate
- Apply: `migrate -path migrations -database $DATABASE_URL up`
- New migration: `migrate create -ext sql -dir migrations -seq <name>`
- Never modify existing migrations — always create new ones
```

**Key patterns:**
- Table-driven test convention stated explicitly
- Error wrapping format specified
- Clean architecture boundaries with interface direction
- Migration safety rule

---

## Example 5: Java/Gradle Monorepo

```markdown
# AGENTS.md

## Setup
- Build all modules: `./gradlew build`
- Required: JDK 21+, Docker (for testcontainers)

## Commands
- Build: `./gradlew build`
- Test: `./gradlew test`
- Single module test: `./gradlew :module-name:test`
- Single test: `./gradlew :module-name:test --tests "com.example.MyTest.testMethod"`
- Lint: `./gradlew spotlessCheck`
- Format: `./gradlew spotlessApply`
- Type check: compilation is the type check (`./gradlew compileJava`)

## Code style
- Google Java Style (enforced by Spotless)
- Run `./gradlew spotlessApply` after every edit — do not commit unformatted code
- Use `var` for local variables when the type is obvious from the right-hand side
- Prefer records for immutable data classes
- Use `Optional` for return types, never for parameters or fields
- Annotations order: `@Nullable` → `@Override` → framework annotations

## Testing
- Use JUnit 5 (Jupiter) — not JUnit 4
- Use `@Nested` classes to group related tests
- Use Testcontainers for integration tests (annotate with `@Testcontainers`)
- Mock with Mockito — use `@ExtendWith(MockitoExtension.class)`, not `initMocks`
- Test class name mirrors source: `UserService.java` → `UserServiceTest.java`

## Architecture
- `core/` — domain model and business logic (no framework imports)
- `api/` — REST controllers (Spring Boot)
- `persistence/` — JPA repositories and entities
- `infra/` — configuration, messaging, external integrations

Core has zero dependencies on other modules. API and persistence depend on core only.
```

**Key patterns:**
- Gradle module-scoped commands
- Google Java Style enforced via tooling
- Testcontainers for integration tests
- Module dependency direction stated explicitly

---

## Section Patterns by Language

### Python
```markdown
- Format: `ruff format <file>` or `black <file>`
- Lint: `ruff check --fix <file>` or `flake8 <file>`
- Type check: `mypy path/to/module`
- Test: `pytest tests/ -xvs` (stop on first failure, verbose)
- Single test: `pytest tests/test_foo.py::test_bar -xvs`
```

### Rust
```markdown
- Format: `cargo fmt` or `just fmt`
- Lint: `cargo clippy -p <crate>` or `just fix -p <crate>`
- Test: `cargo test -p <crate>`
- Full suite: `cargo test` (slow — ask before running)
```

### TypeScript/JavaScript
```markdown
- Format: `prettier --write .` or `pnpm format`
- Lint: `eslint . --fix` or `pnpm lint`
- Type check: `tsc --noEmit` or `pnpm typecheck`
- Test: `vitest run` or `jest` or `pnpm test`
- Single test: `vitest run -t "test name"`
```

### Go
```markdown
- Format: `gofmt -w .` or `goimports -w .`
- Lint: `golangci-lint run`
- Test: `go test ./...`
- Single test: `go test -run TestName ./path/to/package`
- Verbose: `go test -v -count=1 ./path/to/package`
```

### Java (Gradle)
```markdown
- Format: `./gradlew spotlessApply`
- Lint: `./gradlew spotlessCheck`
- Test: `./gradlew test`
- Single module: `./gradlew :module:test`
- Single test: `./gradlew :module:test --tests "ClassName.testMethod"`
```

### Java (Maven)
```markdown
- Format: `mvn spotless:apply`
- Lint: `mvn spotless:check`
- Test: `mvn test`
- Single module: `mvn test -pl module`
- Single test: `mvn test -Dtest=ClassName#testMethod`
```

### Elixir
```markdown
- Format: `mix format`
- Lint: `mix credo`
- Test: `mix test`
- Single test: `mix test path/to/test.exs:42` (line number)
- Type check: `mix dialyzer`
```

### C# (.NET)
```markdown
- Build: `dotnet build`
- Format: `dotnet format`
- Test: `dotnet test`
- Single test: `dotnet test --filter "FullyQualifiedName=Namespace.Class.Method"`
- Single project: `dotnet test path/to/Project.Tests.csproj`
```

---

## Anti-Patterns to Avoid

- **Vague commands**: "run the tests" → `pytest tests/ -xvs`
- **Missing working directory**: If commands must run from a subdirectory, say so
- **Explaining basics**: Don't explain what TypeScript is or how npm works
- **No architecture boundaries**: Listing directories without stating import/access constraints
- **Stale information**: Version-specific instructions with no update path
- **Monorepo without nested files**: If packages have different tooling, they need their own AGENTS.md
