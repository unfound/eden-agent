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
import { DebugState, CumulativeUsage } from './components/DebugPanel.js';
import { Header } from './components/Header.js';
import { ChatPane, ChatMessage } from './components/ChatPane.js';
import { MessageLog } from './components/MessageLog.js';
import { StatsPanel } from './components/StatsPanel.js';
import { InputBar } from './components/InputBar.js';
import { StatusBar } from './components/StatusBar.js';

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
  console.error('eden error:', (err as Error).message);
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

  if (withDebug && debugPlugin) {
    (debugPlugin as any)?.start?.();
  }

  // 调用 Ink 渲染
  const app = render(
    <App
      agent={agent}
      profileName={profileName}
      modelName={profile.agent.model.model}
      providerUrl={profile.agent.model.baseURL}
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

// ==================== App 组件 ====================

interface AppProps {
  agent: Agent;
  profileName: string;
  modelName: string;
  providerUrl: string;
  withDebug: boolean;
  debugPort: number;
}

const App: React.FC<AppProps> = ({ agent, profileName, modelName, providerUrl, withDebug, debugPort }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [debugState, setDebugState] = useState<DebugState | null>(null);
  const [connected, setConnected] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [cumulativeUsage, setCumulativeUsage] = useState<CumulativeUsage>({ in: 0, out: 0, cost: 0 });
  const [rightPanelView, setRightPanelView] = useState<'messages' | 'stats'>('messages');
  const [chatScrollOffset, setChatScrollOffset] = useState(-1); // -1 = auto-follow bottom
  const wsRef = React.useRef<WebSocket | null>(null);
  const prevMsgLen = React.useRef(0);
  const prevThinking = React.useRef(false);

  // WebSocket 连接
  useEffect(() => {
    if (!withDebug) return;

    const ws = new WebSocket(`ws://localhost:${debugPort}`);
    wsRef.current = ws;

    ws.on('open', () => setConnected(true));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'snapshot') {
        setDebugState(msg.state);
      } else if (msg.type === 'event') {
        setDebugState((prev) => {
          if (!prev) return prev;
          return applyDebugEvent(prev, msg.event);
        });
        setCumulativeUsage((prev) => {
          if (msg.event.type === 'request_end') {
            const usage = msg.event.data.usage ?? {};
            return {
              in: prev.in + (usage.in ?? 0),
              out: prev.out + (usage.out ?? 0),
              cost: prev.cost + (usage.cost ?? 0),
            };
          }
          return prev;
        });
      }
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
      if (cmd === '/debug-info') {
        setRightPanelView((prev) => prev === 'messages' ? 'stats' : 'messages');
        setInput('');
        return;
      }
      const userMsg: ChatMessage = { role: 'user', content: input };
      setMessages((prev) => [...prev, userMsg]);
      setChatHistory((prev) => [...prev, userMsg]);
      const text = input;
      setInput('');
      setThinking(true);

      // 流式输出
      (async () => {
        try {
          const { stream, usage: usagePromise } = await agent.chatStream(chatHistory, text);
          let firstToken = true;
          for await (const content of stream) {
            if (firstToken) {
              setMessages((prev) => [...prev, { role: 'assistant', content }]);
              setChatHistory((prev) => [...prev, { role: 'assistant', content }]);
              firstToken = false;
            } else {
              setMessages((prev) => {
                const copy = [...prev];
                if (copy.length > 0) copy[copy.length - 1] = { role: 'assistant', content };
                return copy;
              });
              setChatHistory((prev) => {
                const copy = [...prev];
                if (copy.length > 0) copy[copy.length - 1] = { role: 'assistant', content };
                return copy;
              });
            }
          }
          // 流结束，更新累计用量
          const usage = await usagePromise;
          setCumulativeUsage((prev) => ({
            in: prev.in + usage.in,
            out: prev.out + usage.out,
            cost: prev.cost + ((usage as any).cost ?? 0),
          }));
        } catch (err) {
          const errMsg = `[error] ${(err as Error).message}`;
          setMessages((prev) => [...prev, { role: 'assistant', content: errMsg }]);
          setChatHistory((prev) => [...prev, { role: 'assistant', content: errMsg }]);
        }
        setThinking(false);
      })();
    } else if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
    } else if (key.escape) {
      process.exit(0);
    } else if (key.upArrow) {
      setChatScrollOffset((prev) => {
        // If at bottom (-1), move up by 1; otherwise scroll up by 1
        const current = prev === -1 ? Math.max(0, messages.length - 1) : prev;
        return Math.max(0, current - 1);
      });
    } else if (key.downArrow) {
      setChatScrollOffset((prev) => {
        if (prev === -1) return -1; // already at bottom
        const next = prev + 1;
        // If next would show bottom, reset to auto-follow
        return next >= messages.length ? -1 : next;
      });
    } else if (key.pageUp) {
      setChatScrollOffset((prev) => {
        const current = prev === -1 ? Math.max(0, messages.length - 10) : prev;
        return Math.max(0, current - 10);
      });
    } else if (key.pageDown) {
      setChatScrollOffset((prev) => {
        if (prev === -1) return -1;
        const next = Math.min(messages.length - 1, prev + 10);
        return next >= messages.length - 1 ? -1 : next;
      });
    } else if (inputChars && !key.ctrl && !key.meta) {
      setInput((prev) => prev + inputChars);
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        profileName={profileName}
        modelName={modelName}
        withDebug={withDebug}
        connected={connected}
        debugPort={debugPort}
      />
      <Text dimColor>输入 /exit 退出</Text>

      {/* 主体：双栏 */}
      <Box flexDirection="row" flexGrow={1}>
        {/* 左栏：聊天记录 */}
        <Box flexGrow={1} flexShrink={1}>
          <ChatPane
            messages={messages}
            thinking={thinking}
            withDebug={withDebug}
            scrollOffset={chatScrollOffset}
            onScroll={setChatScrollOffset}
          />
        </Box>

        {/* 右栏（仅 debug 模式） */}
        {withDebug && (
          <Box flexGrow={0} width={54}>
            {rightPanelView === 'messages' ? (
              <MessageLog debugState={debugState} connected={connected} />
            ) : (
              <StatsPanel
                debugState={debugState}
                cumulative={cumulativeUsage}
                modelName={modelName}
                providerUrl={providerUrl}
              />
            )}
          </Box>
        )}
      </Box>

      {/* 输入栏 */}
      <InputBar input={input} />

      {/* 状态栏 */}
      <StatusBar modelName={modelName} cumulative={cumulativeUsage} maxTokens={undefined} />
    </Box>
  );
};

