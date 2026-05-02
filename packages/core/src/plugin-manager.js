/**
 * PluginManager — 插件加载/生命周期/错误隔离
 *
 * - 按需加载：只加载 profile 中配置的插件
 * - 生命周期：init → enable → disable → destroy
 * - 错误隔离：单个插件崩溃不影响核心和其他插件
 * - 工具聚合：收集所有插件暴露的工具
 */
export class PluginManager {
    plugins = new Map();
    tools = new Map();
    skills = new Map();
    enabled = new Set();
    debugChannel;
    constructor(debugChannel, builtins) {
        this.debugChannel = debugChannel;
        if (builtins) {
            builtins.forEach((factory, name) => {
                this.builtinPlugins.set(name, factory);
            });
        }
    }
    /**
     * 加载并初始化一个插件
     */
    async load(name, config, profileDir) {
        if (this.plugins.has(name))
            return; // 已加载则跳过
        let plugin;
        // 1. 尝试内置插件
        plugin = this.loadBuiltin(name);
        // 2. 尝试 npm 包 (@eden/plugin-xxx 或本地路径)
        if (!plugin) {
            plugin = await this.loadNpmPlugin(name);
        }
        if (!plugin) {
            throw new Error(`PluginManager: cannot resolve plugin "${name}"`);
        }
        // 生命周期 init
        if (plugin.init) {
            const ctx = {
                profileDir,
                pluginName: plugin.name,
                config,
                debugChannel: this.debugChannel,
            };
            await plugin.init(ctx);
        }
        // 注册工具
        if (plugin.tools) {
            for (const [toolName, tool] of Object.entries(plugin.tools)) {
                this.tools.set(`${plugin.name}/${toolName}`, tool);
            }
        }
        // 注册 skills
        if (plugin.skills) {
            this.skills.set(plugin.name, plugin.skills);
        }
        this.plugins.set(name, plugin);
        this.debugChannel.emit('hook_called', '', { plugin: name, phase: 'loaded' });
    }
    /**
     * 启用插件
     */
    async enable(name) {
        const plugin = this.plugins.get(name);
        if (!plugin)
            throw new Error(`PluginManager: plugin "${name}" not loaded`);
        if (this.enabled.has(name))
            return;
        if (plugin.enable) {
            await plugin.enable();
        }
        this.enabled.add(name);
        this.debugChannel.emit('hook_called', '', { plugin: name, phase: 'enabled' });
    }
    /**
     * 禁用插件
     */
    async disable(name) {
        const plugin = this.plugins.get(name);
        if (!plugin)
            return;
        if (!this.enabled.has(name))
            return;
        if (plugin.disable) {
            await plugin.disable();
        }
        this.enabled.delete(name);
    }
    /**
     * 销毁插件（清理资源）
     */
    async destroy(name) {
        const plugin = this.plugins.get(name);
        if (!plugin)
            return;
        await this.disable(name);
        if (plugin.destroy) {
            await plugin.destroy();
        }
        // 清理工具和技能
        for (const [key] of this.tools) {
            if (key.startsWith(`${name}/`))
                this.tools.delete(key);
        }
        this.skills.delete(name);
        this.plugins.delete(name);
    }
    /**
     * 获取所有已加载插件
     */
    getPlugins() {
        return new Map(this.plugins);
    }
    /**
     * 获取所有工具
     */
    getTools() {
        return new Map(this.tools);
    }
    /**
     * 获取所有技能提供者
     */
    getSkillProviders() {
        return new Map(this.skills);
    }
    /**
     * 判断插件是否启用
     */
    isEnabled(name) {
        return this.enabled.has(name);
    }
    // ---- 内置插件注册表 ----
    builtinPlugins = new Map();
    registerBuiltin(name, factory) {
        this.builtinPlugins.set(name, factory);
    }
    loadBuiltin(name) {
        const factory = this.builtinPlugins.get(name);
        if (!factory)
            return undefined;
        try {
            return factory();
        }
        catch {
            return undefined;
        }
    }
    async loadNpmPlugin(name) {
        // 支持 @eden/plugin-xxx 或绝对路径
        let resolved = name;
        if (!name.startsWith('@eden/') && !name.startsWith('./') && !name.startsWith('/')) {
            resolved = `@eden/${name.startsWith('plugin-') ? name : `plugin-${name}`}`;
        }
        try {
            const mod = await import(resolved);
            return mod.default ?? mod;
        }
        catch {
            // fallback: 尝试直接作为路径
            try {
                const mod = await import(name);
                return mod.default ?? mod;
            }
            catch {
                return undefined;
            }
        }
    }
}
//# sourceMappingURL=plugin-manager.js.map