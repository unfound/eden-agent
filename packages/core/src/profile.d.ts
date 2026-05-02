/**
 * ProfileManager — Profile 加载与管理
 *
 * - 加载 ~/.eden/profiles/<name>/config.yaml
 * - 按需加载插件（只加载配置中声明的）
 * - 维护活动 profile 状态
 */
import type { Profile } from './types.js';
import { PluginManager } from './plugin-manager.js';
export declare class ProfileManager {
    private profiles;
    private activeProfile;
    private profilesDir;
    constructor(profilesDir: string);
    /**
     * 加载一个 profile（同名不重复加载）
     */
    load(name: string, pluginManager: PluginManager): Promise<Profile>;
    /**
     * 切换活动 profile
     */
    switchTo(name: string, pluginManager: PluginManager): Promise<Profile>;
    /**
     * 获取当前活动的 profile
     */
    getActiveProfile(): Profile | null;
    /**
     * 获取指定 profile 目录路径
     */
    getProfileDir(name: string): string;
    /**
     * 列出所有已加载的 profile
     */
    listProfiles(): string[];
    private resolveProfilePath;
}
//# sourceMappingURL=profile.d.ts.map