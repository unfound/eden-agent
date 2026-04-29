import React from 'react';
import { Box, Text } from 'ink';
import type { DebugState } from './DebugPanel.js';

interface Props {
  debugState: DebugState | null;
  connected: boolean;
}

/**
 * 右栏：消息日志（默认视图）
 * 展示完整的 Request → Response 结构化消息
 */
export const MessageLog: React.FC<Props> = ({ debugState, connected }) => {
  if (!debugState) {
    return (
      <Viewport>
        <Text bold color="cyan">Message Log</Text>
        <Text dimColor>waiting for data{connected ? '' : ' (ws disconnected)'}...</Text>
      </Viewport>
    );
  }

  const msgs = debugState.messages ?? [];
  // 分离 request 消息和 response 消息
  let responseIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') { responseIdx = i; break; }
  }
  const requestMsgs = responseIdx >= 0 ? msgs.slice(0, responseIdx) : msgs;
  const responseMsgs = responseIdx >= 0 ? msgs.slice(responseIdx) : [];
  const toolCalls = debugState.toolCalls ?? [];

  return (
    <Viewport>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">Message Log</Text>
        <Text dimColor>{msgs.length} msg{toolCalls.length > 0 ? ` · ${toolCalls.length} tools` : ''}</Text>
      </Box>

      {/* Divider */}
      <Text dimColor>────────────────────</Text>

      {/* Request Block */}
      {requestMsgs.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="blue">
            ── Request ({requestMsgs.length} msg) ──
          </Text>
          {requestMsgs.map((m, i) => (
            <MessageCard key={i} msg={m} />
          ))}
        </Box>
      )}

      {/* Tool Calls */}
      {toolCalls.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">
            ── Tools ({toolCalls.length}) ──
          </Text>
          {toolCalls.map((tc, i) => (
            <Box key={i} marginTop={1} flexDirection="column" paddingLeft={1}>
              <Text color="yellow">▶ {tc.name}</Text>
              {tc.latencyMs != null && <Text dimColor>  · {tc.latencyMs}ms</Text>}
              <Text dimColor wrap="wrap">  args: {trunc(tc.args, 60)}</Text>
              {tc.result && <Text dimColor wrap="wrap">  → {trunc(tc.result, 80)}</Text>}
            </Box>
          ))}
        </Box>
      )}

      {/* Response Block */}
      {responseMsgs.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="green">
            ── Response ({debugState.tokenUsage.in + debugState.tokenUsage.out} tok) ──
          </Text>
          {responseMsgs.map((m, i) => (
            <MessageCard key={i} msg={m} />
          ))}
        </Box>
      )}

      {/* Error */}
      {debugState.lastError && (
        <Box marginTop={1}>
          <Text color="red" bold>✕ Error</Text>
          <Text color="red" wrap="wrap"> {trunc(debugState.lastError, 60)}</Text>
        </Box>
      )}
    </Viewport>
  );
};

// ── 单条消息卡片 ──

const ROLE_STYLES: Record<string, { color: string; label: string }> = {
  system:    { color: 'cyan',    label: 'system' },
  user:      { color: 'blue',    label: 'user' },
  assistant: { color: 'green',   label: 'assistant' },
  tool:      { color: 'yellow',  label: 'tool' },
};

const MessageCard: React.FC<{ msg: { role: string; content: string } }> = ({ msg }) => {
  const style = ROLE_STYLES[msg.role] ?? { color: 'white', label: msg.role };
  return (
    <Box marginTop={1} flexDirection="column">
      {/* Role label */}
      <Text bold color={style.color}>
        [{style.label}]
      </Text>
      {/* Content */}
      <Box paddingLeft={2}>
        <Text wrap="wrap" dimColor={msg.role === 'system'}>
          {trunc(msg.content, 300)}
        </Text>
      </Box>
    </Box>
  );
};

// ── 面板的外框容器 ──

const Viewport: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box flexDirection="column" borderStyle="round" width={52} paddingLeft={1} paddingRight={1}>
    {children}
  </Box>
);

// ── 工具函数 ──

function trunc(s: string, max: number): string {
  if (!s) return '';
  const single = s.replace(/\n/g, ' ');
  if (single.length <= max) return single;
  return single.slice(0, max) + '…';
}
