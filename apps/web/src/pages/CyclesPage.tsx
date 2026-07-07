import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DashboardPayload, FilterParams } from 'qa-dashboard-batch';
import type { CycleHealth } from '../lib/api';
import type { KpiStyle } from '../theme/qaTheme';
import { QA, fmt, passRateColor, coverageColor } from '../theme/qaTheme';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QaKpiCard, QaKpiGrid } from '../components/qa/QaKpiCard';
import { SegBar, cycleSegSegments } from '../components/qa/SegBar';
import { CycleBadge, QaTable, QaThead } from '../components/qa/QaBadge';
import { CycleDetailDrawer } from '../components/qa/CycleDetailDrawer';
import { batchApi } from '../lib/api';

interface CyclesPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  selectedCycle: string | null;
  onSelectCycle: (key: string | null) => void;
  filterParams: FilterParams;
}

type CycleRow = DashboardPayload['cycles'][number] | CycleHealth;

function FolderPicker({ selectedFolder, onSelectFolder }: { selectedFolder: string; onSelectFolder: (id: string) => void }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ['cycle-folders'], queryFn: batchApi.getCycleFolders, staleTime: 60_000, retry: false });
  const folders = useMemo(() => data?.folders ?? [], [data]);

  return (
    <div className="flex items-center gap-2.5 mb-4 flex-wrap">
      <span className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">QMetry folder</span>
      <select aria-label="QMetry folder" value={selectedFolder} onChange={(e) => onSelectFolder(e.target.value)} disabled={isLoading || folders.length === 0} className="appearance-none font-sans text-[13px] py-1.5 pl-3 pr-6 border border-qa-ink bg-white text-qa-ink cursor-pointer disabled:opacity-50 min-w-[260px]">
        <option value="">{isLoading ? 'Loading folders...' : folders.length ? 'Select folder to load cycles...' : 'No folders found'}</option>
        {folders.map((f) => <option key={f.id} value={f.id}>{f.path || f.name}</option>)}
      </select>
      <button type="button" onClick={() => refetch()} disabled={isFetching} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{isFetching ? 'Refreshing...' : 'Refresh folders'}</button>
      {data && <span className="font-mono-qa text-[10px] text-qa-muted-light">{data.source === 'qmetry-live' ? `live folders from QMetry${data.connection ? ` (${data.connection})` : ''}` : 'from imported data'}</span>}
      {error && <span className="font-mono-qa text-[10px] text-[#a13d2c]">Could not load folders: {(error as Error).message}</span>}
    </div>
  );
}

