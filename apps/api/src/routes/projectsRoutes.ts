import { Router, Request, Response } from 'express';
import path from 'path';
import { refilterDashboard, toErrorMessage } from 'qa-dashboard-batch';
import type { FilterParams, UserConnections } from 'qa-dashboard-batch';
import {
  planConnectionProjectMigration,
  ProjectConnectionValidationError,
} from '../services/projectConnections';
import {
  filterFromBody,
  log,
  logError,
  parseFilterParams,
  projectErrorStatus,
  projectImports,
  publishProjectImportOutputs,
  requestId,
  seedProjectRegistry,
  upload,
} from './shared/context';

const router = Router();

router.get('/projects', (_req: Request, res: Response) => {
  const projects = seedProjectRegistry().map((project) => ({
    ...project,
    fileCount: projectImports.listFiles(project.id).length,
  }));
  res.json(projects);
});

router.post('/projects', (req: Request, res: Response) => {
  try {
    const project = projectImports.createProject(req.body as {
      key?: string;
      sourceKeys?: string[];
      name?: string;
      capabilities?: { vendorPortal?: boolean; wonderMilesExport?: boolean };
      dedicatedTab?: { enabled: boolean; label?: string };
    });
    return res.status(201).json({ ok: true, project, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.post('/projects/migrate-connections', (req: Request, res: Response) => {
  try {
    if (projectImports.listProjects().length) {
      return res.status(409).json({ ok: false, error: 'Connection migration is available only while the project registry is empty.', requestId: requestId(req) });
    }
    const body = req.body as Partial<UserConnections>;
    const connections: UserConnections = {
      jira: Array.isArray(body.jira) ? body.jira : [],
      qmetry: Array.isArray(body.qmetry) ? body.qmetry : [],
    };
    const plan = planConnectionProjectMigration(connections);
    if (!plan.length) {
      return res.status(400).json({ ok: false, error: 'No saved connection contains an explicit workspace or source project key to migrate.', requestId: requestId(req) });
    }
    for (const candidate of plan) {
      if (candidate.name.length < 2 || candidate.name.length > 100 || candidate.sourceKeys.some((key) => !/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(key))) {
        throw new ProjectConnectionValidationError(`Project ${candidate.key} contains an invalid ownership key. Use 2-32 letters, numbers, underscores, or hyphens.`);
      }
    }
    const migrated = plan.map((candidate) => ({
      candidate,
      project: projectImports.createProject({ key: candidate.key, sourceKeys: candidate.sourceKeys, name: candidate.name }),
    }));
    return res.status(201).json({
      ok: true,
      projects: migrated.map(({ project }) => project),
      assignments: migrated.flatMap(({ candidate, project }) => [
        ...(candidate.jiraConnectionId ? [{ type: 'jira' as const, connectionId: candidate.jiraConnectionId, projectId: project.id, projectKey: project.key }] : []),
        ...(candidate.qmetryConnectionId ? [{ type: 'qmetry' as const, connectionId: candidate.qmetryConnectionId, projectId: project.id, projectKey: project.key }] : []),
      ]),
      requestId: requestId(req),
    });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.patch('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const project = projectImports.updateProject(req.params.projectId, req.body as {
      key?: string;
      sourceKeys?: string[];
      name?: string;
      capabilities?: { vendorPortal?: boolean; wonderMilesExport?: boolean };
      dedicatedTab?: { enabled: boolean; label?: string };
    });
    const published = await publishProjectImportOutputs(req);
    return res.json({ ok: true, project, ...published, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.delete('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const confirmationKey = String((req.body as { confirmationKey?: string } | undefined)?.confirmationKey || '');
    const deletion = projectImports.deleteProject(req.params.projectId, confirmationKey);
    const published = await publishProjectImportOutputs(req);
    log(req, 'project deleted', { projectId: deletion.project.id, projectKey: deletion.project.key, filesDeleted: deletion.filesDeleted, syncReportsDeleted: deletion.syncReportsDeleted });
    return res.json({ ok: true, deletion, ...published, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/projects/:projectId/files', (req: Request, res: Response) => {
  try {
    return res.json(projectImports.listFiles(req.params.projectId));
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.post('/projects/:projectId/files', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded', requestId: requestId(req) });
  try {
    const file = projectImports.stageFile(req.params.projectId, req.file.originalname, req.file.buffer);
    log(req, 'project file staged', { projectId: req.params.projectId, fileId: file.id, filename: file.originalName, size: file.size });
    const message = file.mappingStatus === 'required'
      ? 'File staged. Map its columns to the project tab before publishing.'
      : file.mappingStatus === 'mapped'
        ? 'File staged and matched to the saved project mapping.'
        : 'File uploaded for the selected project. The Import Data workflow will automatically synchronize it.';
    return res.status(201).json({ ok: true, file, message });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/projects/:projectId/files/:fileId/inspect', (req: Request, res: Response) => {
  try {
    return res.json(projectImports.inspectFile(req.params.projectId, req.params.fileId));
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.put('/projects/:projectId/files/:fileId/mapping', (req: Request, res: Response) => {
  try {
    const saved = projectImports.saveFileMapping(req.params.projectId, req.params.fileId, req.body as {
      tabId?: string;
      columns?: Array<{
        fieldKey: string;
        sourceHeader: string;
        label: string;
        type: 'text' | 'number' | 'date' | 'boolean';
        visible: boolean;
        filterable: boolean;
        searchable: boolean;
        required?: boolean;
      }>;
      uniqueKey?: string;
    });
    return res.json({
      ok: true,
      ...saved,
      message: 'Column mapping saved. Review it, then use Import Data to publish the staged rows.',
      requestId: requestId(req),
    });
  } catch (err) {
    logError(req, 'project file mapping save failed', err, { projectId: req.params.projectId, fileId: req.params.fileId });
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/projects/:projectId/tabs/:tabId/data', (req: Request, res: Response) => {
  try {
    return res.json(projectImports.getTabData(req.params.projectId, req.params.tabId));
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.post('/projects/:projectId/imports/sync', async (req: Request, res: Response) => {
  const filter = filterFromBody(req.body as Partial<FilterParams>);
  try {
    const reconciliation = await projectImports.syncProjectSerialized(req.params.projectId, req.header('x-user-name') || 'Local user');
    const published = await publishProjectImportOutputs(req, { ...filter, project: reconciliation.project.key });
    return res.json({
      ok: true,
      ...published,
      rowCounts: reconciliation.rowCounts,
      reconciliation,
      requestId: requestId(req),
    });
  } catch (err) {
    logError(req, 'project import sync failed', err, { projectId: req.params.projectId });
    return res.status(projectErrorStatus(err) === 404 ? 404 : 500).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.delete('/projects/:projectId/files/:fileId', async (req: Request, res: Response) => {
  try {
    const removedFile = projectImports.deleteFile(req.params.projectId, req.params.fileId);
    const reconciliation = await projectImports.syncProjectSerialized(req.params.projectId, req.header('x-user-name') || 'Local user');
    const published = await publishProjectImportOutputs(req, { project: reconciliation.project.key });
    return res.json({ ok: true, removedFile, ...published, rowCounts: reconciliation.rowCounts, reconciliation, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/projects/:projectId/imports/issues/dashboard', (req: Request, res: Response) => {
  try {
    const project = projectImports.getProject(req.params.projectId);
    const dataset = projectImports.uploadedIssueDataset(project.id);
    const filter = { ...parseFilterParams(req), project: project.key };
    return res.json(refilterDashboard(dataset, filter));
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/projects/:projectId/imports/:syncId', (req: Request, res: Response) => {
  try {
    return res.json(projectImports.getSyncReport(req.params.projectId, req.params.syncId));
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/projects/:projectId/imports/:syncId/report.csv', (req: Request, res: Response) => {
  try {
    const csv = projectImports.reconciliationCsv(req.params.projectId, req.params.syncId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import-reconciliation-${path.basename(req.params.syncId)}.csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

export default router;
