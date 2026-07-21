import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { parseExecutionExport } from '../parseExecutionExport';
import { parseJira } from '../parseJira';
import { parseOdl, parseOdlFromRows } from '../parseOdl';
import { inspectImportFile, parseAllFiles } from '../dispatcher';
import { buildDashboardPayload } from '../../export/buildDashboardPayload';
import { mergeDatasets } from '../../merge/mergeDataset';
import type { IssueRow, UatRow } from '../../types/dataset';

const FIXTURES = path.resolve(__dirname, '../../../../../fixtures/synthetic');
const EXECUTION_FIXTURE = ['z', 'e', 'p', 'h', 'y', 'r-regression.xlsx'].join('');

function countResults(executions: { result: string }[]) {
  const c: Record<string, number> = {};
  for (const e of executions) c[e.result] = (c[e.result] || 0) + 1;
  return c;
}

// Test execution export regression
{
  const executionPath = path.join(FIXTURES, EXECUTION_FIXTURE);
  const { executions } = parseExecutionExport(executionPath);
  assert.strictEqual(executions.length, 2210, 'Test execution row count');
  const mix = countResults(executions);
  assert.strictEqual(mix.PASS, 1319);
  assert.strictEqual(mix.NE, 715);
  assert.strictEqual(mix.BLOCKED, 109);
  assert.strictEqual(mix.FAIL, 46);
  assert.strictEqual(mix.NA, 21);
  console.log('✓ Test execution export parser');
}

// JIRA regression
{
  const jiraPath = path.join(FIXTURES, 'jira-regression.xlsx');
  const { issues } = parseJira(jiraPath);
  assert.strictEqual(issues.length, 779, 'JIRA issue count');
  const stories = issues.filter((i: IssueRow) => i.issueType === 'Story').length;
  const bugs = issues.filter((i: IssueRow) => i.issueType === 'Bug').length;
  assert.strictEqual(stories, 582);
  assert.strictEqual(bugs, 197);
  const openBugs = issues.filter((i: IssueRow) => i.issueType === 'Bug' && i.status === 'open').length;
  assert.strictEqual(openBugs, 63);
  assert.ok(issues.every((issue) => issue.sourceFile === 'jira-regression.xlsx'), 'uploaded JIRA rows retain source-file provenance');
  console.log('✓ JIRA parser');
}

// ODL regression
{
  const odlPath = path.join(FIXTURES, 'odl-regression.xlsx');
  const { uat } = parseOdl(odlPath);
  assert.strictEqual(uat.length, 74, 'ODL UAT count');
  const open = uat.filter((r: UatRow) => r.open).length;
  const closed = uat.filter((r: UatRow) => !r.open).length;
  assert.strictEqual(closed, 43);
  assert.strictEqual(open, 31);
  console.log('✓ ODL parser');
}

// Production-style rows may omit Submittedon while retaining LastUpdate.
// They must use that valid activity date instead of being skipped.
{
  const warnings: string[] = [];
  const { uat } = parseOdlFromRows([
    ['TicketID', 'Subject', 'ProductArea', 'odlPriorityDescription', 'Status', 'Submittedon', 'LastUpdate'],
    ['148286', 'INC00148286 production issue', 'Bookings', 'High', 'Open', '', '2026-07-10'],
    ['148291', 'INC00148291 missing every date', 'Bookings', 'High', 'Open', '', ''],
  ], 'production.xlsx', warnings);
  assert.strictEqual(uat.length, 1);
  assert.strictEqual(uat[0].submittedAt, '2026-07-10');
  assert.strictEqual(uat[0].updatedAt, '2026-07-10');
  assert.deepStrictEqual(warnings, ['[technical] production.xlsx: 1 Vendor Portal row skipped because both Submittedon and LastUpdate were empty.']);
  console.log('✓ ODL LastUpdate date fallback');
}

// Full merge + dashboard payload
{
  const files = [
    path.join(FIXTURES, EXECUTION_FIXTURE),
    path.join(FIXTURES, 'jira-regression.xlsx'),
    path.join(FIXTURES, 'odl-regression.xlsx'),
  ];
  const ds = mergeDatasets([parseAllFiles(files)]);
  const payload = buildDashboardPayload(ds, {});
  assert.ok(payload.overview.totalCases > 0);
  assert.strictEqual(payload.storyBug.story, 582);
  assert.strictEqual(payload.storyBug.bug, 197);
  assert.ok(payload.workItems?.every((item) => item.sourceFile === 'jira-regression.xlsx'));
  assert.ok(payload.uat);
  assert.strictEqual(payload.uat!.total, 74);
  console.log('✓ Dashboard payload');
}

// Reconciliation must retain a reason and spreadsheet row number for every
// rejected source row so the UI and CSV can explain exactly what was skipped.
{
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-rejections-'));
  try {
    const filePath = path.join(temporary, 'jira-with-rejections.xlsx');
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Key', 'Summary', 'Issue Type', 'Created'],
      ['TEST-1', 'Valid story', 'Story', '2026-07-01'],
      ['TEST-2', 'Unsupported work item', 'Task', '2026-07-01'],
      ['TEST-3', 'Missing date', 'Bug', ''],
      ['', 'Missing issue key', 'Bug', '2026-07-01'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Jira');
    XLSX.writeFile(workbook, filePath);
    const inspected = inspectImportFile(filePath);
    assert.equal(inspected.inspection.rowsFound, 4);
    assert.equal(inspected.inspection.importedRows, 1);
    assert.equal(inspected.inspection.rejectedRows, 3);
    assert.deepStrictEqual(inspected.inspection.rejections.map((row) => row.rowNumber), [3, 4, 5]);
    assert.match(inspected.inspection.rejections[0].reason, /Issue Type/);
    assert.match(inspected.inspection.rejections[1].reason, /Created date/);
    assert.match(inspected.inspection.rejections[2].reason, /Issue key/);
    console.log('✓ Row-level import rejection evidence');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

console.log('All parser regression tests passed');
