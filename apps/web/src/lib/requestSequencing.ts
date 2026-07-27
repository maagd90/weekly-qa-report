/**
 * Guards against out-of-order async responses. When a user switches project
 * or applies a new date range before an in-flight request resolves, the app
 * bumps a sequence counter; only the response matching the latest sequence
 * (and the still-active project/tab) is allowed to update visible state.
 * Extracted as pure functions so the race-guard behavior itself is testable
 * without mounting the React tree.
 */

export interface ProjectRequest {
  sequence: number;
  project: string;
}

export interface DateRequest extends ProjectRequest {
  tab: string;
}

export function isCurrentProjectRequest(
  request: ProjectRequest,
  current: { sequence: number; project: string },
): boolean {
  return request.sequence === current.sequence && request.project === current.project;
}

export function isCurrentDateRequest(
  request: DateRequest,
  current: { sequence: number; project: string; tab: string },
): boolean {
  return request.sequence === current.sequence && request.project === current.project && request.tab === current.tab;
}
