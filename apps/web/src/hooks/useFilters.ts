import { useState, useEffect, useMemo } from 'react';
import type { DashboardPayload } from '../lib/dashboardCompute';
import type { FilterParams } from '../lib/api';

export type FilterMode = 'week' | 'daterange';

export interface WeekOption {
  week_number: number;
  week_start: string | null;
  week_end: string | null;
}

export function useFilters(dashboard: DashboardPayload | undefined) {
  const [mode, setMode] = useState<FilterMode>('week');

  const years = dashboard?.meta.years ?? [];
  const weeks: WeekOption[] = useMemo(
    () => (dashboard?.meta.weeks ?? []).map((w) => ({
      week_number: w.week_number,
      week_start: w.week_start,
      week_end: w.week_end,
    })),
    [dashboard]
  );

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  useEffect(() => {
    if (years.length > 0 && selectedYear === null) setSelectedYear(years[0]);
  }, [years, selectedYear]);

  useEffect(() => {
    if (weeks.length > 0 && selectedWeek === null) {
      setSelectedWeek(weeks[0].week_number);
    }
  }, [weeks, selectedWeek]);

  const gp = dashboard?.meta.generateParams;
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(gp?.startDate || weekAgo);
  const [endDate, setEndDate] = useState(gp?.endDate || today);

  useEffect(() => {
    if (gp?.startDate) setStartDate(gp.startDate);
    if (gp?.endDate) setEndDate(gp.endDate);
  }, [gp?.startDate, gp?.endDate]);

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    setSelectedWeek(null);
  };

  const filterParams: FilterParams | null =
    mode === 'daterange'
      ? { startDate, endDate }
      : selectedYear && selectedWeek
      ? { year: selectedYear, week: selectedWeek }
      : null;

  const filterLabel =
    mode === 'daterange'
      ? `${startDate} → ${endDate}`
      : selectedWeek
      ? `Week ${selectedWeek}, ${selectedYear}`
      : '';

  return {
    years,
    weeks,
    selectedYear,
    selectedWeek,
    setSelectedYear: handleYearChange,
    setSelectedWeek,
    mode,
    setMode,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    filterParams,
    filterLabel,
    generatedAt: dashboard?.meta.generatedAt,
  };
}
