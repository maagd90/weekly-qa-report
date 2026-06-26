import React, { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { FilterParams } from '../../lib/api';
import type { DashboardPayload } from '../../lib/dashboardCompute';
import { computeStatusReport } from '../../lib/dashboardCompute';
import { StatusBadge } from '../common/StatusBadge';
import { ProjectDetailPanel } from './ProjectDetailPanel';

interface Props {
  dashboard: DashboardPayload;
  filter: FilterParams;
}

export function ProjectStatusTable({ dashboard, filter }: Props) {
  const rows = useMemo(() => computeStatusReport(dashboard, filter), [dashboard, filter]);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  if (!rows.length) {
    return <p className="text-sm text-slate-400 py-4 text-center">No project status for this period.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 uppercase text-xs">
              <th className="text-left px-4 py-3">Project</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">% Done</th>
              <th className="text-right px-4 py-3">Bugs Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-blue-50 cursor-pointer" onClick={() => setSelected({ id: String(row.project_id), name: String(row.project_name) })}>
                <td className="px-4 py-3 font-medium">{String(row.project_name)}</td>
                <td className="px-4 py-3"><StatusBadge status={String(row.status)} /></td>
                <td className="px-4 py-3 text-right">{Number(row.percent_complete).toFixed(0)}%</td>
                <td className="px-4 py-3 text-right text-red-600">{String(row.bugs_open)}</td>
                <td className="px-4 py-3 text-slate-400"><ChevronRight size={16} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <ProjectDetailPanel dashboard={dashboard} filter={filter} projectId={selected.id} projectName={selected.name} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
