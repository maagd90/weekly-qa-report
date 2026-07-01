import fs from 'fs';
import * as XLSX from 'xlsx';

export interface WorkbookData {
  sheetName: string;
  rows: unknown[][];
}

export function readWorkbookRows(
  filePath: string,
  preferredSheets?: string[],
): WorkbookData {
  const buffer = fs.readFileSync(filePath);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  let sheetName = wb.SheetNames[0];
  if (preferredSheets?.length) {
    const found = preferredSheets.find((n) => wb.SheetNames.includes(n));
    if (found) sheetName = found;
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: '',
  }) as unknown[][];
  return { sheetName, rows };
}
