import { spawn } from 'node:child_process';

console.log('🚀 Iniciando Vectorito en modo desarrollo (Bot + Web)...');

// 1. Iniciar el servidor web (Vite)
const webProcess = spawn('npm', ['run', 'dev', '--prefix', 'web'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

// 2. Iniciar el bot de WhatsApp
const botProcess = spawn('npx', ['tsx', 'src/main.ts'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

// Manejo de cierres y limpieza de procesos huérfanos
function killAll() {
  try {
    webProcess.kill();
  } catch {}
  try {
    botProcess.kill();
  } catch {}
}

process.on('SIGINT', () => {
  killAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  killAll();
  process.exit(0);
});

botProcess.on('exit', (code, signal) => {
  killAll();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

webProcess.on('exit', (code) => {
  // Si la web se cae, también cerramos el bot para alertar al usuario
  killAll();
  process.exit(code ?? 0);
});

botProcess.on('error', (error) => {
  console.error('[Bot Error]', error);
  killAll();
  process.exit(1);
});

webProcess.on('error', (error) => {
  console.error('[Web Error]', error);
  killAll();
  process.exit(1);
});