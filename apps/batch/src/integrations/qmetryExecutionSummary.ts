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
  if (/^(not executed|unexecuted|not run|pending|work in progress|in progress|wip|ne)$/.test(label)) return 'NE';
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

interface ResultLookup {
  aliases: Map<string, ExecutionResult>;
  ordered: ExecutionResult[];
}

interface TabularColumn {
  result: ExecutionResult | null;
  assignee: string | null;
  isAssigneeLabel: boolean;
}

function lookupKey(value: unknown): string {
  return stringValue(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function scalarValues(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => scalarValues(item));
  const row = value as Record<string, unknown>;
  const preferred = [
    'id', 'key', 'value', 'name', 'label', 'title', 'displayName', 'columnName', 'field', 'dataIndex',
    'column', 'columnId', 'header', 'text', 'type',
    'executionResultId', 'executionResultName', 'resultId', 'resultName', 'statusId', 'statusName',
    'userAccountId', 'accountId', 'assigneeId', 'assignee',
  ];
  return preferred.flatMap((key) => {
    const nested = row[key];
    return nested === null || nested === undefined || typeof nested === 'object' ? [] : [nested];
  });
}

function buildResultLookup(value: unknown): ResultLookup {
  const aliases = new Map<string, ExecutionResult>();
  const ordered: ExecutionResult[] = [];
  if (!Array.isArray(value)) return { aliases, ordered };
  for (const definition of value) {
    const candidates = scalarValues(definition);
    const result = candidates.map(resultFromLabel).find((item): item is ExecutionResult => item !== null);
    if (!result) continue;
    ordered.push(result);
    for (const candidate of candidates) {
      const key = lookupKey(candidate);
      if (key) aliases.set(key, result);
    }
  }
  return { aliases, ordered };
}

function resultFromDefinition(value: unknown, lookup: ResultLookup): ExecutionResult | null {
  const direct = resultFromLabel(value);
  if (direct) return direct;
  for (const candidate of scalarValues(value)) {
    const parsed = resultFromLabel(candidate) ?? lookup.aliases.get(lookupKey(candidate));
    if (parsed) return parsed;
  }
  return null;
}

function buildAssigneeLookup(value: unknown): Map<string, string> {
  const lookup = new Map<string, string>();
  const source = objectValue(value);
  for (const [id, displayValue] of Object.entries(source)) {
    const displayName = stringValue(displayValue) || id;
    lookup.set(lookupKey(id), displayName);
    lookup.set(lookupKey(displayName), displayName);
  }
  return lookup;
}

function assigneeFromValue(value: unknown, lookup: Map<string, string>): string {
  for (const candidate of scalarValues(value)) {
    const key = lookupKey(candidate);
    if (key && lookup.has(key)) return lookup.get(key) as string;
  }
  const raw = stringValue(value);
  return lookup.get(lookupKey(raw)) || raw;
}

function isAssigneeColumn(value: unknown): boolean {
  return scalarValues(value).some((candidate) => /(^|\b)(assignee|tester|user|user account|executed by|account id)(\b|$)/i.test(stringValue(candidate)));
}

function tabularColumns(value: unknown, results: ResultLookup, assignees: Map<string, string>): TabularColumn[] {
  if (!Array.isArray(value)) return [];
  return value.map((column) => ({
    result: resultFromDefinition(column, results),
    assignee: assigneeFromValue(column, assignees) || null,
    isAssigneeLabel: isAssigneeColumn(column),
  }));
}

function rowAssignee(row: Record<string, unknown>, assignees: Map<string, string>): string {
  const raw = row.userAccountId
    ?? row.accountId
    ?? row.assigneeId
    ?? row.assigneeName
    ?? row.assignee
    ?? row.executionAssignee
    ?? row.executedBy
    ?? row.tester
    ?? row.user;
  const explicit = assigneeFromValue(raw, assignees);
  if (explicit) return explicit;
  for (const candidate of [row.key, row.id, row.column, row.name, row.label]) {
    const resolved = assigneeFromValue(candidate, assignees);
    if (resolved && assignees.has(lookupKey(resolved))) return resolved;
  }
  const fallback = assigneeFromRow(row);
  return assigneeFromValue(fallback, assignees) || fallback;
}

function rowResult(row: Record<string, unknown>, results: ResultLookup): ExecutionResult | null {
  return resultFromDefinition(
    row.executionResultId
      ?? row.resultId
      ?? row.statusId
      ?? row.executionResult
      ?? row.result
      ?? row.status
      ?? row.executionResultName
      ?? row.resultName
      ?? row.statusName
      ?? row.column
      ?? row.key
      ?? row.id
      ?? row.name
      ?? row.label,
    results,
  );
}

function tabularValueArray(row: Record<string, unknown>): unknown[] | null {
  for (const key of ['data', 'values', 'cells', 'columns', 'counts', 'row', 'rows']) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  return null;
}

function countFromCell(value: unknown): number | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return countFromRow(value as Record<string, unknown>);
  return nonNegativeInteger(value);
}

