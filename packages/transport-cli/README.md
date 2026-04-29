# @eden/transport-cli

Eden Agent 的命令行传输层。提供 `eden` CLI 工具。

## 安装

```bash
pnpm add -w @eden/transport-cli
pnpm exec eden --help
```

## 命令

### `eden chat`

交互式聊天。启动后输入消息，回车发送，输入 `/exit` 退出。

```bash
eden chat --profile novelist
eden chat --profile novelist --debug   # 启用 debug socket
```

### `eden dry-run`

离线预览本次请求的完整组成。不调 LLM，直接展示 system prompt + injected context + final messages。

```bash
eden dry-run "写一段武侠开头" --profile novelist
eden dry-run "写一段武侠开头" --profile novelist --send  # 预览后调用 LLM
```

### `eden debug`

独立 Debug TUI。连接 `eden chat --debug` 启动的 socket，实时渲染面板。

```bash
eden debug --profile novelist
```

## 可用 Profiles

| Profile | 说明 | 插件 |
|---------|------|------|
| `default` | 通用助手，无插件 | — |
| `novelist` | 武侠小说家 | memory-file |
| `trader` | 量化交易助手 | memory-file, tool-terminal, tool-web-search |
| `researcher` | 技术研究员 | memory-vector, skill-fs, tool-terminal, tool-web-search, tool-browser, debug-panel |
