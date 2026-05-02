/**
 * ConfigLoader — YAML 配置加载 + env var 插值 + token budget 校验
 */
import { readFileSync } from 'fs';
import { parse } from 'yaml';
/**
 * 展开 ${ENV_VAR} 或 ${ENV_VAR:default} 形式的 env var
 */
function interpolateEnvVars(value) {
    if (typeof value === 'string') {
        return value.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_, key, def) => {
            return process.env[key] ?? def ?? '';
        });
    }
    if (Array.isArray(value)) {
        return value.map(interpolateEnvVars);
    }
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = interpolateEnvVars(v);
        }
        return out;
    }
    return value;
}
export class ConfigLoader {
    /**
     * 加载 profile yaml 并展开 env var
     */
    static loadProfile(path) {
        const raw = readFileSync(path, 'utf-8');
        const data = parse(raw);
        return interpolateEnvVars(data);
    }
    /**
     * 加载 app 全局配置
     */
    static loadAppConfig(path) {
        const raw = readFileSync(path, 'utf-8');
        const data = parse(raw);
        return interpolateEnvVars(data);
    }
    /**
     * 计算 profile 的总 token 预算（各插件 + system prompt 上限）
     */
    static calcTokenBudget(profile) {
        let budget = 0;
        // base: persona
        budget += 200; // rough estimate for base persona
        // plugins
        for (const plugin of profile.plugins) {
            const maxTokens = plugin.config?.maxTokens;
            budget += maxTokens ?? 0;
        }
        return budget;
    }
}
//# sourceMappingURL=config.js.map