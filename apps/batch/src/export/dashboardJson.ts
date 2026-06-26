import type { Dataset, DashboardPayload, GenerateParams } from '../types/dataset';

export function buildDashboardPayload(dataset: Dataset, params: GenerateParams): DashboardPayload {
  const years = [...new Set(dataset.weeklyLog.map((r) => r.year))].sort((a, b) => b - a);
  const weekMap = new Map<string, { year: number; week_number: number; week_start: string | null; week_end: string | null }>();

  for (const r of dataset.weeklyLog) {
    const key = `${r.year}-${r.week_number}`;
    if (!weekMap.has(key)) {
      weekMap.set(key, { year: r.year, week_number: r.week_number, week_start: r.week_start || null, week_end: r.week_end || null });
    }
  }
  for (const r of dataset.projectStatusWeekly) {
    const key = `${r.year}-${r.week_number}`;
    if (!weekMap.has(key)) {
      weekMap.set(key, { year: r.year, week_number: r.week_number, week_start: null, week_end: null });
    }
  }

  const starts = dataset.weeklyLog.map((r) => r.week_start).filter(Boolean) as string[];
  const ends = dataset.weeklyLog.map((r) => r.week_end).filter(Boolean) as string[];

  return {
    meta: {
      parsedAt: dataset.meta.parsedAt,
      generatedAt: new Date().toISOString(),
      sourceFiles: dataset.meta.sourceFiles,
      formats: dataset.meta.formats,
      warnings: dataset.meta.warnings,
      generateParams: params,
      years,
      weeks: [...weekMap.values()].sort((a, b) => a.year !== b.year ? b.year - a.year : b.week_number - a.week_number),
      dateRange: {
        minDate: starts.length ? starts.sort()[0] : null,
        maxDate: ends.length ? ends.sort().reverse()[0] : null,
      },
    },
    resources: dataset.resources,
    projects: dataset.projects,
    crs: dataset.crs,
    weeklyLog: dataset.weeklyLog,
    projectStatusWeekly: dataset.projectStatusWeekly,
  };
}
