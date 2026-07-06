import React from 'react';
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
  return (
    <nav className="max-w-qa mx-auto px-8 print:hidden">
      <div className="flex gap-0 border-b border-qa-border-mid flex-wrap">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={clsx(
                'flex items-center gap-2 px-[18px] py-3.5 border-none bg-transparent cursor-pointer',
                'text-[13.5px] font-semibold tracking-wide whitespace-nowrap -mb-px',
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
    </nav>
  );
}

export function buildTabs(showVendorPortalBugs: boolean): TabDef[] {
  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview', num: '01' },
    { id: 'testers', label: 'Testers', num: '02' },
    { id: 'cycles', label: 'Test Cycles', num: '03' },
    { id: 'trace', label: 'Traceability', num: '04' },
  ];
  if (showVendorPortalBugs) tabs.push({ id: 'uat', label: 'Vendor Portal Bugs', num: '05' });
  const aiNum = showVendorPortalBugs ? '06' : '05';
  const importNum = showVendorPortalBugs ? '07' : '06';
  const settingsNum = showVendorPortalBugs ? '08' : '07';
  tabs.push(
    { id: 'ai', label: 'AI Report', num: aiNum, hideFilters: true },
    { id: 'import', label: 'Import Data', num: importNum, hideFilters: true },
    { id: 'settings', label: 'Settings', num: settingsNum, hideFilters: true },
  );
  return tabs;
}
