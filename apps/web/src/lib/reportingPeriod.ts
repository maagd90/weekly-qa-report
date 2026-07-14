export const DEFAULT_REPORT_START_DATE = '2026-01-01';

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultReportingPeriod(): { startDate: string; endDate: string } {
  return { startDate: DEFAULT_REPORT_START_DATE, endDate: todayIsoDate() };
}
