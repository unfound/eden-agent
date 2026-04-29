# @eden/plugin-debug-panel

Debug 数据发布插件。订阅核心 `DebugChannel`，通过 Unix Socket 广播事件给 TUI。

## 使用方式

### 1. Chat + 内联 Debug

```bash
eden chat --profile novelist --debug
```

启用 debug-panel 插件，输出 socket 路径：

```
[eden] Chat — profile: novelist [DEBUG]
[eden] Debug socket: /tmp/eden-debug.sock
[eden] Run 'eden debug --profile novelist' in another terminal to open TUI
```

### 2. 独立 TUI

```bash
eden debug --profile novelist
```

打开独立终端窗口，用 ANSI 转义码渲染实时面板。

## 工作原理

```
DebugChannel (核心, 零开销)
    │
    │  emit() — 无订阅者则直接返回
    ▼
DebugPanelPlugin
    │
    │  WebSocket Server on /tmp/eden-debug.sock
    ▼
TUI (独立进程, ANSI 渲染)
```

## 面板内容

- **System Prompt** — 当前 system prompt 内容 + 字符数
- **Memory Context** — 各插件注入的上下文（来源、tokens）
- **Token Usage** — in/out/total + cost
- **Error** — 最后一个错误信息

## 零开销设计

- `DebugChannel.emit()` 无订阅者时直接返回，不采集数据
- TUI 是独立进程，不占用主 agent 进程资源
- 不加载此插件 = 零性能影响
