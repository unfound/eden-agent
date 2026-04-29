import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  input: string;
}

/**
 * 底部固定输入栏（纯展示，键盘由 App 层 useInput 处理）
 */
export const InputBar: React.FC<Props> = ({ input }) => (
  <Box marginTop={1}>
    <Text color="green">{'🧑 你> '}</Text>
    <Text>{input || ''}_</Text>
  </Box>
);
