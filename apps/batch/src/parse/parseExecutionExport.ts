import path from 'path';
import type { ExecutionRow, FileMeta } from '../types/dataset';
import {
  findHeaderRow, rowToObject, mapExecutionResult, parseExecutionExportDate,
  projectFromKey, sanitizeText,
} from '../utils/excel';
import { readWorkbookRows } from '../utils/readWorkbook';

const EXECUTION_EXPORT_HEADERS = ['Test Cycle Key', 'Testcase/Teststep Execution Result'];

export function isExecutionExportFile(rows: unknown[][]): boolean {
  return findHeaderRow(rows, EXECUTION_EXPORT_HEADERS) >= 0;
}

export function parseExecutionExportFromRows(
  rows: unknown[][],
  fileName: string,
): { executions: ExecutionRow[]; file: FileMeta } {
  const headerIdx = findHeaderRow(rows, EXECUTION_EXPORT_HEADERS);
  if (headerIdx < 0) throw new Error('Test execution headers not found');

  const headers = (rows[headerIdx] as unknown[]).map((h) => sanitizeText(h));
  const executions: ExecutionRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || !row.some((c) => c !== '' && c !== null && c !== undefined)) continue;
    const obj = rowToObject(headers, row);
    const caseKey = sanitizeText(obj['Test Case Key']);
    const cycleKey = sanitizeText(obj['Test Cycle Key']);
    if (!caseKey && !cycleKey) continue;

    const executedAt = parseExecutionExportDate(obj['Executed On']);
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
      source: 'test-execution-file',
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
      detectedType: 'test-execution',
      source: 'file',
    },
  };
}

export function parseExecutionExport(filePath: string): { executions: ExecutionRow[]; file: FileMeta } {
  const { rows } = readWorkbookRows(filePath, ['Data']);
  return parseExecutionExportFromRows(rows, path.basename(filePath));
}