// ==================== Debug 事件累积 ====================

function applyDebugEvent(
  state: DebugState,
  event: { type: string; requestId: string; data: Record<string, unknown> }
): DebugState {
  const data = event.data;
  switch (event.type) {
    case 'request_start':
      return {
        ...state,
        currentRequestId: event.requestId,
        systemPrompt: (data.systemPrompt as string) ?? '',
        injectedContext: (data.injectedContext as Array<{ source: string; content: string; tokens: number }>) ?? [],
        rawRequest: (data.rawRequest as Array<{ role: string; content: string }>) ?? [],
        rawResponse: null,
        lastError: undefined,
        toolCalls: [],
      };
    case 'request_end':
      return {
        ...state,
        tokenUsage: (data.usage as { in: number; out: number; total: number; cost?: number }) ?? state.tokenUsage,
        messages: (data.messages as Array<{ role: string; content: string }>) ?? state.messages,
        rawResponse: (data.rawResponse as { content: string; finishReason?: string; model?: string; id?: string }) ?? null,
      };
    case 'tool_called': {
      const tc = { name: (data.name as string) ?? '', args: JSON.stringify(data.args ?? {}) };
      return { ...state, toolCalls: [...state.toolCalls, tc] };
    }
    case 'tool_result': {
      const calls = [...state.toolCalls];
      const last = calls[calls.length - 1];
      if (last) { last.result = String(data.result ?? ''); last.latencyMs = data.latencyMs as number | undefined; }
      return { ...state, toolCalls: calls };
    }
    case 'context_injected': {
      const injections = (data.injections as Array<{ source: string; content: string; tokens: number }>) ?? [];
      return { ...state, injectedContext: [...state.injectedContext, ...injections] };
    }
    case 'error':
      return { ...state, lastError: (data.error as string) ?? 'unknown error' };
    default:
      return state;
  }
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
  pnpm chat [--profile <name>]          交互式聊天
  pnpm chat --profile <name> --debug    聊天 + Debug 分屏
  pnpm dry-run "<prompt>" [--profile]  离线预览
  pnpm dry-run "<prompt>" --send       预览后调用 LLM
  pnpm help
`);
}
