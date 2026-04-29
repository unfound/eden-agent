# @eden/core

Eden Agent 的核心框架包。提供 Agent Loop、插件系统、Profile 管理、ModelProvider 等基础设施。

## 安装

```bash
pnpm add @eden/core
```

## 主要导出

```typescript
import {
  Agent,           // 核心 Agent Loop
  PluginManager,   // 插件加载/生命周期
  HookPipeline,    // 钩子注册与执行
  ProfileManager,  // Profile 加载与管理
  ConfigLoader,    // YAML 配置 + env var 插值
  OpenAIProvider,  // OpenAI 兼容接口
  SystemPromptAssembler,  // System prompt 动态拼装
  DebugChannel,    // Debug 数据发布基础设施
} from '@eden/core';
```

## Agent 使用示例

```typescript
import { Agent, PluginManager, ProfileManager, ConfigLoader, DebugChannel } from '@eden/core';

const debugChannel = new DebugChannel();
const profileManager = new ProfileManager('~/.eden/profiles');
const config = profileManager.load('novelist');
const pluginManager = new PluginManager(debugChannel);

await pluginManager.loadPlugins(config.plugins);

const agent = new Agent({
  profile: config,
  pluginManager,
  debugChannel,
});

const result = await agent.run('写一段武侠开头');
console.log(result.text);
```

## 核心概念

### Plugin

```typescript
interface EdenPlugin {
  name: string;
  version: string;
  init?(ctx: PluginContext): Promise<void>;
  enable?(): Promise<void>;
  disable?(): Promise<void>;
  destroy?(): Promise<void>;
  hooks?: PluginHooks;
  tools?: Record<string, CoreTool>;
}
```

### HookPipeline

每个插件可注册以下钩子，在 Agent Loop 的各阶段被调用：

- `onPreProcess` — LLM 调用前，注入 memory 等上下文
- `onPostProcess` — LLM 调用后，记录结果到记忆等

### Profile

Profile 决定了一个 Agent 的全部配置：

```yaml
# ~/.eden/profiles/novelist/config.yaml
agent:
  name: "小说家"
  model:
    baseURL: "http://localhost:8888/v1"
    model: "qwen3.5-9b"
  system:
    persona: "你是一个武侠小说作家。用中文写作，风格古龙。"
    maxTokens: 300

plugins:
  - name: "@eden/plugin-memory-file"
    config:
      path: "memory/"
      maxTokens: 300
```