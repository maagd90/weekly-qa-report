const { spawn } = require('node:child_process');

const viteBin = require.resolve('vite/bin/vite.js');
const child = spawn(
  process.execPath,
  ['--max-http-header-size=65536', viteBin, ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error('[web] failed to start Vite with larger HTTP header limit:', err.message);
  process.exit(1);
});
