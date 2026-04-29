import React from 'react';
import { Box, Text, useWindowSize } from 'ink';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  messages: ChatMessage[];
  thinking: boolean;
  withDebug: boolean;
  scrollOffset: number;
  onScroll: (offset: number) => void;
}

const HEADER_LINES = 3;   // Header + "输入 /exit 退出" + top border
const FOOTER_LINES = 2;   // InputBar + StatusBar
const PANEL_BORDER = 1;   // right panel border
const MSG_OVERHEAD = 3;   // per message: role line + content top pad + bottom gap

/**
 * Estimate how many terminal lines a message occupies
 * at a given terminal width.
 */
function estimateLines(content: string, termWidth: number): number {
  if (!content) return 0;
  // Each line wraps at (termWidth - indent). Indent accounts for left padding + border.
  const wrapWidth = Math.max(1, termWidth - 6);
  const rawLines = content.split('\n');
  let total = 0;
  for (const rl of rawLines) {
    if (rl.length === 0) {
      total += 1;
    } else {
      total += Math.ceil(rl.length / wrapWidth);
    }
  }
  return total;
}

/**
 * 左栏：聊天记录面板（可滚动）
 */
export const ChatPane: React.FC<Props> = ({
  messages,
  thinking,
  withDebug,
  scrollOffset,
  onScroll,
}) => {
  const { columns, rows } = useWindowSize();

  // Right panel takes 54 cols when debug is on
  const availWidth = columns - (withDebug ? 56 : 2);
  // Available height = terminal rows - header - footer (+ panel border in debug mode)
  const maxMessages = Math.max(1, rows - HEADER_LINES - FOOTER_LINES - (withDebug ? PANEL_BORDER : 0));

  // Build per-message line count to compute which messages fit
  const msgLineCounts = React.useMemo(
    () => messages.map((m) => MSG_OVERHEAD + estimateLines(m.content, availWidth)),
    [messages, availWidth]
  );
  const totalLines = msgLineCounts.reduce((a, b) => a + b, 0) + (thinking ? 2 : 0);

  // Clamp scrollOffset: -1 = auto-follow (show newest)
  const clampedOffset = React.useMemo(() => {
    if (scrollOffset === -1) {
      // Find the last message index that fits from the bottom
      let linesSoFar = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        linesSoFar += msgLineCounts[i];
        if (linesSoFar > maxMessages) return i + 1;
      }
      return 0;
    }
    let linesSoFar = 0;
    for (let i = 0; i < messages.length; i++) {
      linesSoFar += msgLineCounts[i];
      if (linesSoFar > scrollOffset) return Math.max(0, i - 1);
    }
    return Math.max(0, messages.length - 1);
  }, [scrollOffset, messages.length, msgLineCounts, maxMessages]);

  // Build visible slice: messages whose cumulative lines fit in maxMessages
  const visibleSlice = React.useMemo(() => {
    const result: { msg: ChatMessage; index: number }[] = [];
    let consumed = 0;
    for (let i = clampedOffset; i < messages.length; i++) {
      const need = msgLineCounts[i];
      if (consumed + need > maxMessages) break;
      result.push({ msg: messages[i], index: i });
      consumed += need;
    }
    return result;
  }, [clampedOffset, messages, msgLineCounts, maxMessages]);

  const hasAbove = clampedOffset > 0;
  const hasBelow = visibleSlice.length < messages.length - clampedOffset;

  // Indent width accounts for left padding
  const indentPad = 2;

  return (
    <Box flexDirection="column" flexShrink={1} overflowY="hidden">
      {/* Scroll indicator: above */}
      {hasAbove && (
        <Box>
          <Text dimColor>
            ↑{' '}
            <Text dimColor>
              {clampedOffset > 1
                ? `top ${clampedOffset} msgs hidden`
                : '1 msg above'}
            </Text>
          </Text>
        </Box>
      )}

      {/* Visible messages */}
      {visibleSlice.map(({ msg, index }) => (
        <Box key={index} flexDirection="column" marginTop={index > clampedOffset ? 1 : 0}>
          <Text>
            <Text color={msg.role === 'user' ? 'green' : 'brightBlue'} bold>
              {msg.role === 'user' ? '🧑 你' : '🤖 Eden'}
            </Text>
          </Text>
          <Box paddingLeft={indentPad}>
            <Text wrap="wrap">{msg.content}</Text>
          </Box>
        </Box>
      ))}

      {/* Thinking indicator */}
      {thinking && (
        <Box marginTop={1} paddingLeft={indentPad}>
          <Text italic dimColor>▊</Text>
        </Box>
      )}

      {/* Scroll indicator: below */}
      {hasBelow && (
        <Box marginTop={1}>
          <Text dimColor>
            ↓{' '}
            <Text dimColor>
              {messages.length - clampedOffset - visibleSlice.length > 1
                ? `${messages.length - clampedOffset - visibleSlice.length} msgs below`
                : '1 msg below'}
            </Text>
          </Text>
        </Box>
      )}
    </Box>
  );
};
