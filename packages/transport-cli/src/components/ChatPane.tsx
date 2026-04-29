import React from 'react';
import { Box, Text } from 'ink';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  messages: ChatMessage[];
  thinking: boolean;
  withDebug: boolean;
}

/**
 * 左栏：聊天记录面板
 * - 角色着色（用户绿 / AI 蓝）
 * - 流式更新时实时显示累积文本
 * - 消息内换行适配左栏宽度
 */
export const ChatPane: React.FC<Props> = ({ messages, thinking, withDebug }) => (
  <Box flexDirection="column" flexShrink={1} overflowY="hidden">
    {messages.map((m, i) => (
      <Box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
        {/* 角色标签行 */}
        <Text>
          <Text color={m.role === 'user' ? 'green' : 'brightBlue'} bold>
            {m.role === 'user' ? '🧑 你' : '🤖 Eden'}
          </Text>
        </Text>
        {/* 消息内容 — 换行适配左栏 */}
        <Box paddingLeft={2}>
          <Text wrap="wrap">
            {m.content}
          </Text>
        </Box>
      </Box>
    ))}
    {thinking && (
      <Box marginTop={1} paddingLeft={2}>
        <Text italic dimColor>▊</Text>
      </Box>
    )}
  </Box>
);
