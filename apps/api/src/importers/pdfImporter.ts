import fs from 'fs';

export interface RawPdfData {
  text: string;
  rows: string[][];
  headers: string[];
}

export async function extractPdfData(filePath: string): Promise<RawPdfData> {
  // Dynamically require pdf-parse to avoid test-environment issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const parsed = await pdfParse(dataBuffer);

  const text: string = parsed.text || '';
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);

  // Attempt to detect a table structure: lines where values are separated by
  // 2+ spaces or tab characters
  const rows: string[][] = [];
  for (const line of lines) {
    // Split on 2+ whitespace or tabs
    const cells = line.split(/\s{2,}|\t/).map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length >= 2) {
      rows.push(cells);
    }
  }

  const headers = rows.length > 0 ? rows[0] : [];
  const dataRows = rows.slice(1);

  return { text, rows: dataRows, headers };
}
