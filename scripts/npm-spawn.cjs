const { spawn } = require('child_process');

function normalizeArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || args.some((arg) => typeof arg !== 'string' || !arg.trim())) {
    throw new TypeError('npm arguments must be a non-empty string array');
  }
  return args.map((arg) => arg.trim());
}

function quoteCmdArgument(value) {
  if (/^[A-Za-z0-9_:@./=+,-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function buildNpmSpawnSpec(args, platform = process.platform, env = process.env) {
  const normalized = normalizeArgs(args);
  if (platform === 'win32') {
    // Modern Node releases do not reliably execute npm.cmd directly with spawn().
    // Launch it through the Windows command processor instead. This also works when
    // Node was started from Git Bash, PowerShell, Command Prompt, or an IDE terminal.
    const command = env.ComSpec || env.COMSPEC || 'cmd.exe';
    const commandLine = ['npm', ...normalized].map(quoteCmdArgument).join(' ');
    return { command, args: ['/d', '/s', '/c', commandLine] };
  }
  return { command: 'npm', args: normalized };
}

function spawnNpm(args, options = {}) {
  const spec = buildNpmSpawnSpec(args);
  return spawn(spec.command, spec.args, options);
}

module.exports = {
  buildNpmSpawnSpec,
  spawnNpm,
};
