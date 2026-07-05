import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DashboardPayload } from 'qa-dashboard-batch';
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
}

function CycleFolderPicker({ dashboard, onSelectCycle }: { dashboard: DashboardPayload; onSelectCycle: (key: string | null) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['cycle-folders'], queryFn: batchApi.getCycleFolders, staleTime: 60_000 });
  const [notImported, setNotImported] = useState<string | null>(null);
  const options = useMemo(() => data?.cycles ?? [], [data]);

  const handlePick = (id: string) => {
    setNotImported(null);
    if (!id) return;
    const match = dashboard.cycles.find((c) => c.key === id || c.name === id);
    if (match) onSelectCycle(match.key);
    else setNotImported(options.find((o) => o.id === id)?.name || id);
  };

  return (
    <div className="flex items-center gap-2.5 mb-4 flex-wrap">
      <span className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">Jump to test cycle</span>
      <select
        aria-label="Jump to test cycle"
        defaultValue=""
        onChange={(e) => handlePick(e.target.value)}
        disabled={isLoading || options.length === 0}
        className="appearance-none font-sans text-[13px] py-1.5 pl-3 pr-6 border border-qa-ink bg-white text-qa-ink cursor-pointer disabled:opacity-50 min-w-[220px]"
      >
        <option value="">{isLoading ? 'Loading cycles…' : options.length ? 'Search cycle folders…' : 'No cycles found'}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {data && <span className="font-mono-qa text-[10px] text-qa-muted-light">{data.source === 'qmetry-live' ? `live from QMetry${data.connection ? ` (${data.connection})` : ''}` : 'from imported data — combine with the date filter above for a weekly view'}</span>}
      {notImported && <span className="text-[12px]" style={{ color: '#a13d2c' }}>"{notImported}" has no execution rows in the current scope yet — Generate Report after importing/fetching it.</span>}
    </div>
  );
}

export function CyclesPage({ dashboard, kpiStyle, selectedCycle, onSelectCycle }: CyclesPageProps) {
  const { cycles, overview } = dashboard;
  const notStarted = cycles.filter((c) => c.pass + c.fail + c.blocked + c.na === 0).length;
  const fullPass = cycles.filter((c) => {
    const exec = c.pass + c.fail + c.blocked + c.na;
    return exec > 0 && c.fail === 0 && c.blocked === 0;
  }).length;
  const coveragePct = overview.totalCases ? Math.round((overview.executed / overview.totalCases) * 100) : 0;
  const shown = cycles.slice(0, 16);
  const selected = cycles.find((c) => c.key === selectedCycle) ?? null;

  return (
    <>
      <QaPageShell title="Test Cycle Health" subtitle="click a cycle for the breakdown →">
        <CycleFolderPicker dashboard={dashboard} onSelectCycle={onSelectCycle} />
        <QaKpiGrid cols={4}>
          <QaKpiCard kpiStyle={kpiStyle} label="Test Cycles" value={cycles.length} sub="in current scope" color={QA.accent} />
          <QaKpiCard kpiStyle={kpiStyle} label="Clean Cycles" value={fullPass} sub="0 fail · 0 blocked" color="#2F7D5A" />
          <QaKpiCard kpiStyle={kpiStyle} label="Not Started" value={notStarted} sub="0% executed" color={QA.NE} />
          <QaKpiCard kpiStyle={kpiStyle} label="Coverage" value={`${coveragePct}%`} sub={`${fmt(overview.totalCases - overview.executed)} cases pending`} color={QA.BLOCKED} />
        </QaKpiGrid>
        <QaSection title="Cycles by Volume" noPadding headerRight={<span className="font-mono-qa text-[10.5px] text-qa-muted-light">showing top {shown.length}</span>}>
          <QaTable>
            <QaThead cols={[
              { label: 'Cycle', className: 'pl-[22px]' },
              { label: 'Status' },
              { label: 'Result split', className: 'w-[170px]' },
              { label: 'Pass %', align: 'right' },
              { label: 'Coverage', align: 'right' },
              { label: 'Cases', align: 'right', className: 'pr-[22px]' },
            ]} />
            <tbody>
              {shown.map((c) => {
                const exec = c.pass + c.fail + c.blocked + c.na;
                return (
                  <tr key={c.key} className="border-t border-[#f0ede5] cursor-pointer hover:bg-[#faf8f2]" onClick={() => onSelectCycle(c.key)}>
                    <td className="py-3 pl-[22px]"><div className="font-semibold max-w-[340px] truncate">{c.name}</div><div className="font-mono-qa text-[10px] text-qa-muted-light">{c.key}</div></td>
                    <td className="py-3 px-3"><CycleBadge status={c.status} /></td>
                    <td className="py-3 px-3"><SegBar segments={cycleSegSegments(c.pass, c.fail, c.blocked, c.ne, c.na, c.total)} height={11} /></td>
                    <td className="py-3 px-3 text-right font-mono-qa" style={{ color: exec ? passRateColor(c.passPct) : '#b3aea3' }}>{exec ? `${c.passPct}%` : '—'}</td>
                    <td className="py-3 px-3 text-right font-mono-qa" style={{ color: coverageColor(c.coverage) }}>{c.coverage}%</td>
                    <td className="py-3 pr-[22px] text-right font-mono-qa text-qa-muted">{c.total}</td>
                  </tr>
                );
              })}
            </tbody>
          </QaTable>
          {!cycles.length && <div className="py-8 text-center text-[13px] text-qa-muted-light">No test cycles match the current filters.</div>}
        </QaSection>
      </QaPageShell>
      <CycleDetailDrawer cycle={selected} onClose={() => onSelectCycle(null)} />
    </>
  );
}
