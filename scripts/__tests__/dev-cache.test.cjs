const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GENERATED_DEV_CACHE_FILES, clearGeneratedDevCache } = require('../dev-cache.cjs');

function write(dir, name, content = name) {
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-dashboard-dev-cache-'));
  try {
    for (const name of GENERATED_DEV_CACHE_FILES) write(root, name);
    write(root, 'report.md', 'keep report');
    write(root, 'raw-dataset.import.json', 'keep imported cache');
    write(root, 'custom-output.json', 'keep custom output');

    const cleared = clearGeneratedDevCache(root);
    assert.deepStrictEqual([...cleared.deleted].sort(), [...GENERATED_DEV_CACHE_FILES].sort());
    for (const name of GENERATED_DEV_CACHE_FILES) {
      assert.strictEqual(fs.existsSync(path.join(root, name)), false, `${name} should be deleted`);
    }
    assert.strictEqual(fs.readFileSync(path.join(root, 'report.md'), 'utf8'), 'keep report');
    assert.strictEqual(fs.readFileSync(path.join(root, 'raw-dataset.import.json'), 'utf8'), 'keep imported cache');
    assert.strictEqual(fs.readFileSync(path.join(root, 'custom-output.json'), 'utf8'), 'keep custom output');

    for (const name of GENERATED_DEV_CACHE_FILES) write(root, name, 'preserve');
    const preserved = clearGeneratedDevCache(root, { preserve: true });
    assert.strictEqual(preserved.preserved, true);
    assert.deepStrictEqual(preserved.deleted, []);
    for (const name of GENERATED_DEV_CACHE_FILES) {
      assert.strictEqual(fs.readFileSync(path.join(root, name), 'utf8'), 'preserve');
    }

    console.log('dev cache cleanup tests passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
