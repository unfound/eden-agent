# Debug Panel UI 重构计划

## 布局方案

### Debug 模式（`--debug`）

```
┌─ eden · novelist · qwen3.5 · ws ✓ ──────────────────────────┐
│  ┌─ 左栏 40%：聊天记录 ─────────┐ ┌─ 右栏 60%：消息日志 ─┐  │
│  │                              │ │                         │  │
│  │  🧑 你: 你好                 │ │  Request (2 msg)        │  │
│  │                              │ │  ┌─ system ──────────┐  │  │
│  │  🤖 Eden: 你好。             │ │  │ 你是武侠小说作家…  │  │  │
│  │  你来了。                    │ │  └───────────────────┘  │  │
│  │  是来听故事的？               │ │  ┌─ user ────────────┐  │  │
│  │                              │ │  │ 你好               │  │  │
│  │  🧑 你: 讲个故事吧            │ │  └───────────────────┘  │  │
│  │                              │ │                         │  │
│  │  🤖 Eden: 好。               │ │  Response (1.2s)        │  │
│  │  有一个老乞丐。              │ │  ┌─ assistant ────────┐  │  │
│  │  一把破伞。                  │ │  │ 你好。你来了。      │  │  │
│  │                              │ │  └───────────────────┘  │  │
│  │                              │ │                         │  │
│  │                              │ │  ▸ Token: in 1,490     │  │
│  │                              │ │    persona 200 |        │  │
│  │                              │ │    memory 196 |         │  │
│  │                              │ │    user 58 | out 619   │  │
│  │                              │ │                         │  │
│  │                              │ │  ▸ Memory (recalled 1) │  │
│  │                              │ │  [memory-file] 196t    │  │
│  │                              │ │  / 300t (65%)          │  │
│  │                              │ │  #1 用户偏好… 45t      │  │
│  │                              │ │                         │  │
│  │                              │ │  ✕ [ModelProvider]      │  │
│  │                              │ │  HTTP 400 — not found   │  │
│  └──────────────────────────────┘ └─────────────────────────┘  │
│                                                               │
│  ═══════════════════════════════════════════════════════════  │
│  > 输入消息...                                    [发送]     │
│  ──────────────────────────────────────────────────────────   │
│  qwen3.5 · in: 1,490 · out: 619 · ▓▓▓▓▓░░░░ 3.6% (572/16k)  │
└───────────────────────────────────────────────────────────────┘
```

### 非 Debug 模式（不加 `--debug`）

```
┌─ eden · novelist · qwen3.5 ─────────────────────────────────┐
│                                                               │
│  🧑 你: 你好                                                  │
│                                                               │
│  🤖 Eden: 你好。                                              │
│  你来了。                                                     │
│  是来听故事的？                                                │
│  ── in 483 · out 58 · tot 541 · $0.0003 ──                  │
│                                                               │
│  🧑 你: 讲个故事吧                                             │
│                                                               │
│  🤖 Eden: 好。                                                │
│  有一个老乞丐。                                                │
│  一把破伞。                                                   │
│  ── in 966 · out 619 · tot 1585 · $0.0014 ──                │
│                                                               │
│  ═══════════════════════════════════════════════════════════  │
│  > 输入消息...                                    [发送]     │
│  ──────────────────────────────────────────────────────────   │
│  qwen3.5 · in: 1,490 · out: 619 · ▓▓▓▓▓░░░░ 3.6% (572/16k)  │
└───────────────────────────────────────────────────────────────┘
```

## 当前状态 vs 目标

| 维度 | 当前 | 目标 |
|------|------|------|
| 布局 | 左聊天+右Debug信息 | 左聊天+右结构化消息日志 |
| 左栏 | Debug 统计面板 | 普通聊天记录（对话流） |
| 右栏 | 无 | 带角色着色卡片的完整消息日志 |
| 消息展示 | 纯文本 | JSON 格式化 + role 标签 + 背景色 |
| 输入框 | 内联在聊天区 | 底部固定，跨栏 |
| 状态栏 | 无 | 底部：model + 累计 token + 进度条 |
| 进度条 | 无 | token 使用率可视化 |

