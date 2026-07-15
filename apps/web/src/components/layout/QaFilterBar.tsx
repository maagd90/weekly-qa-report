import React from 'react';
import clsx from 'clsx';
import type { KpiStyle } from '../../theme/qaTheme';
import { QA } from '../../theme/qaTheme';

interface QaFilterBarProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  result: 'all' | 'PASS' | 'FAIL' | 'BLOCKED';
  onResultChange: (r: 'all' | 'PASS' | 'FAIL' | 'BLOCKED') => void;
  kpiStyle: KpiStyle;
  onKpiStyleChange: (s: KpiStyle) => void;
  showResult?: boolean;
  dataMin?: string | null;
  dataMax?: string | null;
  onSearchApis?: () => void;
  searchApisLabel?: string;
  isSearchingApis?: boolean;
}

const FOCUS_CHIPS: { id: 'all' | 'PASS' | 'FAIL' | 'BLOCKED'; label: string; color: string }[] = [
  { id: 'all', label: 'All', color: QA.ink },
  { id: 'PASS', label: 'Pass', color: QA.PASS },
  { id: 'FAIL', label: 'Fail', color: QA.FAIL },
  { id: 'BLOCKED', label: 'Blocked', color: QA.BLOCKED },
];

const KPI_OPTS: { id: KpiStyle; label: string }[] = [
  { id: 'editorial', label: 'Rule' },
  { id: 'framed', label: 'Tint' },
  { id: 'minimal', label: 'Bare' },
];

const inputDateClass = 'font-mono-qa text-xs py-[7px] px-2 border border-qa-ink bg-white text-qa-ink';

export function QaFilterBar(props: QaFilterBarProps) {
  const {
    startDate, endDate, onStartDateChange, onEndDateChange,
    search, onSearchChange, result, onResultChange,
    kpiStyle, onKpiStyleChange,
    showResult = true,
    dataMin, dataMax,
    onSearchApis,
    searchApisLabel = 'Search',
    isSearchingApis = false,
  } = props;

  const dataRangeLabel = dataMin || dataMax ? `Data range ${dataMin || 'any'} → ${dataMax || 'any'}` : 'No data range limit';

  return (
    <div className="max-w-qa mx-auto px-8 py-3.5 flex items-center gap-[18px] flex-wrap border-b border-[#e7e3d9] print:hidden">
      <div className="flex items-center gap-2">
        <span className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">Period</span>
        <input type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)} title={dataRangeLabel} className={inputDateClass} />
        <span className="text-qa-muted-light text-xs">→</span>
        <input type="date" value={endDate} onChange={(e) => onEndDateChange(e.target.value)} title={dataRangeLabel} className={inputDateClass} />
        {onSearchApis && (
          <button
            type="button"
            onClick={onSearchApis}
            disabled={isSearchingApis || !startDate || !endDate}
            title="Search latest live API and cached/imported data using the selected filters"
            className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-3 py-[7px] border border-qa-ink bg-qa-ink text-[#F5F3ED] cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          >
            {isSearchingApis ? 'Searching...' : searchApisLabel}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 border border-qa-border-mid bg-white px-2.5">
        <span className="text-[13px] text-qa-muted-pale">⚲</span>
        <input type="text" value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search cycles, Quality Assurance, keys..." className="border-none outline-none bg-transparent font-sans text-[13px] text-qa-ink py-2 px-1 w-[180px]" />
        {search && <button type="button" onClick={() => onSearchChange('')} className="border-none bg-transparent cursor-pointer text-qa-muted-pale text-[15px] leading-none p-0.5">×</button>}
      </div>

      {showResult && (
        <div className="flex items-center gap-2.5">
          <span className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">Result</span>
          <div className="flex gap-1.5 flex-wrap">
            {FOCUS_CHIPS.map((c) => {
              const active = result === c.id;
              return (
                <button key={c.id} type="button" onClick={() => onResultChange(c.id)} className={clsx('flex items-center gap-1.5 whitespace-nowrap font-mono-qa text-[11px] tracking-wide px-[11px] py-1.5 cursor-pointer border', active ? 'bg-qa-ink text-[#F5F3ED] border-qa-ink' : 'bg-white text-qa-ink border-qa-border-mid')}>
                  {c.id !== 'all' && <span className="w-2 h-2 shrink-0" style={{ background: c.color }} />}
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2.5">
        <span className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">Card style</span>
        <div className="flex border border-qa-border-mid">
          {KPI_OPTS.map((opt) => (
            <button key={opt.id} type="button" onClick={() => onKpiStyleChange(opt.id)} className={clsx('font-mono-qa text-[11px] tracking-wide uppercase px-3 py-[7px] border-none cursor-pointer', kpiStyle === opt.id ? 'bg-qa-ink text-[#F5F3ED]' : 'bg-white text-qa-ink')}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
