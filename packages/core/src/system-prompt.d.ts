/**
 * SystemPromptAssembler — System Prompt 动态组装
 *
 * 每次请求动态拼装，无预写死的通用提示词。
 * 每个插件注入自己的那一段，带来源标注。
 */
import type { ProcessContext } from './types.js';
export declare class SystemPromptAssembler {
    /**
     * 组装最终的 system prompt 字符串
     *
     * 结构：
     * 1. 基础 persona（来自 profile 配置）
     * 2. 每个 ContextInjection（按 source 分组，带标注）
     * 3. 激活的 skill 指令
     */
    assemble(ctx: ProcessContext): string;
    /**
     * 根据 token 预算截断注入的上下文
     * 每个插件可声明 maxTokens预算，超过自动截断
     */
    applyTokenBudget(ctx: ProcessContext, pluginBudgets: Map<string, number>): void;
}
//# sourceMappingURL=system-prompt.d.ts.map