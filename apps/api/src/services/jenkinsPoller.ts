import { getDb } from '../db/schema';
import type { JenkinsConfig } from '../routes/settings';

// ── Types from Jenkins REST API ───────────────────────────────────────────

interface JenkinsJob {
  name: string;
  displayName?: string;
  url: string;
  _class: string;
  color?: string;
  jobs?: JenkinsJob[]; // folders contain nested jobs
}

interface JenkinsBuild {
  number: number;
  result: string | null;
  duration: number;
  estimatedDuration: number;
  timestamp: number;
  building: boolean;
  description: string | null;
  actions: JenkinsAction[];
  url: string;
}

interface JenkinsAction {
  _class?: string;
  causes?: { userName?: string; userId?: string; shortDescription?: string }[];
  totalCount?: number;
  failCount?: number;
  skipCount?: number;
  passCount?: number;
  // Branch info in Git SCM action
  buildsByBranchName?: Record<string, unknown>;
  lastBuiltRevision?: { branch?: { name: string }[] };
  remoteUrls?: string[];
  parameters?: { name: string; value: unknown }[];
}

interface JenkinsTestReport {
  totalCount: number;
  failCount: number;
  skipCount: number;
  passCount?: number;
}

// ── HTTP helper ───────────────────────────────────────────────────────────

