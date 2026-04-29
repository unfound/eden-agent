import React from 'react';
import { Box, Text } from 'ink';

export interface DebugState {
  currentRequestId: string | null;
  systemPrompt: string;
  injectedContext: Array<{ source: string; content: string; tokens: number }>;
  tokenUsage: { in: number; out: number; total: number; cost?: number };
  lastError?: string;
}

interface Props {
  state: DebugState | null;
  port: number;
}

export const DebugPanel: React.FC<Props> = ({ state, port }) => {
  return (
    <Box
      flexDirection="column"
      width={50}
      borderStyle="round"
      borderDimColor={false}
      padding={1}
    >
      <Text bold color="cyan">━━ Debug ━━</Text>
      <Text dimColor>port: {port}</Text>

      {!state ? (
        <Text dimColor>waiting...</Text>
      ) : (
        <>
          <Text dimColor>req: {state.currentRequestId ?? '—'}</Text>

          <Text bold>▸ System ({state.systemPrompt.length}c)</Text>
          <Text dimColor>{trunc(state.systemPrompt, 40)}</Text>

          <Text bold>▸ Memory ({state.injectedContext.length})</Text>
          {state.injectedContext.length === 0 ? (
            <Text dimColor>  empty</Text>
          ) : (
            state.injectedContext.slice(0, 6).map((inj, i) => (
              <Box key={i} flexDirection="column" paddingLeft={1}>
                <Text dimColor color="cyan">[{inj.source}]</Text>
                <Text dimColor>  {inj.tokens}t · {trunc(inj.content, 40)}</Text>
              </Box>
            ))
          )}
          {state.injectedContext.length > 6 && (
            <Text dimColor>  ...+{state.injectedContext.length - 6}</Text>
          )}

          <Text bold>▸ Tokens</Text>
          <Text>
            {' '}in:<Text color="yellow">{state.tokenUsage.in}</Text>{' '}
            out:<Text color="yellow">{state.tokenUsage.out}</Text>{' '}
            tot:<Text color="yellow">{state.tokenUsage.total}</Text>
            {state.tokenUsage.cost != null && (
              <Text color="green"> ${state.tokenUsage.cost.toFixed(6)}</Text>
            )}
          </Text>

          {state.lastError && (
            <Text color="red">▸ Error: {trunc(state.lastError, 40)}</Text>
          )}
        </>
      )}
    </Box>
  );
};

function trunc(s: string, max: number): string {
  const single = s.replace(/\n/g, ' ');
  return single.length <= max ? single : single.slice(0, max) + '...';
}
