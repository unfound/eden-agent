#!/usr/bin/env node
/**
 * eden — CLI 入口
 *
 * eden chat --profile novelist
 * eden chat --profile novelist --debug   # 左右分屏：chat | debug panel
 * eden dry-run "prompt" --profile novelist
 * eden dry-run "prompt" --profile novelist --send
 */

import { Agent, HookPipeline, PluginManager, DebugChannel, SystemPromptAssembler, OpenAIProvider, estimateTokens as coreEstimateTokens } from '@eden/core';
import createMemoryFilePlugin from '@eden/plugin-memory-file';
import { createPlugin as createDebugPanelPlugin } from '@eden/plugin-debug-panel';
import { ConfigLoader } from '@eden/core';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { WebSocket } from 'ws';

// ---- ANSI 颜色常量 ----
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m',
  yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m',
  brightBlue: '\x1b[94m',
};

// 左右分屏宽度配置
const LEFT_WIDTH = 80;   // chat 区
const TOTAL_HEIGHT = 40; // 总高（行数）
const DEBUG_COL = LEFT_WIDTH + 1; // debug 区起始列

// ---- 入口 ----

const args = process.argv.slice(2);
const command = args[0] ?? 'chat';

async function main() {
  if (command === 'chat') {
    await runChat();
  } else if (command === 'dry-run') {
    await runDryRun();
  } else if (command === 'help') {
    printHelp();
  } else {
    console.error(`eden: unknown command "${command}". See "eden help".`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('eden error:', err.message);
  process.exit(1);
});

// ==================== CHAT 模式 ====================

async function runChat() {
  const profileName = getFlag('--profile') ?? 'default';
  const withDebug = hasFlag('--debug');

  const profilesDir = resolveProfileDir();
  const profilePath = join(profilesDir, profileName, 'config.yaml');
  if (!existsSync(profilePath)) {
    console.error(`eden: profile "${profileName}" not found at ${profilePath}`);
    process.exit(1);
  }

  const profile = ConfigLoader.loadProfile(profilePath);
  const profileDir = join(profilesDir, profileName);

  const debugChannel = new DebugChannel();
  const hookPipeline = new HookPipeline();
  const builtinPlugins = new Map<string, () => any>();
  builtinPlugins.set('memory-file', () => createMemoryFilePlugin());
  builtinPlugins.set('@eden/plugin-memory-file', () => createMemoryFilePlugin());
  const regDebug = () => createDebugPanelPlugin();
  builtinPlugins.set('@eden/plugin-debug-panel', regDebug);
  builtinPlugins.set('debug-panel', regDebug);

  const pluginManager = new PluginManager(debugChannel, builtinPlugins);

  for (const entry of profile.plugins) {
    try {
      await pluginManager.load(entry.name, entry.config ?? {}, profileDir);
      await pluginManager.enable(entry.name);
    } catch (err) {
      console.warn(`[eden] plugin "${entry.name}" load failed:`, (err as Error).message);
    }
  }

  if (withDebug) {
    const debugKey = '@eden/plugin-debug-panel';
    if (!pluginManager.getPlugins().has(debugKey) &&
        !pluginManager.getPlugins().has('debug-panel')) {
      await pluginManager.load(debugKey, {}, profileDir);
    }
    await pluginManager.enable(debugKey);
  }

  pluginManager.getPlugins().forEach((plugin) => {
    hookPipeline.register(plugin);
  });

  const provider = new OpenAIProvider(profile.agent.model);
  const assembler = new SystemPromptAssembler();
  const agent = new Agent({
    pluginManager, provider, hookPipeline, debugChannel,
    systemPromptAssembler: assembler,
    persona: profile.agent.system.persona,
    model: profile.agent.model.model,
  });

  const debugPlugin = pluginManager.getPlugins().get('@eden/plugin-debug-panel')
    ?? pluginManager.getPlugins().get('debug-panel');

  const DEBUG_PORT = (debugPlugin as any)?.getDebugPort?.() ?? 18791;

  // WebSocket 连接到 debug panel
  let ws: WebSocket | null = null;
  let debugState: DebugState | null = null;

  if (withDebug && debugPlugin) {
    ws = new WebSocket(`ws://localhost:${DEBUG_PORT}`);
    ws.on('open', () => console.log(`[debug] connected ws://localhost:${DEBUG_PORT}`));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'snapshot') debugState = msg.state;
      else if (msg.type === 'event') applyEvent(msg.event);
    });
    ws.on('close', () => {
      console.log('[debug] disconnected');
      ws = null;
    });
    ws.on('error', () => { ws = null; });

    // 初始化屏幕
    initSplitScreen();
    scheduleRender(() => renderDebug(debugState));
  }

  console.log(`[eden] Chat — ${profileName} | ${profile.agent.model.model}${withDebug ? ' | [DEBUG]' : ''}`);
  console.log('输入 /exit 退出\n');

  const rl = await import('readline').then((m) =>
    m.createInterface({ input: process.stdin, output: process.stdout })
  );
  const messages: any[] = [];
  const chatLines: string[] = [];

  const question = (p: string): Promise<string> => new Promise((r) => rl.question(p, r));

  // 渲染函数
  const render = () => {
    if (!withDebug) return;
    clearLeft();
    console.log(`${C.bold}${C.cyan}═══ Chat ═══${C.reset}`);
    chatLines.forEach((l) => console.log(trunc(l, LEFT_WIDTH - 2)));
  };

  while (true) {
    if (withDebug) {
      // 先显示当前 chat 状态
      render();
      scheduleRender(() => renderDebug(debugState));
    }
    const input = await question(`${C.green}🧑 你: ${C.reset}`);
    if (!input.trim() || input.trim() === '/exit') break;

    const result = await agent.chat(messages, input);
    const reply = result.response;
    console.log(`${C.brightBlue}\n🤖 Eden: ${C.reset}${reply}\n`);
    messages.push({ role: 'user', content: input });
    messages.push({ role: 'assistant', content: reply });
    chatLines.push(`🧑 你: ${input}`);
    chatLines.push(`🤖 Eden: ${reply}`);

    if (withDebug) {
      // 刷新 debug panel
      scheduleRender(() => renderDebug(debugState));
    }
  }

  rl.close();
  if (ws) ws.close();
  process.stdout.write('\x1b[?1049l'); // 恢复屏幕
}

