import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Hammer, CheckCircle, XCircle, AlertTriangle, RefreshCw,
  GitBranch, Clock, ChevronDown, ChevronUp, Activity, Loader2,
  Settings, Play,
} from 'lucide-react';
import clsx from 'clsx';
import { jenkinsApi } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────

interface JenkinsJob {
  job_name: string;
  display_name: string;
  url: string;
  last_synced: string;
  last_build_number: number;
  last_result: string | null;
  last_status: string;
  last_duration_ms: number;
  last_timestamp: string;
  last_branch: string;
  last_tests_total: number;
  last_tests_passed: number;
  last_tests_failed: number;
}

interface JenkinsBuild {
  job_name: string;
  display_name?: string;
  build_number: number;
  result: string | null;
  status: string;
  duration_ms: number;
  timestamp: string;
  branch: string;
  triggered_by: string;
  tests_total: number;
  tests_passed: number;
  tests_failed: number;
  tests_skipped: number;
}

interface TrendRow {
  date: string;
  totalBuilds: number;
  successBuilds: number;
  failedBuilds: number;
  testsTotal: number;
  testsFailed: number;
  avgDurationSec: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function resultColor(result: string | null, status: string): string {
  if (status === 'IN_PROGRESS') return 'text-blue-600 bg-blue-50 border-blue-200';
  switch (result) {
    case 'SUCCESS':  return 'text-green-700 bg-green-50 border-green-200';
    case 'FAILURE':  return 'text-red-700 bg-red-50 border-red-200';
    case 'UNSTABLE': return 'text-yellow-700 bg-yellow-50 border-yellow-200';
    case 'ABORTED':  return 'text-slate-600 bg-slate-100 border-slate-200';
    default:         return 'text-slate-500 bg-slate-50 border-slate-200';
  }
}

function resultDot(result: string | null, status: string): string {
  if (status === 'IN_PROGRESS') return 'bg-blue-500 animate-pulse';
  switch (result) {
    case 'SUCCESS':  return 'bg-green-500';
    case 'FAILURE':  return 'bg-red-500';
    case 'UNSTABLE': return 'bg-yellow-500';
    default:         return 'bg-slate-400';
  }
}

function resultLabel(result: string | null, status: string): string {
  if (status === 'IN_PROGRESS') return 'Running';
  return result || 'Unknown';
}

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function fmtTime(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function passRate(total: number, failed: number): string {
  if (!total) return '—';
  return `${Math.round(((total - failed) / total) * 100)}%`;
}

// ── Job Status Card ───────────────────────────────────────────────────────

function JobCard({ job, onClick }: { job: JenkinsJob; onClick: () => void }) {
  const colorClass = resultColor(job.last_result, job.last_status);
  const dotClass   = resultDot(job.last_result, job.last_status);
  const label      = resultLabel(job.last_result, job.last_status);

  return (
    <div
      onClick={onClick}
      className={clsx('rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow', colorClass)}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-semibold text-sm leading-tight line-clamp-2">{job.display_name}</span>
        <span className={clsx('w-2.5 h-2.5 rounded-full shrink-0 mt-0.5', dotClass)} />
      </div>
      <p className="text-xs font-medium mb-2">{label}</p>
      <div className="space-y-1 text-xs opacity-75">
        {job.last_build_number && <p>#{job.last_build_number}</p>}
        {job.last_branch && (
          <p className="flex items-center gap-1">
            <GitBranch size={10} /> {job.last_branch}
          </p>
        )}
        {job.last_duration_ms > 0 && (
          <p className="flex items-center gap-1">
            <Clock size={10} /> {fmtDuration(job.last_duration_ms)}
          </p>
        )}
        {job.last_tests_total > 0 && (
          <p>{job.last_tests_total} tests · {job.last_tests_failed} failed</p>
        )}
      </div>
    </div>
  );
}

// ── Build History Row ─────────────────────────────────────────────────────

function BuildRow({ build }: { build: JenkinsBuild }) {
  const colorClass = resultColor(build.result, build.status);
  const label = resultLabel(build.result, build.status);
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50">
      <td className="px-4 py-2.5 font-medium text-slate-700 text-sm">{build.display_name || build.job_name}</td>
      <td className="px-4 py-2.5 text-sm text-slate-500">#{build.build_number}</td>
      <td className="px-4 py-2.5">
        <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border', colorClass)}>{label}</span>
      </td>
      <td className="px-4 py-2.5 text-sm text-slate-500">
        {build.branch ? (
          <span className="flex items-center gap-1"><GitBranch size={11} />{build.branch}</span>
        ) : '—'}
      </td>
      <td className="px-4 py-2.5 text-sm text-right text-slate-500">{fmtDuration(build.duration_ms)}</td>
      <td className="px-4 py-2.5 text-sm text-right">
        {build.tests_total > 0 ? (
          <span className={build.tests_failed > 0 ? 'text-red-600' : 'text-green-600'}>
            {passRate(build.tests_total, build.tests_failed)} ({build.tests_total})
          </span>
        ) : '—'}
      </td>
      <td className="px-4 py-2.5 text-xs text-slate-400">{fmtTime(build.timestamp)}</td>
      <td className="px-4 py-2.5 text-xs text-slate-400">{build.triggered_by || '—'}</td>
    </tr>
  );
}

// ── Live Builds Banner ────────────────────────────────────────────────────

function LiveBuildsBanner() {
  const [liveBuilds, setLiveBuilds] = useState<JenkinsBuild[]>([]);

  useEffect(() => {
    const es = new EventSource('/api/jenkins/live');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'live') setLiveBuilds(data.builds);
      } catch { /* skip */ }
    };
    return () => es.close();
  }, []);

  if (!liveBuilds.length) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
      <h4 className="text-sm font-semibold text-blue-800 flex items-center gap-2 mb-3">
        <Activity size={14} className="animate-pulse" />
        {liveBuilds.length} Build{liveBuilds.length > 1 ? 's' : ''} Running
      </h4>
      <div className="space-y-2">
        {liveBuilds.map((b) => (
          <div key={`${b.job_name}-${b.build_number}`} className="flex items-center gap-3 text-sm">
            <Loader2 size={14} className="text-blue-500 animate-spin shrink-0" />
            <span className="font-medium text-blue-900">{b.job_name}</span>
            <span className="text-blue-600">#{b.build_number}</span>
            {b.branch && (
              <span className="flex items-center gap-1 text-blue-500 text-xs">
                <GitBranch size={10} />{b.branch}
              </span>
            )}
            <span className="text-blue-400 text-xs ml-auto">{fmtTime(b.timestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export function BuildsPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const queryClient = useQueryClient();
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [trendDays, setTrendDays] = useState(30);
  const [showHistory, setShowHistory] = useState(true);
  const [resultFilter, setResultFilter] = useState('');

  const { data: summary }  = useQuery({ queryKey: ['jenkins-summary'],  queryFn: jenkinsApi.summary,  refetchInterval: 30_000 });
  const { data: jobs = [], isLoading: jobsLoading } = useQuery({ queryKey: ['jenkins-jobs'], queryFn: jenkinsApi.jobs, refetchInterval: 30_000 });
  const { data: trends = [] } = useQuery({
    queryKey: ['jenkins-trends', selectedJob, trendDays],
    queryFn: () => jenkinsApi.trends({ jobName: selectedJob || undefined, days: trendDays }),
    refetchInterval: 60_000,
  });
  const { data: builds = [], isLoading: buildsLoading } = useQuery({
    queryKey: ['jenkins-builds', selectedJob, resultFilter],
    queryFn: () => selectedJob
      ? jenkinsApi.jobBuilds(selectedJob)
      : jenkinsApi.builds({ result: resultFilter || undefined, limit: 50 }),
    refetchInterval: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: jenkinsApi.sync,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jenkins'] }),
  });

  const s = summary as Record<string, number> & { recentFailures?: JenkinsBuild[] } | undefined;

  // If Jenkins not configured at all (no jobs ever synced)
  const neverSynced = !jobsLoading && (jobs as JenkinsJob[]).length === 0;

  if (neverSynced) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-12 text-slate-400">
        <Hammer size={48} className="mb-4 text-slate-300" />
        <p className="text-base font-medium text-slate-500">Jenkins not connected yet</p>
        <p className="text-sm mt-1">Add your Jenkins URL and API token in Settings to start syncing builds.</p>
        <button
          onClick={onOpenSettings}
          className="mt-4 flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white text-sm px-5 py-2.5 rounded-xl transition"
        >
          <Settings size={14} /> Go to Settings
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 overflow-auto">
      {/* Header actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Hammer size={20} className="text-slate-500" /> Jenkins Builds
        </h2>
        <div className="flex items-center gap-3">
          {selectedJob && (
            <button onClick={() => setSelectedJob(null)} className="text-sm text-blue-600 hover:underline">
              ← All Jobs
            </button>
          )}
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-50 text-slate-600 text-sm px-3 py-2 rounded-lg transition disabled:opacity-60"
          >
            <RefreshCw size={14} className={syncMutation.isPending ? 'animate-spin' : ''} />
            {syncMutation.isPending ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Live builds */}
      <LiveBuildsBanner />

      {/* KPI cards */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          <KpiBox label="Total Jobs"      value={s.totalJobs}      color="slate" />
          <KpiBox label="Running"         value={s.runningBuilds}  color="blue"  />
          <KpiBox label="Successful"      value={s.successBuilds}  color="green" />
          <KpiBox label="Failed"          value={s.failedBuilds}   color="red"   />
          <KpiBox label="Unstable"        value={s.unstableBuilds} color="yellow"/>
          <KpiBox label="Success Rate"    value={`${s.successRate ?? 0}%`} color="purple" />
        </div>
      )}

      {/* Job status board */}
      {!selectedJob && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Job Status Board</h3>
          {jobsLoading ? (
            <div className="text-sm text-slate-400 py-8 text-center">Loading jobs…</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {(jobs as JenkinsJob[]).map((job) => (
                <JobCard key={job.job_name} job={job} onClick={() => setSelectedJob(job.job_name)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trend charts */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-700">
            {selectedJob ? `${selectedJob} — ` : ''}Build Trend
          </h3>
          <div className="flex gap-1">
            {[7, 14, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setTrendDays(d)}
                className={clsx('px-2.5 py-1 text-xs rounded-lg transition', trendDays === d ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {(trends as TrendRow[]).length === 0 ? (
          <div className="h-60 flex items-center justify-center text-slate-400 text-sm">No trend data yet</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-slate-500 mb-2">Build Results</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trends as TrendRow[]} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="successBuilds" name="Success" fill="#22c55e" stackId="a" radius={[0,0,0,0]} />
                  <Bar dataKey="failedBuilds"  name="Failed"  fill="#ef4444" stackId="a" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-2">Avg Build Duration (seconds)</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trends as TrendRow[]} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="avgDurationSec" name="Duration (s)" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Test results trend */}
      {(trends as TrendRow[]).some((t) => t.testsTotal > 0) && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Test Results Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trends as TrendRow[]} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="testsTotal"  name="Total"  fill="#3b82f6" stackId="t" />
              <Bar dataKey="testsFailed" name="Failed" fill="#ef4444" stackId="t" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Build history table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <button
            className="flex items-center gap-2 text-sm font-semibold text-slate-700"
            onClick={() => setShowHistory(!showHistory)}
          >
            {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Build History {selectedJob ? `— ${selectedJob}` : '(All Jobs)'}
          </button>
          {!selectedJob && (
            <select
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value)}
              className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">All Results</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILURE">Failed</option>
              <option value="UNSTABLE">Unstable</option>
              <option value="ABORTED">Aborted</option>
            </select>
          )}
        </div>

        {showHistory && (
          buildsLoading ? (
            <div className="py-8 text-center text-slate-400 text-sm">Loading builds…</div>
          ) : (builds as JenkinsBuild[]).length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">No builds found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wide">
                    <th className="text-left px-4 py-3 font-semibold">Job</th>
                    <th className="text-left px-4 py-3 font-semibold">#</th>
                    <th className="text-left px-4 py-3 font-semibold">Result</th>
                    <th className="text-left px-4 py-3 font-semibold">Branch</th>
                    <th className="text-right px-4 py-3 font-semibold">Duration</th>
                    <th className="text-right px-4 py-3 font-semibold">Tests (Pass%)</th>
                    <th className="text-left px-4 py-3 font-semibold">Time</th>
                    <th className="text-left px-4 py-3 font-semibold">Triggered By</th>
                  </tr>
                </thead>
                <tbody>
                  {(builds as JenkinsBuild[]).map((b, i) => <BuildRow key={i} build={b} />)}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Recent failures */}
      {!selectedJob && s?.recentFailures && (s.recentFailures as JenkinsBuild[]).length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-red-800 flex items-center gap-2 mb-3">
            <XCircle size={14} /> Recent Failures
          </h3>
          <div className="space-y-2">
            {(s.recentFailures as JenkinsBuild[]).map((b, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-red-700">
                <span className="font-medium">{b.job_name}</span>
                <span className="text-red-400">#{b.build_number}</span>
                {b.branch && <span className="flex items-center gap-1 text-red-400 text-xs"><GitBranch size={10} />{b.branch}</span>}
                <span className="ml-auto text-xs text-red-400">{fmtTime(b.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiBox({ label, value, color }: { label: string; value: number | string; color: string }) {
  const colorMap: Record<string, string> = {
    slate: 'bg-slate-50 border-slate-200 text-slate-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    green: 'bg-green-50 border-green-200 text-green-800',
    red: 'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    purple: 'bg-violet-50 border-violet-200 text-violet-800',
  };
  return (
    <div className={clsx('rounded-xl border p-4 text-center', colorMap[color] || colorMap.slate)}>
      <p className="text-2xl font-bold">{value ?? '—'}</p>
      <p className="text-xs mt-0.5 opacity-70 font-medium">{label}</p>
    </div>
  );
}
