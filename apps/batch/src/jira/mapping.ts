import fs from 'fs';
import path from 'path';
import { basename } from '../utils/helpers';

export interface SavedMapping {
  pattern: string;
  mapping: Record<string, string>;
  weekYear?: number;
  weekNumber?: number;
}

export function mappingsDir(configDir: string): string {
  return path.join(configDir, 'mappings');
}

export function loadMappingForFile(configDir: string, filename: string): SavedMapping | null {
  const dir = mappingsDir(configDir);
  if (!fs.existsSync(dir)) return null;
  const base = basename(filename).replace(/\.[^.]+$/, '');
  const exact = path.join(dir, `${base}.json`);
  if (fs.existsSync(exact)) {
    return JSON.parse(fs.readFileSync(exact, 'utf8')) as SavedMapping;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const saved = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as SavedMapping;
    if (base.includes(saved.pattern) || saved.pattern.includes(base)) return saved;
  }
  return null;
}

export function saveMapping(configDir: string, pattern: string, mapping: Record<string, string>, weekYear?: number, weekNumber?: number): void {
  const dir = mappingsDir(configDir);
  fs.mkdirSync(dir, { recursive: true });
  const payload: SavedMapping = { pattern, mapping, weekYear, weekNumber };
  fs.writeFileSync(path.join(dir, `${pattern}.json`), JSON.stringify(payload, null, 2));
}

export function listMappings(configDir: string): SavedMapping[] {
  const dir = mappingsDir(configDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as SavedMapping);
}

export function applyColumnMapping(rows: Record<string, unknown>[], mapping: Record<string, string>): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [src, val] of Object.entries(row)) {
      const target = mapping[src];
      if (target) out[target] = val;
    }
    return out;
  });
}
