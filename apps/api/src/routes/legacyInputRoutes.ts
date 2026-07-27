import { Router, Request, Response } from 'express';
import { toErrorMessage } from 'qa-dashboard-batch';
import {
  projectErrorStatus,
  projectImports,
  publishProjectImportOutputs,
  queryString,
  requestId,
  upload,
} from './shared/context';

/**
 * Compatibility endpoints remain project-scoped. They intentionally refuse an
 * unscoped request so older clients cannot list, sync, or delete another
 * project's files by accident.
 */
const router = Router();

router.post('/input/sync', async (req: Request, res: Response) => {
  const projectId = String((req.body as { projectId?: string }).projectId || '');
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId is required.', requestId: requestId(req) });
  try {
    const reconciliation = await projectImports.syncProjectSerialized(projectId, req.header('x-user-name') || 'Local user');
    const published = await publishProjectImportOutputs(req, { project: reconciliation.project.key });
    return res.json({ ok: true, ...published, rowCounts: reconciliation.rowCounts, reconciliation, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  const projectId = String((req.body as { projectId?: string }).projectId || '');
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId is required.', requestId: requestId(req) });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded', requestId: requestId(req) });
  try {
    const file = projectImports.stageFile(projectId, req.file.originalname, req.file.buffer);
    return res.status(201).json({ ok: true, file, message: 'File staged for the selected project.' });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/input/files', (req: Request, res: Response) => {
  const projectId = queryString(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId is required.', requestId: requestId(req) });
  try {
    return res.json(projectImports.listFiles(projectId));
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.delete('/input/:fileId', async (req: Request, res: Response) => {
  const projectId = queryString(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId is required.', requestId: requestId(req) });
  try {
    const removedFile = projectImports.deleteFile(projectId, req.params.fileId);
    const reconciliation = await projectImports.syncProjectSerialized(projectId, req.header('x-user-name') || 'Local user');
    const published = await publishProjectImportOutputs(req, { project: reconciliation.project.key });
    return res.json({ ok: true, removedFile, ...published, rowCounts: reconciliation.rowCounts, reconciliation, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

export default router;
