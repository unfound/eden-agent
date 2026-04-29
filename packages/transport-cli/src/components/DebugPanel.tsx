import React from 'react';
import { Box, Text } from 'ink';

export interface DebugState {
  currentRequestId: string | null;
  systemPrompt: string;
  injectedContext: Array<{ source: string; content: string; tokens: number }>;
  tokenUsage: { in: number; out: number; total: number; cost?: number };
  messages: Array<{ role: string; content: string }>;
  toolCalls: Array<{
    name: string;
    args: string;
    result?: string;
    latencyMs?: number;
  }>;
  lastError?: string;
}

export interface CumulativeUsage {
  in: number;
  out: number;
  cost: number;
}

interface Props {
  state: DebugState | null;
  port: number;
  connected: boolean;
  cumulative: CumulativeUsage;
}

export const DebugPanel: React.FC<Props> = ({
  state,
  port,
  connected,
  cumulative,
}) => {
  return (
    <Box
      flexDirection="column"
      width={48}
      borderStyle="round"
      borderDimColor={false}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* ── Header line ── */}
      <Box>
        <Text bold color="cyan">
          Debug
        </Text>
        <Text>
          {' '}ws <Text color={connected ? 'green' : 'red'}>{connected ? '✓' : '✗'}</Text>
        </Text>
      </Box>

      {!state ? (
        <Text dimColor>waiting for request...</Text>
      ) : (
        <>
          {/* Meta line: req + cumulative */}
          <Text dimColor>
            req {trunc(state.currentRequestId ?? '—', 16)}
            {cumulative.in > 0 && (
              <Text>
                {' | '}tot in <Text color="yellow">{cumulative.in}</Text>
                {' '}<Text color="green">${cumulative.cost.toFixed(6)}</Text>
              </Text>
            )}
          </Text>

          {/* Divider */}
          <Text dimColor>────────────────────</Text>

          {/* ▸ System Prompt — line stat */}
          {state.systemPrompt && (
            <Box key="section-system">
              <Text bold>▸</Text>
              <Text>
                {' '}System{' '}
                <Text dimColor>{state.systemPrompt.length}c</Text>
              </Text>
            </Box>
          )}

          {/* ▸ Memory — list items */}
          {state.injectedContext.length > 0 && (
            <Box key="section-memory" flexDirection="column">
              <Box>
                <Text bold>▸</Text>
                <Text>
                  {' '}Memory{' '}
                  <Text dimColor>{state.injectedContext.length}</Text>
                </Text>
              </Box>
              {state.injectedContext.slice(0, 4).map((inj, i) => (
                <Box key={i} paddingLeft={2}>
                  <Text dimColor>
                    <Text dimColor color="cyan">[{inj.source}]</Text>
                    {' '}{inj.tokens}t · {trunc(inj.content, 18)}
                  </Text>
                </Box>
              ))}
              {state.injectedContext.length > 4 && (
                <Box paddingLeft={2}>
                  <Text dimColor>… +{state.injectedContext.length - 4}</Text>
                </Box>
              )}
            </Box>
          )}

          {/* ▸ Tools — line items */}
          {state.toolCalls.length > 0 && (
            <Box key="section-tools" flexDirection="column">
              <Box>
                <Text bold>▸</Text>
                <Text>
                  {' '}Tools{' '}
                  <Text dimColor>{state.toolCalls.length}</Text>
                </Text>
              </Box>
              {state.toolCalls.map((tc, i) => (
                <Box key={i} paddingLeft={2}>
                  <Text color="yellow">▶ {tc.name}</Text>
                  <Text dimColor>
                    {tc.latencyMs != null ? ` · ${tc.latencyMs}ms ` : ' '}
                    {trunc(tc.args, 20)}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {/* ▸ Tokens — compact */}
          <Box key="section-tokens">
            <Text bold>▸</Text>
            <Text>
              {' '}in <Text color="yellow">{state.tokenUsage.in}</Text>
              {' | '}out <Text color="yellow">{state.tokenUsage.out}</Text>
              {' | '}tot <Text color="yellow">{state.tokenUsage.total}</Text>
            </Text>
          </Box>

          {/* Cost — if available */}
          {state.tokenUsage.cost != null && (
            <Box key="section-cost">
              <Text bold>▸</Text>
              <Text>
                {' '}Cost{' '}
                <Text color="green">${state.tokenUsage.cost.toFixed(6)}</Text>
              </Text>
            </Box>
          )}

          {/* Error */}
          {state.lastError && (
            <Box key="section-error">
              <Text color="red">✕ {trunc(state.lastError, 40)}</Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

function trunc(s: string, max: number): string {
  const single = s.replace(/\n/g, ' ');
  if (single.length <= max) return single;
  return single.slice(0, max) + '…';
}
