/**
 * @eden/core — Eden Agent 核心包
 *
 * 导出所有公共类型和类
 */

// 类型
export type {
  Message,
  ToolCall,
  ToolResult,
  EdenPlugin,
  PluginContext,
  PluginHooks,
  CoreTool,
  SkillProvider,
  ContextInjection,
  ToolCallRecord,
  TokenUsage,
  ProcessContext,
  ModelConfig,
  ChatCompletionMessage,
  ChatCompletionResponse,
  ModelProvider,
  DebugEvent,
  DebugEventType,
  Profile,
  ProfileAgentConfig,
  ProfilePluginEntry,
  AppConfig,
} from './types.js';

// 核心类
export { Agent } from './agent.js';
export { HookPipeline } from './hook-pipeline.js';
export { PluginManager } from './plugin-manager.js';
export { ProfileManager } from './profile.js';
export { ConfigLoader } from './config.js';
export { DebugChannel } from './debug-channel.js';
export { SystemPromptAssembler } from './system-prompt.js';
export { OpenAIProvider, estimateTokens, estimateCost } from './provider.js';
export { TuiServer } from './tui-server.js';
