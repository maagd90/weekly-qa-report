import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { projectsApi, type FilterParams } from '../../lib/api';
import { StatusBadge } from '../common/StatusBadge';
import { ProjectDetailPanel } from './ProjectDetailPanel';

interface Props { filter: FilterParams; }

export function ProjectStatusTable({ filter }: Props) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['project-status-report', filter],
    queryFn: () => projectsApi.statusReport(filter),
  });

  const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null);

  if (isLoading) return <div className="p-8 text-center text-slate-400 text-sm">Loading...</div>;
  if (!data.length) return (
    <div className="p-8 text-center text-slate-400 text-sm">
      No project status reports for this period. Add entries to the Project_Status_Weekly sheet.
    </div>
  );

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wide">
              <th className="text-left px-4 py-3 font-semibold">Project</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="text-right px-4 py-3 font-semibold">% Done</th>
              <th className="text-right px-4 py-3 font-semibold">Tests</th>
              <th className="text-right px-4 py-3 font-semibold">Bugs Open</th>
              <th className="text-right px-4 py-3 font-semibold">Rep.</th>
              <th className="text-right px-4 py-3 font-semibold">Closed</th>
              <th className="text-right px-4 py-3 font-semibold">Resources</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.map((row: Record<string, unknown>, i: number) => (
              <tr
                key={`${String(row.project_id)}-${String(row.week_number)}`}
                className={`border-t border-slate-100 hover:bg-blue-50 cursor-pointer transition ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                onClick={() => setSelectedProject({ id: String(row.project_id), name: String(row.project_name) })}
              >
                <td className="px-4 py-3 font-medium text-slate-800">{String(row.project_name)}</td>
                <td className="px-4 py-3"><StatusBadge status={String(row.status)} /></td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-20 bg-slate-200 rounded-full h-1.5">
                      <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${row.percent_complete}%` }} />
                    </div>
                    <span>{Number(row.percent_complete).toFixed(0)}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">{String(row.tests_executed)}</td>
                <td className="px-4 py-3 text-right font-medium text-red-600">{String(row.bugs_open)}</td>
                <td className="px-4 py-3 text-right">{String(row.bugs_reported)}</td>
                <td className="px-4 py-3 text-right text-green-600">{String(row.bugs_closed)}</td>
                <td className="px-4 py-3 text-right">{String(row.resources_assigned)}</td>
                <td className="px-4 py-3 text-slate-400"><ChevronRight size={16} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedProject && (
        <ProjectDetailPanel
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          filter={filter}
          onClose={() => setSelectedProject(null)}
        />
      )}
    </>
  );
}
