#!/usr/bin/env node
/**
 * eden — CLI 入口 (Ink 版本)
 *
 * pnpm chat --profile novelist
 * pnpm chat --profile novelist --debug
 * pnpm dry-run "prompt" --profile novelist
 */

import React, { useState, useEffect } from 'react';
import { render, useInput, Box, Text } from 'ink';
import { Agent, HookPipeline, PluginManager, DebugChannel, SystemPromptAssembler, OpenAIProvider } from '@eden/core';
import createMemoryFilePlugin from '@eden/plugin-memory-file';
import { createPlugin as createDebugPanelPlugin } from '@eden/plugin-debug-panel';
import { ConfigLoader } from '@eden/core';
import { existsSync } from 'fs';
import { join } from 'path';
import { WebSocket } from 'ws';
import { DebugPanel, DebugState } from './components/DebugPanel.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'chat';

// ==================== 入口 ====================

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

  // 初始化 Agent
  const debugChannel = new DebugChannel();
  const hookPipeline = new HookPipeline();
  const builtinPlugins = new Map<string, () => any>();
  builtinPlugins.set('memory-file', () => createMemoryFilePlugin());
  builtinPlugins.set('@eden/plugin-memory-file', () => createMemoryFilePlugin());
  const regDebug = () => createDebugPanelPlugin();
  builtinPlugins.set('@eden/plugin-debug-panel', regDebug);

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
    if (!pluginManager.getPlugins().has(debugKey)) {
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

  const debugPlugin = pluginManager.getPlugins().get('@eden/plugin-debug-panel');
  const DEBUG_PORT = (debugPlugin as any)?.getDebugPort?.() ?? 18791;

  // 启动 debug panel WebSocket server
  if (withDebug && debugPlugin) {
    (debugPlugin as any)?.start?.();
  }

  // 调用 Ink 渲染
  const app = render(
    <ChatInk
      agent={agent}
      profileName={profileName}
      modelName={profile.agent.model.model}
      withDebug={withDebug}
      debugPort={DEBUG_PORT}
    />
  );

  return app.waitUntilExit();
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

// ==================== Ink 组件 ====================

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatInkProps {
  agent: Agent;
  profileName: string;
  modelName: string;
  withDebug: boolean;
  debugPort: number;
}

const ChatInk: React.FC<ChatInkProps> = ({
  agent,
  profileName,
  modelName,
  withDebug,
  debugPort,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [debugState, setDebugState] = useState<DebugState | null>(null);
  const [connected, setConnected] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const wsRef = React.useRef<WebSocket | null>(null);

  // WebSocket 连接
  useEffect(() => {
    if (!withDebug) return;

    const ws = new WebSocket(`ws://localhost:${debugPort}`);
    wsRef.current = ws;

    ws.on('open', () => setConnected(true));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'snapshot') setDebugState(msg.state);
      else if (msg.type === 'event') ws.send(JSON.stringify({ type: 'snapshot' }));
    });
    ws.on('close', () => setConnected(false));
    ws.on('error', () => setConnected(false));

    return () => { ws.close(); };
  }, [withDebug, debugPort]);

  // 键盘输入
  useInput((inputChars, key) => {
    if (key.return) {
      const cmd = input.trim();
      if (!cmd) return;
      if (cmd === '/exit' || cmd === '/quit') {
        process.exit(0);
      }
      const userMsg: Message = { role: 'user', content: input };
      setMessages((prev) => [...prev, userMsg]);
      setChatHistory((prev) => [...prev, userMsg]);
      setInput('');
      setThinking(true);

      // 调用 agent
      agent.chat(chatHistory, input).then((result) => {
        const assistantMsg: Message = { role: 'assistant', content: result.response };
        setMessages((prev) => [...prev, assistantMsg]);
        setChatHistory((prev) => [...prev, assistantMsg]);
        setThinking(false);
      }).catch((err) => {
        const errMsg: Message = { role: 'assistant', content: `[error] ${err.message}` };
        setMessages((prev) => [...prev, errMsg]);
        setThinking(false);
      });
    } else if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
    } else if (key.escape) {
      process.exit(0);
    } else if (inputChars && !key.ctrl && !key.meta) {
      setInput((prev) => prev + inputChars);
    }
  });

  const title = `[eden] ${profileName} | ${modelName}${withDebug ? ' | DEBUG' : ''}`;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{title}</Text>
      <Text dimColor>输入 /exit 退出 | Backspace 删除</Text>
      <Text> </Text>

      <Box flexDirection="row" flexGrow={1}>
        {/* 左侧：聊天区 */}
        <Box flexDirection="column" flexGrow={1}>
          {messages.map((m, i) => (
            <Text key={i} wrap="truncate">
              <Text color="green">{m.role === 'user' ? '🧑 你' : '🤖 Eden'}</Text>
              <Text>: </Text>
              <Text>{m.content}</Text>
            </Text>
          ))}
          {thinking && (
            <Text italic>Eden: thinking...</Text>
          )}

          {/* 输入行 */}
          <Box marginTop={1}>
            <Text color="green">{'🧑 你> '}</Text>
            <Text>{input}_</Text>
          </Box>
        </Box>

        {/* 右侧：Debug Panel */}
        {withDebug && (
          <Box marginLeft={1} flexDirection="column">
            <DebugPanel state={debugState} port={debugPort} />
            <Text dimColor>ws {connected ? '✓' : '✗'}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

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
  const single = s.replace(/\n/g, ' ');
  return single.length <= max ? single : single.slice(0, max) + '...';
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
  console.log('\n============================================================');
}

function printHelp() {
  console.log(`
eden — Profile-based AI Agent

Usage:
  eden chat [--profile <name>]         交互式聊天
  eden chat --profile <name> --debug   聊天 + Debug 分屏
  eden dry-run "<prompt>" [--profile]  离线预览
  eden dry-run "<prompt>" --send       预览后调用 LLM
  eden help

Profiles:
  ~/.eden/profiles/<name>/config.yaml
  EDEN_PROFILES_DIR 环境变量可覆盖
`);
}
