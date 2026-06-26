import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Calendar, List } from 'lucide-react';
import clsx from 'clsx';
import { importApi } from '../../lib/api';
import type { FilterMode } from '../../hooks/useFilters';

interface WeekOption {
  week_number: number;
  week_start: string | null;
  week_end: string | null;
}

interface GlobalFiltersProps {
  // Week mode
  years: number[];
  weeks: WeekOption[];
  selectedYear: number | null;
  selectedWeek: number | null;
  onYearChange: (y: number) => void;
  onWeekChange: (w: number) => void;
  // Date range mode
  mode: FilterMode;
  onModeChange: (m: FilterMode) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
}

export function GlobalFilters({
  years, weeks, selectedYear, selectedWeek, onYearChange, onWeekChange,
  mode, onModeChange, startDate, endDate, onStartDateChange, onEndDateChange,
}: GlobalFiltersProps) {
  const queryClient = useQueryClient();
  const { data: importStatus } = useQuery({
    queryKey: ['import-status'],
    queryFn: importApi.status,
    refetchInterval: 30_000,
  });

  const refreshMutation = useMutation({
    mutationFn: importApi.refresh,
    onSuccess: () => { queryClient.invalidateQueries(); },
  });

  const lastImport = importStatus?.importedAt
    ? new Date(importStatus.importedAt).toLocaleString()
    : null;

  return (
    <div className="flex flex-wrap items-center gap-3 bg-white border-b border-slate-200 px-6 py-3 sticky top-0 z-10 shadow-sm">
      {/* Mode toggle */}
      <div className="flex rounded-lg border border-slate-200 overflow-hidden">
        <button
          onClick={() => onModeChange('week')}
          className={clsx('flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition', mode === 'week' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}
        >
          <List size={12} /> Week
        </button>
        <button
          onClick={() => onModeChange('daterange')}
          className={clsx('flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition', mode === 'daterange' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}
        >
          <Calendar size={12} /> Date Range
        </button>
      </div>

      {mode === 'week' ? (
        <>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 font-medium">Year</label>
            <select
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={selectedYear ?? ''}
              onChange={(e) => onYearChange(Number(e.target.value))}
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 font-medium">Week</label>
            <select
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={selectedWeek ?? ''}
              onChange={(e) => onWeekChange(Number(e.target.value))}
            >
              {weeks.map((w) => (
                <option key={w.week_number} value={w.week_number}>
                  Week {w.week_number}{w.week_start ? ` (${w.week_start})` : ''}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 font-medium">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 font-medium">To</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-3">
        {lastImport && <span className="text-xs text-slate-400 hidden sm:block">Last import: {lastImport}</span>}
        <button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded-lg transition disabled:opacity-60"
        >
          <RefreshCw size={14} className={refreshMutation.isPending ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
    </div>
  );
}
