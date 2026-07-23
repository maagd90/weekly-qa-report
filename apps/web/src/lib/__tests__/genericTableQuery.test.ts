import assert from 'node:assert/strict';
import { compileGenericTableQuery } from '../genericTableQuery.ts';
import type { ProjectColumnConfig, ProjectTabRow } from '../api.ts';

const columns: ProjectColumnConfig[] = [
  { fieldKey: 'ticket', sourceHeader: 'Ticket ID', label: 'Ticket', type: 'text', visible: true, filterable: true, searchable: true },
  { fieldKey: 'status', sourceHeader: 'Current Status', label: 'Status', type: 'text', visible: true, filterable: true, searchable: true },
  { fieldKey: 'effort', sourceHeader: 'Effort', label: 'Effort', type: 'number', visible: true, filterable: true, searchable: false },
  { fieldKey: 'submitted', sourceHeader: 'Submitted', label: 'Submitted', type: 'date', visible: true, filterable: true, searchable: true },
];

const rows: ProjectTabRow[] = [
  {
    id: 'one',
    projectId: 'project-c',
    tabId: 'tab-c',
    importProfileVersion: 1,
    sourceFileId: 'file-1',
    sourceFile: 'project-c.xlsx',
    sourceRow: 2,
    importedAt: '2026-07-23T00:00:00.000Z',
    values: { ticket: 'PC-1', status: 'Pending', effort: 3, submitted: '2026-07-20' },
  },
  {
    id: 'two',
    projectId: 'project-c',
    tabId: 'tab-c',
    importProfileVersion: 1,
    sourceFileId: 'file-1',
    sourceFile: 'project-c.xlsx',
    sourceRow: 3,
    importedAt: '2026-07-23T00:00:00.000Z',
    values: { ticket: 'PC-2', status: 'Closed', effort: 8, submitted: '2026-07-22' },
  },
];

const combined = compileGenericTableQuery('status = "Pending" AND effort < 5', columns);
assert.ok(combined.predicate);
assert.deepEqual(rows.filter(combined.predicate!), [rows[0]]);

const grouped = compileGenericTableQuery('(status = "Pending" OR status = "Closed") AND submitted >= "2026-07-21"', columns);
assert.ok(grouped.predicate);
assert.deepEqual(rows.filter(grouped.predicate!), [rows[1]]);

assert.match(compileGenericTableQuery('hidden = "secret"', columns).error || '', /unknown or unavailable field/i);
assert.match(compileGenericTableQuery('effort ~ "8"', columns).error || '', /not supported/i);
assert.match(compileGenericTableQuery('submitted >= "23-Jul-2026"', columns).error || '', /YYYY-MM-DD/i);

console.log('Generic project-tab advanced search tests passed');
