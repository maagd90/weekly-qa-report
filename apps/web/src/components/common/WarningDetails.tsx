import React from 'react';

interface WarningDetailsProps {
  summary: string;
  messages: string[];
  detailsLabel?: string;
  className?: string;
}

export function WarningDetails({ summary, messages, detailsLabel = 'View technical details', className = '' }: WarningDetailsProps) {
  const warnings = [...new Set(messages.map((message) => message.trim()).filter(Boolean))];
  if (!warnings.length) return null;

  return (
    <div role="status" className={`border border-[#ead6a5] bg-[#fff9e8] px-3 py-2.5 text-[#7a5200] ${className}`.trim()}>
      <div className="text-[12px] font-semibold leading-5">{summary}</div>
      <details className="mt-1.5">
        <summary className="font-mono-qa text-[10.5px] uppercase tracking-wide cursor-pointer select-none">
          {detailsLabel}
        </summary>
        <ul className="mt-2 mb-0 pl-5 space-y-1 text-[11.5px] leading-5 break-words">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      </details>
    </div>
  );
}
