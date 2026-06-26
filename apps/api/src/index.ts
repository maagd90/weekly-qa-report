import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import batchRouter from './routes/batchRoutes';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.use('/api', batchRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[api] Server running on http://localhost:${PORT}`);
  console.log('[api] File-based mode — no database. Drop files in input/, then POST /api/generate');
});
