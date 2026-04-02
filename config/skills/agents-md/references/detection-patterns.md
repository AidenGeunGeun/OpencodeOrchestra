# Detection Patterns

Maps config files and project signals to exact tool invocations. Read this file during Phase 1 (investigation) to turn what you find into accurate AGENTS.md commands.

The pattern is: **find a signal → derive the exact commands**. Don't guess — verify by reading the config file.

---

## Package Managers

| Signal file | Package manager | Install command | Run command |
|---|---|---|---|
| `package-lock.json` | npm | `npm install` | `npm run <script>` |
| `yarn.lock` | Yarn | `yarn install` | `yarn <script>` |
| `pnpm-lock.yaml` | pnpm | `pnpm install` | `pnpm <script>` |
| `bun.lockb` or `bun.lock` | Bun | `bun install` | `bun run <script>` |
| `Cargo.lock` + `Cargo.toml` | Cargo | `cargo build` | `cargo run` |
| `go.sum` + `go.mod` | Go modules | `go mod download` | `go run .` |
| `pyproject.toml` + `uv.lock` | uv | `uv sync` | `uv run <cmd>` |
| `pyproject.toml` + `poetry.lock` | Poetry | `poetry install` | `poetry run <cmd>` |
| `pyproject.toml` (no lock) | pip | `pip install -e .` | `python -m <module>` |
| `requirements.txt` | pip | `pip install -r requirements.txt` | `python <script>` |
| `Gemfile.lock` | Bundler | `bundle install` | `bundle exec <cmd>` |
| `mix.lock` | Mix (Elixir) | `mix deps.get` | `mix run` |

**Monorepo signals:**
| Signal | Tool | Workspace commands |
|---|---|---|
| `pnpm-workspace.yaml` | pnpm workspaces | `pnpm --filter <pkg> <cmd>` |
| `Cargo.toml` with `[workspace]` | Cargo workspace | `cargo test -p <crate>` |
| `go.work` | Go workspaces | `go test ./packages/<pkg>/...` |
| `turbo.json` | Turborepo | `pnpm turbo run <task> --filter=<pkg>` |
| `nx.json` | Nx | `nx run <project>:<target>` |
| `lerna.json` | Lerna | `lerna run <script> --scope=<pkg>` |

---

## Test Runners

### JavaScript / TypeScript

| Signal | Runner | Run all | Run single test | Run single file |
|---|---|---|---|---|
| `vitest.config.ts` or `vitest` in package.json | Vitest | `vitest run` | `vitest run -t "test name"` | `vitest run path/to/file.test.ts` |
| `jest.config.*` or `jest` in package.json | Jest | `jest` | `jest -t "test name"` | `jest path/to/file.test.ts` |
| `playwright.config.ts` | Playwright | `playwright test` | `playwright test -g "test name"` | `playwright test path/to/file.spec.ts` |
| `cypress.config.*` | Cypress | `cypress run` | `cypress run --spec "path/to/spec"` | Same |
| `.mocharc.*` or `mocha` in package.json | Mocha | `mocha` | `mocha --grep "test name"` | `mocha path/to/file.test.js` |

**Key detection step:** Read `package.json` → check `scripts.test` to find the actual test command the project uses. It may wrap the runner with flags.

### Python

| Signal | Runner | Run all | Run single test | Run single file |
|---|---|---|---|---|
| `pytest.ini`, `pyproject.toml [tool.pytest]`, `conftest.py` | pytest | `pytest` | `pytest path/to/test.py::test_func -xvs` | `pytest path/to/test.py -xvs` |
| `setup.cfg [tool:pytest]` | pytest | Same | Same | Same |
| `tox.ini` | tox (wraps pytest usually) | `tox` | `tox -- path/to/test.py::test_func` | Check tox.ini for test command |
| `noxfile.py` | nox | `nox` | Check nox sessions | Check nox sessions |

**Key detection step:** Read `pyproject.toml` → look for `[tool.pytest.ini_options]` for default flags (like `--strict-markers`, `addopts`). These matter — include them if agents need to match CI behavior.

### Rust

| Signal | Runner | Run all | Run single test | Run package |
|---|---|---|---|---|
| `Cargo.toml` (default) | cargo test | `cargo test` | `cargo test test_name` | `cargo test -p <crate>` |
| `cargo-nextest` in justfile/CI | nextest | `cargo nextest run` | `cargo nextest run -E 'test(name)'` | `cargo nextest run -p <crate>` |
| `*.snap` files, `cargo-insta` | insta snapshots | `cargo test` then `cargo insta review` | Same | Same |

### Go

| Signal | Runner | Run all | Run single test | Run package |
|---|---|---|---|---|
| `*_test.go` files | `go test` | `go test ./...` | `go test -run TestName ./pkg/` | `go test ./path/to/pkg/...` |
| `testify` imports | go test + testify | Same | Same | Same |

### Java / Kotlin