## 任务拆解

### Phase 1 — 布局重构

- [ ] **T1.1** 将 `eden.tsx` 中的 ChatInk 组件拆为：
  - `Header`：标题栏（eden + profile + ws 状态）
  - `ChatPane`：左栏，聊天记录列表
  - `MessageLog`：右栏，结构化消息日志
  - `InputBar`：底部固定输入框
  - `StatusBar`：底部状态信息（model + token + 进度条）
- [ ] **T1.2** 双栏 Flex 布局：左栏 40% + 右栏 60%
- [ ] **T1.3** 底部固定 InputBar + StatusBar，独立于双栏区域
- [ ] **T1.4** 左栏可滚动（对话历史长时）

### Phase 2 — 左栏：聊天记录（ChatPane）

- [ ] **T2.1** 对话列表，类似当前左栏样式
- [ ] **T2.2** 消息换行（`wrap="wrap"`）适配左栏宽度
- [ ] **T2.3** 角色标识（🧑 🤖）和颜色
- [ ] **T2.4** 显示最新消息在底部，自动滚动

### Phase 3 — 右栏：消息日志（MessageLog）

- [ ] **T3.1** Request Block 头部：`Request (N msg +M tools)` 带蓝色背景标签
- [ ] **T3.2** system 消息卡片：灰色背景 + role 标签
- [ ] **T3.3** user 消息卡片：蓝色背景 + role 标签
- [ ] **T3.4** tool 调用卡片：黄色背景，显示 name + args + result
- [ ] **T3.5** Response Block 头部：`Response (X.Xs · XX+XX tokens)` 带绿色背景标签
- [ ] **T3.6** assistant 消息卡片：绿色背景 + role 标签
- [ ] **T3.7** 错误卡片：红色背景
- [ ] **T3.8** 消息内容 JSON 格式化显示

### Phase 4 — 底部区域

- [ ] **T4.1** 分隔线 + 输入框（跨栏宽）
- [ ] **T4.2** 发送按钮（回车触发）
- [ ] **T4.3** 多行输入支持（Shift+Enter 换行）
- [ ] **T4.4** 状态栏：model 名
- [ ] **T4.5** 状态栏：累计 token (in / out / total)
- [ ] **T4.6** 状态栏：Token 进度条 `▓▓▓▓▓░░░░ 3.6% (572/16384)`

### Phase 5 — 视觉美化

- [ ] **T5.1** 圆角卡片风格（Ink borderStyle 选择）
- [ ] **T5.2** 角色块颜色体系（system=灰, user=蓝, assistant=绿, tool=黄, error=红）
- [ ] **T5.3** JSON 格式化（key/value 不同色）
- [ ] **T5.4** 响应时间格式化（ms/s）
- [ ] **T5.5** 背景色与主题统一

## 组件树

```
<App>
  <Header />                    // 标题栏
  <Box flexDirection="row">     // 主体双栏
    <ChatPane flex={40} />      // 左栏 40%
    <MessageLog flex={60} />    // 右栏 60%
  </Box>
  <InputBar />                  // 底部输入框
  <StatusBar />                 // 底部状态条
</App>
```

## 数据流

```
Agent.chat() → DebugChannel.emit()
  → @eden/plugin-debug-panel (WebSocket)
    → ChatInk (WS → React State)
      ├── ChatPane:     messages[] (普通对话)
      ├── MessageLog:   messages[] + toolCalls (结构化)
      ├── InputBar:     input + submit handler
      └── StatusBar:    tokenUsage + cumulativeUsage + model
```

## 消息卡片数据结构

```typescript
interface MessageCard {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  latencyMs?: number;
  tokens?: number;
}
```

## 注意事项

