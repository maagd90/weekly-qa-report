import React from 'react';
import { Calendar, List } from 'lucide-react';
import clsx from 'clsx';
import type { FilterMode } from '../../hooks/useFilters';

interface WeekOption {
  week_number: number;
  week_start: string | null;
  week_end: string | null;
}

interface GlobalFiltersProps {
  years: number[];
  weeks: WeekOption[];
  selectedYear: number | null;
  selectedWeek: number | null;
  onYearChange: (y: number) => void;
  onWeekChange: (w: number) => void;
  mode: FilterMode;
  onModeChange: (m: FilterMode) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
  generatedAt?: string;
}

export function GlobalFilters(props: GlobalFiltersProps) {
  const {
    years, weeks, selectedYear, selectedWeek, onYearChange, onWeekChange,
    mode, onModeChange, startDate, endDate, onStartDateChange, onEndDateChange, generatedAt,
  } = props;

  return (
    <div className="flex flex-wrap items-center gap-3 bg-white border-b border-slate-200 px-6 py-3 sticky top-0 z-10 shadow-sm">
      <div className="flex rounded-lg border border-slate-200 overflow-hidden">
        <button onClick={() => onModeChange('week')} className={clsx('flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition', mode === 'week' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}>
          <List size={12} /> Week
        </button>
        <button onClick={() => onModeChange('daterange')} className={clsx('flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition', mode === 'daterange' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}>
          <Calendar size={12} /> Date Range
        </button>
      </div>

      {mode === 'week' ? (
        <>
          <select className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" value={selectedYear ?? ''} onChange={(e) => onYearChange(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" value={selectedWeek ?? ''} onChange={(e) => onWeekChange(Number(e.target.value))}>
            {weeks.map((w) => <option key={w.week_number} value={w.week_number}>Week {w.week_number}</option>)}
          </select>
        </>
      ) : (
        <>
          <input type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          <input type="date" value={endDate} onChange={(e) => onEndDateChange(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        </>
      )}

      {generatedAt && (
        <span className="ml-auto text-xs text-slate-400">Generated: {new Date(generatedAt).toLocaleString()}</span>
      )}
    </div>
  );
}
