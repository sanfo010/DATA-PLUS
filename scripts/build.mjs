import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS ?? '1',
};

const commands = [
  ['TypeScript', resolve(projectRoot, 'node_modules/typescript/lib/tsc.js')],
  ['Backend TypeScript', resolve(projectRoot, 'node_modules/typescript/lib/tsc.js'), '--project', 'tsconfig.server.json'],
  ['Vite', resolve(projectRoot, 'node_modules/vite/bin/vite.js'), 'build'],
];

for (const [name, executable, ...args] of commands) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(`Could not start ${name}: ${result.error.message}`, {
      cause: result.error,
    });
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
