/**
 * HookPipeline — 插件钩子注册与执行
 */
import type { EdenPlugin, ProcessContext, ToolCall, ToolResult } from './types.js';
export declare class HookPipeline {
    private preProcess;
    private postProcess;
    private preToolCall;
    private postToolCall;
    private onError;
    register(plugin: EdenPlugin): void;
    clear(): void;
    private runError;
    onPreProcess(ctx: ProcessContext): Promise<void>;
    onPostProcess(ctx: ProcessContext): Promise<void>;
    onPreToolCall(call: ToolCall, ctx: ProcessContext): Promise<void>;
    onPostToolCall(call: ToolCall, result: ToolResult, ctx: ProcessContext): Promise<void>;
}
//# sourceMappingURL=hook-pipeline.d.ts.map