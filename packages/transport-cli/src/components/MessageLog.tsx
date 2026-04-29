import React from 'react';
import { Box, Text } from 'ink';
import type { DebugState } from './DebugPanel.js';

interface Props {
  debugState: DebugState | null;
  connected: boolean;
}

/**
 * 右栏：结构化消息日志
 * Phase 1 骨架 — Phase 3 会填充完整的 role 卡片渲染
 */
export const MessageLog: React.FC<Props> = ({ debugState, connected }) => {
  if (!debugState) {
    return (
      <Box flexDirection="column" borderStyle="round" width={52} paddingLeft={1} paddingRight={1}>
        <Text bold color="cyan">Message Log</Text>
        <Text dimColor>waiting for data{connected ? '' : ' (ws disconnected)'}...</Text>
      </Box>
    );
  }

  const msgs = debugState.messages ?? [];

  return (
    <Box flexDirection="column" borderStyle="round" width={52} paddingLeft={1} paddingRight={1}>
      <Text bold color="cyan">Message Log</Text>
      <Text dimColor>
        {msgs.length} msg{toolCallsCount(debugState) > 0 ? ` · ${toolCallsCount(debugState)} tools` : ''}
      </Text>

      {msgs.map((m, i) => (
        <Box key={i} marginTop={1} flexDirection="column">
          <Text bold inverse color={roleColor(m.role)}>
            {' '}{m.role}{' '}
          </Text>
          <Text dimColor wrap="wrap">
            {trunc(m.content, 200)}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

function toolCallsCount(state: DebugState): number {
  return state.toolCalls?.length ?? 0;
}

function roleColor(role: string): string {
  switch (role) {
    case 'system': return 'cyan';
    case 'user': return 'blue';
    case 'assistant': return 'green';
    case 'tool': return 'yellow';
    default: return 'white';
  }
}

function trunc(s: string, max: number): string {
  const single = s.replace(/\n/g, ' ');
  if (single.length <= max) return single;
  return single.slice(0, max) + '…';
}
