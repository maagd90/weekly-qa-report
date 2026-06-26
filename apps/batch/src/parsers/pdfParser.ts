export async function extractPdfRows(filePath: string): Promise<{ headers: string[]; rows: string[][]; text: string }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse');
  const fs = require('fs') as typeof import('fs');
  const parsed = await pdfParse(fs.readFileSync(filePath));
  const text: string = parsed.text || '';
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  const rows: string[][] = [];
  for (const line of lines) {
    const cells = line.split(/\s{2,}|\t/).map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length >= 2) rows.push(cells);
  }
  const headers = rows.length > 0 ? rows[0] : [];
  return { headers, rows: rows.slice(1), text: text.slice(0, 5000) };
}

export function pdfRowsToObjects(headers: string[], dataRows: string[][]): Record<string, unknown>[] {
  return dataRows.map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
}
