import React from 'react';
import type { DashboardWorkItem } from 'qa-dashboard-batch';
import { PRIORITY_COLORS, QA } from '../../theme/qaTheme';
import { DetailDrawerBase, formatDetailDate } from './DetailDrawerBase';

interface WonderMilesDetailDrawerProps {
  story: DashboardWorkItem | null;
  onClose: () => void;
}

function DetailField({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="mb-1 font-mono-qa text-[10px] uppercase text-qa-muted-light">{label}</div>
      <div className={`${mono ? 'font-mono-qa' : ''} break-words text-sm text-qa-muted`}>{value?.trim() || '—'}</div>
    </div>
  );
}

export function WonderMilesDetailDrawer({ story, onClose }: WonderMilesDetailDrawerProps) {
  if (!story) return null;

  return (
    <DetailDrawerBase
      isOpen={Boolean(story)}
      title={`${story.key}: ${story.summary || story.issueType}`}
      closeLabel="Close Wonder Miles details"
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DetailField label="Key" value={story.key} mono />
        <DetailField label="Type" value={story.issueType} />
      </div>

      <DetailField label="Summary" value={story.summary} />

      <div className="flex flex-wrap gap-5">
        <div>
          <div className="mb-1 font-mono-qa text-[10px] uppercase text-qa-muted-light">Status</div>
          <span className="inline-block border border-qa-border bg-[#e8f4e8] px-2 py-1 font-mono-qa text-[11px] font-semibold text-[#2f6a48]">
            {story.status === 'done' ? 'Done / Closed' : 'Open'}
          </span>
        </div>
        <div>
          <div className="mb-1 font-mono-qa text-[10px] uppercase text-qa-muted-light">Priority</div>
          <span
            className="inline-block px-2 py-1 font-mono-qa text-[11px] font-semibold text-white"
            style={{ background: PRIORITY_COLORS[story.priority] || QA.muted }}
          >
            {story.priority || 'Unassigned'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DetailField label="Product Area" value={story.area} />
        <DetailField label="Environment" value={story.environment} />
        <DetailField label="Change Request" value={story.changeRequest} mono />
        <DetailField label="Sprint" value={story.sprint} />
        <DetailField label="Assignee" value={story.assignee || 'Unassigned'} />
        <DetailField label="Last Updated By" value={story.updatedBy || story.assignee || 'Unassigned'} />
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-qa-border pt-4 sm:grid-cols-2">
        <DetailField label="Created" value={formatDetailDate(story.createdAt)} />
        <DetailField label="Last Updated At" value={formatDetailDate(story.updatedAt)} />
      </div>

      {story.sourceFile && (
        <div className="border-t border-qa-border pt-4">
          <DetailField label="Source File" value={story.sourceFile.replace(/^\d+_/, '')} mono />
        </div>
      )}
    </DetailDrawerBase>
  );
}
