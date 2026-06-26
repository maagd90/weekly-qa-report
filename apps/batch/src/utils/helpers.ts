export function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

export function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : Math.max(0, n);
}

export function clamp100(v: unknown): number {
  const n = Number(v);
  if (isNaN(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}
