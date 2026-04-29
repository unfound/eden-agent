/**
 * @eden/plugin-memory-file
 *
 * 基于文件的记忆插件。
 * - onPreProcess: 读取记忆文件，注入到 ProcessContext
 * - onPostProcess: 将本次对话追加到记忆文件
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { EdenPlugin, PluginContext, ProcessContext, ContextInjection } from '@eden/core';

interface MemoryEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface MemoryConfig {
  path?: string;       // 相对于 profileDir，默认 "memory/"
  maxEntries?: number; // 最多保留条数，默认 100
  maxTokens?: number;  // 最多注入 tokens，默认 300
}

function lastOfRole(messages: any[], role: string): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) return messages[i].content;
  }
  return null;
}

function newId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPlugin(): EdenPlugin {
  let ctx: PluginContext | null = null;
  let cfg: MemoryConfig = { path: 'memory/', maxEntries: 100, maxTokens: 300 };

  function memDir(): string {
    return join(ctx!.profileDir, cfg.path!);
  }

  function memFile(): string {
    return join(memDir(), 'memory.jsonl');
  }

  function ensureDir(): void {
    if (!existsSync(memDir())) mkdirSync(memDir(), { recursive: true });
  }

  function loadEntries(): MemoryEntry[] {
    try {
      const raw = readFileSync(memFile(), 'utf-8');
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as MemoryEntry);
    } catch {
      return [];
    }
  }

  function buildInjection(entries: MemoryEntry[]): ContextInjection | null {
    const lines: string[] = [];
    let chars = 0;
    const maxChars = cfg.maxTokens! * 3.5;

    for (const entry of [...entries].reverse()) {
      const prefix = entry.role === 'user' ? '[记-用户]' : '[记-助手]';
      const line = `${prefix} ${entry.content}`;
      if (chars + line.length > maxChars) break;
      lines.push(line);
      chars += line.length;
    }

    if (lines.length === 0) return null;

    return {
      source: 'memory-file',
      content: lines.join('\n'),
      tokens: Math.ceil(chars / 3.5),
      metadata: { count: lines.length },
    };
  }

  return {
    name: 'memory-file',
    version: '0.1.0',

    async init(pluginCtx) {
      ctx = pluginCtx;
      const raw = pluginCtx.config as MemoryConfig;
      cfg = {
        path: raw.path ?? 'memory/',
        maxEntries: raw.maxEntries ?? 100,
        maxTokens: raw.maxTokens ?? 300,
      };
    },

    hooks: {
      async onPreProcess(pc) {
        if (!ctx) return;
        const entries = loadEntries();
        if (entries.length === 0) return;
        const inj = buildInjection(entries);
        if (inj) pc.injectedContext.push(inj);
      },

      async onPostProcess(pc) {
        if (!ctx) return;
        const userMsg = lastOfRole(pc.messages, 'user');
        const asstMsg = lastOfRole(pc.messages, 'assistant');
        if (!userMsg && !asstMsg) return;

        ensureDir();
        const lines: string[] = [];
        if (userMsg) {
          lines.push(JSON.stringify({ id: newId(), role: 'user', content: userMsg, timestamp: Date.now() }));
        }
        if (asstMsg) {
          lines.push(JSON.stringify({ id: newId(), role: 'assistant', content: asstMsg, timestamp: Date.now() }));
        }
        if (lines.length === 0) return;

        try {
          const existing = existsSync(memFile()) ? readFileSync(memFile(), 'utf-8') : '';
          writeFileSync(memFile(), existing + lines.join('\n') + '\n', 'utf-8');
        } catch { /* ignore */ }

        // prune
        const entries = loadEntries();
        if (entries.length > cfg.maxEntries!) {
          const kept = entries.slice(-cfg.maxEntries!);
          try {
            writeFileSync(memFile(), kept.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
          } catch { /* ignore */ }
        }
      },
    },
  };
}

export default createPlugin;
