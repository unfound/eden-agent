import { execSync } from 'child_process';
import { rmSync } from 'fs';
rmSync('dist', { force: true, recursive: true });
execSync('./node_modules/.bin/tsc', { stdio: 'inherit' });
console.log('✅ @eden/plugin-memory-file built');
