# Eden Agent — Architecture & Implementation Plan

## 1. Vision

> **一个 profile = 一个 Agent。只为需要的零件付费。**

现有的 Agent 框架太胖了。你只想写小说，它却加载了 terminal、浏览器、飞书、记忆、技能……system prompt 2000 tokens 起步，大部分跟你没关系。

Eden 反过来：

```
eden chat --profile novelist    → 加载 0 个工具，200 token system prompt
eden chat --profile trader      → 加载 2 个工具，300 token system prompt
eden chat --profile researcher  → 加载 4 个工具，500 token system prompt
```

每个 Agent **只组装自己需要的零件**，token 开销精确到每个插件的贡献。看得见、改得动、省得下。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| **Profile 即 Agent** | 一个 `config.yaml` = 一个完整的 Agent 实例，互不干扰 |
| **零插件也能跑** | 不配置任何插件 → 纯 LLM 问答，开销最小 |
| **按需加载** | 没配置的插件代码不会加载进运行时 |
| **System prompt 动态拼装** | 没有预写死的通用提示词，每个插件注入自己的那一段 |
| **精确可观测** | Debug Panel + dry-run，看清每一轮请求的 token 组成 |
| **隔离失败** | 一个插件崩溃不影响核心和其他插件 |

---

## 3. Profile 系统

### 3.1 概念

```
~/.eden/profiles/
├── novelist/              # 小说 Agent（完整的 workspace）
│   ├── config.yaml          #   Agent 配置
│   ├── memory/            #   该 Agent 的记忆
│   ├── skills/            #   该 Agent 的技能
│   └── writings/          #   该 Agent 的产物
│
├── trader/                # 炒股 Agent（另一个 workspace）
│   ├── config.yaml
│   ├── memory/
│   ├── skills/
│   └── notes/
│
├── researcher/            # 研究 Agent
│   ├── config.yaml
│   ├── memory/
│   ├── skills/
│   └── papers/
│
└── default/               # 通用
    ├── config.yaml
    ├── memory/
    └── skills/
```

每个 profile 是一个**自包含目录**：配置、记忆、技能、产物全在里面。移动/备份/分享一个 Agent = 复制一个文件夹。

### 3.2 三个典型 Profile 对比

#### Novelist — 极简，零工具

```yaml
# profiles/novelist/config.yaml
agent:
  name: "小说家"
  model:
    baseURL: "http://localhost:8888/v1"
    model: "qwen3.5-9b"
  system:
    persona: "你是一个武侠小说作家。用中文写作，风格古龙。"
    maxTokens: 200

plugins:
  - name: "@eden/plugin-memory-file"
    config:
      path: "memory/"          # 相对于 profile 目录
      maxTokens: 300
```

**每轮请求开销：**
```
system persona:    200 tokens
memory context:    300 tokens
tools:               0 tokens (没工具)
─────────────────────────
总计:              ~500 tokens
成本(qwen3.5):    ~$0.0003
```

#### Trader — 轻量，两个工具

```yaml
# profiles/trader/config.yaml
agent:
  name: "交易助手"
  model:
    baseURL: "http://localhost:8888/v1"
    model: "qwen3.5-9b"
  system:
    persona: "你是一个量化交易助手。只提供分析，不构成投资建议。"
    maxTokens: 200

plugins:
  - name: "@eden/plugin-memory-file"
    config:
      path: "memory/"
      maxTokens: 200
  - name: "@eden/plugin-tool-terminal"
  - name: "@eden/plugin-tool-web-search"
    config:
      maxTokens: 200
```

#### Researcher — 研究，多工具

```yaml
# profiles/researcher/config.yaml
agent:
  name: "研究员"
  model:
    baseURL: "https://api.openai.com/v1"
    model: "gpt-4o-mini"
  system:
    persona: "你是一个技术研究员。深度分析，引用来源。"
    maxTokens: 300

plugins:
  - name: "@eden/plugin-memory-vector"
    config:
      path: "memory/"
      maxTokens: 500
  - name: "@eden/plugin-skill-fs"
    config:
      path: "skills/"
  - name: "@eden/plugin-tool-terminal"
  - name: "@eden/plugin-tool-web-search"
  - name: "@eden/plugin-tool-browser"

  - name: "@eden/plugin-debug-panel"
    config:
      enabled: true
```

### 3.3 启动命令

