import { Router } from 'express';
import path from 'path';
import { getLastImportResult, runImport } from '../watchers/fileWatcher';

const router = Router();

router.get('/status', (_req, res) => {
  const result = getLastImportResult();
  if (!result) return res.json({ status: 'no_import_yet' });
  res.json(result);
});

router.post('/refresh', (_req, res) => {
  const filePath = process.env.EXCEL_SOURCE_PATH;
  if (!filePath) return res.status(400).json({ error: 'EXCEL_SOURCE_PATH not configured' });
  runImport(path.resolve(filePath));
  res.json({ status: 'triggered', message: 'Import started' });
});

export default router;
