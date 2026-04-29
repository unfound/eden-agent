import { execSync } from 'child_process';

execSync('tsc --watch', { stdio: 'inherit' });
