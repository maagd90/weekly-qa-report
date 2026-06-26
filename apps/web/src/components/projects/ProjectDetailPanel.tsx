import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, AlertTriangle, CheckCircle, ChevronRight } from 'lucide-react';
import { projectsApi, type FilterParams } from '../../lib/api';
import { StatusBadge } from '../common/StatusBadge';

interface Props {
  projectId: string;
  projectName: string;
  filter: FilterParams;
  onClose: () => void;
}

export function ProjectDetailPanel({ projectId, projectName, filter, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-detail', projectId, filter],
    queryFn: () => projectsApi.detail(projectId, filter),
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div
        className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-slate-800">{projectName}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X size={20} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading...</div>
        ) : !data?.status ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">No data for this period</div>
        ) : (
          <div className="p-6 space-y-6 flex-1">
            {/* Status header */}
            <div className="flex items-center gap-4">
              <StatusBadge status={data.status.status} />
              <span className="text-2xl font-bold text-slate-800">{Number(data.status.percent_complete).toFixed(0)}%</span>
              <span className="text-sm text-slate-500">complete</span>
              {data.prevStatus && (
                <span className={`text-xs flex items-center gap-1 ${data.status.percent_complete > data.prevStatus.percent_complete ? 'text-green-600' : 'text-slate-400'}`}>
                  <ChevronRight size={12} />
                  was {Number(data.prevStatus.percent_complete).toFixed(0)}% prev week
                </span>
              )}
            </div>

            {/* Key info */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Tests Executed', value: data.status.tests_executed },
                { label: 'Bugs Open',      value: data.status.bugs_open, color: 'text-red-600' },
                { label: 'Bugs Reported',  value: data.status.bugs_reported },
                { label: 'Bugs Closed',    value: data.status.bugs_closed, color: 'text-green-600' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-500 mb-1">{label}</p>
                  <p className={`text-xl font-bold ${color || 'text-slate-800'}`}>{value ?? '—'}</p>
                </div>
              ))}
            </div>

            {/* Narrative sections */}
            {[
              { label: 'Key Accomplishments', value: data.status.key_accomplishments, icon: <CheckCircle size={14} className="text-green-500" /> as React.ReactNode },
              { label: 'Risks',    value: data.status.risks,    icon: <AlertTriangle size={14} className="text-yellow-500" /> as React.ReactNode },
              { label: 'Blockers', value: data.status.blockers, icon: <AlertTriangle size={14} className="text-red-500" /> as React.ReactNode },
              { label: 'Next Week Plan', value: data.status.next_week_plan, icon: undefined as React.ReactNode },
            ].map(({ label, value, icon }) => value ? (
              <div key={label}>
                <h4 className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  {icon}{label}
                </h4>
                <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{String(value)}</p>
              </div>
            ) : null)}

            {/* CRs */}
            {data.crs?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Change Requests</h4>
                <div className="space-y-1.5">
                  {data.crs.map((cr: Record<string, unknown>) => (
                    <div key={String(cr.cr_id)} className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                      <span className="font-mono text-xs text-blue-600">{String(cr.cr_id)}</span>
                      <span className="text-slate-700 flex-1">{String(cr.cr_title)}</span>
                      <span className="text-xs text-slate-400">{String(cr.priority)} / {String(cr.status)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resources */}
            {data.resources?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Assigned Resources</h4>
                <div className="space-y-1.5">
                  {data.resources.map((r: Record<string, unknown>) => (
                    <div key={String(r.resource_id)} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                      <div>
                        <span className="font-medium text-slate-700">{String(r.resource_name)}</span>
                        {r.team ? <span className="text-xs text-slate-400 ml-2">{String(r.team)}</span> : null}
                      </div>
                      <div className="flex gap-3 text-xs text-slate-500">
                        <span>Tests: {String(r.testsExecuted)}</span>
                        <span>Bugs: {String(r.bugsReported)}</span>
                        <span>{String(r.hoursSpent)}h</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
