/**
 * HookPipeline — 插件钩子注册与执行
 */

import type { EdenPlugin, PluginHooks, ProcessContext, ToolCall, ToolResult } from './types.js';

export class HookPipeline {
  private preProcess: Array<{ plugin: string; fn: (ctx: ProcessContext) => Promise<void> }> = [];
  private postProcess: Array<{ plugin: string; fn: (ctx: ProcessContext) => Promise<void> }> = [];
  private preToolCall: Array<{ plugin: string; fn: (call: ToolCall, ctx: ProcessContext) => Promise<void> }> = [];
  private postToolCall: Array<{ plugin: string; fn: (call: ToolCall, result: ToolResult, ctx: ProcessContext) => Promise<void> }> = [];
  private onError: Array<{ plugin: string; fn: (err: Error, ctx: ProcessContext) => Promise<void> }> = [];

  register(plugin: EdenPlugin): void {
    const h = plugin.hooks;
    if (!h) return;
    if (h.onPreProcess) this.preProcess.push({ plugin: plugin.name, fn: h.onPreProcess });
    if (h.onPostProcess) this.postProcess.push({ plugin: plugin.name, fn: h.onPostProcess });
    if (h.onPreToolCall) this.preToolCall.push({ plugin: plugin.name, fn: h.onPreToolCall });
    if (h.onPostToolCall) this.postToolCall.push({ plugin: plugin.name, fn: h.onPostToolCall });
    if (h.onError) this.onError.push({ plugin: plugin.name, fn: h.onError });
  }

  clear(): void {
    this.preProcess = [];
    this.postProcess = [];
    this.preToolCall = [];
    this.postToolCall = [];
    this.onError = [];
  }

  private async runError(err: Error, ctx: ProcessContext): Promise<void> {
    for (const { fn } of this.onError) {
      try {
        await fn(err, ctx);
      } catch {
        // ignore
      }
    }
  }

  async onPreProcess(ctx: ProcessContext): Promise<void> {
    for (const { plugin, fn } of this.preProcess) {
      try {
        await fn(ctx);
      } catch (err) {
        console.warn(`[HookPipeline] ${plugin} hook failed:`, (err as Error).message);
        await this.runError(err as Error, ctx);
      }
    }
  }

  async onPostProcess(ctx: ProcessContext): Promise<void> {
    for (const { plugin, fn } of this.postProcess) {
      try {
        await fn(ctx);
      } catch (err) {
        console.warn(`[HookPipeline] ${plugin} hook failed:`, (err as Error).message);
        await this.runError(err as Error, ctx);
      }
    }
  }

  async onPreToolCall(call: ToolCall, ctx: ProcessContext): Promise<void> {
    for (const { plugin, fn } of this.preToolCall) {
      try {
        await fn(call, ctx);
      } catch (err) {
        console.warn(`[HookPipeline] ${plugin} hook failed:`, (err as Error).message);
        await this.runError(err as Error, ctx);
      }
    }
  }

  async onPostToolCall(call: ToolCall, result: ToolResult, ctx: ProcessContext): Promise<void> {
    for (const { plugin, fn } of this.postToolCall) {
      try {
        await fn(call, result, ctx);
      } catch (err) {
        console.warn(`[HookPipeline] ${plugin} hook failed:`, (err as Error).message);
        await this.runError(err as Error, ctx);
      }
    }
  }
}
