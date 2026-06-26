/**
 * Build a SQL WHERE clause that filters weekly_log by either
 * (year + week_number) or (startDate/endDate date range).
 *
 * Returns { clause, params } where params are bound in order.
 */
export function buildWeeklyLogFilter(
  year?: number,
  week?: number,
  startDate?: string,
  endDate?: string
): { clause: string; params: (number | string)[] } {
  if (startDate && endDate) {
    return {
      clause: `wl.week_start <= ? AND wl.week_end >= ?`,
      params: [endDate, startDate],
    };
  }
  if (year && week) {
    return {
      clause: `wl.year = ? AND wl.week_number = ?`,
      params: [year, week],
    };
  }
  if (year) {
    return { clause: `wl.year = ?`, params: [year] };
  }
  return { clause: '1=1', params: [] };
}

/**
 * Compute the ISO Monday and Sunday for a given year+week using JavaScript.
 * Returns { weekStart: "YYYY-MM-DD", weekEnd: "YYYY-MM-DD" }
 */
export function isoWeekToDates(year: number, week: number): { weekStart: string; weekEnd: string } {
  // Jan 4th is always in week 1 of the ISO year
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // Mon=1 … Sun=7
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1));

  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { weekStart: fmt(monday), weekEnd: fmt(sunday) };
}

/**
 * Build a WHERE clause that filters project_status_weekly by date range.
 * Since that table has no week_start/end, we compute them from ISO week.
 *
 * We use a SQLite expression that derives the week bounds and compares.
 * For simplicity, we pre-compute the overlapping week numbers from startDate/endDate.
 */
export function weeksOverlappingRange(
  startDate: string,
  endDate: string
): { year: number; weeks: number[] } | null {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

  const year = start.getUTCFullYear();
  const results: number[] = [];

  // Walk through each week of the year to find overlapping ones
  for (let week = 1; week <= 53; week++) {
    const { weekStart, weekEnd } = isoWeekToDates(year, week);
    const ws = new Date(weekStart);
    const we = new Date(weekEnd);
    // Overlap check: week overlaps [start, end] if ws <= endDate AND we >= startDate
    if (ws <= end && we >= start) {
      results.push(week);
    }
    // Stop if we've passed the end date by more than a week
    if (ws > end) break;
  }

  return { year, weeks: results };
}

export function buildProjectStatusFilter(
  year?: number,
  week?: number,
  startDate?: string,
  endDate?: string
): { clause: string; params: (number | string)[] } {
  if (startDate && endDate) {
    const overlap = weeksOverlappingRange(startDate, endDate);
    if (!overlap || overlap.weeks.length === 0) {
      return { clause: '1=0', params: [] }; // no matching weeks
    }
    const placeholders = overlap.weeks.map(() => '?').join(',');
    return {
      clause: `psw.year = ? AND psw.week_number IN (${placeholders})`,
      params: [overlap.year, ...overlap.weeks],
    };
  }
  if (year && week) {
    return { clause: `psw.year = ? AND psw.week_number = ?`, params: [year, week] };
  }
  if (year) {
    return { clause: `psw.year = ?`, params: [year] };
  }
  return { clause: '1=1', params: [] };
}
