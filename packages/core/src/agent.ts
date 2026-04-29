/**
 * Agent — 核心 Agent Loop
 *
 * 1. 初始化 ProcessContext
 * 2. 收集所有插件的 onPreProcess 注入上下文
 * 3. 组装 system prompt
 * 4. 调用 LLM
 * 5. 处理工具调用（循环）
 * 6. 调用 onPostProcess
 * 7. 返回最终文本
 */

import type {
  Message,
  ProcessContext,
  ContextInjection,
  ToolCall,
  ToolCallRecord,
  TokenUsage,
  ChatCompletionMessage,
  ModelProvider,
} from './types.js';
import { HookPipeline } from './hook-pipeline.js';
import { PluginManager } from './plugin-manager.js';
import { SystemPromptAssembler } from './system-prompt.js';
import { DebugChannel } from './debug-channel.js';
import { estimateTokens, estimateCost } from './provider.js';

export interface AgentOptions {
  pluginManager: PluginManager;
  provider: ModelProvider;
  hookPipeline: HookPipeline;
  debugChannel: DebugChannel;
  systemPromptAssembler: SystemPromptAssembler;
  persona: string;
  model: string;
}

export class Agent {
  private options: AgentOptions;

  constructor(options: AgentOptions) {
    this.options = options;
  }

  /**
   * 单轮对话
   */
  async chat(
    messages: Message[],
    userMessage: string,
    opts?: { dryRun?: boolean; activeSkills?: string[] }
  ): Promise<{ response: string; usage: TokenUsage; context: ProcessContext }> {
    const { pluginManager, provider, hookPipeline, debugChannel, systemPromptAssembler, persona, model } = this.options;
    const requestId = debugChannel.newRequestId();

    // 1. 初始化 ProcessContext
    const ctx = this.initContext(requestId, persona, messages, opts?.activeSkills ?? []);

    // 2. 收集所有插件的注入上下文（onPreProcess 阶段）
    ctx.injectedContext = await this.collectInjectedContext(hookPipeline, ctx);

    // 3. 应用 token 预算截断
    const pluginBudgets = this.getPluginBudgets(pluginManager);
    systemPromptAssembler.applyTokenBudget(ctx, pluginBudgets);

    // 4. 组装 system prompt
    const systemPrompt = systemPromptAssembler.assemble(ctx);
    debugChannel.emit('request_start', requestId, { systemPrompt, injectedContext: ctx.injectedContext });

    if (opts?.dryRun) {
      return {
        response: '',
        usage: ctx.tokenUsage,
        context: ctx,
      };
    }

    // 5. 构建 LLM 消息
    const llmMessages: ChatCompletionMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
        name: m.name,
        tool_call_id: m.toolCallId,
      })),
      { role: 'user', content: userMessage },
    ];

    // 6. 调用 LLM
    let assistantMessage = '';
    try {
      const response = await provider.chat(llmMessages);
      const choice = response.choices[0];

      if (response.usage) {
        ctx.tokenUsage.in = response.usage.prompt_tokens ?? 0;
        ctx.tokenUsage.out = response.usage.completion_tokens ?? 0;
        ctx.tokenUsage.total = response.usage.total_tokens ?? 0;
        ctx.tokenUsage.cost = estimateCost(model, ctx.tokenUsage.in, ctx.tokenUsage.out);
      }

      assistantMessage = choice.message.content ?? '';
      debugChannel.emit('request_end', requestId, { response: assistantMessage, usage: ctx.tokenUsage });
    } catch (err) {
      debugChannel.emit('error', requestId, { error: (err as Error).message });
      await hookPipeline.onPostProcess(ctx);
      throw err;
    }

    // 7. 记录对话到 ctx.messages（供 onPostProcess 使用，如记忆写入）
    ctx.messages.push({ role: 'user', content: userMessage });
    if (assistantMessage) {
      ctx.messages.push({ role: 'assistant', content: assistantMessage });
    }

    // 8. onPostProcess
    await hookPipeline.onPostProcess(ctx);

    return { response: assistantMessage, usage: ctx.tokenUsage, context: ctx };
  }

  private initContext(
    requestId: string,
    persona: string,
    messages: Message[],
    activeSkills: string[]
  ): ProcessContext {
    return {
      messages,
      systemPrompt: persona,
      injectedContext: [],
      activeSkills,
      toolCalls: [],
      tokenUsage: { in: 0, out: 0, total: 0 },
      requestId,
    };
  }

  private async collectInjectedContext(
    hookPipeline: HookPipeline,
    ctx: ProcessContext
  ): Promise<ContextInjection[]> {
    // 触发所有插件的 onPreProcess 钩子
    await hookPipeline.onPreProcess(ctx);
    return ctx.injectedContext;
  }

  private getPluginBudgets(pluginManager: PluginManager): Map<string, number> {
    const budgets = new Map<string, number>();
    for (const [name] of pluginManager.getPlugins()) {
      budgets.set(name, 0); // default no budget limit; per-plugin budgets from config
    }
    return budgets;
  }
}
