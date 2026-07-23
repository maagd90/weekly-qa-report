import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { inspectWorkbookColumns, parseMappedWorkbook } from '../mappedImport';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-mapped-import-'));
const workbookPath = path.join(root, 'project-c.xlsx');

try {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Ticket', 'Score', 'Active', 'Submitted'],
    ['C-1', 42, 'Yes', '2026-07-01'],
    ['C-2', 'not-a-number', 'Yes', '2026-07-02'],
    ['C-1', 50, 'No', '2026-07-03'],
    ['', 60, 'Yes', '2026-07-04'],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
  XLSX.writeFile(workbook, workbookPath);

  const inspection = inspectWorkbookColumns(workbookPath);
  assert.deepStrictEqual(inspection.headers, ['Ticket', 'Score', 'Active', 'Submitted']);
  assert.equal(inspection.rowCount, 4);

  const parsed = parseMappedWorkbook(workbookPath, {
    version: 1,
    headerSignature: inspection.headerSignature,
    uniqueKey: 'ticket',
    createdAt: '2026-07-23T00:00:00.000Z',
    columns: [
      { fieldKey: 'ticket', sourceHeader: 'Ticket', label: 'Ticket', type: 'text', visible: true, filterable: true, searchable: true, required: true },
      { fieldKey: 'score', sourceHeader: 'Score', label: 'Score', type: 'number', visible: true, filterable: true, searchable: true },
      { fieldKey: 'active', sourceHeader: 'Active', label: 'Active', type: 'boolean', visible: true, filterable: true, searchable: true },
      { fieldKey: 'submitted', sourceHeader: 'Submitted', label: 'Submitted', type: 'date', visible: true, filterable: true, searchable: true },
    ],
  });

  assert.equal(parsed.rows.length, 1);
  assert.deepStrictEqual(parsed.rows[0].values, {
    ticket: 'C-1',
    score: 42,
    active: true,
    submitted: '2026-07-01',
  });
  assert.equal(parsed.rejections.length, 3);
  assert.match(parsed.rejections[0].reason, /valid number/i);
  assert.match(parsed.rejections[1].reason, /duplicate unique record/i);
  assert.match(parsed.rejections[2].reason, /Ticket is required/i);
  assert.throws(
    () => parseMappedWorkbook(workbookPath, {
      version: 2,
      headerSignature: 'different-schema',
      columns: [],
      uniqueKey: 'ticket',
      createdAt: '2026-07-23T00:00:00.000Z',
    }),
    /headers do not match/i,
  );
  console.log('mapped import profile tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
