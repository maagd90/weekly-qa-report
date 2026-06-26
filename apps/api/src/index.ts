import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';

import metaRouter     from './routes/meta';
import resourcesRouter from './routes/resources';
import projectsRouter  from './routes/projects';
import importRouter    from './routes/importRoute';
import uploadRouter    from './routes/upload';
import settingsRouter  from './routes/settings';
import aiRouter        from './routes/ai';
import { startWatcher } from './watchers/fileWatcher';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/meta',      metaRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/projects',  projectsRouter);
app.use('/api/import',    importRouter);
app.use('/api/upload',    uploadRouter);
app.use('/api/settings',  settingsRouter);
app.use('/api/ai',        aiRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[api] Server running on http://localhost:${PORT}`);

  const excelPath = process.env.EXCEL_SOURCE_PATH;
  if (excelPath) {
    startWatcher(path.resolve(excelPath));
  } else {
    console.log('[api] EXCEL_SOURCE_PATH not set — use the Upload tab to import data.');
  }
});
