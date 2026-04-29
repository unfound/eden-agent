import { execSync } from 'child_process';
import { rmSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. 清理
rmSync('dist', { force: true, recursive: true });

// 2. esbuild bundle
execSync(`./node_modules/.bin/esbuild src/index.ts --bundle --platform=node --target=node18 --format=esm --outfile=dist/index.js --external:ws --sourcemap`, { stdio: 'inherit', cwd: __dirname });

// 3. 生成 .d.ts
execSync(`./node_modules/.bin/tsc --emitDeclarationOnly`, {
  stdio: 'inherit',
  cwd: __dirname,
});

console.log('✅ @eden/plugin-debug-panel built');
