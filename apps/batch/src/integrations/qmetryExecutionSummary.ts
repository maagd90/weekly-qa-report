import type { ExecutionResult, ExecutionRow } from '../types/dataset';
import { canonicalProjectKey } from '../projects/projectKey';
import { sanitizeText } from '../utils/excel';

export interface QmetryExecutionSummaryCount {
  assignee: string;
  result: ExecutionResult;
  count: number;
}

export interface ParsedQmetryExecutionSummary {
  counts: QmetryExecutionSummaryCount[];
  total: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return sanitizeText(row.displayName ?? row.fullName ?? row.name ?? row.label ?? row.value ?? row.key);
  }
  return sanitizeText(value);
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function resultFromLabel(value: unknown): ExecutionResult | null {
  const label = stringValue(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+count$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) return null;
  if (/^(pass|passed|success|successful)$/.test(label)) return 'PASS';
  if (/^(fail|failed|failure)$/.test(label)) return 'FAIL';
  if (/^(blocked|block)$/.test(label)) return 'BLOCKED';
  if (/^(not executed|unexecuted|not run|pending|ne)$/.test(label)) return 'NE';
  if (/^(not applicable|n\/a|na)$/.test(label)) return 'NA';
  return null;
}

function assigneeFromRow(row: Record<string, unknown>): string {
  return stringValue(
    row.assigneeName
      ?? row.assignee
      ?? row.executionAssignee
      ?? row.executedBy
      ?? row.tester
      ?? row.user
      ?? row.displayName
      ?? row.label
      ?? row.name,
  ) || 'Unassigned';
}

function countFromRow(row: Record<string, unknown>): number | null {
  for (const key of ['count', 'value', 'y', 'total', 'totalCount', 'executionCount']) {
    const count = nonNegativeInteger(row[key]);
    if (count !== null) return count;
  }
  return null;
}

function directResultCount(row: Record<string, unknown>): QmetryExecutionSummaryCount | null {
  const result = resultFromLabel(row.executionResult ?? row.result ?? row.status ?? row.resultName ?? row.executionStatus);
  const count = countFromRow(row);
  if (!result || count === null) return null;
  return { assignee: assigneeFromRow(row), result, count };
}

function namedCounts(row: Record<string, unknown>): QmetryExecutionSummaryCount[] {
  const assignee = assigneeFromRow(row);
  const out: QmetryExecutionSummaryCount[] = [];
  const containers = [row, objectValue(row.counts), objectValue(row.results), objectValue(row.executionResults), objectValue(row.summary)];
  for (const container of containers) {
    for (const [key, value] of Object.entries(container)) {
      const result = resultFromLabel(key);
      const count = nonNegativeInteger(value);
      if (result && count !== null) out.push({ assignee, result, count });
    }
  }
  return out;
}

function parseRowArray(value: unknown): QmetryExecutionSummaryCount[] {
  if (!Array.isArray(value) || !value.length || !value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) return [];
  const rows = value as Record<string, unknown>[];
  const out: QmetryExecutionSummaryCount[] = [];
  for (const row of rows) {
    const direct = directResultCount(row);
    if (direct) {
      out.push(direct);
      continue;
    }
    const named = namedCounts(row);
    if (named.length) {
      out.push(...named);
      continue;
    }
    const parentAssignee = assigneeFromRow(row);
    for (const key of ['data', 'results', 'executionResults', 'statuses', 'summary']) {
      const nested = row[key];
      if (!Array.isArray(nested)) continue;
      for (const item of nested) {
        const child = objectValue(item);
        const result = resultFromLabel(
          child.executionResult ?? child.result ?? child.status ?? child.resultName ?? child.executionStatus ?? child.name ?? child.label,
        );
        const count = countFromRow(child);
        if (result && count !== null) out.push({ assignee: parentAssignee, result, count });
      }
    }
  }
  return out;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function numericArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const counts = value.map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) return countFromRow(item as Record<string, unknown>);
    return nonNegativeInteger(item);
  });
  return counts.every((count): count is number => count !== null) ? counts : null;
}

function parseNamedPointSeries(series: Record<string, unknown>[]): QmetryExecutionSummaryCount[] {
  const out: QmetryExecutionSummaryCount[] = [];
  for (const item of series) {
    const points = item.data ?? item.values;
    if (!Array.isArray(points)) continue;
    const seriesResult = resultFromLabel(item.result ?? item.name ?? item.label);
    const seriesAssignee = stringValue(item.assignee ?? item.tester);
    for (const value of points) {
      const point = objectValue(value);
      const count = countFromRow(point);
      if (count === null) continue;
      const pointLabel = point.assignee ?? point.tester ?? point.name ?? point.label ?? point.category ?? point.x;
      if (seriesResult) {
        const assignee = stringValue(pointLabel) || 'Unassigned';
        out.push({ assignee, result: seriesResult, count });
      } else if (seriesAssignee) {
        const result = resultFromLabel(point.result ?? point.status ?? point.executionResult ?? pointLabel);
        if (result) out.push({ assignee: seriesAssignee, result, count });
      }
    }
  }
  return out;
}

