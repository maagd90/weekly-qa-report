import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  buildDataset,
  computeFingerprint,
  emptyConnections,
  loadRawDataset,
  mergeDatasets,
  refilterDashboard,
  saveRawDataset,
  stampDatasetWorkspace,
  workspaceIdFromName,
} from 'qa-dashboard-batch';
import type { Dataset } from 'qa-dashboard-batch';

const router = Router();
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../..');
const DATA_ROOT = process.env.DATA_ROOT || (process.env.INPUT_DIR ? path.dirname(process.env.INPUT_DIR) : path.join(ROOT, 'data'));
const LEGACY_INPUT_DIR = process.env.INPUT_DIR || path.join(DATA_ROOT, 'input');
const LEGACY_OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(DATA_ROOT, 'output');
const PROJECT_DATA_DIR = process.env.PROJECT_DATA_DIR || path.join(DATA_ROOT, 'projects');
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(ROOT, 'config');
const IMPORT_CACHE_FILE = 'raw-dataset.imported.json';
const LIVE_CACHE_FILE = 'raw-dataset.live.json';
const PROJECT_META_FILE = 'project.json';
const LEGACY_GENERATED_FILES = [
  'raw-dataset.json',
  'dataset-fingerprint.txt',
  'dashboard-data.json',
  'report.md',
  'report-meta.json',
  IMPORT_CACHE_FILE,
];

interface MovedFile {
  source: string;
  target: string;
  targetName: string;
}

function requestId(req: Request): string {
  return (req as Request & { requestId?: string }).requestId || req.header('x-request-id') || 'no-request-id';
}

function workspaceId(value?: string): string | undefined {
  const id = workspaceIdFromName(value) || (value || '').trim();
  return id && id !== 'all' ? id : undefined;
}

function projectDirs(project: string): { inputDir: string; outputDir: string; rootDir: string } {
  const rootDir = path.join(PROJECT_DATA_DIR, project);
  return { rootDir, inputDir: path.join(rootDir, 'input'), outputDir: path.join(rootDir, 'output') };
}

function totalRows(dataset?: Dataset | null): number {
  if (!dataset) return 0;
  return dataset.executions.length + dataset.issues.length + dataset.uat.length;
}

