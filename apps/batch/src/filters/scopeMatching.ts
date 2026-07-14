import type { ApiFetchScope, ExecutionRow, IssueRow } from '../types/dataset';
import { canonicalProjectKey, canonicalProjectOrUndefined } from '../projects/projectKey';

/** Exact date format accepted by API fetch scopes and normalized dataset rows. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts a date only when it uses the sortable `YYYY-MM-DD` representation.
 *
 * The function validates representation rather than calendar semantics because
 * upstream parsers already normalize real dates. Lexicographic comparisons are
 * therefore safe and avoid timezone shifts at date-only boundaries.
 *
 * @param value Candidate date string.
 * @returns The trimmed date, or `undefined` when its format is unsupported.
 */
export function validIsoDate(value?: string | null): string | undefined {
  const normalized = (value || '').trim();
  return ISO_DATE_PATTERN.test(normalized) ? normalized : undefined;
}

/**
 * Determines whether a row project belongs to the selected API project scope.
 *
 * Project aliases and display labels are canonicalized before comparison. An
 * absent project scope intentionally matches every project.
 *
 * @param project Project value from a dataset row.
 * @param scope Optional live-fetch scope.
 * @returns `true` when the project is in scope.
 */
export function projectMatchesApiScope(project: string | undefined, scope?: ApiFetchScope): boolean {
  const selectedProject = canonicalProjectOrUndefined(scope?.project);
  if (!selectedProject) return true;
  return canonicalProjectKey(project || '') === selectedProject;
}

/**
 * Determines whether any relevant row date is inside the API date scope.
 *
 * Date bounds are inclusive. If neither bound is present, all dates match. If
 * a bound exists, at least one valid row date must satisfy every supplied bound;
 * missing or malformed dates cannot prove that a row belongs to the scope.
 *
 * @param dates Relevant activity dates for a row.
 * @param scope Optional live-fetch scope.
 * @returns `true` when at least one date falls inside the scope.
 */
export function datesMatchApiScope(dates: Array<string | null | undefined>, scope?: ApiFetchScope): boolean {
  const startDate = validIsoDate(scope?.startDate);
  const endDate = validIsoDate(scope?.endDate);
  if (!startDate && !endDate) return true;

  return dates.some((rawDate) => {
    const date = validIsoDate(rawDate);
    return Boolean(date && (!startDate || date >= startDate) && (!endDate || date <= endDate));
  });
}

/**
 * Determines whether a JIRA issue row is covered by a live API refresh.
 *
 * An issue is in scope when its project matches and at least one of creation,
 * update, or resolution dates satisfies the selected inclusive date range.
 *
 * @param row Normalized issue row from the cached dataset.
 * @param scope Optional live-fetch scope.
 * @returns `true` when a fresh scoped fetch is authoritative for this row.
 */
export function issueMatchesApiScope(row: IssueRow, scope?: ApiFetchScope): boolean {
  return projectMatchesApiScope(row.project, scope)
    && datesMatchApiScope([row.createdAt, row.updatedAt, row.resolvedAt], scope);
}

/**
 * Determines whether a QMetry execution row is covered by a live API refresh.
 *
 * An execution is in scope when its project matches and either its execution or
 * update date satisfies the selected inclusive date range.
 *
 * @param row Normalized execution row from the cached dataset.
 * @param scope Optional live-fetch scope.
 * @returns `true` when a fresh scoped fetch is authoritative for this row.
 */
export function executionMatchesApiScope(row: ExecutionRow, scope?: ApiFetchScope): boolean {
  return projectMatchesApiScope(row.project, scope)
    && datesMatchApiScope([row.executedAt, row.updatedAt], scope);
}
