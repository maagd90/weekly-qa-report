import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import type { Dataset } from 'qa-dashboard-batch';
import { canonicalProjectKey } from 'qa-dashboard-batch';

const router = Router();
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../..');
const INPUT_DIR = process.env.INPUT_DIR || path.join(ROOT, 'input');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(ROOT, 'output');
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(ROOT, 'config');
const PROJECTS_FILE = path.join(CONFIG_DIR, 'projects.json');
const ASSIGNMENTS_FILE = path.join(INPUT_DIR, '.project-assignments.json');
const IMPORT_CACHE_FILE = path.join(OUTPUT_DIR, 'raw-dataset.imported.json');

interface ProjectDefinition {
  key: string;
  name: string;
  active: boolean;
  createdAt: string;
}

interface ProjectBreakdown {
  project: string;
  executions: number;
  issues: number;
  bugs: number;
  stories: number;
  vendorBugs: number;
}

interface ImportAssignment {
  project: string;
  assignedAt: string;
  originalName?: string;
}

type ImportAssignments = Record<string, ImportAssignment>;

fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(CONFIG_DIR, { recursive: true });

const DEFAULT_PROJECTS: ProjectDefinition[] = [
  { key: 'DLM', name: 'DN4_FT - Supply & DMC', active: true, createdAt: new Date(0).toISOString() },
  { key: 'DP', name: 'WonderMiles', active: true, createdAt: new Date(0).toISOString() },
];

function requestId(req: Request): string {
  return (req as Request & { requestId?: string }).requestId || req.header('x-request-id') || 'no-request-id';
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, filePath);
}

function loadProjects(): ProjectDefinition[] {
  const configured = readJson<ProjectDefinition[]>(PROJECTS_FILE, []);
  const merged = new Map<string, ProjectDefinition>();
  for (const project of [...DEFAULT_PROJECTS, ...configured]) {
    const key = canonicalProjectKey(project.key);
    if (!key || key === 'all') continue;
    merged.set(key, { ...project, key, name: project.name?.trim() || key, active: project.active !== false });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function saveProjects(projects: ProjectDefinition[]): void {
  writeJson(PROJECTS_FILE, projects);
}

function loadAssignments(): ImportAssignments {
  return readJson<ImportAssignments>(ASSIGNMENTS_FILE, {});
}

function saveAssignments(assignments: ImportAssignments): void {
  writeJson(ASSIGNMENTS_FILE, assignments);
}

function projectExists(projectKey: string): boolean {
  const key = canonicalProjectKey(projectKey);
  return loadProjects().some((project) => project.key === key && project.active !== false);
}

function projectBreakdown(dataset: Dataset | null): ProjectBreakdown[] {
  if (!dataset) return [];
  const map = new Map<string, ProjectBreakdown>();
  const get = (rawProject: string): ProjectBreakdown => {
    const project = canonicalProjectKey(rawProject) || 'UNKNOWN';
    let row = map.get(project);
    if (!row) {
      row = { project, executions: 0, issues: 0, bugs: 0, stories: 0, vendorBugs: 0 };
      map.set(project, row);
    }
    return row;
  };

  for (const execution of dataset.executions) get(execution.project).executions += 1;
  for (const issue of dataset.issues) {
    const row = get(issue.project);
    row.issues += 1;
    if (issue.issueType === 'Bug') row.bugs += 1;
    if (issue.issueType === 'Story') row.stories += 1;
  }
  for (const uat of dataset.uat) get(uat.project).vendorBugs += 1;

  return [...map.values()].sort((a, b) => a.project.localeCompare(b.project));
}

function importedDataset(): Dataset | null {
  return readJson<Dataset | null>(IMPORT_CACHE_FILE, null);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, INPUT_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${path.basename(file.originalname).replace(/[/\\]/g, '_')}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') cb(null, true);
    else cb(new Error('Only .xlsx and .xls files are allowed'));
  },
});

router.get('/projects', (_req: Request, res: Response) => {
  res.json(loadProjects());
});

router.post('/projects', (req: Request, res: Response) => {
  const rawKey = typeof req.body?.key === 'string' ? req.body.key : '';
  const rawName = typeof req.body?.name === 'string' ? req.body.name : '';
  const key = canonicalProjectKey(rawKey);
  const name = rawName.trim();

  if (!key || key === 'all') return res.status(400).json({ ok: false, error: 'A valid project key is required.', requestId: requestId(req) });
  if (!name) return res.status(400).json({ ok: false, error: 'Project name is required.', requestId: requestId(req) });

  const projects = loadProjects();
  if (projects.some((project) => project.key === key)) {
    return res.status(409).json({ ok: false, error: `Project ${key} already exists.`, requestId: requestId(req) });
  }

  const project: ProjectDefinition = { key, name, active: true, createdAt: new Date().toISOString() };
  saveProjects([...projects, project]);
  return res.status(201).json({ ok: true, project });
});

router.post('/project-upload', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded.', requestId: requestId(req) });

  const project = canonicalProjectKey(typeof req.body?.project === 'string' ? req.body.project : '');
  if (!project || project === 'all' || !projectExists(project)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ ok: false, error: 'Select a valid project before uploading the file.', requestId: requestId(req) });
  }

  const assignments = loadAssignments();
  assignments[req.file.filename] = {
    project,
    assignedAt: new Date().toISOString(),
    originalName: req.file.originalname,
  };
  saveAssignments(assignments);

  return res.json({
    ok: true,
    filename: req.file.filename,
    project,
    message: `File staged against project ${project}. Click Sync imported data to update dashboard data.`,
  });
});

router.get('/project-import/files', (_req: Request, res: Response) => {
  if (!fs.existsSync(INPUT_DIR)) return res.json([]);
  const assignments = loadAssignments();
  const files = fs.readdirSync(INPUT_DIR)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => fs.statSync(path.join(INPUT_DIR, name)).isFile())
    .map((name) => {
      const stat = fs.statSync(path.join(INPUT_DIR, name));
      const assignment = assignments[name];
      return {
        name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        project: assignment?.project || '',
        originalName: assignment?.originalName || name,
        assignedAt: assignment?.assignedAt,
      };
    });
  res.json(files);
});

router.get('/project-import/summary', (_req: Request, res: Response) => {
  const dataset = importedDataset();
  const assignments = loadAssignments();
  const projects = loadProjects();
  const breakdown = projectBreakdown(dataset);
  const projectNames = Object.fromEntries(projects.map((project) => [project.key, project.name]));

  const files = (dataset?.files || []).map((file) => ({
    ...file,
    assignedProject: assignments[file.name]?.project || file.project,
    projectName: projectNames[canonicalProjectKey(assignments[file.name]?.project || file.project)] || canonicalProjectKey(assignments[file.name]?.project || file.project),
  }));

  res.json({
    ok: true,
    rowCounts: {
      executions: dataset?.executions.length || 0,
      issues: dataset?.issues.length || 0,
      uat: dataset?.uat.length || 0,
    },
    projectBreakdown: breakdown.map((row) => ({ ...row, projectName: projectNames[row.project] || row.project })),
    files,
    warnings: dataset?.meta.warnings || [],
    parsedAt: dataset?.meta.parsedAt,
  });
});

export default router;
