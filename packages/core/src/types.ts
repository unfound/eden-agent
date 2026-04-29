/**
 * @eden/core 类型系统
 * 核心类型定义，所有其他模块依赖于此
 */

// ============ 消息类型 ============

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  result: unknown;
  error?: string;
}

// ============ Plugin 系统 ============

export interface PluginContext {
  profileDir: string;
  pluginName: string;
  config: Record<string, unknown>;
  // deno-lint-ignore no-explicit-any
  debugChannel: any;
}

export interface PluginHooks {
  onPreProcess?(ctx: ProcessContext): Promise<void>;
  onPostProcess?(ctx: ProcessContext): Promise<void>;
  onPreToolCall?(call: ToolCall): Promise<void>;
  onPostToolCall?(call: ToolCall, result: ToolResult): Promise<void>;
  onError?(error: Error, ctx: ProcessContext): Promise<void>;
}

export interface CoreTool {
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: PluginContext): Promise<unknown>;
}

export interface SkillProvider {
  getSkill(name: string): Promise<string | null>;
  listSkills(): Promise<string[]>;
}

export interface EdenPlugin {
  name: string;
  version: string;
  init?(ctx: PluginContext): Promise<void>;
  enable?(): Promise<void>;
  disable?(): Promise<void>;
  destroy?(): Promise<void>;
  hooks?: PluginHooks;
  tools?: Record<string, CoreTool>;
  skills?: SkillProvider;
}

// ============ ProcessContext ============

export interface ContextInjection {
  source: string;
  content: string;
  tokens: number;
  metadata?: Record<string, unknown>;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  latencyMs?: number;
}

export interface TokenUsage {
  in: number;
  out: number;
  total: number;
  cost?: number;
}

export interface ProcessContext {
  messages: Message[];
  systemPrompt: string;
  injectedContext: ContextInjection[];
  activeSkills: string[];
  toolCalls: ToolCallRecord[];
  tokenUsage: TokenUsage;
  requestId: string;
}

// ============ Model Provider ============

export interface ModelConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ChatCompletionChoice {
  message: ChatCompletionMessage;
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ModelProvider {
  chat(messages: ChatCompletionMessage[]): Promise<ChatCompletionResponse>;
  chatStream(messages: ChatCompletionMessage[]): Promise<{
    textStream: AsyncGenerator<string, void, void>;
    usage: Promise<{ in: number; out: number; total: number }>;
  }>;
}

// ============ Debug ============

export type DebugEventType =
  | 'request_start'
  | 'request_end'
  | 'hook_called'
  | 'tool_called'
  | 'tool_result'
  | 'error'
  | 'context_injected';

export interface DebugEvent {
  type: DebugEventType;
  requestId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

// ============ Profile ============

export interface ProfileAgentConfig {
  name: string;
  model: ModelConfig;
  system: {
    persona: string;
    maxTokens?: number;
  };
}

export interface ProfilePluginEntry {
  name: string;
  config?: Record<string, unknown>;
}

export interface Profile {
  agent: ProfileAgentConfig;
  plugins: ProfilePluginEntry[];
}

// ============ Config ============

export interface AppConfig {
  profilesDir: string;
  defaultProfile: string;
  debug?: boolean;
}

// ============ Agent ============

export interface AgentConfig {
  profile: Profile;
  plugins: Map<string, EdenPlugin>;
  provider: ModelProvider;
}