| Signal | Runner | Run all | Run single test | Run module |
|---|---|---|---|---|
| `build.gradle` + JUnit | Gradle | `./gradlew test` | `./gradlew test --tests "ClassName.testMethod"` | `./gradlew :module:test` |
| `pom.xml` + JUnit/Surefire | Maven | `mvn test` | `mvn test -Dtest=ClassName#testMethod` | `mvn test -pl module` |

---

## Linters & Formatters

### JavaScript / TypeScript

| Signal | Tool | Lint command | Format command |
|---|---|---|---|
| `.eslintrc.*` or `eslint.config.*` | ESLint | `eslint . --fix` | N/A (use Prettier) |
| `.prettierrc.*` or `prettier` in package.json | Prettier | N/A | `prettier --write .` |
| `biome.json` | Biome | `biome check --fix .` | `biome format --write .` |
| `deno.json` | Deno | `deno lint` | `deno fmt` |

### Python

| Signal | Tool | Lint command | Format command |
|---|---|---|---|
| `ruff.toml` or `[tool.ruff]` in pyproject.toml | Ruff | `ruff check --fix <file>` | `ruff format <file>` |
| `.flake8` or `[tool.flake8]` | Flake8 | `flake8 <file>` | N/A |
| `[tool.black]` in pyproject.toml | Black | N/A | `black <file>` |
| `[tool.isort]` in pyproject.toml | isort | `isort <file>` | Same |
| `mypy.ini` or `[tool.mypy]` | mypy | `mypy path/to/code` | N/A |
| `pyrightconfig.json` or `[tool.pyright]` | Pyright | `pyright path/to/code` | N/A |

### Rust

| Signal | Tool | Command |
|---|---|---|
| `rustfmt.toml` or `.rustfmt.toml` | rustfmt | `cargo fmt` |
| `clippy.toml` or `.clippy.toml` | Clippy | `cargo clippy -p <crate> -- -D warnings` |

### Go

| Signal | Tool | Command |
|---|---|---|
| Default (always available) | gofmt | `gofmt -w .` |
| `.golangci.yml` | golangci-lint | `golangci-lint run` |
| `goimports` in tooling | goimports | `goimports -w .` |

### Java / Kotlin

| Signal | Tool | Command |
|---|---|---|
| `.editorconfig` + `spotless` plugin | Spotless | `./gradlew spotlessApply` |
| `checkstyle.xml` | Checkstyle | `./gradlew checkstyleMain` |
| `pom.xml` + `spotless-maven-plugin` | Spotless (Maven) | `mvn spotless:apply` |
| `.ktlint*` | ktlint | `ktlint --format` |

---

## CI Config → Command Extraction

CI configs are gold mines for exact commands. Here's where to look:

| CI system | Config location | What to extract |
|---|---|---|
| GitHub Actions | `.github/workflows/*.yml` | `run:` steps — these are the exact commands CI executes |
| GitLab CI | `.gitlab-ci.yml` | `script:` blocks per stage |
| CircleCI | `.circleci/config.yml` | `command:` in steps |
| Jenkins | `Jenkinsfile` | `sh` steps |
| Drone | `.drone.yml` | `commands:` per step |

**What to look for in CI configs:**
1. Test commands (often with specific flags for CI like `--ci`, `--coverage`)
2. Lint/format check commands (often `--check` mode, not `--fix`)
3. Build commands
4. Environment setup (Node version, Python version, system packages)
5. Database setup for integration tests

**Important:** CI commands often use `--check` or `--ci` mode (read-only). For the AGENTS.md, convert these to the interactive/fix equivalents:
- CI: `prettier --check .` → AGENTS.md: `prettier --write .`
- CI: `ruff check .` → AGENTS.md: `ruff check --fix <file>`
- CI: `cargo fmt -- --check` → AGENTS.md: `cargo fmt`

---

## Task Runners & Build Tools

| Signal | Tool | How to discover commands |
|---|---|---|
| `Makefile` | Make | Read targets: `make -n <target>` or just read the file |
| `justfile` | just | `just --list` or read the file |
| `Taskfile.yml` | Task | `task --list` or read the file |
| `turbo.json` | Turborepo | Read `pipeline` keys — these are the available tasks |
| `nx.json` | Nx | `nx show projects` for project list |
| `dagger.json` | Dagger | Read the Dagger module for available functions |

---

## Quick Decision Tree

When investigating a project, follow this order:

1. **Root `ls`** → identify language (Cargo.toml? package.json? go.mod?)
2. **Read the manifest** → extract project name, dependencies, scripts
3. **Check for lockfile** → confirms package manager
4. **Check for task runner** → Makefile/justfile/Taskfile may wrap everything
5. **Read CI config** → extract exact commands with flags
6. **Check linter/formatter configs** → determine the exact tools and their settings
7. **Look at test directories** → confirm test runner, find example patterns
8. **Read recent commits** → `git log --oneline -20` for message format conventions
