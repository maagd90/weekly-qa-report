import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const OUT = path.resolve(__dirname, '../../../fixtures/synthetic');

function writeSheet(fileName: string, sheetName: string, rows: unknown[][]) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  fs.mkdirSync(OUT, { recursive: true });
  XLSX.writeFile(wb, path.join(OUT, fileName));
}

// Zephyr — 2210 rows with exact result mix; April subset for filter tests
{
  const headers = [
    'Test Cycle Key', 'Test Cycle Summary', 'Test Case Key',
    'Testcase/Teststep Execution Result', 'Executed By', 'Executed On',
  ];
  const rows: unknown[][] = [headers];
  const mix: [string, number][] = [
    ['PASS', 1319], ['NOT EXECUTED', 715], ['BLOCKED', 109], ['FAIL', 46], ['NOT APPLICABLE', 21],
  ];
  type Row = { result: string; executedOn: string };
  const data: Row[] = [];
  let idx = 0;
  for (const [result, count] of mix) {
    for (let i = 0; i < count; i++) {
      idx++;
      const executedOn = result !== 'NOT EXECUTED' ? '15/Mar/2026 10:00:00' : '';
      data.push({ result, executedOn });
    }
  }

  // April window: 302 executed rows (21 FAIL + 51 BLOCKED + 230 PASS) without changing result totals
  const aprilDate = '15/Apr/2026 10:00:00';
  let failSet = 0;
  let blockedSet = 0;
  let passSet = 0;
  for (const row of data) {
    if (row.result === 'FAIL' && failSet < 21) {
      row.executedOn = aprilDate;
      failSet++;
    } else if (row.result === 'BLOCKED' && blockedSet < 51) {
      row.executedOn = aprilDate;
      blockedSet++;
    } else if (row.result === 'PASS' && passSet < 230) {
      row.executedOn = aprilDate;
      passSet++;
    }
  }

  for (let i = 0; i < data.length; i++) {
    rows.push([
      'DLM-TR-1', 'Cycle Alpha', `DLM-TC-${i + 1}`, data[i].result,
      'Tester A', data[i].executedOn,
    ]);
  }
  writeSheet('zephyr-regression.xlsx', 'Data', rows);
  console.log('Wrote zephyr-regression.xlsx', rows.length - 1, 'rows');
}

// JIRA — 779 issues (582 Story, 197 Bug; 63 open bugs)
{
  const rows: unknown[][] = [
    ['Title banner'], [], [],
    ['Key', 'Issue Type', 'Summary', 'Status', 'Priority', 'Assignee', 'Created', 'Updated', 'Resolved'],
  ];
  const excelDate = (iso: string) => {
    const d = new Date(iso);
    return (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
  };
  for (let i = 1; i <= 582; i++) {
    rows.push([
      `DLM-${10000 + i}`, 'Story', `Story area ${i % 5}`, 'Done', 'Medium', 'User A',
      excelDate('2025-01-15'), excelDate('2026-03-01'), excelDate('2026-02-01'),
    ]);
  }
  for (let i = 1; i <= 197; i++) {
    const open = i <= 63;
    rows.push([
      `DLM-${20000 + i}`, 'Bug', `Bug Global DMC ${i}`, open ? 'Open' : 'Done',
      i <= 48 ? 'Highest' : 'Medium', 'User B',
      excelDate('2025-06-01'), excelDate('2026-04-15'), open ? '' : excelDate('2026-05-01'),
    ]);
  }
  writeSheet('jira-regression.xlsx', 'general_report', rows);
  console.log('Wrote jira-regression.xlsx', 779, 'issues');
}

// ODL — 74 UAT (43 closed, 31 open)
{
  const headers = ['TicketID', 'Subject', 'ProductArea', 'Change Request', 'odlPriorityDescription',
    'Client_Priority', 'Submittedby', 'Submittedon', 'Status', 'LastUpdate'];
  const rows: unknown[][] = [headers];
  const excelDate = (iso: string) => {
    const d = new Date(iso);
    return (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
  };
  for (let i = 1; i <= 74; i++) {
    const closed = i <= 43;
    const subject = i <= 32
      ? `UAT Booking issue ${i}`
      : i <= 54
        ? `Phase 2B UAT Booking issue ${i}`
        : i <= 70
          ? `INC${String(i).padStart(6, '0')} Production issue ${i}`
          : `Booking issue without prefix ${i}`;
    rows.push([
      `UAT-${i}`, subject, 'Bookings', 'AA-1', 'High', 'P1', 'Submitter',
      excelDate('2026-05-01'), closed ? 'Closed' : 'Pending', excelDate('2026-06-01'),
    ]);
  }
  writeSheet('odl-regression.xlsx', 'IssueLogData', rows);
  console.log('Wrote odl-regression.xlsx', 74, 'rows');
}

console.log('Synthetic fixtures written to', OUT);
