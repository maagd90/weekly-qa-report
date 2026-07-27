import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { batchApi } from '../lib/api';
import type { ProjectColumnConfig, ProjectRecord, ProjectTabRow } from '../lib/api';
import { compileGenericTableQuery } from '../lib/genericTableQuery';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';

interface ProjectDataPageProps {
  project: ProjectRecord;
  tabId: string;
  startDate: string;
  endDate: string;
}

type SearchMode = 'basic' | 'advanced';
const PAGE_SIZE = 25;

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function basicQuery(filters: Record<string, string>): string {
  return Object.entries(filters)
    .filter(([, value]) => value)
    .map(([field, value]) => `${field} = ${quoted(value)}`)
    .join(' AND ');
}

export function ProjectDataPage({ project, tabId, startDate, endDate }: ProjectDataPageProps) {
  const [mode, setMode] = useState<SearchMode>('basic');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [advancedDraft, setAdvancedDraft] = useState('');
  const [appliedAdvanced, setAppliedAdvanced] = useState('');
  const [advancedError, setAdvancedError] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' } | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-tab-data', project.id, tabId],
    queryFn: () => batchApi.getProjectTabData(project.id, tabId),
    retry: false,
  });

  const tab = data?.tab || project.tabs.find((candidate) => candidate.id === tabId);
  const mapping = tab?.mappings.find((candidate) => candidate.version === tab.activeMappingVersion)
    || tab?.mappings[tab.mappings.length - 1];
  const columns = (mapping?.columns || []).filter((column) => column.visible);
  const searchable = (mapping?.columns || []).filter((column) => column.searchable);
  const filterable = (mapping?.columns || []).filter((column) => column.filterable);
  const dateColumns = (mapping?.columns || []).filter((column) => column.type === 'date');
  const rows = data?.dataset.rows || [];

  const dateRows = useMemo(() => rows.filter((row) => {
    if (!dateColumns.length || (!startDate && !endDate)) return true;
    const values = dateColumns.map((column) => String(row.values[column.fieldKey] || '')).filter(Boolean);
    if (!values.length) return true;
    return values.some((value) => (!startDate || value >= startDate) && (!endDate || value <= endDate));
  }), [dateColumns, endDate, rows, startDate]);

  const filterOptions = useMemo(() => Object.fromEntries(filterable.map((column) => {
    const counts = new Map<string, number>();
    for (const row of dateRows) {
      const value = text(row.values[column.fieldKey]);
      if (value === '—') continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [column.fieldKey, [...counts].sort(([left], [right]) => left.localeCompare(right))];
  })), [dateRows, filterable]) as Record<string, Array<[string, number]>>;

  const compiledAdvanced = useMemo(
    () => compileGenericTableQuery(appliedAdvanced, mapping?.columns || []),
    [appliedAdvanced, mapping?.columns],
  );

  const visibleRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    const filtered = dateRows.filter((row) => {
      if (mode === 'advanced') return (compiledAdvanced.predicate || (() => true))(row);
      if (Object.entries(filters).some(([field, expected]) => expected && text(row.values[field]).toLocaleLowerCase() !== expected.toLocaleLowerCase())) return false;
      return !keyword || searchable.some((column) => text(row.values[column.fieldKey]).toLocaleLowerCase().includes(keyword));
    });
    if (!sort) return filtered;
    return [...filtered].sort((left, right) => {
      const comparison = text(left.values[sort.field]).localeCompare(text(right.values[sort.field]), undefined, { numeric: true });
      return sort.direction === 'asc' ? comparison : -comparison;
    });
  }, [compiledAdvanced.predicate, dateRows, filters, mode, search, searchable, sort]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = visibleRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  useEffect(() => setPage(0), [filters, search, appliedAdvanced, mode, startDate, endDate]);
  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  function openAdvanced(): void {
    const query = basicQuery(filters);
    setAdvancedDraft(query);
    setAppliedAdvanced(query);
    setAdvancedError('');
    setMode('advanced');
  }

  function applyAdvanced(): void {
    const result = compileGenericTableQuery(advancedDraft, mapping?.columns || []);
    if (!result.predicate) {
      setAdvancedError(result.error || 'The advanced query is invalid.');
      return;
    }
    setAppliedAdvanced(advancedDraft.trim());
    setAdvancedError('');
  }

  function toggleSort(column: ProjectColumnConfig): void {
    setSort((current) => current?.field === column.fieldKey
      ? { field: column.fieldKey, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { field: column.fieldKey, direction: 'asc' });
  }

  if (isLoading) return <QaPageShell title={tab?.label || 'Project data'}><div role="status" className="py-12 text-center text-qa-muted">Loading project data…</div></QaPageShell>;
  if (error) return <QaPageShell title={tab?.label || 'Project data'}><div role="alert" className="border border-[#ecccc2] bg-[#f8ece8] p-4 text-[#a13d2c]">{(error as Error).message}</div></QaPageShell>;
  if (!mapping) {
    return <QaPageShell title={tab?.label || 'Project data'} intro="This project tab is ready, but its source columns have not been configured.">
      <div className="border border-[#e6d6b8] bg-[#fff8e8] p-4 text-[13px] text-[#7a5612]">Open <strong>Import Data</strong>, upload a spreadsheet, and choose <strong>Map columns</strong>. The saved mapping will create this table and its filters.</div>
    </QaPageShell>;
  }

  return (
    <QaPageShell
      title={tab?.label || 'Project data'}
      subtitle={`${visibleRows.length.toLocaleString()} of ${dateRows.length.toLocaleString()} row(s) in the selected period`}
      intro={`Imported data owned only by ${project.name}. Mapping profile v${mapping.version} controls the visible columns and available filters.`}
    >
      <QaSection title={mode === 'basic' ? 'Basic Search' : 'Advanced Search'} className="mb-[22px]">
        {mode === 'basic' ? <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filterable.map((column) => <label key={column.fieldKey} className="text-[11px] font-mono-qa uppercase tracking-wide text-qa-muted">{column.label}
              <select value={filters[column.fieldKey] || ''} onChange={(event) => setFilters((current) => ({ ...current, [column.fieldKey]: event.target.value }))} className="mt-1.5 block w-full border border-qa-border bg-white px-3 py-2.5 text-[13px] normal-case font-sans">
                <option value="">All</option>
                {(filterOptions[column.fieldKey] || []).map(([value, count]) => <option key={value} value={value}>{value} ({count})</option>)}
              </select>
            </label>)}
          </div>
          <label className="mt-4 block text-[11px] font-mono-qa uppercase tracking-wide text-qa-muted">Search anything
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search across every configured searchable column…" className="mt-1.5 block w-full border border-qa-ink bg-white px-3 py-2.5 text-[13px] normal-case font-sans" />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setFilters({}); setSearch(''); }} className="border border-qa-border bg-white px-3 py-2 font-mono-qa text-[10px] uppercase tracking-wider">Clear filters</button>
            <button type="button" onClick={openAdvanced} className="border-none bg-transparent px-2 py-2 font-mono-qa text-[10px] uppercase tracking-wider text-[#15605E] underline">Advanced Search</button>
          </div>
        </> : <>
          <label className="block text-[11px] font-mono-qa uppercase tracking-wide text-qa-muted">JQL-style local query
            <textarea value={advancedDraft} onChange={(event) => setAdvancedDraft(event.target.value)} rows={3} placeholder={`${mapping.columns[0]?.fieldKey || 'status'} = "value" AND ${mapping.columns[1]?.fieldKey || mapping.columns[0]?.fieldKey || 'priority'} != "value"`} className="mt-1.5 block w-full border border-qa-ink bg-white px-3 py-2.5 font-mono-qa text-[12px] normal-case" />
          </label>
          <p className="mb-0 mt-2 text-[11px] text-qa-muted">Fields: {mapping.columns.filter((column) => column.searchable || column.filterable).map((column) => column.fieldKey).join(', ')}. Supported operators depend on each column type.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={applyAdvanced} className="border border-qa-ink bg-qa-ink px-4 py-2 font-mono-qa text-[10px] uppercase tracking-wider text-white">Apply</button>
            <button type="button" onClick={() => { setAdvancedDraft(''); setAppliedAdvanced(''); setAdvancedError(''); }} className="border border-qa-border bg-white px-3 py-2 font-mono-qa text-[10px] uppercase tracking-wider">Clear</button>
            <button type="button" onClick={() => { setMode('basic'); setAdvancedError(''); }} className="border-none bg-transparent px-2 py-2 font-mono-qa text-[10px] uppercase tracking-wider text-[#15605E] underline">Basic Search</button>
          </div>
          {advancedError && <div role="alert" className="mt-3 border border-[#ecccc2] bg-[#f8ece8] p-3 text-[12px] text-[#a13d2c]">{advancedError}</div>}
        </>}
      </QaSection>

      <QaSection title="Imported rows" subtitle={`${data?.dataset.sourceFiles.length || 0} source file(s) · last rebuilt ${data ? new Date(data.dataset.updatedAt).toLocaleString() : 'not yet'}`} noPadding>
        {!rows.length ? <div className="py-12 text-center text-[13px] text-qa-muted">No mapped rows have been published yet. Upload and map a file from Import Data.</div> : !visibleRows.length ? <div className="py-12 text-center text-[13px] text-qa-muted">No rows match the active dates and search criteria.</div> : <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-left text-[12px]">
              <caption className="sr-only">{tab?.label} mapped project rows</caption>
              <thead className="bg-[#f7f5ef] font-mono-qa text-[10px] uppercase tracking-wide">
                <tr>{columns.map((column) => <th key={column.fieldKey} className="whitespace-nowrap border-b border-qa-border px-3 py-2"><button type="button" onClick={() => toggleSort(column)} className="border-none bg-transparent p-0 font-inherit uppercase tracking-inherit">{column.label}{sort?.field === column.fieldKey ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>)}</tr>
              </thead>
              <tbody>{pageRows.map((row) => <tr key={`${row.id}-${row.sourceFileId}`} className="border-t border-qa-border align-top first:border-t-0">{columns.map((column) => <td key={column.fieldKey} className="max-w-[360px] break-words px-3 py-2">{text(row.values[column.fieldKey])}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 border-t border-qa-border px-4 py-3 text-[11.5px] sm:flex-row sm:items-center sm:justify-between">
            <span>Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, visibleRows.length)} of {visibleRows.length.toLocaleString()}</span>
            <div className="flex gap-2"><button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} className="border border-qa-border bg-white px-3 py-1.5 disabled:opacity-40">Previous</button><span className="px-2 py-1.5">Page {safePage + 1} of {totalPages}</span><button type="button" disabled={safePage >= totalPages - 1} onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} className="border border-qa-border bg-white px-3 py-1.5 disabled:opacity-40">Next</button></div>
          </div>
        </>}
      </QaSection>
    </QaPageShell>
  );
}
