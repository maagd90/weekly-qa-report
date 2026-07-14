const assert = require('assert');
const { buildNpmSpawnSpec, spawnNpm } = require('../npm-spawn.cjs');
const rootPackage = require('../../package.json');

function runNpmVersionSmokeTest() {
  return new Promise((resolve, reject) => {
    const child = spawnNpm(['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('npm --version smoke test timed out'));
    }, 20_000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`npm --version failed with code=${code} signal=${signal || 'none'} stderr=${stderr.trim()}`));
        return;
      }
      assert.match(stdout.trim(), /^\d+\.\d+\.\d+(?:[-+].+)?$/, `unexpected npm version output: ${stdout}`);
      resolve();
    });
  });
}

async function main() {
  assert.match(
    rootPackage.scripts['dev:servers'],
    /^npm run build --workspace=apps\/batch && /,
    'development startup must compile the batch workspace before the API imports its dist output',
  );

  const windows = buildNpmSpawnSpec(['run', 'dev'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });
  assert.equal(windows.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(windows.args, ['/d', '/s', '/c', 'npm run dev']);

  const windowsFallback = buildNpmSpawnSpec(['--version'], 'win32', {});
  assert.equal(windowsFallback.command, 'cmd.exe');
  assert.deepEqual(windowsFallback.args, ['/d', '/s', '/c', 'npm --version']);

  const unix = buildNpmSpawnSpec(['run', 'dev'], 'linux', {});
  assert.equal(unix.command, 'npm');
  assert.deepEqual(unix.args, ['run', 'dev']);

  assert.throws(() => buildNpmSpawnSpec([], 'linux', {}), /non-empty string array/);
  assert.throws(() => buildNpmSpawnSpec(['run', ''], 'linux', {}), /non-empty string array/);

  await runNpmVersionSmokeTest();
  console.log(`npm spawn tests passed on ${process.platform}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
