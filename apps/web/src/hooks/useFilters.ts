import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { metaApi, type FilterParams } from '../lib/api';

export type FilterMode = 'week' | 'daterange';

export function useFilters() {
  const [mode, setMode] = useState<FilterMode>('week');

  // Week mode state
  const { data: years = [] } = useQuery({ queryKey: ['years'], queryFn: metaApi.years });
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  useEffect(() => {
    if (years.length > 0 && selectedYear === null) setSelectedYear(years[0]);
  }, [years, selectedYear]);

  const { data: weeks = [] } = useQuery({
    queryKey: ['weeks', selectedYear],
    queryFn: () => metaApi.weeks(selectedYear!),
    enabled: selectedYear !== null,
  });

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  useEffect(() => {
    if (weeks.length > 0 && selectedWeek === null) {
      setSelectedWeek(weeks[weeks.length - 1].week_number);
    }
  }, [weeks, selectedWeek]);

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    setSelectedWeek(null);
  };

  // Date range mode state
  const { data: dbRange } = useQuery({
    queryKey: ['date-range'],
    queryFn: metaApi.dateRange,
  });

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState<string>(weekAgo);
  const [endDate, setEndDate] = useState<string>(today);

  // Build the FilterParams object used by all API calls
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
    // week mode
    years,
    weeks,
    selectedYear,
    selectedWeek,
    setSelectedYear: handleYearChange,
    setSelectedWeek,
    // date range mode
    mode,
    setMode,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    dbRange,
    // combined
    filterParams,
    filterLabel,
  };
}
