# @eden/transport-cli

Eden Agent 的命令行传输层。提供 `eden` CLI 工具，支持交互式聊天和离线预览。

## 安装

```bash
pnpm add -w @eden/transport-cli
# 或者全局链接
pnpm add -w @eden/transport-cli
node packages/transport-cli/bin/eden.js --help
```

## 命令

### `eden chat`

交互式聊天。启动后输入消息，回车发送，输入 `/exit` 退出。

```bash
eden chat --profile novelist
```

### `eden dry-run`

离线预览本次请求的完整组成。不调 LLM，直接展示 system prompt + injected context + final messages。

```bash
# 仅预览
eden dry-run "写一段武侠开头" --profile novelist

# 预览后调用 LLM
eden dry-run "写一段武侠开头" --profile novelist --send
```

### 可用 Profiles

- `default` — 通用助手，无插件
- `novelist` — 武侠小说家，带文件记忆
- `trader` — 量化交易助手
- `researcher` — 技术研究员