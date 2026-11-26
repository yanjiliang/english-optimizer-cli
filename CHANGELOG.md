# Changelog

All notable changes to **English Optimizer CLI** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-11-26

Major release delivering a full three-phase product overhaul across CLI ergonomics,
streaming UX, developer writing workflows, Markdown-safe batch processing, personal
phrasebook history, custom prompt management, and security hardening.

### Breaking Changes

- **Node.js requirement raised to `^20.19.0 || >=22.12.0`** (dropped Node.js 18, which is EOL and incompatible with native ESM `require()` for upgraded dependencies).
- **Project-local `./.env` isolation**: only `CAO_*`-prefixed variables are loaded from a working directory's `./.env` so unrelated projects' `API_KEY` or `AI_PROVIDER` variables no longer hijack the CLI. Legacy unprefixed variable names remain supported from your shell environment and `~/.english-optimizer/.env`.
- Upgraded `zod` from v3 to v4 and removed unused runtime dependencies (`cli-cursor`, `keypress`, `ora`, `uuid`).

### Added

- **One-Shot, Stdin Pipe & Clipboard Modes**
  - Optimize directly via positional args (`cao "..."`), piped stdin (`echo "..." | cao`), or clipboard round-trip (`cao -x`).
  - Added `--raw`, `--no-copy`, `--no-stream`, `--diff`, `--provider <ollama|api>`, and `--model <model>` flags for clean Unix pipeline composition.
- **Real-Time Streaming Output**
  - Implemented OpenAI-compatible SSE and Ollama NDJSON stream parsers (`src/ai/stream-utils.ts`) with a lightweight TTY-aware spinner (`src/utils/spinner.ts`).
- **Developer Writing Modes, Multi-Tone Variants & Learning Aids**
  - Added four built-in engineering presets: `slack`, `pr`, `commit`, and `email` alongside `professional`, `concise`, `grammar`, and `senior_developer`.
  - Added `-v, --variants` to generate 3 tone options (`Casual`, `Neutral`, `Formal`) with interactive selection and clipboard copy.
  - Added `-e, --explain` to provide brief Chinese explanations of key phrasing improvements, plus automatic inline word-level diffs for English-to-English rewrites.
- **Upgraded Instant REPL**
  - Added interactive slash commands: `/m [mode]`, `/v [text]`, `/why`, `/shorter`, `/softer`, `/formal`, `/casual`, `/r`, `/diff`, `/copy [n]`, `/edit` (`$EDITOR`), `/star`, `/unstar`, `/h [query|starred]`, `/1`–`/3`, `/help`, `/q`.
  - Added `"""` multi-paragraph block input mode.
