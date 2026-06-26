import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LayoutDashboard, FolderKanban, Upload, Brain, Settings, Hammer } from 'lucide-react';
import clsx from 'clsx';
import { GlobalFilters } from './components/filters/GlobalFilters';
import { ResourcesPage } from './pages/ResourcesPage';
import { ProjectStatusPage } from './pages/ProjectStatusPage';
import { ImportStatusPage } from './pages/ImportStatusPage';
import { AiReportPage } from './pages/AiReportPage';
import { BuildsPage } from './pages/BuildsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useFilters } from './hooks/useFilters';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

type Tab = 'resources' | 'projects' | 'import' | 'ai' | 'builds' | 'settings';

const TABS: { id: Tab; label: string; icon: React.ReactNode; hideFilters?: boolean }[] = [
  { id: 'resources', label: 'Resources',      icon: <LayoutDashboard size={16} /> },
  { id: 'projects',  label: 'Project Status', icon: <FolderKanban size={16} /> },
  { id: 'import',    label: 'Import Data',    icon: <Upload size={16} />,      hideFilters: true },
  { id: 'ai',        label: 'AI Report',      icon: <Brain size={16} />,       hideFilters: true },
  { id: 'builds',    label: 'Builds',         icon: <Hammer size={16} />,      hideFilters: true },
  { id: 'settings',  label: 'Settings',       icon: <Settings size={16} />,    hideFilters: true },
];

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>('resources');
  const filters = useFilters();

  const currentTab = TABS.find((t) => t.id === activeTab)!;
  const showFilters = !currentTab.hideFilters;

  const filterParams = filters.filterParams;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm print:hidden">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 rounded-xl p-2">
              <LayoutDashboard size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">QA Dashboard</h1>
              <p className="text-xs text-slate-400">Team Metrics & AI Reports</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <nav className="flex px-6 -mb-px gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              )}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* Global filters (shown only on data tabs) */}
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
        />
      )}

      {/* Page content */}
      <main className={clsx('flex-1', (activeTab === 'ai' || activeTab === 'builds') ? 'flex flex-col overflow-hidden' : 'overflow-auto')}>
        {activeTab === 'resources' && filterParams && (
          <ResourcesPage filter={filterParams} year={filters.selectedYear ?? new Date().getFullYear()} />
        )}
        {activeTab === 'projects' && filterParams && (
          <ProjectStatusPage filter={filterParams} year={filters.selectedYear ?? new Date().getFullYear()} />
        )}
        {activeTab === 'import' && <ImportStatusPage />}
        {activeTab === 'ai' && <AiReportPage />}
        {activeTab === 'builds' && <BuildsPage onOpenSettings={() => setActiveTab('settings')} />}
        {activeTab === 'settings' && <SettingsPage />}

        {/* No filter selected yet */}
        {(activeTab === 'resources' || activeTab === 'projects') && !filterParams && (
          <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
            Select a year and week (or date range) to load data.
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
