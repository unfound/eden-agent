import React from 'react';
import { Box, Text } from 'ink';
import type { DebugState, CumulativeUsage } from './DebugPanel.js';

interface Props {
  debugState: DebugState | null;
  cumulative: CumulativeUsage;
  modelName: string;
  providerUrl?: string;
}

/**
 * 右栏：统计面板（/debug-info 切换视图）
 * Token 组成、Memory recall、预算 vs 实际
 */
export const StatsPanel: React.FC<Props> = ({ debugState, cumulative, modelName, providerUrl }) => {
  if (!debugState) {
    return (
      <Viewport>
        <Text dimColor>waiting for data...</Text>
      </Viewport>
    );
  }

  const u = debugState.tokenUsage;
  const totalBudget = 16384; // default, should come from profile config

  return (
    <Viewport>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">Debug Info</Text>
        <Text dimColor>/debug-info</Text>
      </Box>
      <Text dimColor>────────────────────</Text>

      {/* Token Usage */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>▸ Token Usage</Text>
        <Box paddingLeft={2}>
          <Text>
            in <Text color="yellow">{u.in}</Text>
            {' | '}out <Text color="yellow">{u.out}</Text>
            {' | '}tot <Text color="yellow">{u.total}</Text>
            {u.cost != null && <Text color="green"> · ${u.cost.toFixed(6)}</Text>}
          </Text>
        </Box>
      </Box>

      {/* Cumulative */}
      {cumulative.in > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>▸ Cumulative</Text>
          <Box paddingLeft={2}>
            <Text dimColor>
              in <Text color="yellow">{cumulative.in}</Text>
              {' | '}out <Text color="yellow">{cumulative.out}</Text>
              {' | '}cost <Text color="green">${cumulative.cost.toFixed(6)}</Text>
            </Text>
          </Box>
          {/* Progress bar */}
          <Box paddingLeft={2} marginTop={0}>
            <Bar value={cumulative.in + cumulative.out} max={totalBudget} />
          </Box>
        </Box>
      )}

      {/* Token Budget */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>▸ Budget</Text>
        <Box paddingLeft={2}>
          <Text dimColor>
            total {u.total} / {totalBudget} ({Math.round((u.total / totalBudget) * 100)}%)
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <Bar value={u.total} max={totalBudget} />
        </Box>
      </Box>

      {/* Memory Injection */}
      {debugState.injectedContext.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>▸ Memory ({debugState.injectedContext.length})</Text>
          {debugState.injectedContext.slice(0, 4).map((inj, i) => (
            <Box key={i} paddingLeft={2} flexDirection="column">
              <Text>
                <Text color="cyan">[{inj.source}]</Text>
                <Text dimColor> {inj.tokens}t</Text>
              </Text>
              <Text dimColor wrap="wrap">
                {' '}· {trunc(inj.content, 40)}
              </Text>
            </Box>
          ))}
          {debugState.injectedContext.length > 4 && (
            <Box paddingLeft={2}><Text dimColor>… +{debugState.injectedContext.length - 4}</Text></Box>
          )}
        </Box>
      )}

      {/* Model Provider */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>▸ Provider</Text>
        <Box paddingLeft={2}>
          <Text dimColor>{modelName}{providerUrl ? ` @ ${providerUrl}` : ''}</Text>
        </Box>
      </Box>

      {/* System Prompt preview */}
      {debugState.systemPrompt && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>▸ System Prompt</Text>
          <Box paddingLeft={2}>
            <Text dimColor wrap="wrap">
              {trunc(debugState.systemPrompt, 120)}
            </Text>
          </Box>
        </Box>
      )}

      {/* Error */}
      {debugState.lastError && (
        <Box marginTop={1}>
          <Text color="red" bold>✕ {trunc(debugState.lastError, 50)}</Text>
        </Box>
      )}
    </Viewport>
  );
};

// ── Token 进度条组件 ──

const Bar: React.FC<{ value: number; max: number; width?: number }> = ({ value, max, width = 10 }) => {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  const filled = Math.round((pct / 100) * width);
  const bar = '▓'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
  return <Text dimColor>{bar} {pct}%</Text>;
};

// ── 面板外框 ──

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
