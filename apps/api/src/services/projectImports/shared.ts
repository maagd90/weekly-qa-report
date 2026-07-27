import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export function now(): string {
  return new Date().toISOString();
}

export function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

export function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}
