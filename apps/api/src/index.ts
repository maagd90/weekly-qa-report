import './loadRepoEnv';
import express from 'express';
import cors from 'cors';
import util from 'util';
import http from 'http';
import batchRouter from './routes/batchRoutes';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const MAX_HEADER_SIZE = Number(process.env.HTTP_MAX_HEADER_SIZE || 65_536);
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function nextRequestId(): string {
  return `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('authorization') || lower.includes('cookie') || lower.includes('token') || lower.includes('secret') || lower.includes('password') || lower.includes('credential') || lower.includes('session') || lower.includes('xsrf') || lower.includes('key');
}

function redact(value: unknown, key = ''): unknown {
  if (isSensitiveKey(key)) return value ? '***redacted***' : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redact(v, k);
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}...<truncated>`;
  return value;
}

function inspectPayload(payload: Record<string, unknown>): string {
  return util.inspect(redact(payload), { depth: 8, colors: false, breakLength: 140, maxArrayLength: 20, maxStringLength: 1200 });
}

app.set('etag', false);
app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use((req, res, next) => {
  const requestId = req.header('x-request-id') || nextRequestId();
  const startedAt = Date.now();
  res.setHeader('x-request-id', requestId);
  (req as typeof req & { requestId?: string }).requestId = requestId;
  const requestPayload = {
    contentType: req.header('content-type'),
    origin: req.header('origin'),
    referer: req.header('referer'),
    userAgent: req.header('user-agent'),
    hasAnthropicKey: Boolean(req.header('x-anthropic-key')),
    hasUserConnections: Boolean(req.header('x-user-connections')),
    query: req.query,
    body: req.method === 'GET' ? undefined : req.body,
  };
  console.log(`[api] [${requestId}] --> ${req.method} ${req.originalUrl} ${inspectPayload(requestPayload)}`);
  res.on('finish', () => {
    console.log(`[api] [${requestId}] <-- ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms ${inspectPayload({ responseHeaders: { contentType: res.getHeader('content-type'), cacheControl: res.getHeader('cache-control') } })}`);
  });
  next();
});

app.use('/api', batchRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = (req as typeof req & { requestId?: string }).requestId || 'unknown';
  console.error(`[api] [${requestId}] unhandled error`, err.stack || err.message);
  res.status(500).json({ error: err.message || 'Unexpected server error', requestId });
});

http.createServer({ maxHeaderSize: MAX_HEADER_SIZE }, app).listen(PORT, () => {
  console.log(`[api] Server running on http://localhost:${PORT}`);
  console.log(`[api] Max HTTP header size: ${MAX_HEADER_SIZE} bytes`);
  console.log('[api] File-based mode — no database. Drop files in input/, then POST /api/generate');
  console.log(`[api] CORS origins: ${corsOrigins.join(', ')}`);
  console.log(`[api] Integration debug logging: ${process.env.INTEGRATION_DEBUG === 'false' || process.env.API_DEBUG === 'false' ? 'disabled' : 'enabled'}`);
});
