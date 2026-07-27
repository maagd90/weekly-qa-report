import React from 'react';
import type { DashboardUatRow } from 'qa-dashboard-batch';
import { PRIORITY_COLORS, QA } from '../../theme/qaTheme';
import { DetailDrawerBase, formatDetailDate } from './DetailDrawerBase';

interface UatBugDetailDrawerProps {
  bug: DashboardUatRow | null;
  onClose: () => void;
}

function DetailField({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <div className="mb-1 font-mono-qa text-[10px] uppercase text-qa-muted-light">{label}</div>
      <div className={`${mono ? 'font-mono-qa' : ''} break-words text-sm text-qa-muted`}>{value?.trim() || '—'}</div>
    </div>
  );
}

export function UatBugDetailDrawer({ bug, onClose }: UatBugDetailDrawerProps) {
  if (!bug) return null;

  const priority = bug.clientPriority?.trim() || bug.priority?.trim() || 'Unassigned';

  return (
    <DetailDrawerBase
      isOpen={Boolean(bug)}
      title={`Bug ${bug.id || 'details'}`}
      closeLabel="Close Vendor Portal bug details"
      onClose={onClose}
    >
      <DetailField label="Ticket ID" value={bug.id} mono />
      <DetailField label="Subject" value={bug.subject} />

      <div className="flex flex-wrap gap-5">
        <div>
          <div className="mb-1 font-mono-qa text-[10px] uppercase text-qa-muted-light">Status</div>
          <span className="inline-block border border-qa-border bg-[#e8f4e8] px-2 py-1 font-mono-qa text-[11px] font-semibold text-[#2f6a48]">
            {bug.status || 'Unknown'}
          </span>
        </div>
        <div>
          <div className="mb-1 font-mono-qa text-[10px] uppercase text-qa-muted-light">Priority</div>
          <span
            className="inline-block px-2 py-1 font-mono-qa text-[11px] font-semibold text-white"
            style={{ background: PRIORITY_COLORS[priority] || QA.muted }}
          >
            {priority}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DetailField label="Product Area" value={bug.area} />
        <DetailField label="Change Request" value={bug.cr} mono />
      </div>

      <div className="border-t border-qa-border pt-4">
        <div className="mb-2 font-mono-qa text-[10px] uppercase text-qa-muted-light">Submitted</div>
        <div className="text-sm">{formatDetailDate(bug.submittedAt)}</div>
        {bug.submitter?.trim() && <div className="mt-1 text-[11px] text-qa-muted">by {bug.submitter}</div>}
      </div>

      <div className="border border-[#e7d7ad] bg-[#f8f1de] p-4">
        <div className="mb-2 font-mono-qa text-[10px] font-bold uppercase text-[#765318]">Last Updated At</div>
        <div className="text-base font-semibold text-qa-ink">{formatDetailDate(bug.updatedAt)}</div>
        <div className="mt-3 font-mono-qa text-[10px] font-bold uppercase text-[#765318]">Last Updated By</div>
        <div className="mt-1 text-sm font-semibold text-qa-ink">{bug.updatedBy?.trim() || bug.submitter?.trim() || '—'}</div>
      </div>

      <DetailField label="Latest Note" value={bug.note} />

      {bug.sourceFile && (
        <div className="border-t border-qa-border pt-4">
          <DetailField label="Source File" value={bug.sourceFile.replace(/^\d+_/, '')} mono />
        </div>
      )}
    </DetailDrawerBase>
  );
}