function parseChartObject(row: Record<string, unknown>): QmetryExecutionSummaryCount[] {
  const labels = stringArray(row.categories ?? row.labels ?? objectValue(row.xAxis).categories);
  const seriesValue = row.series ?? row.datasets;
  if (!Array.isArray(seriesValue)) return [];
  const series = seriesValue.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  if (!series.length) return [];

  const namedPoints = parseNamedPointSeries(series);
  if (!labels.length) return namedPoints;

  const labelResults = labels.map(resultFromLabel);
  if (labelResults.every((result): result is ExecutionResult => result !== null)) {
    const out: QmetryExecutionSummaryCount[] = [];
    for (const item of series) {
      const values = numericArray(item.data ?? item.values);
      if (!values || values.length !== labels.length) continue;
      const assignee = stringValue(item.assignee ?? item.name ?? item.label) || 'Unassigned';
      values.forEach((count, index) => out.push({ assignee, result: labelResults[index], count }));
    }
    if (out.length) return out;
  }

  const seriesResults = series.map((item) => resultFromLabel(item.result ?? item.name ?? item.label));
  if (seriesResults.every((result): result is ExecutionResult => result !== null)) {
    const out: QmetryExecutionSummaryCount[] = [];
    series.forEach((item, seriesIndex) => {
      const values = numericArray(item.data ?? item.values);
      if (!values || values.length !== labels.length) return;
      values.forEach((count, labelIndex) => out.push({ assignee: labels[labelIndex] || 'Unassigned', result: seriesResults[seriesIndex], count }));
    });
    return out;
  }

  return namedPoints;
}

function collectCandidates(value: unknown, depth = 0): QmetryExecutionSummaryCount[][] {
  if (depth > 8 || value === null || value === undefined) return [];
  const candidates: QmetryExecutionSummaryCount[][] = [];
  const rowArray = parseRowArray(value);
  if (rowArray.length) candidates.push(rowArray);
  if (Array.isArray(value)) {
    for (const item of value) candidates.push(...collectCandidates(item, depth + 1));
    return candidates;
  }
  if (typeof value !== 'object') return candidates;
  const row = value as Record<string, unknown>;
  const chart = parseChartObject(row);
  if (chart.length) candidates.push(chart);
  for (const nested of Object.values(row)) candidates.push(...collectCandidates(nested, depth + 1));
  return candidates;
}

function consolidate(counts: QmetryExecutionSummaryCount[]): QmetryExecutionSummaryCount[] {
  const grouped = new Map<string, QmetryExecutionSummaryCount>();
  for (const item of counts) {
    if (item.count < 0) continue;
    const assignee = item.assignee || 'Unassigned';
    const key = `${assignee.toLowerCase()}|${item.result}`;
    const existing = grouped.get(key);
    grouped.set(key, { assignee: existing?.assignee || assignee, result: item.result, count: (existing?.count || 0) + item.count });
  }
  return [...grouped.values()];
}

/**
 * QMetry's gadget API is not a public stable contract and different on-prem
 * releases return either row-oriented or chart-oriented JSON. Parse only
 * recognised result/count structures and reject unknown shapes rather than
 * silently producing a plausible but wrong report.
 */
export function parseQmetryExecutionSummary(value: unknown): ParsedQmetryExecutionSummary | null {
  const candidates = collectCandidates(value)
    .map(consolidate)
    .filter((candidate) => candidate.length > 0)
    .sort((a, b) => b.reduce((sum, item) => sum + item.count, 0) - a.reduce((sum, item) => sum + item.count, 0));
  const counts = candidates[0];
  if (!counts?.length) return null;
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  return { counts, total };
}

export function qmetryQqlDate(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid QMetry date: ${isoDate}`);
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) throw new Error(`Invalid QMetry date: ${isoDate}`);
  return `${match[3]}/${month}/${match[1]}`;
}

export function executionSummaryQql(startDate: string, endDate: string): string {
  return [
    `execution.executedon >= '${qmetryQqlDate(startDate)}'`,
    `execution.executedon <= '${qmetryQqlDate(endDate)}'`,
    'execution.onlylatestexecutions = true',
    'testcase.includearchive = false',
    'testcycle.includearchive = false',
  ].join(' AND ');
}

export function executionRowsFromSummary(
  parsed: ParsedQmetryExecutionSummary,
  projectKey: string,
  startDate: string,
  endDate: string,
): ExecutionRow[] {
  const project = canonicalProjectKey(projectKey) || projectKey || 'UNKNOWN';
  const cycleKey = `${project}-EXECUTION-SUMMARY-${startDate}-${endDate}`;
  const cycleName = `QMetry execution summary (${startDate} to ${endDate})`;
  const rows: ExecutionRow[] = [];
  if (parsed.total === 0) {
    return [{
      project,
      cycleKey,
      cycleName,
      caseKey: `${project}-SUMMARY-${startDate}-${endDate}-EMPTY`,
      result: 'NE',
      tester: null,
      executedAt: null,
      updatedAt: null,
      source: 'qmetry',
      summaryOnly: true,
      summaryMarker: true,
      summaryScopeStart: startDate,
      summaryScopeEnd: endDate,
    }];
  }
  let ordinal = 0;
  for (const item of parsed.counts) {
    for (let index = 0; index < item.count; index++) {
      ordinal += 1;
      rows.push({
        project,
        cycleKey,
        cycleName,
        caseKey: `${project}-SUMMARY-${startDate}-${endDate}-${item.result}-${ordinal}`,
        result: item.result,
        tester: item.result === 'NE' ? null : (item.assignee || 'Unassigned'),
        executedAt: null,
        updatedAt: null,
        source: 'qmetry',
        summaryOnly: true,
        summaryScopeStart: startDate,
        summaryScopeEnd: endDate,
      });
    }
  }
  return rows;
}
