import { execSync } from 'child_process';
import { rmSync } from 'fs';

rmSync('dist', { force: true, recursive: true });
execSync('tsc', { stdio: 'inherit' });
console.log('✅ @eden/transport-cli built');