function listFiles(dir: string): Array<{ name: string; size: number; modifiedAt: string }> {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => {
      const stat = fs.statSync(path.join(dir, entry.name));
      return { name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function uniqueTargetName(inputDir: string, sourceName: string): string {
  if (!fs.existsSync(path.join(inputDir, sourceName))) return sourceName;
  const ext = path.extname(sourceName);
  const base = path.basename(sourceName, ext);
  let index = 1;
  let candidate = `${base}-migrated-${index}${ext}`;
  while (fs.existsSync(path.join(inputDir, candidate))) {
    index += 1;
    candidate = `${base}-migrated-${index}${ext}`;
  }
  return candidate;
}

function moveFile(source: string, target: string): void {
  try {
    fs.renameSync(source, target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') throw err;
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
  }
}

function rollbackMoves(moved: MovedFile[]): void {
  for (const item of [...moved].reverse()) {
    try {
      if (fs.existsSync(item.target) && !fs.existsSync(item.source)) moveFile(item.target, item.source);
    } catch (err) {
      console.error('[api] legacy migration rollback failed', { target: item.target, source: item.source, error: (err as Error).message });
    }
  }
}

function loadDatasetFile(outputDir: string, fileName: string): Dataset | null {
  const filePath = path.join(outputDir, fileName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Dataset;
}

function clearLegacyImportedOutputs(preserveLiveCache: boolean): string[] {
  const removed: string[] = [];
  const names = preserveLiveCache ? LEGACY_GENERATED_FILES : [...LEGACY_GENERATED_FILES, LIVE_CACHE_FILE];
  for (const name of names) {
    const filePath = path.join(LEGACY_OUTPUT_DIR, name);
    if (!fs.existsSync(filePath)) continue;
    fs.unlinkSync(filePath);
    removed.push(name);
  }
  return removed;
}

function restoreLegacyLiveSnapshot(liveDataset: Dataset): void {
  const fingerprint = computeFingerprint(LEGACY_INPUT_DIR, CONFIG_DIR, emptyConnections(), { liveSync: false, includeFiles: true });
  saveRawDataset(LEGACY_OUTPUT_DIR, liveDataset, fingerprint);
  fs.writeFileSync(path.join(LEGACY_OUTPUT_DIR, 'dashboard-data.json'), JSON.stringify(refilterDashboard(liveDataset, {}), null, 2));
}

router.get('/input/legacy-files', (_req: Request, res: Response) => {
  const files = listFiles(LEGACY_INPUT_DIR);
  const legacyDataset = loadRawDataset(LEGACY_OUTPUT_DIR);
  const legacyLive = loadDatasetFile(LEGACY_OUTPUT_DIR, LIVE_CACHE_FILE);
  res.json({
    files,
    count: files.length,
    hasLegacyOutput: Boolean(legacyDataset),
    hasLegacyLiveCache: totalRows(legacyLive) > 0,
    rowCounts: legacyDataset ? {
      executions: legacyDataset.executions.length,
      issues: legacyDataset.issues.length,
      uat: legacyDataset.uat.length,
    } : { executions: 0, issues: 0, uat: 0 },
  });
});

router.post('/input/migrate-legacy', async (req: Request, res: Response) => {
  const project = workspaceId((req.body as { project?: string } | undefined)?.project);
  if (!project) {
    return res.status(400).json({ ok: false, error: 'Select a specific project workspace before migrating legacy files.', requestId: requestId(req) });
  }

  const files = listFiles(LEGACY_INPUT_DIR);
  if (!files.length) {
    return res.json({ ok: true, project, migrated: [], rowCounts: { executions: 0, issues: 0, uat: 0 }, warnings: ['No legacy input files were found.'], requestId: requestId(req) });
  }

  const dirs = projectDirs(project);
  fs.mkdirSync(dirs.inputDir, { recursive: true });
  fs.mkdirSync(dirs.outputDir, { recursive: true });
  fs.writeFileSync(path.join(dirs.rootDir, PROJECT_META_FILE), JSON.stringify({ project, slug: project, migratedAt: new Date().toISOString() }, null, 2));

  const legacyLive = loadDatasetFile(LEGACY_OUTPUT_DIR, LIVE_CACHE_FILE);
  const preserveLegacyLive = totalRows(legacyLive) > 0;
  const moved: MovedFile[] = [];

  try {
    for (const file of files) {
      const source = path.join(LEGACY_INPUT_DIR, file.name);
      const targetName = uniqueTargetName(dirs.inputDir, file.name);
      const target = path.join(dirs.inputDir, targetName);
      moveFile(source, target);
      moved.push({ source, target, targetName });
    }

    const buildOptions = { liveSync: false, includeFiles: true };
    const fingerprint = computeFingerprint(dirs.inputDir, CONFIG_DIR, emptyConnections(), buildOptions);
    const imported = stampDatasetWorkspace(await buildDataset(dirs.inputDir, CONFIG_DIR, emptyConnections(), buildOptions), project);
    if (!totalRows(imported)) throw new Error('Migrated files did not produce any supported QA rows. Files were returned to the legacy folder.');

    fs.writeFileSync(path.join(dirs.outputDir, IMPORT_CACHE_FILE), JSON.stringify(imported, null, 2));
    const workspaceLive = loadDatasetFile(dirs.outputDir, LIVE_CACHE_FILE);
    const merged = workspaceLive ? mergeDatasets([imported, workspaceLive]) : imported;
    saveRawDataset(dirs.outputDir, merged, fingerprint);
    const dashboard = refilterDashboard(merged, { project });
    fs.writeFileSync(path.join(dirs.outputDir, 'dashboard-data.json'), JSON.stringify(dashboard, null, 2));
    for (const reportFile of ['report.md', 'report-meta.json']) {
      const reportPath = path.join(dirs.outputDir, reportFile);
      if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    }

    const removedLegacyOutputs = clearLegacyImportedOutputs(preserveLegacyLive);
    if (legacyLive && preserveLegacyLive) restoreLegacyLiveSnapshot(legacyLive);

    const warnings = [...merged.meta.warnings];
    if (preserveLegacyLive) warnings.push('Legacy live API cache was preserved under All projects and was not assigned automatically to this workspace.');

    return res.json({
      ok: true,
      project,
      migrated: moved.map((item) => item.targetName),
      rowCounts: {
        executions: merged.executions.length,
        issues: merged.issues.length,
        uat: merged.uat.length,
      },
      removedLegacyOutputs,
      preservedLegacyLiveCache: preserveLegacyLive,
      warnings,
      dashboard,
      requestId: requestId(req),
    });
  } catch (err) {
    rollbackMoves(moved);
    return res.status(500).json({
      ok: false,
      error: (err as Error).message,
      migrated: [],
      requestId: requestId(req),
    });
  }
});

export default router;