```bash
eden chat                         # 默认 profile (default.yaml)
eden chat --profile novelist      # 小说家
eden chat --profile trader        # 交易助手
eden chat --profile researcher    # 研究员

eden chat --profile novelist --debug   # 同时启动 debug TUI

eden dry-run "写一段武侠开头" --profile novelist
# 离线预览 system prompt + memory + tools，不调 LLM

eden dry-run "写一段武侠开头" --profile novelist --send
# 预览后调用 LLM
```

---

## 4. 核心架构

```
┌──────────────────────────────────────────────────────────┐
│                       EdenAgent                           │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Plugin   │  │ Agent    │  │ Config   │  │ Profile  │ │
│  │ Manager  │◄─┤ Loop     ├──┤ Loader   │  │ Manager  │ │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └──────────┘ │
│       │              │                                     │
│  ┌────▼──────────────▼────────────────────────────────┐   │
│  │              Hook Pipeline                          │   │
│  │  onPreProcess → onPostToolCall → onPostProcess     │   │
│  │                                                     │   │
│  │  ProcessContext (始终维护，零开销)                  │   │
│  │    .systemPrompt: string                           │   │
│  │    .injectedContext: {source, content, tokens}[]   │   │
│  │    .toolCalls: {name, args, result, latency}[]     │   │
│  │    .tokenUsage: {in, out, cost}                    │   │
│  └────────────────────────────────────────────────────┘   │
│                                                           │
│  ┌──────────────┐   Model Provider (core)                 │
│  │ Provider     │── OpenAI-compat 接口                     │
│  └──────────────┘  配置驱动切换                            │
└──────────────────────────────────────────────────────────┘

         ▲              ▲              ▲              ▲
         │              │              │              │
    ┌────┴───┐     ┌────┴───┐     ┌────┴───┐    ┌────┴──────┐
    │ Memory │     │ Skill  │     │ Tool   │    │ Debug     │
    │ Plugin │     │ Plugin │     │ Plugin │    │ Plugin    │
    └────────┘     └────────┘     └────────┘    └───────────┘
                                                  (仅启用时发布)
```

---

## 5. EdenPlugin 接口

```typescript
interface EdenPlugin {
  name: string;
  version: string;

  // 生命周期
  init?(ctx: PluginContext): Promise<void>;
  enable?(): Promise<void>;
  disable?(): Promise<void>;
  destroy?(): Promise<void>;

  // 能力暴露
  hooks?: PluginHooks;
  tools?: Record<string, CoreTool>;
  skills?: SkillProvider;
  middleware?: Middleware;
  transports?: Transport;
}

interface PluginHooks {
  onPreProcess?(ctx: ProcessContext): Promise<void>;
  onPostProcess?(ctx: ProcessContext): Promise<void>;
  onPreToolCall?(call: ToolCall): Promise<void>;
  onPostToolCall?(call: ToolCall, result: ToolResult): Promise<void>;
  onError?(error: Error, ctx: ProcessContext): Promise<void>;
}

interface ProcessContext {
  messages: Message[];
  systemPrompt: string;           // 动态拼装的 system prompt
  injectedContext: ContextInjection[];  // 各插件注入的上下文（带来源）
  activeSkills: string[];
  toolCalls: ToolCallRecord[];
  tokenUsage: TokenUsage;
  requestId: string;
}

interface ContextInjection {
  source: string;      // 插件名，如 "memory-file"
  content: string;     // 注入的文本
  tokens: number;      // 占用 token 数
  metadata?: Record<string, unknown>;  // 如 { score: 0.87 }
}
```

---

## 6. System Prompt 动态组装

核心不预写死 system prompt。每次请求动态拼装：

```typescript
function assembleSystemPrompt(ctx: ProcessContext): string {
  const parts: string[] = [];

  // 1. 基础 persona（来自 profile 配置）
  parts.push(ctx.systemPrompt);

  // 2. 每个记忆插件注入的上下文（按 source 分组，带标注）
  for (const inj of ctx.injectedContext) {
    parts.push(`[${inj.source}]\n${inj.content}`);
  }

  // 3. 激活的 skill 指令
  for (const skill of ctx.activeSkills) {
    parts.push(skill);
  }

  // 4. 工具描述由 AI SDK 自动追加到 messages

  return parts.join("\n\n");
}
```

**关键：** Novelist agent 没有工具插件 → `toolDescriptions` 为空 → system prompt 就是 persona + memory。

---

## 7. Debug 系统

### 7.1 数据采集在 Core，发布在 Plugin

