/**
 * Agent — 核心 Agent Loop
 *
 * 1. 初始化 ProcessContext
 * 2. 收集所有插件的 onPreProcess 注入上下文
 * 3. 组装 system prompt
 * 4. 调用 LLM（支持 tools）
 * 5. 处理工具调用（循环，最多 MAX_TOOL_ROUNDS 轮）
 * 6. 调用 onPostProcess
 * 7. 返回最终文本
 */
import type { Message, ProcessContext, TokenUsage, ModelProvider } from './types.js';
import { HookPipeline } from './hook-pipeline.js';
import { PluginManager } from './plugin-manager.js';
import { SystemPromptAssembler } from './system-prompt.js';
import { DebugChannel } from './debug-channel.js';
export interface AgentOptions {
    pluginManager: PluginManager;
    provider: ModelProvider;
    hookPipeline: HookPipeline;
    debugChannel: DebugChannel;
    systemPromptAssembler: SystemPromptAssembler;
    persona: string;
    model: string;
}
export declare class Agent {
    private options;
    constructor(options: AgentOptions);
    /** 暴露 debugChannel 供 EdenServer 订阅调试事件 */
    get debugChannel(): DebugChannel;
    /** 从所有已启用插件收集 tools，转换为 LLM 格式 */
    private collectToolDefinitions;
    /** 执行一个工具调用，返回结果字符串 */
    private executeTool;
    chat(messages: Message[], userMessage: string, opts?: {
        dryRun?: boolean;
        activeSkills?: string[];
    }): Promise<{
        response: string;
        usage: TokenUsage;
        context: ProcessContext;
    }>;
    chatStream(messages: Message[], userMessage: string, opts?: {
        activeSkills?: string[];
    }): Promise<{
        stream: AsyncGenerator<string, void, void>;
        usage: Promise<TokenUsage>;
        context: ProcessContext;
    }>;
    private initContext;
    private collectInjectedContext;
    private getPluginBudgets;
}
//# sourceMappingURL=agent.d.ts.map