const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function excelSerialToIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 0) {
    const ms = Date.UTC(1899, 11, 30) + value * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

export function parseZephyrDate(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === 'NOT EXECUTED') return null;
  const m = trimmed.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = MONTHS[m[2]];
  const year = parseInt(m[3], 10);
  if (mon === undefined) return null;
  return `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/â€"/g, '–').replace(/\u00a0/g, ' ').trim();
}

export function projectFromKey(key: string): string {
  const m = key.match(/^([A-Z]+)-/);
  return m ? m[1] : 'UNKNOWN';
}

export function findHeaderRow(rows: unknown[][], required: string[], maxScan = 8): number {
  for (let i = 0; i < Math.min(maxScan, rows.length); i++) {
    const headers = (rows[i] as unknown[]).map((h) => sanitizeText(h));
    if (required.every((r) => headers.includes(r))) return i;
  }
  return -1;
}

export function rowToObject(headers: string[], row: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  headers.forEach((h, i) => {
    if (h) obj[h] = row[i];
  });
  return obj;
}

export function mapExecutionResult(raw: unknown): import('../types/dataset').ExecutionResult {
  const v = sanitizeText(raw).toUpperCase();
  if (v === 'PASS' || v === 'P') return 'PASS';
  if (v === 'FAIL' || v === 'F') return 'FAIL';
  if (v === 'BLOCKED' || v === 'B') return 'BLOCKED';
  if (v === 'NOT APPLICABLE' || v === 'A' || v === 'NA') return 'NA';
  if (v === 'NOT EXECUTED' || v === 'N') return 'NE';
  return 'NE';
}

export function mapJiraStatus(status: string, doneStatuses: string[]): import('../types/dataset').IssueStatus {
  const s = sanitizeText(status);
  return doneStatuses.some((d) => d.toLowerCase() === s.toLowerCase()) ? 'done' : 'open';
}
