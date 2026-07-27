import type { DashboardPayload, DashboardWorkItem, ProjectCapabilities } from 'qa-dashboard-batch';

export type ReportCapability = keyof ProjectCapabilities;
export type ReportSectionState = 'disabled' | 'populated' | 'out-of-range' | 'not-uploaded';

export interface ReportSectionResolution {
  state: ReportSectionState;
  rows: DashboardWorkItem[];
}

function normalizedProjectKey(value?: string): string {
  return (value || '').trim().toUpperCase();
}

export function projectHasReportCapability(
  dashboard: DashboardPayload,
  project: string | undefined,
  capability: ReportCapability,
): boolean {
  const key = normalizedProjectKey(project);
  if (!key || key === 'ALL') return false;
  const capabilities = dashboard.scope.capabilitiesByProject || {};
  const match = Object.entries(capabilities).find(([candidate]) => normalizedProjectKey(candidate) === key);
  return match?.[1]?.[capability] === true;
}

export function scopeHasReportCapability(dashboard: DashboardPayload, capability: ReportCapability): boolean {
  const selectedProject = normalizedProjectKey(dashboard.scope.project);
  if (selectedProject && selectedProject !== 'ALL') {
    return projectHasReportCapability(dashboard, selectedProject, capability);
  }
  return false;
}

function scopedProject(dashboard: DashboardPayload): string | undefined {
  const project = normalizedProjectKey(dashboard.scope.project);
  return project && project !== 'ALL' ? project : undefined;
}

function projectFileExists(dashboard: DashboardPayload, detectedType: 'jira' | 'odl'): boolean {
  const selectedProject = scopedProject(dashboard);
  if (!selectedProject) return false;
  return dashboard.files.some((file) =>
    file.source === 'file'
    && file.detectedType === detectedType
    && normalizedProjectKey(file.project) === selectedProject);
}

export function resolveVendorPortalSection(dashboard: DashboardPayload): ReportSectionResolution {
  if (!scopeHasReportCapability(dashboard, 'vendorPortal')) return { state: 'disabled', rows: [] };
  if ((dashboard.uat?.total || 0) > 0) return { state: 'populated', rows: [] };
  return {
    state: projectFileExists(dashboard, 'odl') ? 'out-of-range' : 'not-uploaded',
    rows: [],
  };
}

export function vendorPortalEmptyMessage(dashboard: DashboardPayload): string {
  return resolveVendorPortalSection(dashboard).state === 'out-of-range'
    ? 'No Vendor Portal bugs fall within the selected date range. Widen the reporting period to include activity from the uploaded export.'
    : 'No Vendor Portal export is staged for this project. Upload an eligible ODL/production spreadsheet under Import Data and synchronize it.';
}

export function resolveWonderMilesSection(dashboard: DashboardPayload): ReportSectionResolution {
  if (!scopeHasReportCapability(dashboard, 'wonderMilesExport')) return { state: 'disabled', rows: [] };
  const project = scopedProject(dashboard);
  const rows = (dashboard.workItems || []).filter((row) =>
    Boolean(row.sourceFile)
    && Boolean(project)
    && normalizedProjectKey(row.project) === project);
  if (rows.length > 0) return { state: 'populated', rows };
  return {
    state: projectFileExists(dashboard, 'jira') ? 'out-of-range' : 'not-uploaded',
    rows: [],
  };
}
