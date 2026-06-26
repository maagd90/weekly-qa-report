import React, { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { LayoutDashboard, FolderKanban, Upload, Brain, Settings, BarChart3 } from 'lucide-react';
import clsx from 'clsx';
import { GlobalFilters } from './components/filters/GlobalFilters';
import { ResourcesPage } from './pages/ResourcesPage';
import { ProjectStatusPage } from './pages/ProjectStatusPage';
import { ImportStatusPage } from './pages/ImportStatusPage';
import { AiReportPage } from './pages/AiReportPage';
import { SettingsPage } from './pages/SettingsPage';
import { ChartPickerPanel, EmptyDashboard } from './components/common/ChartPickerPanel';
import { useFilters } from './hooks/useFilters';
import { batchApi } from './lib/api';
import type { DashboardPayload } from './lib/dashboardCompute';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

type Tab = 'resources' | 'projects' | 'import' | 'ai' | 'settings' | 'charts';

const TABS: { id: Tab; label: string; icon: React.ReactNode; hideFilters?: boolean }[] = [
  { id: 'resources', label: 'Resources', icon: <LayoutDashboard size={16} /> },
  { id: 'projects', label: 'Project Status', icon: <FolderKanban size={16} /> },
  { id: 'import', label: 'Import Data', icon: <Upload size={16} />, hideFilters: true },
  { id: 'ai', label: 'AI Report', icon: <Brain size={16} />, hideFilters: true },
  { id: 'charts', label: 'Charts', icon: <BarChart3 size={16} />, hideFilters: true },
  { id: 'settings', label: 'Settings', icon: <Settings size={16} />, hideFilters: true },
];

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>('resources');

  const { data: dashboard, isLoading, refetch } = useQuery<DashboardPayload | null>({
    queryKey: ['dashboard'],
    queryFn: batchApi.getDashboard,
    retry: false,
  });

  const filters = useFilters(dashboard ?? undefined);
  const currentTab = TABS.find((t) => t.id === activeTab)!;
  const showFilters = !currentTab.hideFilters && !!dashboard;
  const filterParams = filters.filterParams;
  const hasDashboard = !!dashboard;

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
              <h1 className="text-lg font-bold text-slate-800">QA Dashboard</h1>
              <p className="text-xs text-slate-400">File-based batch · no database</p>
            </div>
          </div>
        </div>
        <nav className="flex px-6 -mb-px gap-1 overflow-x-auto">
          {TABS.map((tab) => (
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
          years={filters.years}
          weeks={filters.weeks}
          selectedYear={filters.selectedYear}
          selectedWeek={filters.selectedWeek}
          onYearChange={filters.setSelectedYear}
          onWeekChange={filters.setSelectedWeek}
          mode={filters.mode}
          onModeChange={filters.setMode}
          startDate={filters.startDate}
          endDate={filters.endDate}
          onStartDateChange={filters.setStartDate}
          onEndDateChange={filters.setEndDate}
          generatedAt={filters.generatedAt}
        />
      )}

      <main className={clsx('flex-1', activeTab === 'ai' ? 'flex flex-col overflow-hidden min-h-0' : 'overflow-auto')}>
        {isLoading && (activeTab === 'resources' || activeTab === 'projects') && (
          <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading dashboard…</div>
        )}

        {!isLoading && !hasDashboard && (activeTab === 'resources' || activeTab === 'projects') && (
          <EmptyDashboard onGenerate={goGenerate} />
        )}

        {hasDashboard && activeTab === 'resources' && filterParams && (
          <ResourcesPage dashboard={dashboard} filter={filterParams} year={filters.selectedYear ?? new Date().getFullYear()} />
        )}
        {hasDashboard && activeTab === 'projects' && filterParams && (
          <ProjectStatusPage dashboard={dashboard} filter={filterParams} year={filters.selectedYear ?? new Date().getFullYear()} />
        )}
        {activeTab === 'import' && <ImportStatusPage />}
        {activeTab === 'ai' && <AiReportPage onGenerated={() => refetch()} />}
        {activeTab === 'charts' && (
          <div className="p-6 max-w-2xl mx-auto">
            <ChartPickerPanel />
          </div>
        )}
        {activeTab === 'settings' && <SettingsPage />}

        {hasDashboard && (activeTab === 'resources' || activeTab === 'projects') && !filterParams && (
          <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
            Select a year and week (or date range) to filter charts.
          </div>
        )}
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
