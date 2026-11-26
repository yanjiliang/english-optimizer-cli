# English Optimizer CLI

[English](README.md) | [简体中文](README.zh-CN.md) | [更新日志](CHANGELOG.md)

一个强大的 CLI 工具，帮助非英语母语者使用 AI 翻译与润色英文写作。默认交互模式下输入中文或英文即可获得地道英文并自动复制到剪贴板，也可以用 `--classic` 模式通过单键快捷键切换多种风格！

## 功能特性

- ⚡ **单次命令、管道与剪贴板模式** - 支持命令行直接传参（`cao "..."` 或中性别名 `eopt "..."`）、标准输入管道和剪贴板直通（`cao -x`），实时流式输出
- 🎯 **即时模式（默认）** - 交互式 REPL 支持 `/m`、`/v`、`/why`、`/shorter`、`/softer`、`/star`、`/edit` 快捷指令、`"""` 多段落块输入与词级 Diff 高亮
- ⌨️ **经典模式（`--classic`）** - 支持可配置的单键快捷键即时切换多种优化风格
- 🤖 **多种 AI 后端** - 支持本地 Ollama 或云端 API（OpenAI、GLM、DeepSeek、通义千问、Moonshot、OpenRouter、Gemini 及自定义兼容接口）
- 📝 **开发者场景预设与多语气版本** - 内置 `slack`、`pr`、`commit`、`email`、`professional`、`concise`、`grammar`、`senior_developer`，支持 `-v/--variants` 与 `-e/--explain`
- 📄 **Markdown 安全分块批量优化** - 自动保护 YAML Frontmatter、代码块、HTML 注释与行内代码，长文档自动按段落分块，支持 `--dry-run` 预览 Diff
- ⭐ **历史记录与个人表达库** - 支持检索、收藏（`/star`）、复制、按需清空及导出 Markdown / JSON
- 🔧 **自定义提示词管理** - 支持 `prompt.yaml`、`translation-prompt.txt` 与 `cao prompts add/show/remove` 全流程管理
- 🐋 **Docker 支持** - 使用 Docker 轻松设置 Ollama

> **命令别名：** 全局安装后同时提供 `cao` 和中性短命令 `eopt`（功能完全一致，方便在团队或屏幕共享环境中使用）。

## 前置要求

- Node.js 20.19+（或 22.12+）和 npm
- Docker（可选，用于本地 Ollama 设置）

## YAML 提示词配置

你可以在项目根目录使用 YAML 文件配置 AI 行为：

### YAML 提示词文件

在项目根目录创建 `prompt.yaml` 文件：

```yaml
role:
  name: Native English Full-Stack Engineer Coach
  description: >
    你是一位以英语为母语的资深全栈软件工程师。
    你在前端、后端、系统设计和实际工程协作方面有丰富经验。

goals:
  - 帮助用户学习软件工程师使用的自然、口语化英语
  - 将用户的输入翻译成地道的、母语级别的英语

user_profile:
  background: 软件工程师
  native_language: 中文
  learning_goal: 提高日常工程沟通的实用英语

instructions:
  - 始终假设用户想要改进他们的英语
  - 以英语母语工程师自然表达的方式重写输入
  - 优先使用对话式、工作友好的语言，而不是学术或过于正式的英语

output_format:
  style: >
    工程团队中常用的自然、口语化英语。
    听起来像会议、Slack 或代码审查中的真实对话。

examples:
  - input: '这个需求我已经完成了，但是还需要再测试一下'
    output: "I've finished this feature, but I still need to do some more testing."

  - input: '这个问题我稍后再跟进'
    output: "I'll follow up on this later."

constraints:
  - 除非用户明确要求，否则不要过度解释
  - 不要改变原意
```

CLI 将自动检测并使用当前目录中的 `prompt.yaml` 文件（如果存在）。

### 基于文本的提示词模板

你也可以使用基于文本的提示词自定义翻译/优化行为：

### 查看当前提示词

```bash
cao prompt --show
```

### 编辑提示词模板

```bash
cao prompt --edit
# 或直接编辑
code ~/.english-optimizer/translation-prompt.txt
```

### 自定义提示词示例

**正式商务英语：**

```
你是一位专业的商务翻译。
将文本翻译/优化为正式的商务英语，使用专业术语。
文本："{text}"
```

**轻松的开发者聊天：**

```
你是一位软件开发者。
将文本翻译/优化为像 Slack 消息一样的轻松英语。
文本："{text}"
```

**技术文档：**

