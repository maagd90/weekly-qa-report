import type { Dataset, WeeklyLogRow, ProjectStatusRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';

export function mergeDatasets(parts: Dataset[]): Dataset {
  const merged = emptyDataset();
  const resourceIds = new Set<string>();
  const projectIds = new Set<string>();
  const crIds = new Set<string>();
  const logKeys = new Set<string>();
  const statusKeys = new Set<string>();

  for (const part of parts) {
    merged.meta.sourceFiles.push(...part.meta.sourceFiles);
    merged.meta.formats.push(...part.meta.formats);
    merged.meta.warnings.push(...part.meta.warnings);

    for (const r of part.resources) {
      if (!resourceIds.has(r.resource_id)) {
        resourceIds.add(r.resource_id);
        merged.resources.push(r);
      }
    }
    for (const p of part.projects) {
      if (!projectIds.has(p.project_id)) {
        projectIds.add(p.project_id);
        merged.projects.push(p);
      }
    }
    for (const c of part.crs) {
      if (!crIds.has(c.cr_id)) {
        crIds.add(c.cr_id);
        merged.crs.push(c);
      }
    }
    for (const w of part.weeklyLog) {
      const key = `${w.year}|${w.week_number}|${w.resource_id}|${w.cr_id}`;
      if (!logKeys.has(key)) {
        logKeys.add(key);
        merged.weeklyLog.push(w);
      }
    }
    for (const s of part.projectStatusWeekly) {
      const key = `${s.year}|${s.week_number}|${s.project_id}`;
      if (!statusKeys.has(key)) {
        statusKeys.add(key);
        merged.projectStatusWeekly.push(s);
      }
    }
  }

  merged.meta.parsedAt = new Date().toISOString();
  return merged;
}

export function filterWeeklyLog(
  rows: WeeklyLogRow[],
  opts: { year?: number; week?: number; startDate?: string; endDate?: string }
): WeeklyLogRow[] {
  if (opts.startDate && opts.endDate) {
    return rows.filter((r) => r.week_start && r.week_end && r.week_start <= opts.endDate! && r.week_end >= opts.startDate!);
  }
  if (opts.year && opts.week) {
    return rows.filter((r) => r.year === opts.year && r.week_number === opts.week);
  }
  if (opts.year) return rows.filter((r) => r.year === opts.year);
  return rows;
}

export function filterProjectStatus(
  rows: ProjectStatusRow[],
  opts: { year?: number; week?: number; startDate?: string; endDate?: string }
): ProjectStatusRow[] {
  if (opts.startDate && opts.endDate) {
    const overlap = weeksOverlappingRange(opts.startDate, opts.endDate);
    if (!overlap) return [];
    return rows.filter((r) => r.year === overlap.year && overlap.weeks.includes(r.week_number));
  }
  if (opts.year && opts.week) {
    return rows.filter((r) => r.year === opts.year && r.week_number === opts.week);
  }
  if (opts.year) return rows.filter((r) => r.year === opts.year);
  return rows;
}

export function isoWeekToDates(year: number, week: number): { weekStart: string; weekEnd: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { weekStart: fmt(monday), weekEnd: fmt(sunday) };
}

export function weeksOverlappingRange(startDate: string, endDate: string): { year: number; weeks: number[] } | null {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  const year = start.getUTCFullYear();
  const results: number[] = [];
  for (let week = 1; week <= 53; week++) {
    const { weekStart, weekEnd } = isoWeekToDates(year, week);
    const ws = new Date(weekStart);
    const we = new Date(weekEnd);
    if (ws <= end && we >= start) results.push(week);
    if (ws > end) break;
  }
  return { year, weeks: results };
}
