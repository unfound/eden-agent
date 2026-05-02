#!/usr/bin/env node
/**
 * eden — CLI 入口
 *
 * pnpm eden server --profile default
 * pnpm eden dry-run "prompt" --profile default
 * pnpm eden help
 */

import { Agent, HookPipeline, PluginManager, DebugChannel, SystemPromptAssembler, OpenAIProvider, EdenServer, ConfigLoader } from '@eden/core';
import createMemoryFilePlugin from '@eden/plugin-memory-file';
import { existsSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

// ==================== 入口 ====================

async function main() {
  if (command === 'server') {
    await runServer();
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
  console.error('eden error:', (err as Error).message);
  process.exit(1);
});

// ==================== SERVER 模式 ====================

async function runServer() {
  const profileName = getFlag('--profile') ?? 'default';
  const port = parseInt(getFlag('--port') ?? '3000', 10);

  const { profile, profileDir } = loadProfile(profileName);

  const debugChannel = new DebugChannel();
  const hookPipeline = new HookPipeline();
  const builtinPlugins = new Map<string, () => any>();
  builtinPlugins.set('memory-file', () => createMemoryFilePlugin());
  builtinPlugins.set('@eden/plugin-memory-file', () => createMemoryFilePlugin());
  const pluginManager = new PluginManager(debugChannel, builtinPlugins);

  for (const entry of profile.plugins) {
    try {
      await pluginManager.load(entry.name, entry.config ?? {}, profileDir);
      await pluginManager.enable(entry.name);
    } catch (err) {
      console.warn(`[eden] plugin "${entry.name}" load failed:`, (err as Error).message);
    }
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

  const server = new EdenServer({ port });
  await server.start(agent);

  console.log(`\n  🌐 http://localhost:${port}/api/chat`);
  console.log(`  开发时: cd packages/transport-web && pnpm dev\n`);
  console.log('  Ctrl+C 停止\n');

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\n[eden] 关闭中...');
      server.stop();
      resolve();
    });
  });

  process.exit(0);
}

// ==================== DRY-RUN 模式 ====================

async function runDryRun() {
  const prompt = args.slice(1).find((a) => !a.startsWith('--')) ?? '';
  const profileName = getFlag('--profile') ?? 'default';
  const send = hasFlag('--send');

  if (!prompt) { console.error('eden dry-run: missing prompt'); process.exit(1); }

  const { profile, profileDir } = loadProfile(profileName);

  const debugChannel = new DebugChannel();
  const hookPipeline = new HookPipeline();
  const builtinPlugins = new Map<string, () => any>();
  builtinPlugins.set('memory-file', () => createMemoryFilePlugin());
  builtinPlugins.set('@eden/plugin-memory-file', () => createMemoryFilePlugin());
  const pluginManager = new PluginManager(debugChannel, builtinPlugins);

  for (const entry of profile.plugins) {
    try {
      await pluginManager.load(entry.name, entry.config ?? {}, profileDir);
      pluginManager.getPlugins().get(entry.name) && hookPipeline.register(pluginManager.getPlugins().get(entry.name)!);
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

// ==================== 工具函数 ====================

function loadProfile(profileName: string) {
  const profilesDir = process.env.EDEN_PROFILES_DIR ?? join(process.env.HOME ?? '', '.eden', 'profiles');
  const profilePath = join(profilesDir, profileName, 'config.yaml');

  if (!existsSync(profilePath)) {
    console.error(`eden: profile "${profileName}" not found at ${profilePath}`);
    process.exit(1);
  }

  const profile = ConfigLoader.loadProfile(profilePath);
  const profileDir = join(profilesDir, profileName);
  return { profile, profileDir };
}

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function printDryRunOutput(ctx: any, userPrompt: string) {
  console.log('\n=== DRY RUN ================================================\n');
  console.log(`-- System Prompt (${ctx.systemPrompt.length}c) --`);
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
  console.log('============================================================');
}

function printHelp() {
  console.log(`
eden — Profile-based AI Agent

Usage:
  pnpm eden server [--profile <name>] [--port <port>]   启动 HTTP 服务
  pnpm eden dry-run "<prompt>" [--profile]              离线预览
  pnpm eden dry-run "<prompt>" --send                   预览后调用 LLM
  pnpm eden help
`);
}
