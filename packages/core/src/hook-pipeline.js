/**
 * HookPipeline — 插件钩子注册与执行
 */
export class HookPipeline {
    preProcess = [];
    postProcess = [];
    preToolCall = [];
    postToolCall = [];
    onError = [];
    register(plugin) {
        const h = plugin.hooks;
        if (!h)
            return;
        if (h.onPreProcess)
            this.preProcess.push({ plugin: plugin.name, fn: h.onPreProcess });
        if (h.onPostProcess)
            this.postProcess.push({ plugin: plugin.name, fn: h.onPostProcess });
        if (h.onPreToolCall)
            this.preToolCall.push({ plugin: plugin.name, fn: h.onPreToolCall });
        if (h.onPostToolCall)
            this.postToolCall.push({ plugin: plugin.name, fn: h.onPostToolCall });
        if (h.onError)
            this.onError.push({ plugin: plugin.name, fn: h.onError });
    }
    clear() {
        this.preProcess = [];
        this.postProcess = [];
        this.preToolCall = [];
        this.postToolCall = [];
        this.onError = [];
    }
    async runError(err, ctx) {
        for (const { fn } of this.onError) {
            try {
                await fn(err, ctx);
            }
            catch {
                // ignore
            }
        }
    }
    async onPreProcess(ctx) {
        for (const { plugin, fn } of this.preProcess) {
            try {
                await fn(ctx);
            }
            catch (err) {
                console.warn(`[HookPipeline] ${plugin} hook failed:`, err.message);
                await this.runError(err, ctx);
            }
        }
    }
    async onPostProcess(ctx) {
        for (const { plugin, fn } of this.postProcess) {
            try {
                await fn(ctx);
            }
            catch (err) {
                console.warn(`[HookPipeline] ${plugin} hook failed:`, err.message);
                await this.runError(err, ctx);
            }
        }
    }
    async onPreToolCall(call, ctx) {
        for (const { plugin, fn } of this.preToolCall) {
            try {
                await fn(call, ctx);
            }
            catch (err) {
                console.warn(`[HookPipeline] ${plugin} hook failed:`, err.message);
                await this.runError(err, ctx);
            }
        }
    }
    async onPostToolCall(call, result, ctx) {
        for (const { plugin, fn } of this.postToolCall) {
            try {
                await fn(call, result, ctx);
            }
            catch (err) {
                console.warn(`[HookPipeline] ${plugin} hook failed:`, err.message);
                await this.runError(err, ctx);
            }
        }
    }
}
//# sourceMappingURL=hook-pipeline.js.map