```
你是一位技术文档翻译员。
将文本翻译/优化为精确的技术文档英语。
文本："{text}"
```

查看 `TRANSLATION_PROMPT_EXAMPLE.md` 了解更多示例。

## 快速开始

### 1. 安装

```bash
npm install
```

### 2. 设置 Ollama（本地 AI）

```bash
# 使脚本可执行
chmod +x scripts/setup-ollama.sh

# 运行设置（启动 Ollama 并拉取模型）
./scripts/setup-ollama.sh
```

### 3. 构建 CLI

```bash
npm run build
```

### 4. 开始使用

```bash
npm start
# 或
cao
```

## 使用方法

### 单次命令、管道与剪贴板模式

无需进入交互界面，直接在终端一行命令完成翻译或润色：

```bash
# 直接传参（流式输出，润色英文时自动显示词级 Diff，并复制到剪贴板）
cao "这个需求今天能做完，明天提测"
cao -m pr "这里会有空指针问题，加个判空吧"
cao -m commit "修复登录过期没有跳转的问题"
cao -m slack "等我五分钟，刚拉下最新代码"
cao -m email "麻烦确认下周三上线时间"

# 多语气版本（Casual / Neutral / Formal）与中文改进要点讲解
cao -v "明天能上线吗"
cao -e "it's works very good"

# 剪贴板直通：读取剪贴板 -> 优化 -> 写回剪贴板
cao -x
cao --clip -m pr

# 标准输入/输出管道（重定向或管道输出时自动进入纯文本模式）
echo "fix bug pls" | cao -m concise
pbpaste | cao --raw | pbcopy

# 单次临时覆盖提供商、模型或禁用复制/流式输出
cao -p api --model gpt-4o-mini "hello world"
cao --no-copy --no-stream "quick check"
```

### 即时模式（默认）

直接运行 CLI 进入交互模式（也可带 `-m <场景>` 直接进入指定预设），输入中文或英文后按空行回车即可流式翻译并优化：

```bash
cao
cao -m pr   # 直接进入 PR / Code Review 模式
```

**工作原理：**

1. 输入中文或英文内容，每行结束后按 Enter
2. 输入完成后，按 **Enter（空行）** 触发翻译/优化（提示词查找顺序：`./prompt.yaml` → `~/.english-optimizer/prompt.yaml` → `~/.english-optimizer/translation-prompt.txt`）
3. 查看中英文对照结果（润色英文时自动高亮词级 Diff），优化后的英文会自动复制到剪贴板
4. 输入带空行的多段落长文时，可用 `"""` 包裹段落块，或输入 `/edit` 调用 `$EDITOR` 编辑
5. 支持在交互模式直接使用 **Slash 快捷指令**：
   - `/m [模式]` — 查看或切换场景预设（`translate`、`slack`、`pr`、`commit`、`email`、`professional`、`concise`、`grammar`、`senior_developer` 或自定义提示词名）
   - `/v [文本]` — 一次生成 3 个语气版本（Casual / Neutral / Formal），输入 `/1`、`/2`、`/3` 复制对应版本
   - `/why` — 用简短中文讲解刚才为什么这样改更地道
   - `/shorter`、`/softer`、`/formal`、`/casual` — 基于上一条结果二次微调
   - `/star` — 收藏/取消收藏上一条结果到个人表达库
   - `/r` — 重新生成 · `/diff` — 查看词级 Diff · `/copy` — 重新复制 · `/edit` — 打开编辑器 · `/h [关键词]` — 历史检索 · `/q` — 退出

### 经典模式（可选）

如果你更喜欢先提交文本，再按快捷键在内置或自定义风格间切换：

```bash
cao --classic
# 或
npm start -- --classic
```

1. 输入文本（输入空行回车完成）
2. 按单个快捷键切换不同的优化风格（可在 `config.yaml` 的 `hotkeys` 中自定义）：
   - `p` - 专业语气
   - `c` - 简洁版本
   - `g` - 语法修正
   - `d` - 资深开发者风格
   - `r` - 重置为原始文本
   - `h` - 查看历史
   - `q` 或 `Ctrl+C` - 退出
   - 以及 `~/.english-optimizer/prompts.json` 中定义的自定义提示词快捷键（如 `a`、`f`）

### 批量优化文件（Markdown 安全分块）

自动保护 YAML Frontmatter、```` ``` ```` / `~~~` 代码块、HTML 注释与行内 `` `code` ``，长文档按段落自动分块避免截断：

```bash
# 预览行级 Diff，不写入文件
cao batch README.md --mode professional --dry-run

