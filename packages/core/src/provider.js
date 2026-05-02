/**
 * ModelProvider — OpenAI 兼容接口
 *
 * 支持任意 OpenAI-compatible API 端点。
 * 配置驱动切换，无需改动调用代码。
 */
export class OpenAIProvider {
    config;
    constructor(config) {
        this.config = config;
    }
    async chat(messages, tools) {
        const { baseURL, model, apiKey } = this.config;
        const body = {
            model,
            messages,
            stream: false,
            ...(this.config.maxTokens ? { max_tokens: this.config.maxTokens } : {}),
            ...(this.config.temperature !== undefined ? { temperature: this.config.temperature } : {}),
        };
        if (tools && tools.length > 0)
            body.tools = tools;
        const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`ModelProvider: HTTP ${response.status} — ${text}`);
        }
        return response.json();
    }
    /**
     * 流式调用 LLM，逐 token 产出文本
     * 返回 [textStream, usagePromise]
     */
    async chatStream(messages, tools) {
        const { baseURL, model, apiKey } = this.config;
        const body = {
            model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            ...(this.config.maxTokens ? { max_tokens: this.config.maxTokens } : {}),
            ...(this.config.temperature !== undefined ? { temperature: this.config.temperature } : {}),
        };
        if (tools && tools.length > 0)
            body.tools = tools;
        const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`ModelProvider: HTTP ${response.status} — ${text}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let usageResolver;
        const usagePromise = new Promise((r) => { usageResolver = r; });
        let accumulatedText = '';
        let done = false;
        let finalUsage = { in: 0, out: 0, total: 0 };
        // 收集 tool_calls（流式拼接）
        const toolCallsMap = new Map();
        async function* generate() {
            while (!done) {
                const { value, done: streamDone } = await reader.read();
                if (streamDone) {
                    done = true;
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:'))
                        continue;
                    const data = trimmed.slice(5).trim();
                    if (data === '[DONE]') {
                        done = true;
                        break;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        // usage chunk
                        if (parsed.usage) {
                            finalUsage = {
                                in: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens ?? 0,
                                out: parsed.usage.completion_tokens ?? parsed.usage.output_tokens ?? 0,
                                total: parsed.usage.total_tokens ?? 0,
                            };
                        }
                        const choice = parsed.choices?.[0];
                        if (!choice)
                            continue;
                        // 文本 delta
                        const delta = choice.delta?.content;
                        if (delta) {
                            accumulatedText += delta;
                            yield accumulatedText;
                        }
                        // tool_calls delta
                        const toolDeltas = choice.delta?.tool_calls;
                        if (Array.isArray(toolDeltas)) {
                            for (const td of toolDeltas) {
                                const idx = td.index ?? 0;
                                const existing = toolCallsMap.get(idx);
                                if (existing) {
                                    if (td.id)
                                        existing.id = td.id;
                                    if (td.function?.name)
                                        existing.name = td.function.name;
                                    if (td.function?.arguments)
                                        existing.arguments += td.function.arguments;
                                }
                                else {
                                    toolCallsMap.set(idx, {
                                        id: td.id ?? '',
                                        name: td.function?.name ?? '',
                                        arguments: td.function?.arguments ?? '',
                                    });
                                }
                            }
                        }
                    }
                    catch {
                        // skip unparseable lines
                    }
                }
            }
            usageResolver(finalUsage);
        }
        const stream = generate();
        // 包装 generator，在流结束后暴露 toolCalls
        const self = this;
        async function* wrappedStream() {
            for await (const text of stream) {
                yield text;
            }
        }
        // 暴露 toolCalls（流结束后可读）
        const result = { textStream: wrappedStream(), usage: usagePromise };
        result.toolCalls = () => Array.from(toolCallsMap.values());
        return result;
    }
}
/**
 * 估算字符串的 token 数（粗略估算，中文约 2 chars/token，英文约 4 chars/token）
 */
export function estimateTokens(text) {
    let chars = 0;
    for (const ch of text) {
        chars += ch.charCodeAt(0) > 127 ? 2 : 1;
    }
    return Math.ceil(chars / 3.5);
}
/**
 * 根据模型估算成本（$/1M tokens）
 * 支持的模型在下面添加
 */
const MODEL_COSTS = {
    'qwen3.5-9b': { in: 0.1, out: 0.1 },
    'qwen3.5': { in: 0.1, out: 0.1 },
    'qwen2.5-7b': { in: 0.1, out: 0.1 },
    'gpt-4o-mini': { in: 0.15, out: 0.6 },
    'gpt-4o': { in: 2.5, out: 10 },
    'gpt-3.5-turbo': { in: 0.5, out: 1.5 },
};
export function estimateCost(model, inTokens, outTokens) {
    const costs = MODEL_COSTS[model] ?? { in: 0.5, out: 1.5 };
    return (inTokens * costs.in + outTokens * costs.out) / 1_000_000;
}
//# sourceMappingURL=provider.js.map