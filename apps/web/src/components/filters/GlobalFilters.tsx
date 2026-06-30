import React from 'react';
import clsx from 'clsx';

interface GlobalFiltersProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  result: 'all' | 'PASS' | 'FAIL' | 'BLOCKED';
  onResultChange: (r: 'all' | 'PASS' | 'FAIL' | 'BLOCKED') => void;
  project: string;
  onProjectChange: (p: string) => void;
  projects: string[];
  generatedAt?: string;
}

export function GlobalFilters(props: GlobalFiltersProps) {
  const {
    startDate, endDate, onStartDateChange, onEndDateChange,
    search, onSearchChange, result, onResultChange,
    project, onProjectChange, projects, generatedAt,
  } = props;

  return (
    <div className="flex flex-wrap items-center gap-3 bg-white border-b border-slate-200 px-6 py-3 sticky top-0 z-10 shadow-sm">
      <input type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)}
        className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
      <span className="text-slate-400 text-sm">→</span>
      <input type="date" value={endDate} onChange={(e) => onEndDateChange(e.target.value)}
        className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />

      <input type="search" placeholder="Search…" value={search} onChange={(e) => onSearchChange(e.target.value)}
        className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-40" />

      <select value={result} onChange={(e) => onResultChange(e.target.value as typeof result)}
        className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
        <option value="all">All results</option>
        <option value="PASS">Pass</option>
        <option value="FAIL">Fail</option>
        <option value="BLOCKED">Blocked</option>
      </select>

      <select value={project} onChange={(e) => onProjectChange(e.target.value)}
        className={clsx('border border-slate-300 rounded-lg px-3 py-1.5 text-sm', projects.length <= 1 && 'opacity-50')}>
        {projects.map((p) => <option key={p} value={p}>{p === 'all' ? 'All projects' : p}</option>)}
      </select>

      {generatedAt && (
        <span className="ml-auto text-xs text-slate-400">Updated: {new Date(generatedAt).toLocaleString()}</span>
      )}
    </div>
  );
}
