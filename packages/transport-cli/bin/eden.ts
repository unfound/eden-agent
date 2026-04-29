#!/usr/bin/env node
/**
 * eden — CLI 入口
 *
 * eden chat --profile novelist
 * eden dry-run "prompt" --profile novelist
 */

import { Agent, HookPipeline, PluginManager, ProfileManager, DebugChannel, SystemPromptAssembler, OpenAIProvider, estimateTokens as coreEstimateTokens } from '@eden/core';
import createMemoryFilePlugin from '@eden/plugin-memory-file';
import { ConfigLoader } from '@eden/core';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

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

// ---- chat 模式 ----

async function runChat() {
  const profileName = getFlag('--profile') ?? 'default';

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
  // 注册内置插件（支持短名和全名）
  const builtinPlugins = new Map<string, () => any>();
  const reg = () => createMemoryFilePlugin();
  builtinPlugins.set('memory-file', reg);
  builtinPlugins.set('@eden/plugin-memory-file', reg);
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

  // 注册钩子
  for (const [, plugin] of pluginManager.getPlugins()) {
    hookPipeline.register(plugin);
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

  console.log(`[eden] Chat — profile: ${profileName}, model: ${profile.agent.model.model}`);
  console.log('输入 /exit 退出\n');

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
  // 注册内置插件（支持短名和全名）
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
  eden chat [--profile <name>]        交互式聊天
  eden dry-run "<prompt>" [--profile]  离线预览
  eden dry-run "<prompt>" --send      预览后调用 LLM
  eden help

Profiles:
  ~/.eden/profiles/<name>/config.yaml
  EDEN_PROFILES_DIR 环境变量可覆盖
`);
}
