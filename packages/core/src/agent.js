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
import { estimateCost } from './provider.js';
const MAX_TOOL_ROUNDS = 5;
export class Agent {
    options;
    constructor(options) {
        this.options = options;
    }
    /** 暴露 debugChannel 供 EdenServer 订阅调试事件 */
    get debugChannel() {
        return this.options.debugChannel;
    }
    // ── 工具收集与执行 ────────────────────────────────
    /** 从所有已启用插件收集 tools，转换为 LLM 格式 */
    collectToolDefinitions() {
        const { pluginManager } = this.options;
        const defs = [];
        for (const [name, plugin] of pluginManager.getPlugins()) {
            if (!plugin.tools)
                continue;
            for (const [toolName, tool] of Object.entries(plugin.tools)) {
                defs.push({
                    type: 'function',
                    function: {
                        name: toolName,
                        description: tool.description,
                        parameters: tool.parameters,
                    },
                });
            }
        }
        return defs;
    }
    /** 执行一个工具调用，返回结果字符串 */
    async executeTool(toolName, args) {
        const { pluginManager } = this.options;
        for (const [, plugin] of pluginManager.getPlugins()) {
            if (!plugin.tools)
                continue;
            const tool = plugin.tools[toolName];
            if (tool) {
                try {
                    const result = await tool.execute(args);
                    return typeof result === 'string' ? result : JSON.stringify(result);
                }
                catch (err) {
                    return `Error: ${err.message}`;
                }
            }
        }
        return `Error: tool "${toolName}" not found`;
    }
    // ── 非流式对话 ───────────────────────────────────
    async chat(messages, userMessage, opts) {
        const { provider, hookPipeline, debugChannel, systemPromptAssembler, persona, model } = this.options;
        const requestId = debugChannel.newRequestId();
        const ctx = this.initContext(requestId, persona, messages, opts?.activeSkills ?? []);
        ctx.injectedContext = await this.collectInjectedContext(hookPipeline, ctx);
        const pluginBudgets = this.getPluginBudgets();
        systemPromptAssembler.applyTokenBudget(ctx, pluginBudgets);
        const systemPrompt = systemPromptAssembler.assemble(ctx);
        const toolDefs = this.collectToolDefinitions();
        // 构建消息
        const llmMessages = [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({
                role: m.role,
                content: m.content,
                name: m.name,
                tool_call_id: m.toolCallId,
            })),
            { role: 'user', content: userMessage },
        ];
        debugChannel.emit('request_start', requestId, {
            systemPrompt,
            injectedContext: ctx.injectedContext,
            rawRequest: llmMessages,
        });
        if (opts?.dryRun) {
            return { response: '', usage: ctx.tokenUsage, context: ctx };
        }
        // Tool call loop
        let assistantMessage = '';
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const response = await provider.chat(llmMessages, toolDefs.length > 0 ? toolDefs : undefined);
            const choice = response.choices[0];
            if (response.usage) {
                ctx.tokenUsage.in = response.usage.prompt_tokens ?? 0;
                ctx.tokenUsage.out = response.usage.completion_tokens ?? 0;
                ctx.tokenUsage.total = response.usage.total_tokens ?? 0;
                ctx.tokenUsage.cost = estimateCost(model, ctx.tokenUsage.in, ctx.tokenUsage.out);
            }
            assistantMessage = choice.message.content ?? '';
            // 没有 tool_calls，结束循环
            if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
                break;
            }
            // 执行工具调用
            const toolCalls = choice.message.tool_calls;
            llmMessages.push(choice.message);
            for (const tc of toolCalls) {
                const args = JSON.parse(tc.function.arguments);
                debugChannel.emit('tool_called', requestId, { name: tc.function.name, args });
                const result = await this.executeTool(tc.function.name, args);
                debugChannel.emit('tool_result', requestId, { name: tc.function.name, result });
                ctx.toolCalls.push({ id: tc.id, name: tc.function.name, args: tc.function.arguments, result });
                llmMessages.push({
                    role: 'tool',
                    content: result,
                    tool_call_id: tc.id,
                });
            }
        }
        ctx.messages.push({ role: 'user', content: userMessage });
        if (assistantMessage) {
            ctx.messages.push({ role: 'assistant', content: assistantMessage });
        }
        debugChannel.emit('request_end', requestId, {
            response: assistantMessage,
            usage: ctx.tokenUsage,
            messages: ctx.messages,
            rawResponse: { content: assistantMessage, finishReason: 'stop' },
        });
        await hookPipeline.onPostProcess(ctx);
        return { response: assistantMessage, usage: ctx.tokenUsage, context: ctx };
    }
    // ── 流式对话 ─────────────────────────────────────
    async chatStream(messages, userMessage, opts) {
        const { provider, hookPipeline, debugChannel, systemPromptAssembler, persona, model } = this.options;
        const requestId = debugChannel.newRequestId();
        const ctx = this.initContext(requestId, persona, messages, opts?.activeSkills ?? []);
        ctx.injectedContext = await this.collectInjectedContext(hookPipeline, ctx);
        const pluginBudgets = this.getPluginBudgets();
        systemPromptAssembler.applyTokenBudget(ctx, pluginBudgets);
        const systemPrompt = systemPromptAssembler.assemble(ctx);
        const toolDefs = this.collectToolDefinitions();
        const llmMessages = [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({
                role: m.role,
                content: m.content,
                name: m.name,
                tool_call_id: m.toolCallId,
            })),
            { role: 'user', content: userMessage },
        ];
        debugChannel.emit('request_start', requestId, {
            systemPrompt,
            injectedContext: ctx.injectedContext,
            rawRequest: llmMessages,
        });
        const chatStreamResult = await provider.chatStream(llmMessages, toolDefs.length > 0 ? toolDefs : undefined);
        const { textStream, usage: streamUsage } = chatStreamResult;
        // toolCalls 由 provider 流式收集，流结束后通过 getter 获取
        const getToolCalls = typeof chatStreamResult.toolCalls === 'function'
            ? () => chatStreamResult.toolCalls()
            : () => [];
        let fullText = '';
        const usagePromise = streamUsage.then((u) => {
            ctx.tokenUsage = {
                in: u.in,
                out: u.out,
                total: u.total,
                cost: estimateCost(model, u.in, u.out),
            };
            return ctx.tokenUsage;
        });
        const self = this;
        async function* wrappedStream() {
            try {
                for await (const text of textStream) {
                    fullText = text;
                    yield text;
                }
            }
            catch (err) {
                debugChannel.emit('error', requestId, { error: err.message });
                throw err;
            }
            // 流结束后，处理 tool calls
            const toolCallsFromStream = getToolCalls();
            if (toolCallsFromStream.length > 0) {
                // 把第一轮 LLM 响应加入消息历史
                const assistantMsg = {
                    role: 'assistant',
                    content: fullText,
                    tool_calls: toolCallsFromStream.map((tc) => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: tc.arguments },
                    })),
                };
                llmMessages.push(assistantMsg);
                // Tool call loop
                for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                    for (const tc of toolCallsFromStream) {
                        const args = JSON.parse(tc.arguments || '{}');
                        debugChannel.emit('tool_called', requestId, { name: tc.name, args });
                        const result = await self.executeTool(tc.name, args);
                        debugChannel.emit('tool_result', requestId, { name: tc.name, result });
                        ctx.toolCalls.push({ id: tc.id, name: tc.name, args: tc.arguments, result });
                        llmMessages.push({
                            role: 'tool',
                            content: result,
                            tool_call_id: tc.id,
                        });
                    }
                    // 工具执行完后，再调一次 LLM
                    const secondResponse = await provider.chat(llmMessages);
                    const secondChoice = secondResponse.choices[0];
                    fullText = secondChoice.message.content ?? '';
                    if (!secondChoice.message.tool_calls || secondChoice.message.tool_calls.length === 0) {
                        break;
                    }
                    // 还有 tool calls，继续循环
                    llmMessages.push(secondChoice.message);
                    toolCallsFromStream.length = 0;
                    toolCallsFromStream.push(...secondChoice.message.tool_calls.map((tc) => ({
                        id: tc.id,
                        name: tc.function.name,
                        arguments: tc.function.arguments,
                    })));
                }
            }
            ctx.messages.push({ role: 'user', content: userMessage });
            if (fullText) {
                ctx.messages.push({ role: 'assistant', content: fullText });
            }
            debugChannel.emit('request_end', requestId, {
                response: fullText,
                usage: ctx.tokenUsage,
                messages: ctx.messages,
                rawResponse: { content: fullText, finishReason: 'stop' },
            });
            try {
                await self.options.hookPipeline.onPostProcess(ctx);
            }
            catch {
                // ignore post-process errors
            }
        }
        return { stream: wrappedStream(), usage: usagePromise, context: ctx };
    }
    // ── 内部工具 ─────────────────────────────────────
    initContext(requestId, persona, messages, activeSkills) {
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
    async collectInjectedContext(hookPipeline, ctx) {
        await hookPipeline.onPreProcess(ctx);
        return ctx.injectedContext;
    }
    getPluginBudgets() {
        const budgets = new Map();
        for (const [name] of this.options.pluginManager.getPlugins()) {
            budgets.set(name, 0);
        }
        return budgets;
    }
}
//# sourceMappingURL=agent.js.map