import './loadRepoEnv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import batchRouter from './routes/batchRoutes';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function nextRequestId(): string {
  return `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  const requestId = req.header('x-request-id') || nextRequestId();
  const startedAt = Date.now();
  res.setHeader('x-request-id', requestId);
  (req as typeof req & { requestId?: string }).requestId = requestId;
  console.log(`[api] [${requestId}] --> ${req.method} ${req.originalUrl}`, {
    contentType: req.header('content-type'),
    hasAnthropicKey: Boolean(req.header('x-anthropic-key')),
    hasUserConnections: Boolean(req.header('x-user-connections')),
  });
  res.on('finish', () => {
    console.log(`[api] [${requestId}] <-- ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`);
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

app.listen(PORT, () => {
  console.log(`[api] Server running on http://localhost:${PORT}`);
  console.log('[api] File-based mode — no database. Drop files in input/, then POST /api/generate');
});
