export type ExecutionResult = 'PASS' | 'FAIL' | 'BLOCKED' | 'NE' | 'NA';
export type IssueType = 'Story' | 'Bug';
export type IssueStatus = 'open' | 'done';
export type DataSource = 'qmetry' | 'jira-api' | 'zephyr' | 'jira-file' | 'odl-file';

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
  createdAt: string;
  resolvedAt: string | null;
  updatedAt: string;
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
  submittedAt: string;
  updatedAt: string;
  status: string;
  open: boolean;
  source: DataSource;
}

export interface FileMeta {
  name: string;
  ext: string;
  project: string;
  rows: number;
  status: 'parsed' | 'staged' | 'error';
  detectedType?: 'zephyr' | 'jira' | 'odl' | 'unknown';
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

export interface GenerateParams extends FilterParams {
  reportType: ReportType;
  inputDir?: string;
  outputDir?: string;
  configDir?: string;
  apiKey?: string;
}

export interface GenerateResult {
  ok: boolean;
  filesParsed: number;
  rowCounts: Record<string, number>;
  warnings: string[];
  paths: { dashboard: string; report: string; meta: string; raw: string };
  payload?: DashboardPayload;
  error?: string;
}

export interface DashboardScope extends FilterParams {
  project: string;
  projects: string[];
}

const RESULT_COLORS: Record<string, string> = {
  PASS: '#22c55e',
  FAIL: '#ef4444',
  BLOCKED: '#f59e0b',
  NE: '#94a3b8',
  NA: '#cbd5e1',
};

export function resultColor(code: string): string {
  return RESULT_COLORS[code] || '#64748b';
}

export interface DashboardPayload {
  scope: DashboardScope;
  overview: {
    totalCases: number;
    executed: number;
    passRate: number;
    failed: number;
    blocked: number;
    resultMix: { code: string; label: string; count: number; pct: number; color: string }[];
    byMonth: { ym: string; label: string; pass: number; blocked: number; fail: number }[];
    chartSeries: {
      resultMix: { name: string; value: number; color: string }[];
    };
  };
  testers: {
    name: string;
    executed: number;
    pass: number;
    fail: number;
    blocked: number;
    na: number;
    passPct: number;
  }[];
  cycles: {
    key: string;
    name: string;
    total: number;
    pass: number;
    fail: number;
    blocked: number;
    ne: number;
    na: number;
    passPct: number;
    coverage: number;
    status: string;
  }[];
  /** Cycles sorted by passPct ascending (at-risk first) — for UI table */
  cyclesByPassPctAsc: {
    key: string;
    name: string;
    total: number;
    pass: number;
    fail: number;
    blocked: number;
    ne: number;
    na: number;
    passPct: number;
    coverage: number;
    status: string;
  }[];
  storyBug: {
    story: number;
    bug: number;
    storyOpen: number;
    storyDone: number;
    bugOpen: number;
    bugDone: number;
  };
  traceability: {
    area: string;
    stories: number;
    done: number;
    open: number;
    bugs: number;
    openBugs: number;
    completion: number;
    status: string;
  }[];
  defectBacklog: {
    openTotal: number;
    byPriority: { priority: string; open: number; total: number }[];
    topPriorities: { priority: string; open: number; total: number }[];
    byOwner: { name: string; open: number }[];
  };
  uat: {
    total: number;
    open: number;
    closed: number;
    closureRate: number;
    urgentOpen: number;
    byStatus: { status: string; count: number }[];
    byPriority: { priority: string; count: number }[];
    byArea: { area: string; count: number }[];
    bySubmitter: { name: string; count: number }[];
    rows: {
      id: string;
      subject: string;
      area: string;
      priority: string;
      status: string;
      submitter: string;
      submittedAt: string;
      updatedAt: string;
      cr: string;
    }[];
  } | null;
  files: FileMeta[];
  meta: {
    generatedAt: string;
    parsedAt: string;
    fetchedAt: string | null;
    warnings: string[];
    dataMin: string | null;
    dataMax: string | null;
  };
}
