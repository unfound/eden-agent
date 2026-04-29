#!/usr/bin/env node
/**
 * eden — CLI 入口
 *
 * eden chat --profile novelist
 * eden chat --profile novelist --debug   # chat + TUI 分屏
 * eden dry-run "prompt" --profile novelist
 * eden dry-run "prompt" --profile novelist --send
 * eden debug --profile novelist          # 单独 TUI，连接 chat 进程的 socket
 */

import { Agent, HookPipeline, PluginManager, ProfileManager, DebugChannel, SystemPromptAssembler, OpenAIProvider, estimateTokens as coreEstimateTokens } from '@eden/core';
import createMemoryFilePlugin from '@eden/plugin-memory-file';
import { createPlugin as createDebugPanelPlugin } from '@eden/plugin-debug-panel';
import { ConfigLoader } from '@eden/core';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';

// ---- 入口 ----

const args = process.argv.slice(2);
const command = args[0] ?? 'chat';

async function main() {
  if (command === 'chat') {
    await runChat();
  } else if (command === 'dry-run') {
    await runDryRun();
  } else if (command === 'debug') {
    await runDebugTui();
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

// ---- debug 模式：独立 TUI 进程，连接 socket ----

async function runDebugTui() {
  const profileName = getFlag('--profile') ?? 'default';
  const socketPath = `/tmp/eden-debug-${process.getuid?.() ?? 0}.sock`;

  console.log(`[eden] Debug TUI — profile: ${profileName}`);
  console.log(`[eden] Connecting to socket: ${socketPath}\n`);

  // 启动 PTY TUI
  const tty = spawn('node', ['-e', `
    const { WebSocket } = require('ws');
    const C2 = { reset: '\\x1b[0m', dim: '\\x1b[2m', cyan: '\\x1b[36m', yellow: '\\x1b[33m', green: '\\x1b[32m', red: '\\x1b[31m', bold: '\\x1b[1m' };
    const d = (s, n) => s.length > n ? s.slice(0, n) + '...' : s;
    let state = null;

    function render() {
      if (!state) return;
      process.stdout.write('\\x1b[2J\\x1b[H');
      let out = C2.bold + C2.cyan + '═══ Eden Debug ═══' + C2.reset + '\\n';
      out += C2.dim + 'req: ' + (state.currentRequestId ?? '—') + C2.reset + '\\n\\n';
      out += C2.bold + '▸ System Prompt' + C2.reset + ' (' + state.systemPrompt.length + ' chars)\\n';
      out += d(state.systemPrompt, 300) + '\\n\\n';
      out += C2.bold + '▸ Memory (' + state.injectedContext.length + ')' + C2.reset + '\\n';
      if (!state.injectedContext.length) out += C2.dim + '  (empty)' + C2.reset + '\\n';
      else for (const inj of state.injectedContext) {
        out += '  ' + C2.cyan + '[' + inj.source + ']' + C2.reset + ' ' + inj.tokens + ' tokens\\n';
        out += '  ' + d(inj.content, 80) + '\\n';
      }
      out += '\\n' + C2.bold + '▸ Tokens' + C2.reset + '\\n';
      const u = state.tokenUsage;
      out += '  in:' + C2.yellow + u.in + C2.reset + '  out:' + C2.yellow + u.out + C2.reset + '  total:' + C2.yellow + u.total + C2.reset;
      if (u.cost != null) out += '  ' + C2.green + '$' + u.cost.toFixed(6) + C2.reset;
      out += '\\n';
      if (state.lastError) out += '\\n' + C2.red + '▸ Error: ' + state.lastError + C2.reset + '\\n';
      process.stdout.write(out + '\\n');
    }

    try {
      const ws = new WebSocket('ws+unix://${socketPath}');
      ws.on('open', () => console.error('[tui] connected'));
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'snapshot') { state = msg.state; render(); }
        else if (msg.type === 'event') {
          // 增量更新 state
          const ev = msg.event;
          if (ev.type === 'request_start') {
            if (state) { state.currentRequestId = ev.requestId; state.systemPrompt = ev.data?.systemPrompt ?? ''; state.injectedContext = ev.data?.injectedContext ?? []; }
            render();
          } else if (ev.type === 'request_end') {
            if (state) state.tokenUsage = ev.data?.usage ?? { in:0,out:0,total:0 };
            render();
          } else if (ev.type === 'error') {
            if (state) state.lastError = ev.data?.error;
            render();
          }
        }
      });
      ws.on('close', () => { console.error('[tui] disconnected, retry 1s...'); setTimeout(() => process.exit(1), 1000); });
      ws.on('error', () => {});
    } catch(e) { console.error('[tui] connect error:', e.message); process.exit(1); }
  `], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  tty.on('exit', (code) => process.exit(code ?? 0));
}

// ---- chat 模式 ----

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

  // 注册内置插件
  const regMem = () => createMemoryFilePlugin();
  builtinPlugins.set('memory-file', regMem);
  builtinPlugins.set('@eden/plugin-memory-file', regMem);

  // 注册 debug-panel（短名和全名）
  const regDebug = () => createDebugPanelPlugin();
  builtinPlugins.set('debug-panel', regDebug);
  builtinPlugins.set('@eden/plugin-debug-panel', regDebug);

  const pluginManager = new PluginManager(debugChannel, builtinPlugins);

  // 按需加载插件
  for (const entry of profile.plugins) {
    try {
      await pluginManager.load(entry.name, entry.config ?? {}, profileDir);
      await pluginManager.enable(entry.name);
    } catch (err) {
      console.warn(`[eden] plugin "${entry.name}" load failed:`, (err as Error).message);
    }
  }

  // 强制启用 debug-panel（--debug 标志）
  if (withDebug) {
    // 确保 debug-panel 已加载（同名插件配置存在）
    if (!pluginManager.getPlugins().has('@eden/plugin-debug-panel') &&
        !pluginManager.getPlugins().has('debug-panel')) {
      await pluginManager.load('@eden/plugin-debug-panel', {}, profileDir);
    }
    await pluginManager.enable('@eden/plugin-debug-panel');
    await pluginManager.enable('debug-panel');
  }

  // 注册钩子
  pluginManager.getPlugins().forEach((plugin) => {
    hookPipeline.register(plugin);
  });

  const provider = new OpenAIProvider(profile.agent.model);
  const assembler = new SystemPromptAssembler();

  const agent = new Agent({
    pluginManager,
    provider,
    hookPipeline,
    debugChannel,
    systemPromptAssembler: assembler,
    persona: profile.agent.system.persona,
    model: profile.agent.model.model,
  });

  const debugPlugin = pluginManager.getPlugins().get('debug-panel')
    ?? pluginManager.getPlugins().get('@eden/plugin-debug-panel');

  console.log(`[eden] Chat — profile: ${profileName}, model: ${profile.agent.model.model}${withDebug ? ' [DEBUG]' : ''}`);
  console.log('输入 /exit 退出\n');

  if (withDebug && debugPlugin) {
    const socketPath = (debugPlugin as any).getSocketPath?.() ?? '/tmp/eden-debug.sock';
    console.log(`[eden] Debug socket: ${socketPath}`);
    console.log(`[eden] Run 'eden debug --profile ${profileName}' in another terminal to open TUI\n`);
  }

  const rl = await import('readline').then((m) =>
    m.createInterface({ input: process.stdin, output: process.stdout })
  );
  const messages: any[] = [];

  const question = (p: string): Promise<string> => new Promise((r) => rl.question(p, r));

  while (true) {
    const input = await question('🧑 你: ');
    if (!input.trim() || input.trim() === '/exit') break;

    const result = await agent.chat(messages, input);
    console.log(`\n🤖 Eden: ${result.response}\n`);
    messages.push({ role: 'user', content: input });
    messages.push({ role: 'assistant', content: result.response });
  }

  rl.close();
}

// ---- dry-run 模式 ----

async function runDryRun() {
  const prompt = args.slice(1).find((a) => !a.startsWith('--')) ?? '';
  const profileName = getFlag('--profile') ?? 'default';
  const send = hasFlag('--send');

  if (!prompt) {
    console.error('eden dry-run: missing prompt');
    process.exit(1);
  }

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
  const reg = () => createMemoryFilePlugin();
  builtinPlugins.set('memory-file', reg);
  builtinPlugins.set('@eden/plugin-memory-file', reg);
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
    pluginManager,
    provider,
    hookPipeline,
    debugChannel,
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

function printDryRunOutput(ctx: any, userPrompt: string) {
  const assembler = new SystemPromptAssembler();

  console.log('\n=== DRY RUN ================================================\n');
  const systemPart = ctx.systemPrompt;
  const tokens = coreEstimateTokens(systemPart);
  console.log(`-- System Prompt (${tokens} tokens) --`);
  console.log(systemPart);

  console.log('\n-- Injected Context --');
  if (ctx.injectedContext.length === 0) {
    console.log('(无)');
  } else {
    for (const inj of ctx.injectedContext) {
      console.log(`[${inj.source}] ${inj.tokens} tokens`);
      console.log(inj.content);
    }
  }

  console.log('\n-- Skills --');
  if (ctx.activeSkills.length === 0) {
    console.log('(无)');
  } else {
    console.log(ctx.activeSkills.join('\n'));
  }

  console.log('\n-- Final Messages --');
  const assembled = assembler.assemble(ctx);
  console.log(`system: ${assembled}`);
  console.log(`user: ${userPrompt}`);
  console.log('\n============================================================');
}

// ---- 工具函数 ----

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

function printHelp() {
  console.log(`
eden — Profile-based AI Agent

Usage:
  eden chat [--profile <name>]           交互式聊天
  eden chat --profile <name> --debug    聊天 + TUI 分屏
  eden dry-run "<prompt>" [--profile]  离线预览
  eden dry-run "<prompt>" --send       预览后调用 LLM
  eden debug --profile <name>          独立 TUI（连接 socket）
  eden help

Profiles:
  ~/.eden/profiles/<name>/config.yaml
  EDEN_PROFILES_DIR 环境变量可覆盖
`);
}
