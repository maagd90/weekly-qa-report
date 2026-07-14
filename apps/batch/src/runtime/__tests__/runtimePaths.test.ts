import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureRuntimeDirectories, resolveRuntimePaths } from '../runtimePaths';

function main(): void {
  const fallbackRoot = path.join(os.tmpdir(), 'qa-runtime-fallback');
  const defaults = resolveRuntimePaths({ env: {}, fallbackRoot });
  assert.deepEqual(defaults, {
    rootDir: path.resolve(fallbackRoot),
    inputDir: path.resolve(fallbackRoot, 'input'),
    outputDir: path.resolve(fallbackRoot, 'output'),
    configDir: path.resolve(fallbackRoot, 'config'),
  });

  const environmentRoot = path.join(os.tmpdir(), 'qa-runtime-env');
  const fromEnvironment = resolveRuntimePaths({
    fallbackRoot,
    env: {
      PROJECT_ROOT: environmentRoot,
      INPUT_DIR: path.join(environmentRoot, 'incoming'),
      OUTPUT_DIR: path.join(environmentRoot, 'generated'),
      CONFIG_DIR: path.join(environmentRoot, 'settings'),
    },
  });
  assert.deepEqual(fromEnvironment, {
    rootDir: path.resolve(environmentRoot),
    inputDir: path.resolve(environmentRoot, 'incoming'),
    outputDir: path.resolve(environmentRoot, 'generated'),
    configDir: path.resolve(environmentRoot, 'settings'),
  });

  const explicitRoot = path.join(os.tmpdir(), 'qa-runtime-explicit');
  const explicitInput = path.join(os.tmpdir(), 'qa-runtime-explicit-input');
  const explicit = resolveRuntimePaths({
    rootDir: explicitRoot,
    inputDir: explicitInput,
    env: {
      PROJECT_ROOT: environmentRoot,
      INPUT_DIR: path.join(environmentRoot, 'ignored-input'),
    },
  });
  assert.equal(explicit.rootDir, path.resolve(explicitRoot), 'explicit root must override PROJECT_ROOT');
  assert.equal(explicit.inputDir, path.resolve(explicitInput), 'explicit input must override INPUT_DIR');
  assert.equal(explicit.outputDir, path.resolve(explicitRoot, 'output'), 'unspecified paths derive from the selected root');

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-runtime-directories-'));
  try {
    const directories = resolveRuntimePaths({ env: {}, rootDir: temporaryRoot });
    ensureRuntimeDirectories(directories);
    assert.equal(fs.statSync(directories.inputDir).isDirectory(), true);
    assert.equal(fs.statSync(directories.outputDir).isDirectory(), true);
    assert.equal(fs.statSync(directories.configDir).isDirectory(), true);
    ensureRuntimeDirectories(directories);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  console.log('runtime path tests passed');
}

main();
