/**
 * SystemPromptAssembler — System Prompt 动态组装
 *
 * 每次请求动态拼装，无预写死的通用提示词。
 * 每个插件注入自己的那一段，带来源标注。
 */

import type { ProcessContext } from './types.js';

export class SystemPromptAssembler {
  /**
   * 组装最终的 system prompt 字符串
   *
   * 结构：
   * 1. 基础 persona（来自 profile 配置）
   * 2. 每个 ContextInjection（按 source 分组，带标注）
   * 3. 激活的 skill 指令
   */
  assemble(ctx: ProcessContext): string {
    const parts: string[] = [];

    // 1. 基础 persona
    if (ctx.systemPrompt.trim()) {
      parts.push(ctx.systemPrompt.trim());
    }

    // 2. 各插件注入的上下文
    for (const inj of ctx.injectedContext) {
      if (!inj.content.trim()) continue;
      parts.push(`[${inj.source}]\n${inj.content.trim()}`);
    }

    // 3. 激活的 skill 指令
    for (const skill of ctx.activeSkills) {
      if (!skill.trim()) continue;
      parts.push(skill.trim());
    }

    return parts.join('\n\n');
  }

  /**
   * 根据 token 预算截断注入的上下文
   * 每个插件可声明 maxTokens预算，超过自动截断
   */
  applyTokenBudget(ctx: ProcessContext, pluginBudgets: Map<string, number>): void {
    for (const inj of ctx.injectedContext) {
      const budget = pluginBudgets.get(inj.source) ?? inj.tokens;
      if (inj.tokens > budget) {
        // 简单截断：按比例估算字符数
        const ratio = budget / inj.tokens;
        const chars = Math.floor(inj.content.length * ratio);
        inj.content = inj.content.slice(0, chars) + '...';
        inj.tokens = budget;
        inj.metadata = { ...inj.metadata, truncated: true };
      }
    }
  }
}
