import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { toErrorMessage } from '../errors';
import { readJsonFile, writeJsonFile } from '../jsonFile';

function main(): void {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-foundation-utils-'));
  const validPath = path.join(temporaryRoot, 'valid.json');
  const malformedPath = path.join(temporaryRoot, 'malformed.json');

  try {
    const expected = { project: 'DLM', count: 202 };
    writeJsonFile(validPath, expected);
    assert.deepEqual(readJsonFile<typeof expected>(validPath), expected);
    assert.match(fs.readFileSync(validPath, 'utf8'), /\n  "project": "DLM"/, 'JSON should remain human-readable');

    fs.writeFileSync(malformedPath, '{not-json');
    assert.equal(readJsonFile(malformedPath), null, 'malformed optional caches must be recoverable');
    assert.equal(readJsonFile(path.join(temporaryRoot, 'missing.json')), null, 'missing optional caches must be recoverable');

    assert.equal(toErrorMessage(new Error('network unavailable')), 'network unavailable');
    assert.equal(toErrorMessage('plain failure'), 'plain failure');
    assert.equal(toErrorMessage(null), 'Unknown error');
    assert.equal(toErrorMessage(new Error(''), 'Fallback failure'), 'Fallback failure');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  console.log('foundation utility tests passed');
}

main();
