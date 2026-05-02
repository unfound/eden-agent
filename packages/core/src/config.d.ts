/**
 * ConfigLoader — YAML 配置加载 + env var 插值 + token budget 校验
 */
import { Profile, AppConfig } from './types.js';
export declare class ConfigLoader {
    /**
     * 加载 profile yaml 并展开 env var
     */
    static loadProfile(path: string): Profile;
    /**
     * 加载 app 全局配置
     */
    static loadAppConfig(path: string): AppConfig;
    /**
     * 计算 profile 的总 token 预算（各插件 + system prompt 上限）
     */
    static calcTokenBudget(profile: Profile): number;
}
//# sourceMappingURL=config.d.ts.map