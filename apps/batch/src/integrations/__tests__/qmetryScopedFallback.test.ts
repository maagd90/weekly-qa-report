import assert from 'assert';
import { excludeApproximateQmetryProgressFromDateScope } from '../../cache/datasetCache';
import { applyFilters } from '../../filters/applyFilters';
import { emptyDataset, type ExecutionRow } from '../../types/dataset';

function aggregateRow(caseKey: string, result: ExecutionRow['result']): ExecutionRow {
  return {
    project: 'DLM',
    cycleKey: 'DLM-TR-100',
    cycleName: 'Aggregate-only cycle',
    caseKey,
    result,
    tester: null,
    executedAt: null,
    updatedAt: '2026-07-05',
    source: 'qmetry',
  };
}

function detailedRow(caseKey: string, updatedAt: string): ExecutionRow {
  return {
    project: 'DLM',
    cycleKey: 'DLM-TR-100',
    cycleName: 'Detailed cycle',
    caseKey,
    result: 'PASS',
    tester: 'Tester One',
    executedAt: null,
    updatedAt,
    source: 'qmetry',
  };
}

function main(): void {
  const aggregateRows: ExecutionRow[] = [
    ...Array.from({ length: 95 }, (_, i) => aggregateRow(`DLM-TR-100-PROGRESS-PASS-${i + 1}`, 'PASS')),
    ...Array.from({ length: 7 }, (_, i) => aggregateRow(`DLM-TR-100-PROGRESS-BLOCKED-${i + 1}`, 'BLOCKED')),
    ...Array.from({ length: 3 }, (_, i) => aggregateRow(`DLM-TR-100-PROGRESS-FAIL-${i + 1}`, 'FAIL')),
  ];
  const inRange = detailedRow('DLM-TC-IN-RANGE', '2026-07-10');
  const outOfRange = detailedRow('DLM-TC-OUTSIDE', '2026-07-05');
  const rows = [...aggregateRows, inRange, outOfRange];
  const dateScope = {
    startDate: '2026-07-07',
    endDate: '2026-07-14',
    project: 'DLM',
  };

  const scoped = excludeApproximateQmetryProgressFromDateScope(rows, dateScope);

  assert.equal(scoped.excludedCount, 105, 'all aggregate progress rows must be excluded from a date-scoped report');
  assert.deepEqual(scoped.excludedCycles, ['Aggregate-only cycle']);
  assert.equal(scoped.executions.length, 2, 'real testcase rows must not be rewritten or removed by the safety filter');
  assert.equal(scoped.executions.find((row) => row.caseKey === 'DLM-TC-IN-RANGE')?.updatedAt, '2026-07-10');
  assert.equal(scoped.executions.find((row) => row.caseKey === 'DLM-TC-OUTSIDE')?.updatedAt, '2026-07-05');

  const dataset = emptyDataset();
  dataset.executions = scoped.executions;
  const filtered = applyFilters(dataset, dateScope);

  assert.equal(filtered.executions.length, 1, 'only the real testcase row inside the selected period must remain');
  assert.equal(filtered.executions[0].caseKey, 'DLM-TC-IN-RANGE');
  assert.equal(filtered.executions.filter((row) => row.result === 'BLOCKED').length, 0, 'aggregate blocked totals must not be presented as date-specific activity');

  const allTime = excludeApproximateQmetryProgressFromDateScope(rows, { project: 'DLM' });
  assert.equal(allTime.excludedCount, 0, 'aggregate fallback remains available for an all-time report');
  assert.equal(allTime.executions.length, rows.length);
  assert.ok(allTime.executions.every((row, index) => row.updatedAt === rows[index].updatedAt), 'no dates may be rewritten');

  console.log('QMetry date-scope safety test passed');
}

main();