function resultFromCell(value: unknown, results: ResultLookup): ExecutionResult | null {
  const cell = objectValue(value);
  return resultFromDefinition(
    cell.executionResultId
      ?? cell.resultId
      ?? cell.statusId
      ?? cell.columnId
      ?? cell.key
      ?? cell.executionResult
      ?? cell.result
      ?? cell.status
      ?? cell.name
      ?? cell.label,
    results,
  );
}

function countsFromResultObject(
  row: Record<string, unknown>,
  assignee: string,
  results: ResultLookup,
): QmetryExecutionSummaryCount[] {
  const out: QmetryExecutionSummaryCount[] = [];
  const containers = [row, objectValue(row.counts), objectValue(row.values), objectValue(row.results), objectValue(row.summary)];
  for (const container of containers) {
    for (const [key, value] of Object.entries(container)) {
      const result = resultFromDefinition(key, results);
      const count = nonNegativeInteger(value);
      if (result && count !== null) out.push({ assignee: assignee || 'Unassigned', result, count });
    }
  }
  return out;
}

function parseAssigneesAsRows(
  rows: unknown[],
  columns: TabularColumn[],
  results: ResultLookup,
  assignees: Map<string, string>,
): QmetryExecutionSummaryCount[] {
  const out: QmetryExecutionSummaryCount[] = [];
  const resultColumnCount = columns.filter((column) => column.result).length;
  for (const rawRow of rows) {
    const rowObject = objectValue(rawRow);
    const values = Array.isArray(rawRow) ? rawRow : tabularValueArray(rowObject);
    let assignee = Array.isArray(rawRow) ? '' : rowAssignee(rowObject, assignees);

    if (values) {
      for (let index = 0; index < values.length; index++) {
        if (columns[index]?.isAssigneeLabel) assignee = assigneeFromValue(values[index], assignees) || assignee;
      }
      if (!assignee) {
        const candidate = values.find((value, index) => {
          if (columns[index]?.result) return false;
          return nonNegativeInteger(value) === null && Boolean(stringValue(value));
        });
        assignee = assigneeFromValue(candidate, assignees);
      }

      if (resultColumnCount) {
        values.forEach((value, index) => {
          const result = columns[index]?.result ?? resultFromCell(value, results);
          const count = countFromCell(value);
          if (result && count !== null) out.push({ assignee: assignee || 'Unassigned', result, count });
        });
      } else if (results.ordered.length) {
        const valuesWithoutExplicitResults = values.filter((value) => !resultFromCell(value, results));
        const numericValues = valuesWithoutExplicitResults.filter((value) => countFromCell(value) !== null);
        if (valuesWithoutExplicitResults.length === values.length && numericValues.length === results.ordered.length) {
          numericValues.forEach((value, index) => {
            const count = countFromCell(value);
            if (count !== null) out.push({ assignee: assignee || 'Unassigned', result: results.ordered[index], count });
          });
        }
      }
    }

    if (!Array.isArray(rawRow)) {
      out.push(...countsFromResultObject(rowObject, assignee || rowAssignee(rowObject, assignees), results));
      const cells = tabularValueArray(rowObject);
      if (cells && !resultColumnCount) {
        for (const cellValue of cells) {
          const result = resultFromCell(cellValue, results);
          const count = countFromCell(cellValue);
          if (result && count !== null) out.push({ assignee: assignee || 'Unassigned', result, count });
        }
      }
    }
  }
  return out;
}

function parseAssigneesAsColumns(
  rows: unknown[],
  columns: TabularColumn[],
  results: ResultLookup,
  assignees: Map<string, string>,
): QmetryExecutionSummaryCount[] {
  const out: QmetryExecutionSummaryCount[] = [];
  const recognizedAssignees = columns.filter((column) => column.assignee && assignees.has(lookupKey(column.assignee))).length;
  if (!recognizedAssignees) return out;

  rows.forEach((rawRow, rowIndex) => {
    const rowObject = objectValue(rawRow);
    const values = Array.isArray(rawRow) ? rawRow : tabularValueArray(rowObject);
    if (!values) return;
    let result = Array.isArray(rawRow) ? null : rowResult(rowObject, results);
    let offset = 0;
    if (!result && values.length === columns.length + 1) {
      result = resultFromDefinition(values[0], results);
      if (result) offset = 1;
    }
    if (!result) {
      result = values.map((value) => resultFromCell(value, results) ?? resultFromDefinition(value, results))
        .find((item): item is ExecutionResult => item !== null) ?? results.ordered[rowIndex] ?? null;
    }
    if (!result) return;
    columns.forEach((column, columnIndex) => {
      if (!column.assignee || !assignees.has(lookupKey(column.assignee))) return;
      const count = countFromCell(values[columnIndex + offset]);
      if (count !== null) out.push({ assignee: column.assignee, result: result as ExecutionResult, count });
    });
  });
  return out;
}

