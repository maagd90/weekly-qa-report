import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { toErrorMessage } from '../errors';
import { safeApiError } from '../fetchWithTimeout';
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

    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      const gatewayBody = JSON.stringify({
        error: {
          message: "Model 'bedrock-claude-sonnet-4-5' is not allowed. Allowed models: ['claude-sonnet-5', 'claude-haiku-4-5-20251001']",
          type: 'permission_error',
        },
      });
      const nested = safeApiError('Custom LLM', 403, gatewayBody);
      assert.match(nested, /^Custom LLM error 403: Model 'bedrock-claude-sonnet-4-5' is not allowed/);
      assert.match(nested, /claude-haiku-4-5-20251001/, 'the actionable allowed-model list must survive parsing');

      assert.equal(
        safeApiError('JIRA API', 400, JSON.stringify({ errorMessage: 'Invalid JQL' })),
        'JIRA API error 400: Invalid JQL',
        'existing flat provider errors must remain supported',
      );
      assert.doesNotThrow(
        () => safeApiError('Future API', 500, JSON.stringify({ message: { unexpected: true } })),
        'non-string provider fields must never reach String.prototype.slice',
      );
    } finally {
      console.error = originalConsoleError;
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  console.log('foundation utility tests passed');
}

main();
