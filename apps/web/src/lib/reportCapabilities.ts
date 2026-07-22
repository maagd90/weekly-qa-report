import type { DashboardPayload, ProjectCapabilities } from 'qa-dashboard-batch';

export type ReportCapability = keyof ProjectCapabilities;

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
  return Object.values(dashboard.scope.capabilitiesByProject || {}).some((capabilities) => capabilities[capability]);
}