function parseResultColumnsAsSeries(
  rawColumns: unknown[],
  rows: unknown[],
  results: ResultLookup,
  assignees: Map<string, string>,
): QmetryExecutionSummaryCount[] {
  const out: QmetryExecutionSummaryCount[] = [];
  rawColumns.forEach((rawColumn, columnIndex) => {
    const columnObject = objectValue(rawColumn);
    const result = resultFromDefinition(rawColumn, results) ?? results.ordered[columnIndex] ?? null;
    if (!result) return;
    const values = Array.isArray(rawColumn) ? rawColumn : tabularValueArray(columnObject);
    if (values?.length === rows.length) {
      values.forEach((value, rowIndex) => {
        const rawAssignee = Array.isArray(rows[rowIndex]) ? (rows[rowIndex] as unknown[])[0] : rows[rowIndex];
        const assignee = rawAssignee && typeof rawAssignee === 'object'
          ? rowAssignee(rawAssignee as Record<string, unknown>, assignees)
          : assigneeFromValue(rawAssignee, assignees);
        const count = countFromCell(value);
        if (count !== null) out.push({ assignee: assignee || 'Unassigned', result, count });
      });
      return;
    }
    for (const [key, value] of Object.entries(columnObject)) {
      const assignee = assignees.get(lookupKey(key));
      const count = nonNegativeInteger(value);
      if (assignee && count !== null) out.push({ assignee, result, count });
    }
  });
  return out;
}

function parsePivotTableRows(
  rawColumns: unknown[],
  rows: unknown[],
  results: ResultLookup,
  assignees: Map<string, string>,
): QmetryExecutionSummaryCount[] {
  const headers = rawColumns.map((column) => stringValue(column).toLowerCase().replace(/\s+/g, ' ').trim());
  const assigneeIndex = headers.findIndex((header) => header === 'assignee' || header === 'tester' || header === 'executed by');
  const resultIndex = headers.findIndex((header) => /execution result|execution status|^result$|^status$/.test(header));
  const countIndex = headers.findIndex((header) => header === 'count' || header === 'total' || header === 'execution count');
  if (assigneeIndex < 0 || resultIndex < 0 || countIndex < 0) return [];

  const out: QmetryExecutionSummaryCount[] = [];
  for (const rawRow of rows) {
    if (!Array.isArray(rawRow)) continue;
    const result = resultFromDefinition(rawRow[resultIndex], results);
    const count = nonNegativeInteger(rawRow[countIndex]);
    if (!result || count === null) continue;
    const assignee = assigneeFromValue(rawRow[assigneeIndex], assignees) || 'Unassigned';
    out.push({ assignee, result, count });
  }
  return out;
}

function parseQmetryTabularObject(row: Record<string, unknown>): QmetryExecutionSummaryCount[][] {
  if (!Array.isArray(row.rows) || !Array.isArray(row.column)) return [];
  const results = buildResultLookup(row.executionResults);
  const assignees = buildAssigneeLookup(row.userAccountIdDisplayNames);
  const columns = tabularColumns(row.column, results, assignees);
  const candidates = [
    parsePivotTableRows(row.column, row.rows, results, assignees),
    parseAssigneesAsRows(row.rows, columns, results, assignees),
    parseAssigneesAsColumns(row.rows, columns, results, assignees),
    parseResultColumnsAsSeries(row.column, row.rows, results, assignees),
  ];
  return candidates.filter((candidate) => candidate.length > 0);
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
  candidates.push(...parseQmetryTabularObject(row));
  const chart = parseChartObject(row);
  if (chart.length) candidates.push(chart);
  for (const nested of Object.values(row)) candidates.push(...collectCandidates(nested, depth + 1));
  return candidates;
}

export function describeQmetryExecutionSummaryShape(value: unknown): string {
  const top = objectValue(value);
  const data = objectValue(top.data);
  const table = Object.keys(data).length ? data : top;
  const columns = Array.isArray(table.column) ? table.column : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const firstColumn = columns[0];
  const firstRow = rows[0];
  const columnShape = firstColumn && typeof firstColumn === 'object'
    ? `object(${Object.keys(objectValue(firstColumn)).slice(0, 8).join('|') || 'no keys'})`
    : typeof firstColumn;
  const rowShape = Array.isArray(firstRow)
    ? `array(${firstRow.length})`
    : firstRow && typeof firstRow === 'object'
      ? `object(${Object.keys(objectValue(firstRow)).slice(0, 8).join('|') || 'no keys'})`
      : typeof firstRow;
  const executionResults = Array.isArray(table.executionResults) ? table.executionResults.length : 0;
  const displayNames = Object.keys(objectValue(table.userAccountIdDisplayNames)).length;
  return `top=${Object.keys(top).slice(0, 8).join('|') || 'none'}; data=${Object.keys(table).slice(0, 8).join('|') || 'none'}; columns=${columns.length}:${columnShape}; rows=${rows.length}:${rowShape}; executionResults=${executionResults}; displayNames=${displayNames}`;
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
    const attributedAssignee = /^(unassigned|none|unknown|n\/a)$/i.test(item.assignee.trim()) ? null : (item.assignee || null);
    for (let index = 0; index < item.count; index++) {
      ordinal += 1;
      rows.push({
        project,
        cycleKey,
        cycleName,
        caseKey: `${project}-SUMMARY-${startDate}-${endDate}-${item.result}-${ordinal}`,
        result: item.result,
        tester: item.result === 'NE' ? null : attributedAssignee,
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