```
┌─ Core Agent Loop ─────────────────────────┐
│                                            │
│  ProcessContext 始终维护:                  │
│    .systemPrompt      ← 字符串引用        │
│    .injectedContext   ← 数组引用          │
│    .toolCalls         ← 数组引用          │
│    .tokenUsage        ← 几个数字          │
│                                            │
│  开销：近乎为零（引用+基础类型）          │
└────────────────────────────────────────────┘
                │
                │ (仅当 Debug Plugin 加载)
                ▼
         Debug Plugin
           序列化 → Unix Socket → TUI 进程
```

不加载 Debug 插件 → 数据还在，不序列化不写 socket → 零额外开销。

### 7.2 Debug TUI 布局

```
┌─ Chat ─────────────────┐   ┌─ Debug Panel ───────────────────┐
│                         │   │ ▸ System Prompt       (展开)   │
│ User: 帮我写一段武侠   │   │   你是一个武侠小说作家...       │
│                         │   │                                  │
│ Eden:                   │   │ ▸ Memory Context        (3 条)  │
│ 夜，冷得像刀。         │   │   [memory-file] 用户偏好：...   │
│ 他走在长安街上...       │   │   tokens: 45  score: 0.87      │
│                         │   │   [memory-file] 上次情节：...   │
│                         │   │   tokens: 120  score: 0.72      │
│                         │   │                                  │
│                         │   │ ▸ Skills                  (无)  │
│                         │   │   (未加载 skill 插件)           │
│                         │   │                                  │
│                         │   │ ▸ Tools                   (无)  │
│                         │   │   (未加载工具插件)              │
│                         │   │                                  │
│                         │   │ ▸ Token Usage                    │
│                         │   │   in: 478    out: 156            │
│                         │   │   cost: $0.00037                 │
│                         │   │   ─────────────────              │
│                         │   │   累计 in: 5,234                 │
│                         │   │   累计 cost: $0.0034             │
└─────────────────────────┘   └─────────────────────────────────┘
```

### 7.3 Dry-Run 模式

```bash
$ eden dry-run "主角遇到一个神秘老者" --profile novelist
```

```
=== DRY RUN (未调用 LLM) ====================================

── System Prompt (200 tokens) ──────────────────────────────
你是一个武侠小说作家。用中文写作，风格古龙。

── Memory Context (165 tokens) ─────────────────────────────
[memory-file] 用户偏好：主角姓林，用剑，性格孤傲
[memory-file] 上次写到的情节：林远在长安城被神秘组织追杀
[memory-file] 已验证作品：{主角: 林远, 武器: 剑, 关键配角: 柳如烟}

── Tools ───────────────────────────────────────────────────
(未加载工具插件)

── Skills ──────────────────────────────────────────────────
(未加载 skill 插件)

── Final Messages ──────────────────────────────────────────
system: 你是一个武侠小说作家。用中文写作，风格古龙。

[memory-file] 用户偏好：主角姓林，用剑，性格孤傲
[memory-file] 上次写到的情节：林远在长安城被神秘组织追杀

user: 主角遇到一个神秘老者

────────────────────────────────────────────────────────────
总 input tokens:  365
预估成本:         $0.00022 (qwen3.5-9b)

加上 --send 调用 LLM。
============================================================
```

---

## 8. 插件 Token Budget

每个插件可声明 token 预算上限。超过自动截断。

```typescript
interface PluginConfig {
  maxTokens?: number;  // 该插件最多占用多少 tokens
}
```

```yaml
- name: "@eden/plugin-memory-file"
  config:
    path: "memory/"
    maxTokens: 300   # 记忆最多 300 tokens
```

实现：`onPreProcess` 注入 context 时，核心对每个 `ctx.injectedContext` 做截断：

```typescript
for (const inj of ctx.injectedContext) {
  if (inj.tokens > pluginBudget) {
    inj.content = truncateByTokens(inj.content, pluginBudget);
    inj.tokens = pluginBudget;
    inj.metadata.truncated = true;  // 标注，debug 面板可见
  }
}
```

---

## 9. 项目结构（monorepo）

