# English Optimizer CLI

[English](README.md) | [简体中文](README.zh-CN.md) | [Changelog](CHANGELOG.md)

A powerful CLI tool to help non-native English speakers translate and optimize their writing using AI. Type Chinese or English in interactive mode to get idiomatic English automatically copied to your clipboard, or switch to `--classic` mode for single-key style hotkeys!

## Features

- ⚡ **One-Shot, Pipe & Clipboard Mode** - Optimize directly from args (`cao "..."` or `eopt "..."`), stdin pipes, or clipboard (`cao -x`) with live streaming output
- 🎯 **Instant Mode (Default)** - Interactive REPL with slash commands (`/m`, `/v`, `/why`, `/shorter`, `/softer`, `/star`, `/edit`), multi-paragraph `"""` blocks, and inline word-level diffs
- ⌨️ **Classic Mode (`--classic`)** - Choose optimization styles on the fly with configurable single-key hotkeys
- 🤖 **Multiple AI Backends** - Local Ollama or cloud APIs (OpenAI, GLM, DeepSeek, Qwen, Moonshot, OpenRouter, Gemini, or custom OpenAI-compatible endpoints)
- 📝 **Developer Presets & Tone Variants** - Built-in `slack`, `pr`, `commit`, `email`, `professional`, `concise`, `grammar`, `senior_developer`, plus `-v/--variants` and `-e/--explain`
- 📄 **Markdown-Safe Batch Optimization** - Preserves YAML frontmatter, fenced code blocks, and inline code spans, chunks long files automatically, and supports `--dry-run` diff preview
- ⭐ **History & Personal Phrasebook** - Search, star, copy, clear, and export saved expressions to Markdown or JSON
- 🔧 **Custom Prompts Management** - Manage `prompt.yaml`, `translation-prompt.txt`, and `prompts.json` right from the CLI (`cao prompts add/show/remove`)
- 🐋 **Docker Support** - Easy setup with Ollama in Docker

> **CLI Command Aliases:** Installing globally provides both `cao` and the neutral alias `eopt` (identical behavior — use whichever fits your environment).

## Prerequisites

- Node.js 20.19+ (or 22.12+) and npm
- Docker (optional, for local Ollama setup)

## YAML Prompt Configuration

You can configure the AI behavior using a YAML file at the root of your project:

### YAML Prompt File

Create a `prompt.yaml` file in your project root:

```yaml
role:
  name: Native English Full-Stack Engineer Coach
  description: >
    You are a senior full-stack software engineer who is a native English speaker.
    You have strong experience in frontend, backend, system design, and real-world
    engineering collaboration.

goals:
  - Help the user learn natural, spoken English used by software engineers
  - Translate the user's input into idiomatic, native-level English

user_profile:
  background: Software Engineer
  native_language: Chinese
  learning_goal: Improve practical English for daily engineering communication

instructions:
  - Always assume the user wants to improve their English
  - Rewrite the input in a way a native English-speaking engineer would naturally say it
  - Prefer conversational, work-friendly language over academic or overly formal English

output_format:
  style: >
    Natural, spoken English commonly used in engineering teams.
    Sounds like real conversations in meetings, Slack, or code reviews.

examples:
  - input: '这个需求我已经完成了，但是还需要再测试一下'
    output: "I've finished this feature, but I still need to do some more testing."

  - input: '这个问题我稍后再跟进'
    output: "I'll follow up on this later."

constraints:
  - Do not over-explain unless the user explicitly asks
  - Do not change the original meaning
```

The CLI will automatically detect and use the `prompt.yaml` file if it exists in the current directory.

### Text-based Prompt Template

You can also customize the translation/optimization behavior using a text-based prompt:

### View Current Prompt

```bash
cao prompt --show
```

### Edit Prompt Template

```bash
cao prompt --edit
# Or edit directly
code ~/.english-optimizer/translation-prompt.txt
```

### Example Custom Prompts

**For formal business English:**

```
You are a professional business translator.
Translate/optimize to formal business English with professional terminology.
Text: "{text}"
```

**For casual developer chat:**

```
You are a software developer.
Translate/optimize to casual English like Slack messages.
Text: "{text}"
```

**For technical documentation:**

```
You are a technical documentation translator.
Translate/optimize to precise technical documentation English.
Text: "{text}"
```

See `TRANSLATION_PROMPT_EXAMPLE.md` for more examples.

