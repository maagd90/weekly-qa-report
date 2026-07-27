import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { QaTab } from '../../theme/qaTheme';
import { QA } from '../../theme/qaTheme';

export interface TabDef {
  id: QaTab;
  label: string;
  num: string;
  hideFilters?: boolean;
}

interface QaTabNavProps {
  tabs: TabDef[];
  activeTab: QaTab;
  onTabChange: (tab: QaTab) => void;
}

export function QaTabNav({ tabs, activeTab, onTabChange }: QaTabNavProps) {
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const tabRefs = useRef(new Map<QaTab, HTMLButtonElement>());

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  const focusTab = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    onTabChange(tab.id);
    requestAnimationFrame(() => tabRefs.current.get(tab.id)?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    focusTab(nextIndex);
  };

  return (
    <nav aria-label="Dashboard sections" className="qa-tab-nav max-w-qa mx-auto px-4 sm:px-6 lg:px-8 print:hidden">
      <div className="qa-scroll overflow-x-auto overscroll-x-contain border-b border-qa-border-mid" role="tablist" aria-label="Dashboard views">
        <div className="flex min-w-max gap-0">
          {tabs.map((tab, index) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(tab.id, node);
                  else tabRefs.current.delete(tab.id);
                  if (active) activeTabRef.current = node;
                }}
                type="button"
                role="tab"
                aria-selected={active}
                aria-current={active ? 'page' : undefined}
                tabIndex={active ? 0 : -1}
                onClick={() => onTabChange(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={clsx(
                  'flex min-h-11 shrink-0 items-center gap-2 px-3 py-3 sm:px-[18px] sm:py-3.5 border-none bg-transparent cursor-pointer',
                  'text-[13px] sm:text-[13.5px] font-semibold tracking-wide whitespace-nowrap -mb-px',
                  active ? 'text-qa-ink border-b-2' : 'text-qa-muted-light border-b-2 border-transparent hover:text-qa-muted'
                )}
                style={active ? { borderBottomColor: QA.accent } : undefined}
              >
                <span
                  className="font-mono-qa text-[10px] font-medium"
                  style={{ color: active ? QA.accent : '#c4bfb3' }}
                >
                  {tab.num}
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export function buildTabs(
  showVendorPortalBugs: boolean,
  showWonderMilesExport = false,
  projectTabs: Array<{ id: string; label: string }> = [],
): TabDef[] {
  const tabs: TabDef[] = [];
  const append = (id: QaTab, label: string, hideFilters = false) => tabs.push({
    id,
    label,
    num: String(tabs.length + 1).padStart(2, '0'),
    ...(hideFilters ? { hideFilters: true } : {}),
  });
  append('overview', 'Overview');
  append('testers', 'Quality Assurance');
  append('cycles', 'Test Cycles');
  append('trace', 'Traceability');
  if (showVendorPortalBugs) append('uat', 'Vendor Portal Bugs');
  if (showWonderMilesExport) append('wonder-miles', 'Wonder Miles Export Data');
  for (const tab of projectTabs) append(`project:${tab.id}`, tab.label);
  append('ai', 'QA Report', true);
  append('import', 'Import Data', true);
  append('settings', 'Settings', true);
  return tabs;
}