# 支持所有内置模式、translate 或自定义提示词名
cao batch docs/*.md --mode translate --suffix .en
cao batch notes.md --mode concise --in-place
cao batch guide.md --chunk-size 2000
```

### 历史记录与个人表达库

```bash
# 查看、搜索、按收藏或模式筛选
cao history
cao history -n 20
cao history --search "null check"
cao history --starred

# 收藏、复制、导出 Markdown/JSON 或清空
cao history --star 1
cao history --copy 1
cao history --starred --export phrasebook.md
cao history --clear --keep-starred   # 清空未收藏记录，保留个人表达库
```

### 管理提示词与自定义预设

```bash
# 查看或编辑当前生效的翻译提示词（直接输出原始 YAML 或文本）
cao prompt --show
cao prompt --show --raw > prompt.yaml
cao prompt --edit

# 完整的自定义提示词增删查管理（~/.english-optimizer/prompts.json）
cao prompts
cao prompts show Academic
cao prompts add                                      # 交互式引导添加
cao prompts add tweet -d "技术短推" -p "Rewrite as a concise tweet: {text}" -k t
cao prompts remove tweet
```

### 检查配置

```bash
# 显示当前配置（默认对 API 密钥脱敏）
cao config
cao config --show-secrets

# 运行交互式设置向导（密钥采用掩码输入，配置文件权限自动设为 0600）
cao config --setup

# 测试 API 配置（支持 -p/--provider 和 --model 临时覆盖）
cao test
```

测试命令将：

- 验证你的 API 配置是否有效
- 测试与 API 提供商的连接
- 运行简单的优化测试
- 如果出现问题，显示详细的错误消息

设置向导将引导你完成：

- 选择 AI 提供商（本地 Ollama 或云端 API）
- 配置 API 设置
- 设置首选项

## 配置

配置按以下优先级生效（从高到低）：

1. **命令行参数**（`-p / --provider`、`--model`）
2. **环境变量**（Shell 或 `.env` 文件中的 `CAO_*` 变量）
3. **配置文件**（`~/.english-optimizer/config.yaml` 或 `~/.english-optimizer/config.json`）
4. **内置默认值**

### 使用云端 API（OpenAI、GLM、DeepSeek 等）

默认情况下，CLI 使用本地 Ollama。要使用云端 API，你需要配置它们。

**快速设置：**

1. 复制示例环境文件：

```bash
cp .env.example .env
```

2. 使用你的 API 配置编辑 `.env`（建议使用 `CAO_` 前缀，避免与其他项目的 `.env` 冲突）：

```env
CAO_AI_PROVIDER=api
CAO_API_PROVIDER=openai  # 或 'glm'、'deepseek'、'qwen'、'moonshot'、'custom'
CAO_API_KEY=your_api_key_here
CAO_API_BASE_URL=https://api.openai.com/v1
CAO_API_MODEL=gpt-4o
```

详细的 API 配置说明，请参见 [API_SETUP.md](API_SETUP.md)

### 环境变量

可以将 `.env` 放在 `~/.english-optimizer/.env`（推荐）或当前目录。当前目录的 `./.env` 仅读取带 `CAO_` 前缀的变量，避免被其他项目的 `API_KEY` 覆盖；`~/.english-optimizer/.env` 与 Shell 环境变量同时兼容不带前缀的旧变量名。

复制 `.env.example` 到 `~/.english-optimizer/.env`：

```bash
cp .env.example ~/.english-optimizer/.env
```

编辑 `.env`：

```env
# AI 提供商：本地使用 'ollama'，云端使用 'api'
CAO_AI_PROVIDER=ollama

# Ollama 配置（本地）
CAO_OLLAMA_BASE_URL=http://localhost:11434
CAO_OLLAMA_MODEL=llama3.2:3b

# API 配置（云端 - OpenAI/GLM）
# CAO_AI_PROVIDER=api
# CAO_API_PROVIDER=openai
# CAO_API_KEY=your_api_key_here
# CAO_API_BASE_URL=https://api.openai.com/v1
# CAO_API_MODEL=gpt-4o

# GLM（智谱 AI）
# CAO_API_PROVIDER=glm
# CAO_API_KEY=your_glm_api_key
# CAO_API_BASE_URL=https://open.bigmodel.cn/api/paas/v4
# CAO_API_MODEL=glm-4
```

### 配置文件

配置文件可以是 YAML 或 JSON 格式，会自动创建在 `~/.english-optimizer/config.yaml`（或 `config.json`）：

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

## 自定义提示词

你可以在 `~/.english-optimizer/prompts.json` 创建自定义优化提示词：

```json
[
  {
    "name": "Academic",
    "description": "以适合研究论文的学术风格重写",
    "prompt": "请以学术风格重写以下文本...",
    "hotkey": "a"
  },
  {
    "name": "Friendly",
    "description": "使文本更加友好和随意",
    "prompt": "请重写以下文本使其听起来更友好...",
    "hotkey": "f"
  }
]
```

## Docker 命令

```bash
# 启动 Ollama
docker-compose up -d

# 停止 Ollama
docker-compose down

# 查看日志
docker-compose logs -f ollama

# 重启 Ollama
docker-compose restart
```

## 生产部署

使用云端 API 而不是本地 Ollama：

1. 更新你的 `.env` 文件：

   ```env
   CAO_AI_PROVIDER=api
   CAO_API_PROVIDER=openai  # 或 'glm' 用于智谱 AI
   CAO_API_KEY=your_actual_api_key
   CAO_API_MODEL=gpt-4o  # 或你喜欢的模型
   ```

2. CLI 将自动使用云端 API

## 开发

```bash
# 监视并重新构建
npm run watch

# 在开发模式下运行
npm run dev

# 代码检查
npm run lint
```

## 项目结构

```
english-optimizer-cli/
├── src/
│   ├── index.ts                  # CLI 入口点（cao / eopt）
│   ├── core/
│   │   ├── instant-editor.ts     # 默认即时交互 REPL（支持斜杠命令）
│   │   ├── oneshot.ts            # 单次命令、标准输入管道与剪贴板执行器
│   │   ├── editor.ts             # 经典快捷键交互编辑器
│   │   ├── optimizer.ts          # 优化编排
│   │   ├── batch.ts              # 批量文件优化（支持 --dry-run）
│   │   └── markdown-chunker.ts   # Markdown 代码/Frontmatter 保护与分块器
│   ├── ai/
│   │   ├── provider.ts           # AI 提供商工厂
│   │   ├── ollama.ts             # Ollama 集成（NDJSON 流式）
│   │   ├── api-provider.ts       # OpenAI 兼容提供商（SSE 流式）
│   │   └── stream-utils.ts       # SSE 与 NDJSON 流解析器
│   ├── prompts/
│   │   ├── templates.ts          # 内置场景模板（slack/pr/commit/email/...）
│   │   ├── resolver.ts           # 统一模式与提示词解析器
│   │   ├── structured.ts         # 多版本与解释提示词构建与解析
│   │   ├── yaml-prompt.ts        # 项目/全局 prompt.yaml 加载器
│   │   ├── translation-prompt.ts # translation-prompt.txt 加载器
│   │   ├── custom.ts             # 自定义提示词存储（prompts.json）
│   │   └── commands.ts           # CLI prompts 增删查命令处理器
│   ├── config/
│   │   ├── config.ts             # 配置加载、CAO_* 隔离与密钥脱敏
│   │   ├── wizard.ts             # 交互式配置向导
│   │   └── test.ts               # API 连通性与鉴权诊断
│   ├── history/
│   │   ├── logger.ts             # 历史记录与个人收藏表达库
│   │   └── commands.ts           # CLI history 检索/收藏/导出/清空处理器
│   └── utils/
│       ├── display.ts            # 输出排版、词级/行级 Diff 与截断工具
│       └── spinner.ts            # 轻量级 TTY 感知加载动画
├── docker-compose.yml            # Ollama Docker 设置
├── scripts/
│   ├── bump-version.js           # 版本升级辅助脚本（同步 lockfile）
│   └── setup-ollama.sh           # Ollama 初始化脚本
├── CHANGELOG.md                  # 版本更新日志
└── package.json
```

## 故障排除

### Ollama 连接失败

```bash
# 检查 Ollama 是否运行
docker-compose ps

# 重启 Ollama
docker-compose restart

# 检查 Ollama 日志
docker-compose logs ollama
```

### 未找到模型

```bash
# 手动拉取模型
docker exec -it english-optimizer-ollama ollama pull llama3.2:3b
```

### API 密钥问题

确保你的 `.env` 文件有正确的 API 密钥，且 API 提供商 URL 准确。

## 许可证

MIT

## 贡献

欢迎贡献！请随时提交 Pull Request。

## 作者

为世界各地的非英语母语者用 ❤️ 创建。