## Quick Start

### 1. Clone and Install

```bash
npm install
```

### 2. Setup Ollama (Local AI)

```bash
# Make setup script executable
chmod +x scripts/setup-ollama.sh

# Run setup (starts Ollama and pulls the model)
./scripts/setup-ollama.sh
```

### 3. Build the CLI

```bash
npm run build
```

### 4. Start Using

```bash
npm start
# or
cao
```

## Usage

### One-Shot, Pipe & Clipboard Mode

Optimize text immediately from the command line without opening an interactive session:

```bash
# Direct text argument (streams output, shows word diff for English edits, and copies to clipboard)
cao "这个需求今天能做完，明天提测"
cao -m pr "这里会有空指针问题，加个判空吧"
cao -m commit "修复登录过期没有跳转的问题"
cao -m slack "等我五分钟，刚拉下最新代码"
cao -m email "麻烦确认下周三上线时间"

# Tone variants (Casual / Neutral / Formal) & brief Chinese explanation
cao -v "明天能上线吗"
cao -e "it's works very good"

# Clipboard round-trip: read clipboard -> optimize -> write back to clipboard
cao -x
cao --clip -m pr

# Pipe via stdin / stdout (automatically outputs clean raw text when piped)
echo "fix bug pls" | cao -m concise
pbpaste | cao --raw | pbcopy

# Per-run provider/model overrides and flags
cao -p api --model gpt-4o-mini "hello world"
cao --no-copy --no-stream "quick check"
```

### Instant Mode (Default)

Run the CLI with no arguments (or `-m <preset>` to start in a specific preset), type Chinese or English, and press Enter on an empty line to stream the translation/optimization:

```bash
cao
cao -m pr   # Start directly in PR / Code Review mode
```

**How it works:**

1. Type your text (Chinese or English), pressing Enter after each line
2. Press **Enter** on an empty line to trigger translation/optimization (lookup order: `./prompt.yaml` → `~/.english-optimizer/prompt.yaml` → `~/.english-optimizer/translation-prompt.txt`)
3. View the bilingual result (plus inline word-level diff when polishing English) — the optimized English is automatically copied to your clipboard
4. For multi-paragraph text with blank lines, type `"""` to start/end a block or run `/edit` to open `$EDITOR`
5. Use built-in **Slash Commands** directly in the REPL:
   - `/m [mode]` — list or switch preset (`translate`, `slack`, `pr`, `commit`, `email`, `professional`, `concise`, `grammar`, `senior_developer`, or custom prompt name)
   - `/v [text]` — generate 3 tone variants (Casual / Neutral / Formal), then `/1`, `/2`, `/3` to copy
   - `/why` — stream a concise Chinese explanation of why the phrasing improved
   - `/shorter`, `/softer`, `/formal`, `/casual` — iteratively refine the previous result
   - `/star` — star/unstar the last result into your personal phrasebook
   - `/r` — retry · `/diff` — show word diff · `/copy` — re-copy · `/edit` — open `$EDITOR` · `/h [query]` — history/search · `/q` — quit

### Classic Mode (Optional)

If you prefer to submit text first and then switch between built-in or custom optimization styles with hotkeys:

```bash
cao --classic
# or
npm start -- --classic
```

1. Enter your text (press Enter on an empty line to finish)
2. Press a single-key hotkey (customizable via `hotkeys` in `config.yaml`):
   - `p` - Professional tone
   - `c` - Concise version
   - `g` - Grammar fix
   - `d` - Senior developer style
   - `r` - Reset to original
   - `h` - View history
   - `q` or `Ctrl+C` - Quit
   - Any custom hotkey defined in `~/.english-optimizer/prompts.json` (e.g. `a`, `f`)

### Batch Optimize Files (Markdown-Safe & Chunked)

