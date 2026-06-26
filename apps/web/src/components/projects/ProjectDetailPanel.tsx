import React, { useMemo } from 'react';
import { X, CheckCircle, AlertTriangle } from 'lucide-react';
import type { FilterParams } from '../../lib/api';
import type { DashboardPayload } from '../../lib/dashboardCompute';
import { computeProjectDetail } from '../../lib/dashboardCompute';
import { StatusBadge } from '../common/StatusBadge';

interface Props {
  dashboard: DashboardPayload;
  filter: FilterParams;
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export function ProjectDetailPanel({ dashboard, filter, projectId, projectName, onClose }: Props) {
  const data = useMemo(() => computeProjectDetail(dashboard, filter, projectId), [dashboard, filter, projectId]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-6 py-4 sticky top-0 bg-white">
          <h2 className="font-semibold">{projectName}</h2>
          <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
        </div>
        {!data?.status ? (
          <div className="p-8 text-center text-slate-400">No data for this period</div>
        ) : (
          <div className="p-6 space-y-4">
            <StatusBadge status={data.status.status} />
            <p className="text-2xl font-bold">{Number(data.status.percent_complete).toFixed(0)}% complete</p>
            {data.crs?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">CRs</h4>
                {data.crs.map((cr) => (
                  <div key={cr.cr_id} className="text-sm bg-slate-50 rounded px-3 py-2 mb-1">{cr.cr_id} — {cr.cr_title}</div>
                ))}
              </div>
            )}
            {[
              { label: 'Accomplishments', value: data.status.key_accomplishments, icon: <CheckCircle size={14} className="text-green-500" /> },
              { label: 'Risks', value: data.status.risks, icon: <AlertTriangle size={14} className="text-yellow-500" /> },
              { label: 'Blockers', value: data.status.blockers, icon: <AlertTriangle size={14} className="text-red-500" /> },
            ].map(({ label, value, icon }) => value ? (
              <div key={label}>
                <h4 className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase mb-1">{icon}{label}</h4>
                <p className="text-sm bg-slate-50 rounded p-3">{String(value)}</p>
              </div>
            ) : null)}
          </div>
        )}
      </div>
    </div>
  );
}