// ==================== DRY-RUN 模式 ====================

async function runDryRun() {
  const prompt = args.slice(1).find((a) => !a.startsWith('--')) ?? '';
  const profileName = getFlag('--profile') ?? 'default';
  const send = hasFlag('--send');

  if (!prompt) { console.error('eden dry-run: missing prompt'); process.exit(1); }

  const profilesDir = resolveProfileDir();
  const profilePath = join(profilesDir, profileName, 'config.yaml');
  if (!existsSync(profilePath)) {
    console.error(`eden: profile "${profileName}" not found at ${profilePath}`);
    process.exit(1);
  }

  const profile = ConfigLoader.loadProfile(profilePath);
  const profileDir = join(profilesDir, profileName);

  const debugChannel = new DebugChannel();
  const hookPipeline = new HookPipeline();
  const builtinPlugins = new Map<string, () => any>();
  builtinPlugins.set('memory-file', () => createMemoryFilePlugin());
  builtinPlugins.set('@eden/plugin-memory-file', () => createMemoryFilePlugin());
  const pluginManager = new PluginManager(debugChannel, builtinPlugins);

  for (const entry of profile.plugins) {
    try {
      await pluginManager.load(entry.name, entry.config ?? {}, profileDir);
      const plugin = pluginManager.getPlugins().get(entry.name);
      if (plugin) hookPipeline.register(plugin);
    } catch (err) {
      console.warn(`[eden] plugin "${entry.name}" load failed:`, (err as Error).message);
    }
  }

  const provider = new OpenAIProvider(profile.agent.model);
  const assembler = new SystemPromptAssembler();
  const agent = new Agent({
    pluginManager, provider, hookPipeline, debugChannel,
    systemPromptAssembler: assembler,
    persona: profile.agent.system.persona,
    model: profile.agent.model.model,
  });

  const result = await agent.chat([], prompt, { dryRun: true });
  printDryRunOutput(result.context, prompt);

  if (send) {
    console.log('\n📡 调用 LLM...\n');
    const real = await agent.chat([], prompt);
    console.log(`\n🤖 Eden: ${real.response}\n`);
  }
}

// ==================== 分屏渲染（ANSI）====================

let renderTimer: ReturnType<typeof setTimeout> | null = null;

function initSplitScreen() {
  process.stdout.write('\x1b[?1049h'); // 切换到备用屏幕
  process.stdout.write('\x1b[2J');     // 清屏
}

function scheduleRender(fn: () => void) {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(fn, 50);
}

function clearLeft() {
  process.stdout.write('\x1b[H'); // 光标回左上
  process.stdout.write('\x1b[0J');  // 清除到行尾
}

