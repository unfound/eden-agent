# Eden Agent

> **一个 profile = 一个 Agent。只为需要的零件付费。**

一个模块化的 TypeScript Agent 框架。每个 Agent 由 Profile 驱动，按需加载插件，token 开销精确到每个组件。

## 快速开始

```bash
# 安装依赖
pnpm install

# 构建全部包
pnpm build

# 试用 novelist profile
npx tsx packages/transport-cli/bin/eden.ts dry-run "写一段武侠开头" --profile novelist

# 调用 LLM
npx tsx packages/transport-cli/bin/eden.ts dry-run "写一段武侠开头" --profile novelist --send
```

## 核心设计

- **Profile = Agent**: 一个 `~/.eden/profiles/<name>/config.yaml` = 一个完整的 Agent 实例
- **按需加载**: 只加载配置中声明的插件，未配置的插件代码不会进入运行时
- **零开销观测**: `ProcessContext` 始终维护调试数据，无 Debug 插件时零开销
- **错误隔离**: 单个插件崩溃不影响核心和其他插件

## 项目结构

```
eden-agent/
├── packages/
│   ├── core/                    # @eden/core — 核心框架
│   ├── plugin-memory-file/      # @eden/plugin-memory-file — 文件记忆
│   └── transport-cli/           # @eden/transport-cli — CLI 入口
├── profiles/                    # 示例 profiles（位于 ~/.eden/profiles/）
└── ARCHITECTURE.md              # 完整架构文档
```

## 路线图

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 1 | 核心框架、Profile 系统、CLI、memory-file | ✅ 完成 |
| Phase 2 | skill-fs、tool-terminal、tool-web-search | 🔲 待做 |
| Phase 3 | Debug Panel + TUI | 🔲 待做 |
| Phase 4 | memory-vector、browser、feishu transport | 🔲 待做 |

## 相关链接

- 架构文档: [ARCHITECTURE.md](./ARCHITECTURE.md)