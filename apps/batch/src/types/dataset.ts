export interface Resource {
  resource_id: string;
  resource_name: string;
  team: string;
  role: string;
  active: string;
}

export interface Project {
  project_id: string;
  project_name: string;
  project_manager: string;
  start_date: string;
  target_end_date: string;
  overall_status: string;
  active: string;
}

export interface CR {
  cr_id: string;
  project_id: string;
  cr_title: string;
  priority: string;
  status: string;
  owner: string;
}

export interface WeeklyLogRow {
  year: number;
  week_number: number;
  week_start: string;
  week_end: string;
  resource_id: string;
  cr_id: string;
  tc_planned: number;
  tc_executed: number;
  tc_passed: number;
  tc_failed: number;
  bugs_reported: number;
  bugs_closed: number;
  hours_spent: number;
  notes: string;
}

export interface ProjectStatusRow {
  year: number;
  week_number: number;
  project_id: string;
  status: string;
  percent_complete: number;
  tests_executed: number;
  bugs_open: number;
  bugs_reported: number;
  bugs_closed: number;
  resources_assigned: number;
  key_accomplishments: string;
  risks: string;
  blockers: string;
  next_week_plan: string;
  reported_by: string;
}

export interface DatasetMeta {
  parsedAt: string;
  sourceFiles: string[];
  formats: string[];
  warnings: string[];
}

export interface Dataset {
  resources: Resource[];
  projects: Project[];
  crs: CR[];
  weeklyLog: WeeklyLogRow[];
  projectStatusWeekly: ProjectStatusRow[];
  meta: DatasetMeta;
}

export function emptyDataset(): Dataset {
  return {
    resources: [],
    projects: [],
    crs: [],
    weeklyLog: [],
    projectStatusWeekly: [],
    meta: { parsedAt: new Date().toISOString(), sourceFiles: [], formats: [], warnings: [] },
  };
}

export type ReportType = 'full' | 'executive' | 'resources' | 'projects';

export interface GenerateParams {
  startDate: string;
  endDate: string;
  reportType: ReportType;
  projectId?: string;
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
  paths: { dashboard: string; report: string; meta: string };
  error?: string;
}

export interface DashboardPayload {
  meta: {
    parsedAt: string;
    generatedAt: string;
    sourceFiles: string[];
    formats: string[];
    warnings: string[];
    generateParams: GenerateParams;
    years: number[];
    weeks: { year: number; week_number: number; week_start: string | null; week_end: string | null }[];
    dateRange: { minDate: string | null; maxDate: string | null };
  };
  resources: Resource[];
  projects: Project[];
  crs: CR[];
  weeklyLog: WeeklyLogRow[];
  projectStatusWeekly: ProjectStatusRow[];
}
