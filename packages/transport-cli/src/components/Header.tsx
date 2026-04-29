import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  profileName: string;
  modelName: string;
  withDebug: boolean;
  connected: boolean;
  debugPort: number;
}

export const Header: React.FC<Props> = ({ profileName, modelName, withDebug, connected, debugPort }) => (
  <Box>
    <Text bold color="cyan">
      eden
    </Text>
    <Text>
      {' '}· {profileName} · {modelName}
      {withDebug && (
        <Text>
          {' '}· ws <Text color={connected ? 'green' : 'red'}>{connected ? '✓' : '✗'}</Text> :{debugPort}
        </Text>
      )}
    </Text>
  </Box>
);
