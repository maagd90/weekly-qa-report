import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import type { ExecutionRow, FileMeta } from '../types/dataset';
import {
  findHeaderRow, rowToObject, mapExecutionResult, parseZephyrDate,
  projectFromKey, sanitizeText,
} from '../utils/excel';

const ZEPHYR_HEADERS = ['Test Cycle Key', 'Testcase/Teststep Execution Result'];

export function isZephyrFile(rows: unknown[][]): boolean {
  return findHeaderRow(rows, ZEPHYR_HEADERS) >= 0;
}

export function parseZephyr(filePath: string): { executions: ExecutionRow[]; file: FileMeta } {
  const buffer = fs.readFileSync(filePath);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.find((n) => n === 'Data') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '' });
  const headerIdx = findHeaderRow(rows as unknown[][], ZEPHYR_HEADERS);
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

  const name = path.basename(filePath);
  return {
    executions,
    file: {
      name,
      ext: 'XLSX',
      project: executions[0]?.project || 'DLM',
      rows: executions.length,
      status: 'parsed',
      detectedType: 'zephyr',
      source: 'file',
    },
  };
}
