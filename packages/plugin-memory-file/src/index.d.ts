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
import type { EdenPlugin } from '@eden/core';
declare function createPlugin(): EdenPlugin;
export default createPlugin;
