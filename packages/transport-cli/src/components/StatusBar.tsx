import React from 'react';
import { Box, Text } from 'ink';
import type { CumulativeUsage } from './DebugPanel.js';

interface Props {
  modelName: string;
  cumulative: CumulativeUsage;
  maxTokens?: number;
}

/**
 * 底部状态栏：model · 累计 token · 进度条
 * 始终显示（无论是否 debug 模式）
 */
export const StatusBar: React.FC<Props> = ({ modelName, cumulative, maxTokens }) => {
  const totalTokens = cumulative.in + cumulative.out;
  const limit = maxTokens ?? 16384;
  const pct = Math.min(100, Math.round((totalTokens / limit) * 100));
  const barWidth = 10;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = '▓'.repeat(filled) + '░'.repeat(Math.max(0, barWidth - filled));

  return (
    <Box>
      <Text dimColor>
        {modelName}
        {' · '}in: <Text color="yellow">{cumulative.in}</Text>
        {' · '}out: <Text color="yellow">{cumulative.out}</Text>
        {' · '}{bar} {pct}% ({totalTokens}/{limit})
      </Text>
    </Box>
  );
};