async function jenkinsGet<T>(cfg: JenkinsConfig, path: string): Promise<T> {
  const credentials = cfg.username
    ? Buffer.from(`${cfg.username}:${cfg.apiToken}`).toString('base64')
    : Buffer.from(`:${cfg.apiToken}`).toString('base64');

  const url = `${cfg.url}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' },
  });

  if (!res.ok) throw new Error(`Jenkins API ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

// ── Flatten folders to leaf jobs ─────────────────────────────────────────

async function flattenJobs(cfg: JenkinsConfig, jobs: JenkinsJob[]): Promise<JenkinsJob[]> {
  const result: JenkinsJob[] = [];
  for (const job of jobs) {
    const isFolder = job._class?.includes('Folder') || job._class?.includes('WorkflowMultiBranchProject');
    if (isFolder && job.jobs) {
      const nested = await flattenJobs(cfg, job.jobs);
      result.push(...nested);
    } else if (isFolder) {
      // Fetch nested jobs for this folder
      try {
        const data = await jenkinsGet<{ jobs: JenkinsJob[] }>(cfg, `/job/${encodeURIComponent(job.name)}/api/json?tree=jobs[name,displayName,url,_class,color,jobs[name,displayName,url,_class,color]]`);
        const nested = await flattenJobs(cfg, data.jobs || []);
        result.push(...nested);
      } catch { /* skip inaccessible folders */ }
    } else {
      result.push(job);
    }
  }
  return result;
}

// ── Test connection ───────────────────────────────────────────────────────

export async function testJenkinsConnection(cfg: JenkinsConfig): Promise<{ ok: boolean; jobCount?: number; version?: string; error?: string }> {
  try {
    const data = await jenkinsGet<{ jobs: JenkinsJob[]; _class: string }>(
      cfg, '/api/json?tree=jobs[name,_class,color]'
    );
    const jobs = await flattenJobs(cfg, data.jobs || []);
    return { ok: true, jobCount: jobs.length };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Extract branch from build actions ────────────────────────────────────

function extractBranch(actions: JenkinsAction[]): string {
  for (const action of actions) {
    if (action.lastBuiltRevision?.branch) {
      const name = action.lastBuiltRevision.branch[0]?.name || '';
      return name.replace(/^refs\/remotes\/origin\//, '');
    }
    if (action._class?.includes('ParametersAction')) {
      const branchParam = action.parameters?.find((p) => p.name === 'BRANCH' || p.name === 'branch');
      if (branchParam) return String(branchParam.value);
    }
  }
  return '';
}

function extractTriggeredBy(actions: JenkinsAction[]): string {
  for (const action of actions) {
    if (action.causes?.length) {
      return action.causes.map((c) => c.userName || c.shortDescription || 'unknown').join(', ');
    }
  }
  return '';
}

// ── Sync a single job's recent builds ────────────────────────────────────

async function syncJob(cfg: JenkinsConfig, job: JenkinsJob, buildsToFetch = 10): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();

  // Upsert job record
  db.prepare(`
    INSERT OR REPLACE INTO jenkins_jobs (job_name, display_name, url, job_type, last_synced)
    VALUES (?, ?, ?, ?, ?)
  `).run(job.name, job.displayName || job.name, job.url, job._class || '', now);

  // Fetch recent builds
  let builds: JenkinsBuild[] = [];
  try {
    const data = await jenkinsGet<{ builds: JenkinsBuild[] }>(
      cfg,
      `/job/${encodeURIComponent(job.name)}/api/json?tree=builds[number,result,duration,estimatedDuration,timestamp,building,description,actions[_class,causes[userName,userId,shortDescription],totalCount,failCount,skipCount,lastBuiltRevision[branch[name]],parameters[name,value]]]{0,${buildsToFetch}}`
    );
    builds = data.builds || [];
  } catch {
    return 0; // job may have been deleted or be inaccessible
  }

  let upserted = 0;
  const upsert = db.prepare(`
    INSERT INTO jenkins_builds
      (job_name, build_number, result, status, duration_ms, estimated_duration_ms,
       timestamp, tests_total, tests_passed, tests_failed, tests_skipped, branch, triggered_by, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_name, build_number) DO UPDATE SET
      result = excluded.result,
      status = excluded.status,
      duration_ms = excluded.duration_ms,
      tests_total = excluded.tests_total,
      tests_passed = excluded.tests_passed,
      tests_failed = excluded.tests_failed,
      tests_skipped = excluded.tests_skipped
  `);

  for (const build of builds) {
    const status = build.building ? 'IN_PROGRESS' : 'FINISHED';
    const ts = new Date(build.timestamp).toISOString();
    const branch = extractBranch(build.actions);
    const triggeredBy = extractTriggeredBy(build.actions);

    // Extract test counts from actions (faster than a separate API call)
    let testsTotal = 0, testsFailed = 0, testsSkipped = 0;
    for (const action of build.actions) {
      if (action.totalCount != null) {
        testsTotal = action.totalCount;
        testsFailed = action.failCount || 0;
        testsSkipped = action.skipCount || 0;
        break;
      }
    }

    // If action didn't have test data but build finished, try testReport endpoint
    if (testsTotal === 0 && !build.building) {
      try {
        const report = await jenkinsGet<JenkinsTestReport>(
          cfg,
          `/job/${encodeURIComponent(job.name)}/${build.number}/testReport/api/json?tree=totalCount,failCount,skipCount,passCount`
        );
        testsTotal = report.totalCount || 0;
        testsFailed = report.failCount || 0;
        testsSkipped = report.skipCount || 0;
      } catch { /* no test report — that's fine */ }
    }

    const testsPassed = Math.max(0, testsTotal - testsFailed - testsSkipped);

    upsert.run(
      job.name, build.number, build.result || null, status,
      build.duration, build.estimatedDuration, ts,
      testsTotal, testsPassed, testsFailed, testsSkipped,
      branch, triggeredBy, build.description || null
    );
    upserted++;
  }

  return upserted;
}

// ── Main poll function ────────────────────────────────────────────────────

export async function pollJenkins(cfg: JenkinsConfig): Promise<{ jobs: number; builds: number }> {
  console.log('[jenkins] Polling Jenkins at', cfg.url);

  const data = await jenkinsGet<{ jobs: JenkinsJob[] }>(
    cfg,
    '/api/json?tree=jobs[name,displayName,url,_class,color,jobs[name,displayName,url,_class,color]]'
  );
  const jobs = await flattenJobs(cfg, data.jobs || []);

  let totalBuilds = 0;
  for (const job of jobs) {
    try {
      const count = await syncJob(cfg, job);
      totalBuilds += count;
    } catch (err) {
      console.warn(`[jenkins] Failed to sync job ${job.name}:`, (err as Error).message);
    }
  }

  console.log(`[jenkins] Synced ${jobs.length} jobs, ${totalBuilds} builds`);
  return { jobs: jobs.length, builds: totalBuilds };
}

// ── Periodic poller ───────────────────────────────────────────────────────

let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function startJenkinsPoller(cfg: JenkinsConfig): void {
  if (_pollTimer) clearInterval(_pollTimer);

  // Run immediately then on schedule
  pollJenkins(cfg).catch((err) => console.error('[jenkins] Poll error:', err));

  const intervalMs = (cfg.pollIntervalMinutes ?? 5) * 60 * 1000;
  _pollTimer = setInterval(() => {
    pollJenkins(cfg).catch((err) => console.error('[jenkins] Poll error:', err));
  }, intervalMs);

  console.log(`[jenkins] Poller started — every ${cfg.pollIntervalMinutes} min`);
}

export function stopJenkinsPoller(): void {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}
