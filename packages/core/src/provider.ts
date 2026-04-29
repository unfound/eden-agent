/**
 * ModelProvider — OpenAI 兼容接口
 *
 * 支持任意 OpenAI-compatible API 端点。
 * 配置驱动切换，无需改动调用代码。
 */

import type { ChatCompletionMessage, ChatCompletionResponse, ModelConfig, ModelProvider } from './types.js';

export class OpenAIProvider implements ModelProvider {
  constructor(private config: ModelConfig) {}

  async chat(messages: ChatCompletionMessage[]): Promise<ChatCompletionResponse> {
    const { baseURL, model, apiKey } = this.config;

    const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        ...(this.config.maxTokens ? { max_tokens: this.config.maxTokens } : {}),
        ...(this.config.temperature !== undefined ? { temperature: this.config.temperature } : {}),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ModelProvider: HTTP ${response.status} — ${text}`);
    }

    return response.json() as Promise<ChatCompletionResponse>;
  }
}

/**
 * 估算字符串的 token 数（粗略估算，中文约 2 chars/token，英文约 4 chars/token）
 */
export function estimateTokens(text: string): number {
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
const MODEL_COSTS: Record<string, { in: number; out: number }> = {
  'qwen3.5-9b': { in: 0.1, out: 0.1 },
  'qwen2.5-7b': { in: 0.1, out: 0.1 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-3.5-turbo': { in: 0.5, out: 1.5 },
};

export function estimateCost(model: string, inTokens: number, outTokens: number): number {
  const costs = MODEL_COSTS[model] ?? { in: 0.5, out: 1.5 };
  return (inTokens * costs.in + outTokens * costs.out) / 1_000_000;
}
