import React, { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Users, RotateCcw, GitBranch, ClipboardList,
  Upload, Brain, Settings,
} from 'lucide-react';
import clsx from 'clsx';
import { GlobalFilters } from './components/filters/GlobalFilters';
import { OverviewPage } from './pages/OverviewPage';
import { TestersPage } from './pages/TestersPage';
import { CyclesPage } from './pages/CyclesPage';
import { TraceabilityPage } from './pages/TraceabilityPage';
import { UatPage } from './pages/UatPage';
import { ImportStatusPage } from './pages/ImportStatusPage';
import { AiReportPage } from './pages/AiReportPage';
import { SettingsPage } from './pages/SettingsPage';
import { EmptyDashboard } from './components/common/EmptyDashboard';
import { useFilters } from './hooks/useFilters';
import { batchApi } from './lib/api';
import type { DashboardPayload } from 'qa-dashboard-batch';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

type Tab = 'overview' | 'testers' | 'cycles' | 'traceability' | 'uat' | 'import' | 'ai' | 'settings';

const TABS: { id: Tab; label: string; icon: React.ReactNode; hideFilters?: boolean }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} /> },
  { id: 'testers', label: 'Testers', icon: <Users size={16} /> },
  { id: 'cycles', label: 'Test Cycles', icon: <RotateCcw size={16} /> },
  { id: 'traceability', label: 'Traceability', icon: <GitBranch size={16} /> },
  { id: 'uat', label: 'UAT', icon: <ClipboardList size={16} /> },
  { id: 'import', label: 'Import Data', icon: <Upload size={16} />, hideFilters: true },
  { id: 'ai', label: 'AI Report', icon: <Brain size={16} />, hideFilters: true },
  { id: 'settings', label: 'Settings', icon: <Settings size={16} />, hideFilters: true },
];

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const { data: initialDashboard } = useQuery<DashboardPayload | null>({
    queryKey: ['dashboard-init'],
    queryFn: () => batchApi.getDashboard(),
    retry: false,
  });

  const filters = useFilters(initialDashboard ?? undefined);

  const { data: dashboard, isLoading, refetch } = useQuery<DashboardPayload | null>({
    queryKey: ['dashboard', filters.filterParams],
    queryFn: () => batchApi.getDashboard(filters.filterParams),
    retry: false,
    enabled: !!initialDashboard,
  });

  const display = dashboard ?? initialDashboard;
  const currentTab = TABS.find((t) => t.id === activeTab)!;
  const showFilters = !currentTab.hideFilters;
  const hasDashboard = !!display;
  const showUat = !!display?.uat;

  const goGenerate = () => setActiveTab('ai');

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-white border-b border-slate-200 shadow-sm print:hidden">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 rounded-xl p-2">
              <LayoutDashboard size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">DLM QA Dashboard</h1>
              <p className="text-xs text-slate-400">Zephyr · JIRA · ODL · API integrations</p>
            </div>
          </div>
        </div>
        <nav className="flex px-6 -mb-px gap-1 overflow-x-auto">
          {TABS.filter((t) => t.id !== 'uat' || showUat || !hasDashboard).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {showFilters && (
        <GlobalFilters
          startDate={filters.startDate}
          endDate={filters.endDate}
          onStartDateChange={filters.setStartDate}
          onEndDateChange={filters.setEndDate}
          search={filters.search}
          onSearchChange={filters.setSearch}
          result={filters.result}
          onResultChange={filters.setResult}
          project={filters.project}
          onProjectChange={filters.setProject}
          projects={filters.projects}
          generatedAt={display?.meta.generatedAt}
        />
      )}

      <main className={clsx('flex-1', activeTab === 'ai' ? 'flex flex-col overflow-hidden min-h-0' : 'overflow-auto')}>
        {isLoading && showFilters && hasDashboard && (
          <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Refreshing filters…</div>
        )}

        {!isLoading && !hasDashboard && showFilters && (
          <EmptyDashboard onGenerate={goGenerate} />
        )}

        {display && activeTab === 'overview' && <OverviewPage dashboard={display} />}
        {display && activeTab === 'testers' && <TestersPage dashboard={display} />}
        {display && activeTab === 'cycles' && <CyclesPage dashboard={display} />}
        {display && activeTab === 'traceability' && <TraceabilityPage dashboard={display} />}
        {display && activeTab === 'uat' && showUat && <UatPage dashboard={display} />}
        {activeTab === 'import' && <ImportStatusPage />}
        {activeTab === 'ai' && <AiReportPage onGenerated={() => refetch()} />}
        {activeTab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
