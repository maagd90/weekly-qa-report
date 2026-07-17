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
  /**
   * True when this row represents one counted execution from QMetry's
   * execution-level summary gadget rather than a testcase/cycle detail row.
   * Summary rows are authoritative for overview/result/tester metrics, but are
   * deliberately excluded from cycle-health breakdowns.
   */
  summaryOnly?: boolean;
  /** Zero-count sentinel used to suppress unsafe detailed fallbacks. */
  summaryMarker?: boolean;
  /** Exact date window used by QMetry when producing a summary-only row. */
  summaryScopeStart?: string;
  summaryScopeEnd?: string;
}

export interface IssueRow {
  project: string;
  key: string;
  /** Complete JIRA issue title used by the sprint traceability tables. */
  summary?: string;
  area: string;
  issueType: IssueType;
  status: IssueStatus;
  priority: string;
  assignee: string;
  createdAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
  /** Optional sprint metadata supplied by JIRA exports or integrations. */
  sprint?: string;
  sprintId?: unknown;
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
  /** Original spreadsheet name, retained so merged Vendor Portal imports remain traceable. */
  sourceFile?: string;
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

export interface DedupeStats { executions: number; issues: number; uat: number }

export interface DatasetMeta {
  parsedAt: string;
  fetchedAt: string | null;
  sourceFiles: string[];
  warnings: string[];
  integrations: { jira: boolean; qmetry: boolean };
  deduped?: DedupeStats;
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
      deduped: { executions: 0, issues: 0, uat: 0 },
    },
  };
}

export type ReportType = 'full' | 'executive' | 'defects' | 'cycles' | 'testers';

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

export interface DashboardResultMixItem { code: string; label: string; count: number; pct: number; color: string }
export interface DashboardMonthItem { ym: string; label: string; pass: number; blocked: number; fail: number }
export interface DashboardTesterItem { name: string; executed: number; pass: number; fail: number; blocked: number; na: number; passPct: number }
export interface DashboardQualityAssuranceSearchItem { tester: string; searchText: string }
export interface DashboardNotExecutedCase { project: string; cycleKey: string; cycleName: string; caseKey: string; updatedAt: string }
export interface DashboardCycleItem { key: string; name: string; total: number; pass: number; fail: number; blocked: number; ne: number; na: number; passPct: number; coverage: number; status: string }
export interface DashboardTraceabilityItem { area: string; stories: number; done: number; open: number; bugs: number; openBugs: number; completion: number; status: string }
export interface DashboardWorkItem { key: string; summary: string; issueType: IssueType; status: IssueStatus; priority: string; assignee: string; sprint: string; sprintId?: unknown; area: string; project: string; updatedAt: string }
export interface DashboardPriorityItem { priority: string; open: number; total: number }
export interface DashboardOwnerItem { name: string; open: number }
export interface DashboardStoryBug { story: number; bug: number; storyOpen: number; storyDone: number; bugOpen: number; bugDone: number }
export interface DashboardDefectBacklog { openTotal: number; byPriority: DashboardPriorityItem[]; topPriorities: DashboardPriorityItem[]; byOwner: DashboardOwnerItem[] }
export interface DashboardOverview {
  totalCases: number;
  executed: number;
  passRate: number;
  failed: number;
  blocked: number;
  resultMix: DashboardResultMixItem[];
  byMonth: DashboardMonthItem[];
  chartSeries: { resultMix: { name: string; value: number; color: string }[] };
}
/** `other-uat` is retained only for dashboards cached before unmatched non-empty subjects became Phase 1 UAT. */
export type VendorPortalPhaseCategory = 'phase1-uat' | 'phase2-uat' | 'other-uat' | 'production' | 'unclassified';
export interface DashboardVendorPortalPhaseItem {
  category: VendorPortalPhaseCategory;
  label: string;
  environment: 'UAT' | 'PROD' | 'Unknown';
  count: number;
  open: number;
  closed: number;
}
export interface DashboardUatRow {
  id: string;
  subject: string;
  area: string;
  priority: string;
  status: string;
  submitter: string;
  submittedAt: string;
  updatedAt: string;
  cr: string;
  /** Optional for compatibility with dashboard JSON generated before phase classification existed. */
  reportedPhase?: VendorPortalPhaseCategory;
  sourceFile?: string;
}
export interface DashboardUatPayload {
  total: number;
  open: number;
  closed: number;
  closureRate: number;
  urgentOpen: number;
  byStatus: { status: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  byArea: { area: string; count: number }[];
  bySubmitter: { name: string; count: number }[];
  rows: DashboardUatRow[];
  /** Optional so older cached dashboard JSON remains safe to render. New payloads always populate it. */
  byReportedPhase?: DashboardVendorPortalPhaseItem[];
  /** ODL-style spreadsheets merged into this Vendor Portal view. */
  sourceFiles?: { name: string; rows: number }[];
}
export interface DashboardByProject {
  project: string;
  overview: DashboardOverview;
  storyBug: DashboardStoryBug;
  defectBacklog: DashboardDefectBacklog;
  cycles: DashboardCycleItem[];
  testers: DashboardTesterItem[];
  uat: DashboardUatPayload | null;
}

export interface DashboardPayload {
  scope: { startDate?: string; endDate?: string; search: string; result: string; project: string; projects: string[] };
  overview: DashboardOverview;
  testers: DashboardTesterItem[];
  /** Optional runtime-search metadata. Kept separate from tester metrics so AI/report tools do not receive a large search-only field. */
  qualityAssuranceSearch?: DashboardQualityAssuranceSearchItem[];
  /** Identifiable QMetry detail rows behind the Not Executed count; optional for older cached dashboards. */
  notExecutedCases?: DashboardNotExecutedCase[];
  cycles: DashboardCycleItem[];
  cyclesByPassPctAsc: DashboardCycleItem[];
  storyBug: DashboardStoryBug;
  traceability: DashboardTraceabilityItem[];
  workItems?: DashboardWorkItem[];
  defectBacklog: DashboardDefectBacklog;
  uat: DashboardUatPayload | null;
  byProject?: DashboardByProject[];
  files: FileMeta[];
  meta: { generatedAt: string; parsedAt: string; fetchedAt: string | null; warnings: string[]; dataMin?: string | null; dataMax?: string | null; deduped?: DedupeStats };
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
