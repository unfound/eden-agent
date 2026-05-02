/**
 * ModelProvider — OpenAI 兼容接口
 *
 * 支持任意 OpenAI-compatible API 端点。
 * 配置驱动切换，无需改动调用代码。
 */
import type { ChatCompletionMessage, ChatCompletionResponse, ModelConfig, ModelProvider, ToolDefinition } from './types.js';
export declare class OpenAIProvider implements ModelProvider {
    private config;
    constructor(config: ModelConfig);
    chat(messages: ChatCompletionMessage[], tools?: ToolDefinition[]): Promise<ChatCompletionResponse>;
    /**
     * 流式调用 LLM，逐 token 产出文本
     * 返回 [textStream, usagePromise]
     */
    chatStream(messages: ChatCompletionMessage[], tools?: ToolDefinition[]): Promise<{
        textStream: AsyncGenerator<string, void, void>;
        usage: Promise<{
            in: number;
            out: number;
            total: number;
        }>;
    }>;
}
/**
 * 估算字符串的 token 数（粗略估算，中文约 2 chars/token，英文约 4 chars/token）
 */
export declare function estimateTokens(text: string): number;
export declare function estimateCost(model: string, inTokens: number, outTokens: number): number;
//# sourceMappingURL=provider.d.ts.map