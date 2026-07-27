import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DashboardUatRow, DashboardWorkItem } from 'qa-dashboard-batch';
import { DetailDrawerBase } from '../DetailDrawerBase.tsx';
import { UatBugDetailDrawer } from '../UatBugDetailDrawer.tsx';
import { WonderMilesDetailDrawer } from '../WonderMilesDetailDrawer.tsx';

const vendorBug: DashboardUatRow = {
  id: 'VP-100',
  subject: 'Payment confirmation fails',
  area: 'Payments',
  cr: 'CR-100',
  priority: 'High',
  clientPriority: 'Urgent',
  status: 'In Testing',
  submitter: 'QA Reporter',
  updatedBy: 'Vendor User',
  submittedAt: '2026-07-01',
  updatedAt: '2026-07-12T08:30:00.000Z',
  note: 'Fix deployed for retest',
  reportedPhase: 'phase1-uat',
  sourceFile: '123_vendor-export.xlsx',
};

const vendorHtml = renderToStaticMarkup(<UatBugDetailDrawer bug={vendorBug} onClose={() => undefined} />);
for (const expected of [
  'Bug VP-100',
  'Ticket ID',
  'Payment confirmation fails',
  'Last Updated At',
  'Last Updated By',
  'Vendor User',
  'Latest Note',
  'Fix deployed for retest',
  'vendor-export.xlsx',
]) {
  assert.match(vendorHtml, new RegExp(expected));
}
assert.match(vendorHtml, /role="dialog"/);
assert.match(vendorHtml, /aria-modal="true"/);

const wonderMilesItem: DashboardWorkItem = {
  key: 'WM-101',
  summary: 'Checkout story',
  issueType: 'Story',
  status: 'open',
  priority: 'High',
  assignee: 'QA Owner',
  updatedBy: 'Vendor User',
  sprint: 'Sprint 9',
  area: 'Checkout',
  environment: 'UAT',
  changeRequest: 'CR-441',
  project: 'WM',
  createdAt: '2026-07-01',
  updatedAt: '2026-07-12',
  sourceFile: '456_wonder-miles.xlsx',
};

const wonderHtml = renderToStaticMarkup(<WonderMilesDetailDrawer story={wonderMilesItem} onClose={() => undefined} />);
for (const expected of [
  'WM-101: Checkout story',
  'Summary',
  'Environment',
  'Change Request',
  'Assignee',
  'Created',
  'Last Updated At',
  'Source File',
  'wonder-miles.xlsx',
]) {
  assert.match(wonderHtml, new RegExp(expected));
}

const closedHtml = renderToStaticMarkup(
  <DetailDrawerBase isOpen={false} title="Hidden" onClose={() => undefined}>Hidden content</DetailDrawerBase>,
);
assert.strictEqual(closedHtml, '');

console.log('External data detail drawer rendering tests passed');