function moveTo(col: number, row: number): string {
  return `\x1b[${row};${col}H`;
}

function renderDebug(state: DebugState | null) {
  const C2 = C;
  process.stdout.write(moveTo(DEBUG_COL, 1));

  let out = `${C2.bold}${C2.cyan}═══ Debug ═══${C2.reset}\n`;
  out += `${C2.dim}port: ${18791}${C2.reset}\n`;

  if (!state) {
    out += `${C2.dim}waiting...${C2.reset}`;
    process.stdout.write(out + '\n');
    return;
  }

  out += `${C2.dim}req: ${state.currentRequestId ?? '—'}${C2.reset}\n`;
  out += `${C2.bold}▸ System (${state.systemPrompt.length}c)${C2.reset}\n`;
  out += trunc(state.systemPrompt, LEFT_WIDTH - 4) + '\n';
  out += `${C2.bold}▸ Memory (${state.injectedContext.length})${C2.reset}\n`;

  if (!state.injectedContext.length) {
    out += `${C2.dim}  empty${C2.reset}\n`;
  } else {
    for (const inj of state.injectedContext.slice(0, 5)) {
      out += `  ${C2.cyan}[${inj.source}]${C2.reset} ${inj.tokens}t\n`;
      out += `  ${trunc(inj.content, 60)}\n`;
    }
    if (state.injectedContext.length > 5) out += `  ${C2.dim}...+${state.injectedContext.length - 5}${C2.reset}\n`;
  }

  out += `${C2.bold}▸ Tokens${C2.reset}\n`;
  const u = state.tokenUsage;
  out += `  in:${C2.yellow}${u.in}${C2.reset} out:${C2.yellow}${u.out}${C2.reset} tot:${C2.yellow}${u.total}${C2.reset}`;
  if (u.cost != null) out += ` ${C2.green}$${u.cost.toFixed(6)}${C2.reset}`;
  out += '\n';

  if (state.lastError) {
    out += `${C2.red}▸ Error: ${trunc(state.lastError, 50)}${C2.reset}\n`;
  }

  // 填充空白
  out += '\n'.repeat(Math.max(0, TOTAL_HEIGHT - out.split('\n').length));

  process.stdout.write(out);
}

function applyEvent(event: any) {
  // 增量更新 debugState
  // (full re-render on next tick is fine)
}

// ==================== DRY-RUN 输出 ====================

function printDryRunOutput(ctx: any, userPrompt: string) {
  const assembler = new SystemPromptAssembler();
  console.log('\n=== DRY RUN ================================================\n');
  const tokens = coreEstimateTokens(ctx.systemPrompt);
  console.log(`-- System Prompt (${tokens} tokens) --`);
  console.log(ctx.systemPrompt);
  console.log('\n-- Injected Context --');
  if (ctx.injectedContext.length === 0) console.log('(无)');
  else for (const inj of ctx.injectedContext) {
    console.log(`[${inj.source}] ${inj.tokens} tokens`);
    console.log(inj.content);
  }
  console.log('\n-- Skills --');
  if (ctx.activeSkills.length === 0) console.log('(无)');
  else console.log(ctx.activeSkills.join('\n'));
  console.log('\n-- Final Messages --');
  const assembled = assembler.assemble(ctx);
  console.log(`system: ${assembled}`);
  console.log(`user: ${userPrompt}`);
  console.log('\n============================================================');
}

// ==================== 工具函数 ====================

function resolveProfileDir(): string {
  return process.env.EDEN_PROFILES_DIR ?? join(process.env.HOME ?? '', '.eden', 'profiles');
}

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function trunc(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '...';
}

function printHelp() {
  console.log(`
eden — Profile-based AI Agent

Usage:
  eden chat [--profile <name>]          交互式聊天
  eden chat --profile <name> --debug  聊天 + Debug 分屏（单窗口）
  eden dry-run "<prompt>" [--profile] 离线预览
  eden dry-run "<prompt>" --send      预览后调用 LLM
  eden help

Profiles:
  ~/.eden/profiles/<name>/config.yaml
  EDEN_PROFILES_DIR 环境变量可覆盖
`);
}

// ==================== 类型 ====================

interface DebugState {
  currentRequestId: string | null;
  systemPrompt: string;
  injectedContext: Array<{ source: string; content: string; tokens: number }>;
  tokenUsage: { in: number; out: number; total: number; cost?: number };
  lastError?: string;
}
