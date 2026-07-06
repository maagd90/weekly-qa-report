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