- Ink 组件树 `<Text>` 不支持背景色——需用 `<Box>` 包裹并用 ANSI 背景色码
- Ink `useInput` 在 App 级统一管理，分发给子组件
- 进度条百分比从 profile config 读取 `maxTokens`（若无配置则用 16384 默认）
- 所有核心数据（messages, toolCalls, tokenUsage）都通过 DebugState 从 agent.chat() 获取

## 补充设计要点

### Token 组成可视化
每轮请求显示 token 组成条形图：
```
▸ Token:  in 1,490 (persona 200 | memory 196 | skills 0 | user 58 | tools 0)
          out 619 | tot 2,109 | cost $0.0014
```
清晰看到每部分各占多少，找出浪费。

### 预算 vs 实际
每个插件/注入源显示配额使用率：
```
[memory-file] 196t / 300t (65%)
[plugin-skill] 0t / 500t (0%)
```
一眼看出哪些插件在吃 token、哪些没用满。

### 记忆 Recall 详情
每次请求的 memory injection 显示 recall 到的具体条目：
```
▸ Memory (recalled 3 entries)
  [memory-file]  ·  #1  用户偏好：主角姓林       45t
  [memory-file]  ·  #2  上次情节：林远被追杀       120t  ⚠ truncated
  [memory-file]  ·  #3  已验证：{主角: 林远}       31t
```
含截断标记、分数（向量模式）、token 明细。

### 非 debug 模式 UI
- 全屏左栏 + 底部状态栏
- 每轮对话后消息下方显示灰色 token 小字：
  ```
  🤖 Eden: 你好。你来了。
  ── in 483 · out 58 · tot 541 · $0.0003 ──
  ```
- 状态栏始终显示：model · 累计 in/out · 进度条
- 无右栏，不启动 WebSocket

### Dry-run 模式
复用同样布局，右栏显示拼装预览（无 LLM 调用）：
- system prompt 完整内容
- 各插件注入上下文
- 工具描述
- 预估 token 和成本
- `--send` 时触发实际调用，右栏切换为实时日志

### 右栏视图切换（`/debug-info`）
右栏内容太多会拥挤，用指令切换视图：

| 视图 | 命令 | 内容 |
|------|------|------|
| **消息日志** (默认) | — | Request/Response role 卡片，工具调用 |
| **统计面板** | `/debug-info` | Token 组成、预算 vs 实际、Memory recall、ModelProvider 信息 |

输入 `/debug-info` 在两种视图间切换，当前视图显示在右栏顶部：
```
┌─ 右栏：消息日志 ──────────────┐      ┌─ 右栏：统计面板 ────────────────┐
│  [/debug-info 切换统计面板]    │  ←→  │  [/debug-info 切换消息日志]     │
│  Request (2 msg)               │      │  ▸ Token: in 1,490              │
│  ┌─ system ──────────┐         │      │    persona 200 | memory 196     │
│  │ ...               │         │      │                                 │
│  └───────────────────┘         │      │  ▸ Memory (recalled 1)          │
│  ...                           │      │    [memory-file] 196t / 300t   │
└────────────────────────────────┘      └─────────────────────────────────┘
```

后续扩展新视图只需在 `/debug-info` 循环中加入。也可扩展为 `/debug-info tokens`、`/debug-info memory` 等子命令直接跳转。

> ⚠️ 注意：命令名 `/debug-info` 已确认，实现时保持一致，不要简写或改名为 `/info`、`/di` 等变体。

### 工具调用结果预览
工具结果太长时，不截断参数而显示结果摘要：
```
▶ web_search · 1.2s
  → 返回 5 条结果（第一条: "xxx"…）
```
args 可折叠，优先展示有意义的结果摘要。

### 错误定位
错误信息带来源标注：
```
✕ [ModelProvider] HTTP 400 — model "qwen3.5-9b" not found
✕ [plugin:memory-file] onPreProcess failed: ENOENT memory/
```
快速定位哪个环节出了问题。
