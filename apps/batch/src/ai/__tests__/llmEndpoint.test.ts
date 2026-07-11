import assert from 'assert';
import http from 'http';
import os from 'os';
import path from 'path';
import { generateLlmText } from '../llmProviders';
import { testLlmConnection } from '../testConnection';

interface CapturedRequest {
  url: string;
  method: string;
  apiKey: string;
  body: any;
}

async function startMockAnthropic(): Promise<{ baseUrl: string; requests: CapturedRequest[]; close: () => Promise<void> }> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : {};
      requests.push({
        url: req.url || '',
        method: req.method || '',
        apiKey: String(req.headers['x-api-key'] || ''),
        body,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: body.model || 'custom-claude',
        content: [{ type: 'text', text: 'OK' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function main(): Promise<void> {
  const mock = await startMockAnthropic();
  try {
    const text = await generateLlmText({
      provider: 'anthropic',
      model: 'custom-claude-model',
      apiKey: 'test-anthropic-key',
      baseUrl: `${mock.baseUrl}/v1/messages`,
      maxTokens: 8,
      system: 'Reply with OK only.',
      prompt: 'ping',
      timeoutMs: 5_000,
    });
    assert.strictEqual(text, 'OK');
    assert.strictEqual(mock.requests[0].url, '/v1/messages');
    assert.strictEqual(mock.requests[0].method, 'POST');
    assert.strictEqual(mock.requests[0].apiKey, 'test-anthropic-key');
    assert.strictEqual(mock.requests[0].body.model, 'custom-claude-model');
    console.log('✓ custom Anthropic base URL uses native /v1/messages contract');

    const result = await testLlmConnection({
      provider: 'anthropic',
      model: 'custom-claude-model',
      apiKey: 'test-anthropic-key',
      baseUrl: mock.baseUrl,
    }, path.join(os.tmpdir(), 'qa-dashboard-missing-config'));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.provider, 'anthropic');
    assert.strictEqual(result.model, 'custom-claude-model');
    assert.strictEqual(mock.requests[1].url, '/v1/messages');
    console.log('✓ Save & Test LLM flow supports a custom Anthropic endpoint');
  } finally {
    await mock.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
