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
   * 单轮对话（非流式）
   */
  async chat(
    messages: Message[],
    userMessage: string,
    opts?: { dryRun?: boolean; activeSkills?: string[] }
  ): Promise<{ response: string; usage: TokenUsage; context: ProcessContext }> {
    const { pluginManager, provider, hookPipeline, debugChannel, systemPromptAssembler, persona, model } = this.options;
    const requestId = debugChannel.newRequestId();

    const ctx = this.initContext(requestId, persona, messages, opts?.activeSkills ?? []);
    ctx.injectedContext = await this.collectInjectedContext(hookPipeline, ctx);

    const pluginBudgets = this.getPluginBudgets(pluginManager);
    systemPromptAssembler.applyTokenBudget(ctx, pluginBudgets);

    const systemPrompt = systemPromptAssembler.assemble(ctx);
    debugChannel.emit('request_start', requestId, { systemPrompt, injectedContext: ctx.injectedContext });

    if (opts?.dryRun) {
      return { response: '', usage: ctx.tokenUsage, context: ctx };
    }

    const llmMessages = this.buildMessages(systemPrompt, messages, userMessage);

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

    ctx.messages.push({ role: 'user', content: userMessage });
    if (assistantMessage) {
      ctx.messages.push({ role: 'assistant', content: assistantMessage });
    }

    await hookPipeline.onPostProcess(ctx);

    return { response: assistantMessage, usage: ctx.tokenUsage, context: ctx };
  }

  /**
   * 流式对话 — 每收到一个 token 就 yield 当前累积文本
   * 返回 { stream, usage, context }
   * - stream: AsyncGenerator<string> — 每次 yield 完整累积文本
   * - usage: Promise<TokenUsage> — 流结束后解析
   * - context: 最终 ProcessContext
   */
  async chatStream(
    messages: Message[],
    userMessage: string,
    opts?: { activeSkills?: string[] }
  ): Promise<{
    stream: AsyncGenerator<string, void, void>;
    usage: Promise<TokenUsage>;
    context: ProcessContext;
  }> {
    const { pluginManager, provider, hookPipeline, debugChannel, systemPromptAssembler, persona, model } = this.options;
    const requestId = debugChannel.newRequestId();

    const ctx = this.initContext(requestId, persona, messages, opts?.activeSkills ?? []);
    ctx.injectedContext = await this.collectInjectedContext(hookPipeline, ctx);

    const pluginBudgets = this.getPluginBudgets(pluginManager);
    systemPromptAssembler.applyTokenBudget(ctx, pluginBudgets);

    const systemPrompt = systemPromptAssembler.assemble(ctx);
    debugChannel.emit('request_start', requestId, { systemPrompt, injectedContext: ctx.injectedContext });

    const llmMessages = this.buildMessages(systemPrompt, messages, userMessage);

    const { textStream, usage: streamUsage } = await provider.chatStream(llmMessages);
    let fullText = '';

    const usagePromise = streamUsage.then((u: { in: number; out: number; total: number }) => {
      ctx.tokenUsage = {
        in: u.in,
        out: u.out,
        total: u.total,
        cost: estimateCost(model, u.in, u.out),
      };
      return ctx.tokenUsage;
    });

    async function* generateStream(): AsyncGenerator<string, void, void> {
      for await (const text of textStream) {
        fullText = text;
        yield fullText;
      }
    }

    // Wrap generator to handle post-process after stream ends
    const self = this;
    const originalStream = generateStream();

    async function* wrappedStream(): AsyncGenerator<string, void, void> {
      try {
        for await (const text of originalStream) {
          yield text;
        }
      } catch (err) {
        debugChannel.emit('error', requestId, { error: (err as Error).message });
        throw err;
      }

      // Stream ended — finalize
      debugChannel.emit('request_end', requestId, { response: fullText, usage: ctx.tokenUsage });

      ctx.messages.push({ role: 'user', content: userMessage });
      if (fullText) {
        ctx.messages.push({ role: 'assistant', content: fullText });
      }

      try {
        await self.options.hookPipeline.onPostProcess(ctx);
      } catch {
        // ignore post-process errors
      }
    }

    return { stream: wrappedStream(), usage: usagePromise, context: ctx };
  }

  private buildMessages(
    systemPrompt: string,
    messages: Message[],
    userMessage: string
  ): ChatCompletionMessage[] {
    return [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
        name: m.name,
        tool_call_id: m.toolCallId,
      })),
      { role: 'user', content: userMessage },
    ];
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
    await hookPipeline.onPreProcess(ctx);
    return ctx.injectedContext;
  }

  private getPluginBudgets(pluginManager: PluginManager): Map<string, number> {
    const budgets = new Map<string, number>();
    for (const [name] of pluginManager.getPlugins()) {
      budgets.set(name, 0);
    }
    return budgets;
  }
}
