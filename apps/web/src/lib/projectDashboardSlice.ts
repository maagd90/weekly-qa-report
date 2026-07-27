import type { DashboardByProject, DashboardPayload } from 'qa-dashboard-batch';
import { canonicalProjectKey } from './projectKeys';

export interface ProjectDashboardResolution {
  dashboard: DashboardPayload | null;
  slice: DashboardByProject | null;
  legacyFilesMissing: boolean;
}

function findProjectSlice(dashboard: DashboardPayload, project: string): DashboardByProject | null {
  const key = canonicalProjectKey(project);
  return dashboard.byProject?.find((item) => canonicalProjectKey(item.project) === key) || null;
}

/**
 * Resolves one project from a saved portfolio snapshot without falling back to
 * aggregate data. Returning `null` is deliberate: aggregate specialised rows
 * must never be displayed under a project heading.
 */
export function resolveProjectDashboard(
  dashboard: DashboardPayload,
  project: string,
): ProjectDashboardResolution {
  const slice = findProjectSlice(dashboard, project);
  if (!slice) return { dashboard: null, slice: null, legacyFilesMissing: false };

  const projectKey = canonicalProjectKey(slice.project);
  const capabilities = Object.entries(dashboard.scope.capabilitiesByProject || {})
    .find(([key]) => canonicalProjectKey(key) === projectKey)?.[1];
  const projectName = Object.entries(dashboard.scope.projectNamesByKey || {})
    .find(([key]) => canonicalProjectKey(key) === projectKey)?.[1];

  return {
    slice,
    legacyFilesMissing: !Array.isArray(slice.files),
    dashboard: {
      ...dashboard,
      scope: {
        ...dashboard.scope,
        project: slice.project,
        projects: [slice.project],
        capabilitiesByProject: capabilities ? { [slice.project]: capabilities } : {},
        projectNamesByKey: projectName ? { [slice.project]: projectName } : {},
      },
      overview: slice.overview,
      testers: slice.testers,
      qualityAssuranceSearch: slice.qualityAssuranceSearch,
      cycles: slice.cycles,
      cyclesByPassPctAsc: [...slice.cycles].sort((left, right) => left.passPct - right.passPct),
      storyBug: slice.storyBug,
      traceability: slice.traceability,
      workItems: slice.workItems,
      defectBacklog: slice.defectBacklog,
      uat: slice.uat,
      files: slice.files || [],
      byProject: undefined,
    },
  };
}

export function projectSliceAsDashboard(
  dashboard: DashboardPayload,
  project: string,
): DashboardPayload {
  const resolved = resolveProjectDashboard(dashboard, project).dashboard;
  if (!resolved) {
    throw new Error(`Project ${project} is not available in this portfolio snapshot.`);
  }
  return resolved;
}
