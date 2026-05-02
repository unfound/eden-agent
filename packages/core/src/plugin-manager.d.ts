/**
 * PluginManager — 插件加载/生命周期/错误隔离
 *
 * - 按需加载：只加载 profile 中配置的插件
 * - 生命周期：init → enable → disable → destroy
 * - 错误隔离：单个插件崩溃不影响核心和其他插件
 * - 工具聚合：收集所有插件暴露的工具
 */
import type { EdenPlugin, CoreTool, SkillProvider } from './types.js';
import { DebugChannel } from './debug-channel.js';
export declare class PluginManager {
    private plugins;
    private tools;
    private skills;
    private enabled;
    private debugChannel;
    constructor(debugChannel: DebugChannel, builtins?: Map<string, () => EdenPlugin>);
    /**
     * 加载并初始化一个插件
     */
    load(name: string, config: Record<string, unknown>, profileDir: string): Promise<void>;
    /**
     * 启用插件
     */
    enable(name: string): Promise<void>;
    /**
     * 禁用插件
     */
    disable(name: string): Promise<void>;
    /**
     * 销毁插件（清理资源）
     */
    destroy(name: string): Promise<void>;
    /**
     * 获取所有已加载插件
     */
    getPlugins(): Map<string, EdenPlugin>;
    /**
     * 获取所有工具
     */
    getTools(): Map<string, CoreTool>;
    /**
     * 获取所有技能提供者
     */
    getSkillProviders(): Map<string, SkillProvider>;
    /**
     * 判断插件是否启用
     */
    isEnabled(name: string): boolean;
    private builtinPlugins;
    registerBuiltin(name: string, factory: () => EdenPlugin): void;
    private loadBuiltin;
    private loadNpmPlugin;
}
//# sourceMappingURL=plugin-manager.d.ts.map