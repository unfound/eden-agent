/**
 * ConfigLoader — YAML 配置加载 + env var 插值 + token budget 校验
 */

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { Profile, AppConfig } from './types.js';

/**
 * 展开 ${ENV_VAR} 或 ${ENV_VAR:default} 形式的 env var
 */
function interpolateEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_, key, def) => {
      return process.env[key] ?? def ?? '';
    });
  }
  if (Array.isArray(value)) {
    return value.map(interpolateEnvVars);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
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
  static loadProfile(path: string): Profile {
    const raw = readFileSync(path, 'utf-8');
    const data = parse(raw);
    return interpolateEnvVars(data) as Profile;
  }

  /**
   * 加载 app 全局配置
   */
  static loadAppConfig(path: string): AppConfig {
    const raw = readFileSync(path, 'utf-8');
    const data = parse(raw);
    return interpolateEnvVars(data) as AppConfig;
  }

  /**
   * 计算 profile 的总 token 预算（各插件 + system prompt 上限）
   */
  static calcTokenBudget(profile: Profile): number {
    let budget = 0;
    // base: persona
    budget += 200; // rough estimate for base persona
    // plugins
    for (const plugin of profile.plugins) {
      const maxTokens = (plugin.config as { maxTokens?: number } | undefined)?.maxTokens;
      budget += maxTokens ?? 0;
    }
    return budget;
  }
}
