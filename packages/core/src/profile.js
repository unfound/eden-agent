/**
 * ProfileManager — Profile 加载与管理
 *
 * - 加载 ~/.eden/profiles/<name>/config.yaml
 * - 按需加载插件（只加载配置中声明的）
 * - 维护活动 profile 状态
 */
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { ConfigLoader } from './config.js';
export class ProfileManager {
    profiles = new Map();
    activeProfile = null;
    profilesDir;
    constructor(profilesDir) {
        this.profilesDir = resolve(profilesDir);
    }
    /**
     * 加载一个 profile（同名不重复加载）
     */
    async load(name, pluginManager) {
        if (this.profiles.has(name)) {
            return this.profiles.get(name);
        }
        const configPath = this.resolveProfilePath(name);
        if (!existsSync(configPath)) {
            throw new Error(`ProfileManager: profile "${name}" not found at ${configPath}`);
        }
        const profile = ConfigLoader.loadProfile(configPath);
        this.profiles.set(name, profile);
        this.activeProfile = name;
        // 按需加载插件
        const profileDir = this.getProfileDir(name);
        for (const entry of profile.plugins) {
            try {
                await pluginManager.load(entry.name, entry.config ?? {}, profileDir);
                await pluginManager.enable(entry.name);
            }
            catch (err) {
                console.warn(`[ProfileManager] failed to load plugin "${entry.name}":`, err.message);
                // 不抛出，插件加载失败不影响 profile 加载
            }
        }
        return profile;
    }
    /**
     * 切换活动 profile
     */
    async switchTo(name, pluginManager) {
        // 禁用当前 profile 的插件
        if (this.activeProfile) {
            const current = this.profiles.get(this.activeProfile);
            if (current) {
                for (const entry of current.plugins) {
                    await pluginManager.disable(entry.name);
                }
            }
        }
        return this.load(name, pluginManager);
    }
    /**
     * 获取当前活动的 profile
     */
    getActiveProfile() {
        if (!this.activeProfile)
            return null;
        return this.profiles.get(this.activeProfile) ?? null;
    }
    /**
     * 获取指定 profile 目录路径
     */
    getProfileDir(name) {
        return join(this.profilesDir, name);
    }
    /**
     * 列出所有已加载的 profile
     */
    listProfiles() {
        return Array.from(this.profiles.keys());
    }
    resolveProfilePath(name) {
        // 支持绝对路径和相对路径
        if (name.startsWith('/') || name.startsWith('.')) {
            return name;
        }
        return join(this.profilesDir, name, 'config.yaml');
    }
}
//# sourceMappingURL=profile.js.map