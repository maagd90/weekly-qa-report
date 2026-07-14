import assert from 'assert';
import { anchorQmetryProgressRowsToScope } from '../../cache/datasetCache';
import { applyFilters } from '../../filters/applyFilters';
import { emptyDataset, type ExecutionRow } from '../../types/dataset';

function aggregateRow(caseKey: string, result: ExecutionRow['result']): ExecutionRow {
  return {
    project: 'DLM',
    cycleKey: 'DLM-TR-100',
    cycleName: 'Stakeholder demo cycle',
    caseKey,
    result,
    tester: null,
    executedAt: null,
    updatedAt: '2026-07-05',
    source: 'qmetry',
  };
}

function detailedRow(): ExecutionRow {
  return {
    project: 'DLM',
    cycleKey: 'DLM-TR-100',
    cycleName: 'Stakeholder demo cycle',
    caseKey: 'DLM-TC-1',
    result: 'PASS',
    tester: 'Tester One',
    executedAt: null,
    updatedAt: '2026-07-05',
    source: 'qmetry',
  };
}

function main(): void {
  const aggregateRows: ExecutionRow[] = [
    ...Array.from({ length: 95 }, (_, i) => aggregateRow(`DLM-TR-100-PROGRESS-PASS-${i + 1}`, 'PASS')),
    ...Array.from({ length: 7 }, (_, i) => aggregateRow(`DLM-TR-100-PROGRESS-BLOCKED-${i + 1}`, 'BLOCKED')),
    ...Array.from({ length: 3 }, (_, i) => aggregateRow(`DLM-TR-100-PROGRESS-FAIL-${i + 1}`, 'FAIL')),
  ];
  const rows = [...aggregateRows, detailedRow()];
  const scoped = anchorQmetryProgressRowsToScope(rows, {
    startDate: '2026-07-07',
    endDate: '2026-07-14',
    project: 'DLM',
  });

  assert.ok(scoped.slice(0, aggregateRows.length).every((row) => row.updatedAt === '2026-07-14'));
  assert.equal(scoped[scoped.length - 1].updatedAt, '2026-07-05', 'real testcase dates must not be rewritten');

  const dataset = emptyDataset();
  dataset.executions = scoped;
  const filtered = applyFilters(dataset, {
    startDate: '2026-07-07',
    endDate: '2026-07-14',
    project: 'DLM',
  });

  assert.equal(filtered.executions.length, 105, 'all scoped aggregate progress rows must survive the report date filter');
  assert.equal(filtered.executions.filter((row) => row.result === 'BLOCKED').length, 7);
  assert.equal(filtered.executions.some((row) => row.caseKey === 'DLM-TC-1'), false, 'out-of-range detailed rows must remain excluded');
  console.log('QMetry scoped aggregate fallback test passed');
}

main();
