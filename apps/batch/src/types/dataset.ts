export type ExecutionResult = 'PASS' | 'FAIL' | 'BLOCKED' | 'NE' | 'NA';
export type IssueType = 'Story' | 'Bug';
export type IssueStatus = 'open' | 'done';
export type DataSource = 'qmetry' | 'jira-api' | 'test-execution-file' | 'jira-file' | 'odl-file';

export interface ExecutionRow {
  project: string;
  cycleKey: string;
  cycleName: string;
  caseKey: string;
  result: ExecutionResult;
  tester: string | null;
  executedAt: string | null;
  updatedAt: string | null;
  source: DataSource;
}

export interface IssueRow {
  project: string;
  key: string;
  area: string;
  issueType: IssueType;
  status: IssueStatus;
  priority: string;
  assignee: string;
  createdAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
  applicationCi?: string;
  source: DataSource;
}

export interface UatRow {
  id: string;
  subject: string;
  area: string;
  cr: string;
  priority: string;
  clientPriority: string;
  submitter: string;
  submittedAt: string | null;
  updatedAt: string;
  status: string;
  open: boolean;
  project: string;
  source: DataSource;
}

export interface FileMeta {
  name: string;
  ext: string;
  project: string;
  rows: number;
  status: 'parsed' | 'staged' | 'error';
  detectedType?: 'test-execution' | 'jira' | 'odl' | 'unknown';
  source: 'file' | 'jira-api' | 'qmetry-api';
}

export interface DatasetMeta {
  parsedAt: string;
  fetchedAt: string | null;
  sourceFiles: string[];
  warnings: string[];
  integrations: { jira: boolean; qmetry: boolean };
}

export interface Dataset {
  executions: ExecutionRow[];
  issues: IssueRow[];
  uat: UatRow[];
  projects: string[];
  files: FileMeta[];
  meta: DatasetMeta;
}

export function emptyDataset(): Dataset {
  return {
    executions: [],
    issues: [],
    uat: [],
    projects: [],
    files: [],
    meta: {
      parsedAt: new Date().toISOString(),
      fetchedAt: null,
      sourceFiles: [],
      warnings: [],
      integrations: { jira: false, qmetry: false },
    },
  };
}

export type ReportType = 'full' | 'executive' | 'testers' | 'cycles';

export interface FilterParams {
  startDate?: string;
  endDate?: string;
  search?: string;
  result?: 'all' | 'PASS' | 'FAIL' | 'BLOCKED';
  project?: string;
}

export interface ApiFetchScope {
  startDate?: string;
  endDate?: string;
  project?: string;
}

export interface GenerateParams extends FilterParams {
  reportType: ReportType;
  inputDir?: string;
  outputDir?: string;
  configDir?: string;
  apiKey?: string;
  llm?: import('../ai/llmProviders').LlmSelectionInput;
  connections?: import('./connections').UserConnections;
}

export function resultColor(code: string): string {
  if (code === 'PASS') return '#2F7D5A';
  if (code === 'FAIL') return '#C24533';
  if (code === 'BLOCKED') return '#B5822F';
  if (code === 'NA') return '#6E7280';
  return '#B3AEA3';
}

export interface DashboardPayload {
  [key: string]: any;
  scope: any;
  overview: any;
  testers: any[];
  cycles: any[];
  cyclesByPassPctAsc: any[];
  storyBug: any;
  traceability: any[];
  workItems?: any[];
  defectBacklog: any;
  uat: any;
  byProject?: any[];
  files: FileMeta[];
  meta: any;
}

export interface GenerateResult {
  ok: boolean;
  filesParsed: number;
  rowCounts: Record<string, number> | Partial<{ executions: number; issues: number; uat: number }>;
  warnings: string[];
  paths: { dashboard: string; report: string; meta: string; raw: string };
  payload?: DashboardPayload;
  report?: { markdown: string; meta: unknown };
  error?: string;
}
