import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['--loader', 'ts-node/esm', 'src/main.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    TS_NODE_PREFER_TS_EXTS: 'true',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});