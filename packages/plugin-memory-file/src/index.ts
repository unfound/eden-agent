/**
 * @eden/plugin-memory-file
 *
 * MEMORY.md 记忆插件。
 *
 * 设计理念：
 * - 记忆存储在 MEMORY.md（人类可读的 Markdown 文件）
 * - LLM 通过 tools 自主管理记忆（增删改查）
 * - 每次对话前将 MEMORY.md 内容注入上下文
 *
 * Tools:
 *   read_memory   — 读取完整记忆文件
 *   add_memory    — 追加一条记忆
 *   delete_memory — 删除指定记忆（按行号）
 *   search_memory — 搜索记忆（关键词匹配）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { EdenPlugin, PluginContext, ProcessContext, ContextInjection, CoreTool } from '@eden/core';

interface MemoryConfig {
  path?: string;       // 相对于 profileDir，默认 "MEMORY.md"
  maxTokens?: number;  // 注入记忆的最大 token 数，默认 500
}

function createPlugin(): EdenPlugin {
  let ctx: PluginContext | null = null;
  let cfg: MemoryConfig = { path: 'MEMORY.md', maxTokens: 500 };

  function memFile(): string {
    return join(ctx!.profileDir, cfg.path!);
  }

  function readMemory(): string {
    try {
      return readFileSync(memFile(), 'utf-8');
    } catch {
      return '';
    }
  }

  function writeMemory(content: string): void {
    const filePath = memFile();
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
  }

  function estimateTokens(text: string): number {
    // 粗略估算：中文 ~2 chars/token，英文 ~4 chars/token
    let chars = 0;
    for (const ch of text) chars += ch.charCodeAt(0) > 127 ? 2 : 1;
    return Math.ceil(chars / 3.5);
  }

  // ── Tools ────────────────────────────────────────

  const tools: Record<string, CoreTool> = {
    read_memory: {
      description: '读取 Agent 的记忆文件（MEMORY.md）。在对话开始时调用以了解之前的上下文。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute(): Promise<string> {
        const content = readMemory();
        return content || '(记忆文件为空)';
      },
    },

    add_memory: {
      description: '向记忆文件追加一条新记忆。用于记住用户偏好、重要事实、决策等。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: '记忆分类，如 "用户偏好"、"事实"、"决策"、"上下文"',
          },
          content: {
            type: 'string',
            description: '要记忆的内容，简洁的一句话',
          },
        },
        required: ['category', 'content'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const category = String(args.category ?? '').trim();
        const content = String(args.content ?? '').trim();
        if (!category || !content) return 'Error: category 和 content 不能为空';

        let memory = readMemory();
        const header = `# Agent Memory\n\n`;

        // 如果记忆文件为空，创建基础结构
        if (!memory) {
          memory = header;
        }

        // 查找或创建分类标题
        const sectionHeader = `## ${category}\n`;
        const sectionIdx = memory.indexOf(sectionHeader);

        if (sectionIdx >= 0) {
          // 找到已有分类，在该分类末尾追加
          const afterSection = memory.indexOf('\n## ', sectionIdx + sectionHeader.length);
          const insertPos = afterSection >= 0 ? afterSection : memory.length;
          const line = `- ${content}\n`;
          memory = memory.slice(0, insertPos) + line + memory.slice(insertPos);
        } else {
          // 没有该分类，追加到文件末尾
          memory = memory.trimEnd() + `\n\n${sectionHeader}\n- ${content}\n`;
        }

        writeMemory(memory);
        return `已记忆: [${category}] ${content}`;
      },
    },

    delete_memory: {
      description: '从记忆文件中删除指定行。先用 read_memory 查看内容，再用行号删除。',
      parameters: {
        type: 'object',
        properties: {
          line_number: {
            type: 'number',
            description: '要删除的行号（从 1 开始）',
          },
        },
        required: ['line_number'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const lineNum = Number(args.line_number);
        if (!lineNum || lineNum < 1) return 'Error: 无效的行号';

        const memory = readMemory();
        if (!memory) return 'Error: 记忆文件为空';

        const lines = memory.split('\n');
        if (lineNum > lines.length) return `Error: 行号超出范围（共 ${lines.length} 行）`;

        const deleted = lines[lineNum - 1];
        lines.splice(lineNum - 1, 1);
        writeMemory(lines.join('\n'));
        return `已删除第 ${lineNum} 行: ${deleted}`;
      },
    },

    search_memory: {
      description: '在记忆文件中搜索关键词，返回匹配的行。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词',
          },
        },
        required: ['query'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const query = String(args.query ?? '').trim().toLowerCase();
        if (!query) return 'Error: 搜索关键词不能为空';

        const memory = readMemory();
        if (!memory) return '(记忆文件为空)';

        const lines = memory.split('\n');
        const matches: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(query)) {
            matches.push(`L${i + 1}: ${lines[i]}`);
          }
        }

        return matches.length > 0
          ? `找到 ${matches.length} 条匹配:\n${matches.join('\n')}`
          : `未找到包含 "${query}" 的记忆`;
      },
    },
  };

  return {
    name: 'memory-file',
    version: '0.2.0',

    async init(pluginCtx) {
      ctx = pluginCtx;
      const raw = pluginCtx.config as MemoryConfig;
      cfg = {
        path: raw.path ?? 'MEMORY.md',
        maxTokens: raw.maxTokens ?? 500,
      };
    },

    hooks: {
      async onPreProcess(pc: ProcessContext) {
        if (!ctx) return;
        const content = readMemory();

        // 无论 MEMORY.md 是否为空，都注入工具使用提示
        let memoryBlock = '';
        if (content.trim()) {
          const tokens = estimateTokens(content);
          memoryBlock = content;
          // 截断到最大 token 数
          if (tokens > cfg.maxTokens!) {
            const maxChars = cfg.maxTokens! * 3.5;
            memoryBlock = content.slice(0, maxChars) + '\n...(已截断)';
          }
        }

        const MEMORY_TOOL_PROMPT = `## 记忆系统
以下是你的长期记忆。你拥有持久记忆能力——用户的偏好、事实、重要决定都会被记住。
当用户告诉你个人信息（名字、偏好、习惯等）或重要事实时，你必须立即调用 add_memory 将其保存。
当信息过时或被用户更正时，调用 delete_memory 删除旧记录。
可用工具：add_memory / delete_memory / search_memory / read_memory`;

        pc.injectedContext.push({
          source: 'memory',
          content: `${MEMORY_TOOL_PROMPT}\n\n${memoryBlock || '(暂无记忆)'}`,
          tokens: memoryBlock ? Math.min(estimateTokens(memoryBlock), cfg.maxTokens!) : 0,
        });
      },
    },

    tools,
  };
}

export default createPlugin;