- **Markdown-Safe Chunked Batch Processing**
  - Added `src/core/markdown-chunker.ts` to protect YAML frontmatter, fenced code blocks (```` ``` ```` / `~~~`), HTML comments, horizontal rules, and inline `` `code` `` spans verbatim while preserving `LF`/`CRLF` line endings.
  - Automatically chunks long documents on paragraph/line boundaries (`--chunk-size`, default `2500` chars), adds `--dry-run` line-level diff preview, supports all built-in/translate/custom modes, and exits non-zero if any file fails.
- **History & Personal Phrasebook**
  - Added `--search`, `--starred`, `--mode`, `--star`, `--unstar`, `--copy`, `--export <file|->` (Markdown/JSON), `--clear`, `--keep-starred`, and `--full` options to `cao history`.
  - Starred entries are permanently preserved past the 100-entry rolling history cap.
- **Custom Prompts CLI CRUD**
  - Added `cao prompts list`, `show <name>`, `add [name]` (interactive wizard or flag-driven, with `--force`, built-in mode collision checks, and hotkey conflict checks), `remove <name>`, and `path`.
- **Neutral Command Alias & Global Prompt Fallback**
  - Added `eopt` binary alias alongside `cao` with dynamic usage/help output.
  - Added global `~/.english-optimizer/prompt.yaml` fallback when no project-local `./prompt.yaml` exists.
- **Expanded Cloud Provider Presets**
  - Added first-class support for `deepseek`, `qwen`, `moonshot`, `openrouter`, and `gemini` in addition to `openai`, `glm`, and `custom`.
- **Comprehensive Test Suite**
  - Expanded Vitest suite to **15 test files / 87 unit tests** covering config, providers, SSE/NDJSON streaming, prompt templates/resolver/structured parsers, Markdown chunker, batch, one-shot, REPL slash commands, history phrasebook, custom prompts, spinner, and display utilities.

### Changed

- Separated system instructions from user input messages across providers and improved `prompt.yaml` and built-in templates for cleaner outputs.
- `cao prompt --show` now prints raw YAML/text verbatim (with `--raw` and pipe-friendly formatting), and `cao prompt --edit` uses `spawnSync` to properly support editors with arguments (e.g. `code --wait`).
- Isolated production build via `tsconfig.build.json` (excluding `*.test.ts` from `dist/`) and cleaned `.npmignore` to ship minimal artifacts alongside bilingual READMEs, `CHANGELOG.md`, `API_SETUP.md`, and `LICENSE`.
- Updated GitHub Actions CI matrix to Node.js `20.x` and `22.x` with built CLI smoke tests (`--version`, `--help`).
- Updated `README.md`, `README.zh-CN.md`, `API_SETUP.md`, and `SECURITY.md`.

### Fixed

- **Credential & Config Security**: Masked API keys in `config --show`, `setup`, and `test`; enforced `0600` file permissions when writing config files; expanded leading `~` in configured paths.
- **Batch Edge Cases**: Fixed extensionless output path collisions and added proper non-zero exit status on batch errors.
- **Template Replacement Safety**: Replaced `String.prototype.replace` with literal token substitution so `$&`, `$1`, and `$$` in user text are never corrupted.
- **History Display**: Stopped appending `...` to short history entries that are not truncated.
- **Release Tooling**: Fixed npm `version` lifecycle hook collision in `package.json` (renamed manual script to `version:bump`, added `preversion` lint/format/test/build gate) and updated `scripts/bump-version.js` to sync `package-lock.json`.

---

## [1.6.1] - 2026-01-08

### Changed

- Renamed CLI binary command from `fuck-abc` to `cao` across config test and setup wizard messages.

## [1.6.0] - 2026-01-08

### Added

- Bilingual documentation (`README.md` and `README.zh-CN.md`).
- Vitest test framework setup, ESLint 9 flat config, Prettier formatting, and GitHub Actions CI workflow.
- `SECURITY.md` security policy and `LICENSE` (MIT).

### Changed

- Consolidated duplicate code across AI providers, unified response cleanup, extracted display helpers, and resolved all ESLint errors.
- Updated core and development dependencies.

## [1.5.0] - 2026-01-08

### Added

- Detailed API error diagnostics and GLM insufficient balance detection.

## [1.4.0] - 2026-01-08

### Added

- `test` subcommand to verify API configuration and connectivity.

## [1.3.0] - 2026-01-08

### Added

- Interactive configuration wizard (`setup` subcommand).

## [1.2.0] - 2026-01-08

### Added

- `API_SETUP.md` configuration guide and updated example configs.

## [1.1.1] - 2026-01-08

### Changed

- Refined `prompt.yaml` with more natural conversational instructions and examples.

## [1.1.0] - 2026-01-08

### Changed

- Version bump and prompt improvements.

## [1.0.4] - 2026-01-08

### Fixed

- Read CLI version dynamically from `package.json` instead of a hardcoded string.

## [1.0.2] - 2026-01-08

### Added

- `update` command to check npm registry for newer versions.

## [1.0.1] - 2026-01-08

### Changed

- Reverted npm package name to `english-optimizer-cli` and tuned prompts for casual team chat.

## [1.0.0] - 2026-01-08

### Added

- Initial release of English Optimizer CLI with Ollama and cloud API support, interactive modes, YAML prompt configuration, batch processing, and history logging.