Automatically protects YAML frontmatter, fenced code blocks (```` ``` ```` / `~~~`), HTML comments, and inline `` `code` `` spans, and splits long files into paragraph chunks to avoid context truncation:

```bash
# Preview changes as a line-level diff without writing files
cao batch README.md --mode professional --dry-run

# Optimize files using built-in modes, translate, or custom prompt names
cao batch docs/*.md --mode translate --suffix .en
cao batch notes.md --mode concise --in-place
cao batch guide.md --chunk-size 2000
```

### History & Personal Phrasebook

```bash
# View recent history (or search / filter by starred or mode)
cao history
cao history -n 20
cao history --search "null check"
cao history --starred

# Star, copy, export to Markdown/JSON, or clear
cao history --star 1
cao history --copy 1
cao history --starred --export phrasebook.md
cao history --clear --keep-starred   # Clear unstarred entries while keeping your phrasebook
```

### Manage Prompts & Custom Presets

```bash
# Inspect or edit the active translation prompt (raw YAML or text)
cao prompt --show
cao prompt --show --raw > prompt.yaml
cao prompt --edit

# Full CRUD management for custom prompts (~/.english-optimizer/prompts.json)
cao prompts
cao prompts show Academic
cao prompts add                                      # Interactive wizard
cao prompts add tweet -d "Tech post" -p "Rewrite as a concise tweet: {text}" -k t
cao prompts remove tweet
```

### Check Configuration

```bash
# Show current configuration (API keys are masked by default)
cao config
cao config --show-secrets

# Run interactive setup wizard (uses masked password input and 0600 file permissions)
cao config --setup

# Test API configuration (supports -p/--provider and --model overrides)
cao test
```

The test command will:

- Verify your API configuration is valid
- Test connection to the API provider
- Run a simple optimization test
- Show detailed error messages if something is wrong

The setup wizard will guide you through:

- Choosing AI provider (local Ollama or cloud API)
- Configuring API settings
- Setting up preferences

## Configuration

Configuration is resolved in standard CLI precedence order (highest to lowest):

1. **CLI flags** (`-p / --provider`, `--model`)
2. **Environment variables** (`CAO_*` in shell or `.env` files)
3. **Config file** (`~/.english-optimizer/config.yaml` or `~/.english-optimizer/config.json`)
4. **Built-in defaults**

### Using Cloud APIs (OpenAI, GLM, DeepSeek, etc.)

By default, the CLI uses local Ollama. To use cloud APIs, you need to configure them.

**Quick Setup:**

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit `.env` with your API configuration (use the `CAO_` prefix so local project `.env` files don't conflict with other tools):

```env
CAO_AI_PROVIDER=api
CAO_API_PROVIDER=openai  # or 'glm', 'deepseek', 'qwen', 'moonshot', 'custom'
CAO_API_KEY=your_api_key_here
CAO_API_BASE_URL=https://api.openai.com/v1
CAO_API_MODEL=gpt-4o
```

For detailed API configuration instructions, see [API_SETUP.md](API_SETUP.md)

### Environment Variables

You can place `.env` in `~/.english-optimizer/.env` (recommended) or in your current directory. Only `CAO_`-prefixed variables are read from `./.env` to avoid colliding with another project's `API_KEY`; legacy unprefixed names (e.g. `API_KEY`) are still supported in `~/.english-optimizer/.env` and in your shell environment.

Copy `.env.example` to `.env`:

```bash
cp .env.example ~/.english-optimizer/.env
```

Edit `.env`:

```env
# AI Provider: 'ollama' for local, 'api' for cloud
CAO_AI_PROVIDER=ollama

# Ollama Configuration (local)
CAO_OLLAMA_BASE_URL=http://localhost:11434
CAO_OLLAMA_MODEL=llama3.2:3b

# API Configuration (cloud - OpenAI/GLM)
# CAO_AI_PROVIDER=api
# CAO_API_PROVIDER=openai
# CAO_API_KEY=your_api_key_here
# CAO_API_BASE_URL=https://api.openai.com/v1
# CAO_API_MODEL=gpt-4o

# For GLM (Zhipu AI)
# CAO_API_PROVIDER=glm
# CAO_API_KEY=your_glm_api_key
# CAO_API_BASE_URL=https://open.bigmodel.cn/api/paas/v4
# CAO_API_MODEL=glm-4
```

### Config File

The config file can be in YAML or JSON format and is created automatically at `~/.english-optimizer/config.yaml` (or `config.json`):

```yaml
ai:
  provider: 'ollama'
  ollama:
    baseUrl: 'http://localhost:11434'
    model: 'llama3.2:3b'
  api:
    provider: 'openai'
    apiKey: ''
    baseUrl: 'https://api.openai.com/v1'
    model: 'gpt-4o-mini'

hotkeys:
  professional: 'p'
  concise: 'c'
  grammar: 'g'
  senior_developer: 'd'
  reset: 'r'
  history: 'h'
  quit: 'q'

features:
  enableHistory: true
  historyPath: ~/.english-optimizer/history.json
  enableCustomPrompts: true
  customPromptsPath: ~/.english-optimizer/prompts.json
  useYAMLPrompt: true
```

## Custom Prompts

You can create custom optimization prompts at `~/.english-optimizer/prompts.json`:

```json
[
  {
    "name": "Academic",
    "description": "Rewrite in an academic style suitable for research papers",
    "prompt": "Please rewrite the following text in an academic style...",
    "hotkey": "a"
  },
  {
    "name": "Friendly",
    "description": "Make the text more friendly and casual",
    "prompt": "Please rewrite the following text to sound more friendly...",
    "hotkey": "f"
  }
]
```

## Docker Commands

```bash
# Start Ollama
docker-compose up -d

# Stop Ollama
docker-compose down

# View logs
docker-compose logs -f ollama

# Restart Ollama
docker-compose restart
```

## Production Deployment

To use cloud APIs instead of local Ollama:

1. Update your `.env` file:

   ```env
   CAO_AI_PROVIDER=api
   CAO_API_PROVIDER=openai  # or 'glm' for Zhipu AI
   CAO_API_KEY=your_actual_api_key
   CAO_API_MODEL=gpt-4o  # or your preferred model
   ```

2. The CLI will automatically use the cloud API

## Development

```bash
# Watch and rebuild
npm run watch

# Run in development mode
npm run dev

# Lint
npm run lint
```

## Project Structure

```
english-optimizer-cli/
├── src/
│   ├── index.ts                  # CLI entry point (cao / eopt)
│   ├── core/
│   │   ├── instant-editor.ts     # Default interactive REPL with slash commands
│   │   ├── oneshot.ts            # One-shot, stdin pipe, and clipboard runner
│   │   ├── editor.ts             # Classic interactive editor with hotkeys
│   │   ├── optimizer.ts          # Optimization orchestration
│   │   ├── batch.ts              # Batch file optimizer with --dry-run
│   │   └── markdown-chunker.ts   # Markdown-safe code/frontmatter protector & chunker
│   ├── ai/
│   │   ├── provider.ts           # AI provider factory
│   │   ├── ollama.ts             # Ollama integration (NDJSON streaming)
│   │   ├── api-provider.ts       # OpenAI-compatible providers (SSE streaming)
│   │   └── stream-utils.ts       # SSE & NDJSON stream decoders
│   ├── prompts/
│   │   ├── templates.ts          # Built-in mode templates (slack/pr/commit/email/...)
│   │   ├── resolver.ts           # Unified mode & prompt resolver
│   │   ├── structured.ts         # Variants & explain prompt builders/parsers
│   │   ├── yaml-prompt.ts        # Project/global prompt.yaml loader
│   │   ├── translation-prompt.ts # translation-prompt.txt loader
│   │   ├── custom.ts             # Custom prompts store (prompts.json)
│   │   └── commands.ts           # CLI prompts CRUD handlers
│   ├── config/
│   │   ├── config.ts             # Config loader, CAO_* env isolation, masking
│   │   ├── wizard.ts             # Interactive setup wizard
│   │   └── test.ts               # API connectivity & auth diagnostics
│   ├── history/
│   │   ├── logger.ts             # History & starred phrasebook store
│   │   └── commands.ts           # CLI history search/star/export/clear handlers
│   └── utils/
│       ├── display.ts            # Output formatting, word/line diff, truncation
│       └── spinner.ts            # Lightweight TTY-aware spinner
├── docker-compose.yml            # Ollama Docker setup
├── scripts/
│   ├── bump-version.js           # Semver bump helper (syncs lockfile)
│   └── setup-ollama.sh           # Ollama setup script
├── CHANGELOG.md                  # Release history
└── package.json
```

## Troubleshooting

### Ollama Connection Failed

```bash
# Check if Ollama is running
docker-compose ps

# Restart Ollama
docker-compose restart

# Check Ollama logs
docker-compose logs ollama
```

### Model Not Found

```bash
# Manually pull the model
docker exec -it english-optimizer-ollama ollama pull llama3.2:3b
```

### API Key Issues

Make sure your `.env` file has the correct API key and the API provider URL is accurate.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Author

Created with ❤️ for non-native English speakers everywhere.
