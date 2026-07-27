import React, { useId } from 'react';
import clsx from 'clsx';
import type { KpiStyle } from '../../theme/qaTheme';

interface QaFilterBarProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  searchPlaceholder?: string;
  kpiStyle: KpiStyle;
  onKpiStyleChange: (s: KpiStyle) => void;
  dataMin?: string | null;
  dataMax?: string | null;
  showSearch?: boolean;
  onApplyDates?: () => void;
  datesChanged?: boolean;
  isApplyingDates?: boolean;
}

const KPI_OPTS: { id: KpiStyle; label: string }[] = [
  { id: 'editorial', label: 'Rule' },
  { id: 'framed', label: 'Tint' },
  { id: 'minimal', label: 'Bare' },
];

const inputDateClass = 'w-full min-w-0 max-w-full font-mono-qa text-xs py-[7px] px-2 border border-qa-ink bg-white text-qa-ink';

export function QaFilterBar(props: QaFilterBarProps) {
  const startDateId = useId();
  const endDateId = useId();
  const {
    startDate, endDate, onStartDateChange, onEndDateChange,
    search, onSearchChange,
    searchPlaceholder = 'Search the current tab...',
    kpiStyle, onKpiStyleChange,
    dataMin, dataMax,
    showSearch = true,
    onApplyDates,
    datesChanged = true,
    isApplyingDates = false,
  } = props;

  const dataRangeLabel = dataMin || dataMax ? `Data range ${dataMin || 'any'} → ${dataMax || 'any'}` : 'No data range limit';

  return (
    <div className="max-w-qa mx-auto px-4 py-3.5 flex min-w-0 flex-col items-stretch gap-3 border-b border-[#e7e3d9] sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:flex-wrap lg:gap-[18px] print:hidden">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (datesChanged) onApplyDates?.();
        }}
        className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto] lg:w-auto"
        aria-busy={isApplyingDates}
      >
        <span className="col-span-3 font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light sm:col-span-1" aria-hidden="true">Period</span>
        <label htmlFor={startDateId} className="sr-only">Reporting period start date</label>
        <input id={startDateId} type="date" value={startDate} min={dataMin || undefined} max={endDate || dataMax || undefined} onChange={(e) => onStartDateChange(e.target.value)} title={dataRangeLabel} aria-label="Reporting period start date" className={inputDateClass} />
        <span className="text-qa-muted-light text-xs" aria-hidden="true">→</span>
        <label htmlFor={endDateId} className="sr-only">Reporting period end date</label>
        <input id={endDateId} type="date" value={endDate} min={startDate || dataMin || undefined} max={dataMax || undefined} onChange={(e) => onEndDateChange(e.target.value)} title={dataRangeLabel} aria-label="Reporting period end date" className={inputDateClass} />
        {onApplyDates && (
          <button
            type="submit"
            disabled={isApplyingDates || !datesChanged || !startDate || !endDate}
            title={datesChanged ? 'Apply the selected period to the current tab' : 'Change a date to enable this button'}
            className="col-span-3 min-h-11 w-full whitespace-nowrap font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-3 py-[7px] border border-qa-ink bg-qa-ink text-[#F5F3ED] cursor-pointer disabled:opacity-50 disabled:cursor-wait sm:col-span-1 sm:min-h-0 sm:w-auto"
          >
            {isApplyingDates ? 'Applying...' : 'Apply dates'}
          </button>
        )}
      </form>

      {showSearch && <div className="flex min-h-11 w-full min-w-0 items-center gap-2 border border-qa-border-mid bg-white px-2.5 sm:min-h-0 sm:w-auto sm:flex-1 lg:max-w-[300px]">
        <span className="text-[13px] text-qa-muted-pale" aria-hidden="true">⌕</span>
        <input type="search" value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="w-full min-w-0 border-none outline-none bg-transparent font-sans text-[13px] text-qa-ink py-2 px-1 sm:w-[180px] sm:flex-1" />
        {search && <button type="button" onClick={() => onSearchChange('')} aria-label="Clear search" className="flex min-h-9 min-w-9 items-center justify-center border-none bg-transparent cursor-pointer text-qa-muted text-[18px] leading-none sm:min-h-0 sm:min-w-0 sm:p-0.5">×</button>}
      </div>}

      <div className="flex w-full min-w-0 items-center justify-between gap-2.5 sm:w-auto sm:justify-start lg:ml-auto">
        <span className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">Card style</span>
        <div className="flex min-w-0 border border-qa-border-mid" role="group" aria-label="Dashboard card style">
          {KPI_OPTS.map((opt) => (
            <button key={opt.id} type="button" aria-pressed={kpiStyle === opt.id} onClick={() => onKpiStyleChange(opt.id)} className={clsx('min-h-10 font-mono-qa text-[10px] sm:text-[11px] tracking-wide uppercase px-2.5 sm:min-h-0 sm:px-3 py-[7px] border-none cursor-pointer', kpiStyle === opt.id ? 'bg-qa-ink text-[#F5F3ED]' : 'bg-white text-qa-ink')}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