```
eden-agent/
├── ARCHITECTURE.md
├── packages/
│   ├── core/                    # @eden/core
│   │   ├── src/
│   │   │   ├── agent.ts
│   │   │   ├── plugin-manager.ts
│   │   │   ├── hook-pipeline.ts
│   │   │   ├── provider.ts      # ModelProvider 接口 + OpenAI 兼容
│   │   │   ├── profile.ts       # Profile 加载/管理
│   │   │   ├── system-prompt.ts # System prompt 动态组装
│   │   │   ├── debug-channel.ts # Debug 数据发布基础设施（core）
│   │   │   ├── config.ts
│   │   │   └── types.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── plugin-memory-file/      # @eden/plugin-memory-file
│   │   ├── src/index.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── plugin-skill-fs/         # @eden/plugin-skill-fs
│   ├── plugin-tool-terminal/    # @eden/plugin-tool-terminal
│   ├── plugin-tool-web-search/  # @eden/plugin-tool-web-search
│   ├── plugin-debug-panel/      # @eden/plugin-debug-panel
│   │   ├── src/
│   │   │   ├── index.ts         # EdenPlugin
│   │   │   └── tui.ts           # Debug TUI (ink)
│   │   └── package.json
│   │
│   ├── transport-cli/           # @eden/transport-cli
│   └── transport-http/          # @eden/transport-http
│
├── profiles/                    # 示例 profile 文件
│   ├── novelist.yaml
│   ├── trader.yaml
│   └── researcher.yaml
│
├── examples/
│   └── minimal/                 # 零插件示例
│
├── tsconfig.json
├── package.json
└── pnpm-workspace.yaml
```

---

## 10. 实施路线

### Phase 1 — 核心 + Profile 系统（1-2 周）

- [ ] `@eden/core`
  - [ ] `PluginManager` — 加载/生命周期/错误隔离
  - [ ] `HookPipeline` — 钩子注册和执行
  - [ ] `ModelProvider` — OpenAI 兼容接口
  - [ ] `ProfileManager` — 加载 profile yaml，按需加载插件
  - [ ] `SystemPromptAssembler` — 动态拼装 system prompt
  - [ ] `DebugChannel` — debug 数据发布基础设施
  - [ ] `ConfigLoader` — YAML + env var 插值 + token budget 校验
  - [ ] 类型系统
- [ ] `@eden/transport-cli` — CLI 入口（`eden chat`, `eden dry-run`）
- [ ] 测试覆盖

### Phase 2 — 首批插件（2-3 周）

- [ ] `@eden/plugin-memory-file`
- [ ] `@eden/plugin-skill-fs`
- [ ] `@eden/plugin-tool-terminal`
- [ ] `@eden/plugin-tool-web-search`
- [ ] `@eden/transport-http`

### Phase 3 — Debug 面板（1 周）

- [ ] `@eden/plugin-debug-panel` — 数据发布
- [ ] Debug TUI (ink) — `eden debug` 命令
- [ ] `eden dry-run` — 离线预览

### Phase 4 — 高级（按需）

- [ ] `@eden/plugin-memory-vector`
- [ ] `@eden/plugin-tool-browser`
- [ ] `@eden/transport-feishu`
- [ ] OpenClaw 融合探索

---

## 11. 关键设计决策

### 11.1 Provider 不插件化

一个 Agent 实例只有一个后端。切换 = 改一行 `baseURL`。不需要插件开销。

### 11.2 Debug 数据采集在 Core，发布在 Plugin

`ProcessContext` 始终维护 token/call/context 数据（零开销引用），Debug 插件只是"读+发布"。不加载 = 零开销。

### 11.3 Profile 实现按需加载

配置里列出的插件 → `PluginManager` 用动态 `import()` 加载。没列的插件代码**根本不会被 Node.js 解析**。

### 11.4 技术栈

| 层 | 选择 |
|----|------|
| 语言 | TypeScript |
| AI SDK | Vercel AI SDK v6 |
| 运行时 | Node.js 22+ |
| 包管理 | pnpm (workspace monorepo) |
| 测试 | Vitest |
| 配置 | YAML + env var 插值 |
| Schema | Zod |
| Debug TUI | ink (React for CLI) |
| Lint | ESLint (no-explicit-any: error) |

---

## 12. 下一步

1. ~~对齐架构方向~~ ✅
2. 确认今晚讨论结果，明天动手
3. 搭建 monorepo → `pnpm init` + workspaces
4. 实现 `@eden/core` → PluginManager → HookPipeline → ProfileManager → ModelProvider
5. 实现 `@eden/transport-cli` → `eden chat --profile novelist`
6. 实现 `@eden/plugin-memory-file` → 验证插件系统
7. 端到端跑通：`eden chat --profile novelist`
