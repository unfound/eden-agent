import React from 'react';
import { Box, Text } from 'ink';
import type { DebugState } from './DebugPanel.js';

interface Props {
  debugState: DebugState | null;
  connected: boolean;
}

const ROLE_COLORS: Record<string, string> = {
  system:    'cyan',
  user:      'blue',
  assistant: 'green',
  tool:      'yellow',
};

function trunc(s: string, max: number): string {
  const single = s.replace(/\n/g, '↵');
  if (single.length <= max) return single;
  return single.slice(0, max) + '…';
}

function preview(s: string, max: number): string {
  if (s.length <= max) return s.replace(/\n/g, '↵');
  return s.slice(0, max).replace(/\n/g, '↵') + '…';
}

/**
 * 原始请求/响应展示
 * 直接把发给模型的 messages 数组和模型返回的响应原样摆出来
 */
export const MessageLog: React.FC<Props> = ({ debugState, connected }) => {
  if (!debugState) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Message Log</Text>
        <Text dimColor>waiting for data{connected ? '' : ' (ws disconnected)'}...</Text>
      </Box>
    );
  }

  const rawReq = debugState.rawRequest ?? [];
  const rawResp = debugState.rawResponse;

  return (
    <Box flexDirection="column" minHeight={20}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">Message Log</Text>
        <Text dimColor>{rawReq.length} msg{rawResp ? ' · ✓' : ''}</Text>
      </Box>
      <Text dimColor>────────────────────</Text>

      {/* ── 原始请求（messages 数组） ── */}
      {rawReq.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="blue">
            ◈ Request ({rawReq.length} messages)
          </Text>
          {rawReq.map((m, i) => {
            const color = ROLE_COLORS[m.role] ?? 'white';
            // 用首段来展示，避免内容太长刷屏
            const lines = m.content.split('\n');
            const short = lines[0].length > 150
              ? lines[0].slice(0, 150) + '…'
              : lines[0];
            return (
              <Box key={i} flexDirection="column" marginTop={0}>
                <Box>
                  <Text color={color} bold>[{m.role}]</Text>
                  <Text dimColor> {m.content.length}c</Text>
                </Box>
                {/* Tool Results (if from previous turn) */}
              {(m.role === 'system' || m.role === 'user' || i === rawReq.length - 1) && short && (
                <Box paddingLeft={2}>
                  <Text wrap="wrap" dimColor>{preview(m.content, 120)}</Text>
                </Box>
              )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* ── 工具调用（嵌在 Raw Request 系统提示/用户消息中间） ── */}
      {debugState.toolCalls.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">
            ◈ Tools ({debugState.toolCalls.length})
          </Text>
          {debugState.toolCalls.map((tc, i) => (
            <Box key={i} paddingLeft={1} flexDirection="column">
              <Box>
                <Text color="yellow">▶ {tc.name}</Text>
                {tc.latencyMs != null && <Text dimColor> · {tc.latencyMs}ms</Text>}
              </Box>
              <Box paddingLeft={2}>
                <Text dimColor wrap="wrap">
                  args: {preview(tc.args, 80)}
                </Text>
              </Box>
              {tc.result && (
                <Box paddingLeft={2}>
                  <Text dimColor wrap="wrap">
                    → {preview(tc.result, 100)}
                  </Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* ── 原始响应 ── */}
      {rawResp && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="green">
            ◈ Response
            {rawResp.finishReason ? (
              <Text dimColor> · finish_reason: {rawResp.finishReason}</Text>
            ) : null}
            {rawResp.model ? (
              <Text dimColor> · {rawResp.model}</Text>
            ) : null}
          </Text>

          {/* Token 统计 */}
          <Box>
            <Text dimColor>
              in <Text color="yellow">{debugState.tokenUsage.in}</Text>
              {' | '}out <Text color="yellow">{debugState.tokenUsage.out}</Text>
              {' | '}tot <Text color="yellow">{debugState.tokenUsage.total}</Text>
              {debugState.tokenUsage.cost != null && (
                <Text>
                  {' | '}<Text color="green">${debugState.tokenUsage.cost.toFixed(6)}</Text>
                </Text>
              )}
            </Text>
          </Box>

          {/* 响应内容预览 */}
          {rawResp.content && (
            <Box paddingLeft={2} marginTop={1}>
              <Text wrap="wrap">{rawResp.content}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Error */}
      {debugState.lastError && (
        <Box marginTop={1}>
          <Text color="red" bold>✕ Error</Text>
          <Text color="red" wrap="wrap"> {trunc(debugState.lastError, 60)}</Text>
        </Box>
      )}
    </Box>
  );
};
