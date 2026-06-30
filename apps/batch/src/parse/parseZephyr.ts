import path from 'path';
import type { ExecutionRow, FileMeta } from '../types/dataset';
import {
  findHeaderRow, rowToObject, mapExecutionResult, parseZephyrDate,
  projectFromKey, sanitizeText,
} from '../utils/excel';
import { readWorkbookRows } from '../utils/readWorkbook';

const ZEPHYR_HEADERS = ['Test Cycle Key', 'Testcase/Teststep Execution Result'];

export function isZephyrFile(rows: unknown[][]): boolean {
  return findHeaderRow(rows, ZEPHYR_HEADERS) >= 0;
}

export function parseZephyrFromRows(
  rows: unknown[][],
  fileName: string,
): { executions: ExecutionRow[]; file: FileMeta } {
  const headerIdx = findHeaderRow(rows, ZEPHYR_HEADERS);
  if (headerIdx < 0) throw new Error('Zephyr headers not found');

  const headers = (rows[headerIdx] as unknown[]).map((h) => sanitizeText(h));
  const executions: ExecutionRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || !row.some((c) => c !== '' && c !== null && c !== undefined)) continue;
    const obj = rowToObject(headers, row);
    const caseKey = sanitizeText(obj['Test Case Key']);
    const cycleKey = sanitizeText(obj['Test Cycle Key']);
    if (!caseKey && !cycleKey) continue;

    const executedAt = parseZephyrDate(obj['Executed On']);
    const result = mapExecutionResult(obj['Testcase/Teststep Execution Result']);
    const tester = sanitizeText(obj['Executed By']) || null;

    executions.push({
      project: projectFromKey(caseKey || cycleKey),
      cycleKey,
      cycleName: sanitizeText(obj['Test Cycle Summary']),
      caseKey,
      result,
      tester,
      executedAt,
      updatedAt: executedAt,
      source: 'zephyr',
    });
  }

  return {
    executions,
    file: {
      name: fileName,
      ext: 'XLSX',
      project: executions[0]?.project || 'DLM',
      rows: executions.length,
      status: 'parsed',
      detectedType: 'zephyr',
      source: 'file',
    },
  };
}

export function parseZephyr(filePath: string): { executions: ExecutionRow[]; file: FileMeta } {
  const { rows } = readWorkbookRows(filePath, ['Data']);
  return parseZephyrFromRows(rows, path.basename(filePath));
}