export function CyclesPage({ dashboard, kpiStyle, selectedCycle, onSelectCycle, filterParams }: CyclesPageProps) {
  const [selectedFolder, setSelectedFolder] = useState('');
  const liveCyclesQuery = useQuery({
    queryKey: ['cycles-by-folder-table', selectedFolder, filterParams.startDate, filterParams.endDate, filterParams.project],
    queryFn: () => batchApi.getCyclesByFolder(selectedFolder, undefined, filterParams),
    enabled: Boolean(selectedFolder),
    staleTime: 30_000,
    retry: false,
  });

  const cycles: CycleRow[] = liveCyclesQuery.data?.source === 'qmetry-live' ? liveCyclesQuery.data.cycles : dashboard.cycles;
  const overview = dashboard.overview;
  const notStarted = cycles.filter((c) => c.pass + c.fail + c.blocked + c.na === 0).length;
  const fullPass = cycles.filter((c) => { const exec = c.pass + c.fail + c.blocked + c.na; return exec > 0 && c.fail === 0 && c.blocked === 0; }).length;
  const totalCases = cycles.reduce((sum, c) => sum + c.total, 0);
  const executed = cycles.reduce((sum, c) => sum + c.pass + c.fail + c.blocked + c.na, 0);
  const coveragePct = totalCases ? Math.round((executed / totalCases) * 100) : (overview.totalCases ? Math.round((overview.executed / overview.totalCases) * 100) : 0);
  const shown = cycles.slice(0, selectedFolder ? 50 : 16);
  const selected = dashboard.cycles.find((c) => c.key === selectedCycle) ?? null;
  const liveWarnings = liveCyclesQuery.data?.warnings || [];

  function pickCycle(key: string): void { const imported = dashboard.cycles.find((c) => c.key === key); if (imported) onSelectCycle(imported.key); }

  return (
    <>
      <QaPageShell title="Test Cycle Health" subtitle="select a QMetry folder to view live test cycles and execution result split for the selected period">
        <FolderPicker selectedFolder={selectedFolder} onSelectFolder={setSelectedFolder} />
        {selectedFolder && liveCyclesQuery.isLoading && <div className="mb-4 text-[12px] text-qa-muted-light">Loading cycles and execution results for selected folder...</div>}
        {selectedFolder && liveCyclesQuery.error && <div className="mb-4 text-[12px] text-[#a13d2c]">Could not load folder cycles: {(liveCyclesQuery.error as Error).message}</div>}
        {selectedFolder && liveCyclesQuery.data?.source === 'qmetry-live' && <div className="mb-4 text-[12px] text-qa-muted-light">Showing live QMetry execution results for folder <span className="font-mono-qa text-qa-ink">{selectedFolder}</span> and selected period.{liveWarnings.length ? <span className="text-[#a13d2c]"> {liveWarnings.join('; ')}</span> : null}</div>}
        <QaKpiGrid cols={4}>
          <QaKpiCard kpiStyle={kpiStyle} label="Test Cycles" value={cycles.length} sub={selectedFolder ? 'from selected folder' : 'in current scope'} color={QA.accent} />
          <QaKpiCard kpiStyle={kpiStyle} label="Executed Cases" value={executed} sub="PASS + FAIL + BLOCKED + NA" color={QA.PASS} />
          <QaKpiCard kpiStyle={kpiStyle} label="Not Started" value={notStarted} sub="0% executed" color={QA.NE} />
          <QaKpiCard kpiStyle={kpiStyle} label="Coverage" value={`${coveragePct}%`} sub={`${fmt(Math.max(totalCases - executed, 0))} cases pending`} color={QA.BLOCKED} />
        </QaKpiGrid>
        <QaSection title={selectedFolder ? 'Cycles in Selected Folder' : 'Cycles by Volume'} noPadding headerRight={<span className="font-mono-qa text-[10.5px] text-qa-muted-light">showing top {shown.length}</span>}>
          <QaTable>
            <QaThead cols={[{ label: 'Cycle', className: 'pl-[22px]' }, { label: 'Status' }, { label: 'Result split', className: 'w-[170px]' }, { label: 'Pass %', align: 'right' }, { label: 'Coverage', align: 'right' }, { label: 'Cases', align: 'right', className: 'pr-[22px]' }]} />
            <tbody>
              {shown.map((c) => { const exec = c.pass + c.fail + c.blocked + c.na; return (
                <tr key={c.key} className="border-t border-[#f0ede5] cursor-pointer hover:bg-[#faf8f2]" onClick={() => pickCycle(c.key)}>
                  <td className="py-3 pl-[22px]"><div className="font-semibold max-w-[340px] truncate">{c.name}</div><div className="font-mono-qa text-[10px] text-qa-muted-light">{c.key}</div></td>
                  <td className="py-3 px-3"><CycleBadge status={c.status} /></td>
                  <td className="py-3 px-3"><SegBar segments={cycleSegSegments(c.pass, c.fail, c.blocked, c.ne, c.na, c.total)} height={11} /></td>
                  <td className="py-3 px-3 text-right font-mono-qa" style={{ color: exec ? passRateColor(c.passPct) : '#b3aea3' }}>{exec ? `${c.passPct}%` : '-'}</td>
                  <td className="py-3 px-3 text-right font-mono-qa" style={{ color: coverageColor(c.coverage) }}>{c.coverage}%</td>
                  <td className="py-3 pr-[22px] text-right font-mono-qa text-qa-muted">{c.total}</td>
                </tr>
              ); })}
            </tbody>
          </QaTable>
          {!cycles.length && <div className="py-8 text-center text-[13px] text-qa-muted-light">No test cycles match the selected folder/current filters.</div>}
        </QaSection>
      </QaPageShell>
      <CycleDetailDrawer cycle={selected} onClose={() => onSelectCycle(null)} />
    </>
  );
}
