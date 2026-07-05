import axios from 'axios';
import type {
  DashboardPayload,
  FilterParams,
  ReportType,
  GenerateParams,
  GenerateResult,
  LlmSelectionInput,
  LlmProvider,
  JiraConnectionInput,
  QmetryConnectionInput,
  UserConnections,
} from 'qa-dashboard-batch';

const api = axios.create({ baseURL: '/api' });

const ANTHROPIC_KEY_STORAGE = 'qa_dashboard_anthropic_key';
const JIRA_CONNECTIONS_STORAGE = 'qa_dashboard_jira_connections';
const QMETRY_CONNECTIONS_STORAGE = 'qa_dashboard_qmetry_connections';

type RequestMeta = { requestId: string; startedAt: number };

function nextRequestId(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeJson(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(safeJson);
  const copy: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower.includes('key') || lower.includes('token') || lower.includes('credential') || lower.includes('password')) {
      copy[key] = raw ? '***redacted***' : raw;
    } else {
      copy[key] = safeJson(raw);
    }
  }
  return copy;
}

function logApi(event: string, data: Record<string, unknown>): void {
  console.log(`[web-api] ${event}`, data);
}

export function getUserAnthropicKey(): string {
  try {
    return window.localStorage.getItem(ANTHROPIC_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setUserAnthropicKey(key: string): void {
  try {
    if (key.trim()) window.localStorage.setItem(ANTHROPIC_KEY_STORAGE, key.trim());
    else window.localStorage.removeItem(ANTHROPIC_KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
}

function readConnections<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function writeConnections<T>(key: string, value: T[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export const getJiraConnections = (): JiraConnectionInput[] => readConnections(JIRA_CONNECTIONS_STORAGE);
export const setJiraConnections = (conns: JiraConnectionInput[]): void => writeConnections(JIRA_CONNECTIONS_STORAGE, conns);
export const getQmetryConnections = (): QmetryConnectionInput[] => readConnections(QMETRY_CONNECTIONS_STORAGE);
export const setQmetryConnections = (conns: QmetryConnectionInput[]): void => writeConnections(QMETRY_CONNECTIONS_STORAGE, conns);

export function newConnectionId(): string {
  return `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

api.interceptors.request.use((config) => {
  const meta: RequestMeta = { requestId: nextRequestId(), startedAt: Date.now() };
  (config as typeof config & { metadata?: RequestMeta }).metadata = meta;
  config.headers = config.headers || {};
  config.headers['x-request-id'] = meta.requestId;

  const key = getUserAnthropicKey();
  if (key) config.headers['x-anthropic-key'] = key;

  const jira = getJiraConnections();
  const qmetry = getQmetryConnections();
  if (jira.length || qmetry.length) {
    const connections: UserConnections = { jira, qmetry };
    config.headers['x-user-connections'] = JSON.stringify(connections);
  }

  logApi('request', {
    requestId: meta.requestId,
    method: (config.method || 'GET').toUpperCase(),
    url: `${config.baseURL || ''}${config.url || ''}`,
    hasAnthropicKey: Boolean(key),
    jiraConnections: jira.length,
    qmetryConnections: qmetry.length,
    params: config.params,
    body: safeJson(config.data),
  });
  return config;
});

api.interceptors.response.use(
  (response) => {
    const meta = (response.config as typeof response.config & { metadata?: RequestMeta }).metadata;
    logApi('response', {
      requestId: meta?.requestId,
      method: (response.config.method || 'GET').toUpperCase(),
      url: response.config.url,
      status: response.status,
      elapsedMs: meta ? Date.now() - meta.startedAt : undefined,
    });
    return response;
  },
  (error) => {
    if (axios.isAxiosError(error)) {
      const meta = (error.config as typeof error.config & { metadata?: RequestMeta } | undefined)?.metadata;
      console.error('[web-api] error', {
        requestId: meta?.requestId,
        method: (error.config?.method || 'GET').toUpperCase(),
        url: error.config?.url,
        status: error.response?.status,
        elapsedMs: meta ? Date.now() - meta.startedAt : undefined,
        response: safeJson(error.response?.data),
        message: error.message,
      });
    } else {
      console.error('[web-api] non-axios error', error);
    }
    return Promise.reject(error);
  },
);

function apiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; message?: string; warnings?: string[] } | undefined;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
    if (data?.warnings?.length) return data.warnings.join('; ');
    if (err.response?.status) return `${fallback}: HTTP ${err.response.status}`;
    if (err.code === 'ECONNABORTED') return 'Report generation timed out. Full reports can take 1–2 minutes — please try again.';
    return err.message || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

async function blobErrorMessage(blob: Blob, fallback: string): Promise<string> {
  try {
    const text = await blob.text();
    if (!text) return fallback;
    const payload = JSON.parse(text) as { error?: string; message?: string; warnings?: string[] };
    return payload.error || payload.message || payload.warnings?.join('; ') || text.slice(0, 500);
  } catch {
    return fallback;
  }
}

export { apiErrorMessage };
export type { DashboardPayload, FilterParams, ReportType, GenerateParams, GenerateResult, LlmSelectionInput, LlmProvider };

export interface IntegrationsStatus {
  jira: { enabled: boolean; baseUrl: string; configured: boolean; profiles?: unknown[] };
  qmetry: { enabled: boolean; baseUrl: string; configured: boolean; cycleIds: number };
  config: {
    jira: { enabled: boolean; projectKeys: string[]; jql: string };
    qmetry: { enabled: boolean; projectKey: string; cycleIds: string[] };
  };
  userConnections?: {
    jira: { id: string; name: string; baseUrl: string }[];
    qmetry: { id: string; name: string; baseUrl: string }[];
  };
}

export interface CycleFolder {
  id: string;
  name: string;
}

export interface CycleFoldersResult {
  source: 'qmetry-live' | 'imported';
  connection?: string;
  cycles: CycleFolder[];
}

export const batchApi = {
  getStatus: () => api.get('/status').then((r) => r.data as { apiKeyConfigured: boolean; jiraConfigured: boolean; llmProvidersConfigured?: Record<string, boolean> }),

  testLlm: (selection: LlmSelectionInput) => api.post('/llm/test', selection, { timeout: 35_000 })
    .then((r) => r.data as { ok: boolean; provider?: LlmProvider; providerLabel?: string; model?: string; route?: 'direct' | 'proxy'; elapsedMs?: number; error?: string; logs?: string[] })
    .catch((err) => { throw new Error(apiErrorMessage(err, 'LLM connectivity test failed')); }),

  testAnthropic: () => api.get('/anthropic/test', { timeout: 35_000 })
    .then((r) => r.data as { ok: boolean; model?: string; route?: 'direct' | 'proxy'; elapsedMs?: number; error?: string; logs?: string[] })
    .catch((err) => { throw new Error(apiErrorMessage(err, 'Anthropic connectivity test failed')); }),

  generate: (params: GenerateParams) => api.post<GenerateResult>('/generate', params, { timeout: 300_000 })
    .then((r) => r.data)
    .catch((err) => { throw new Error(apiErrorMessage(err, 'Report generation failed')); }),

  getDashboard: (filter?: Partial<FilterParams>) => {
    const params = filter ? {
      startDate: filter.startDate,
      endDate: filter.endDate,
      search: filter.search,
      result: filter.result,
      project: filter.project,
    } : undefined;
    return api.get('/dashboard', { params }).then((r) => r.data as DashboardPayload).catch((err) => {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    });
  },

  getReport: () => api.get('/report').then((r) => r.data).catch((err) => {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }),

  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },

  listInputFiles: () => api.get('/input/files').then((r) => r.data as { name: string; size: number; modifiedAt: string }[]),
  deleteInputFile: (filename: string) => api.delete(`/input/${encodeURIComponent(filename)}`).then((r) => r.data),

  getIntegrations: () => api.get('/integrations').then((r) => r.data as IntegrationsStatus),
  testIntegrations: () => api.post('/integrations/test').then((r) => r.data),

  testConnection: (type: 'jira' | 'qmetry', connection: JiraConnectionInput | QmetryConnectionInput) =>
    api.post('/integrations/test-connection', { type, connection }, { timeout: 35_000 })
      .then((r) => r.data as { ok: boolean; count?: number; error?: string })
      .catch((err) => ({ ok: false, error: apiErrorMessage(err, 'Connection test failed') })),

  getCycleFolders: () => api.get('/cycles/folders', { timeout: 35_000 }).then((r) => r.data as CycleFoldersResult),

  downloadReportPdf: async ({ startDate, endDate, reportType, kpiStyle }: { startDate: string; endDate: string; reportType: ReportType; kpiStyle: string }) => {
    try {
      const response = await api.post('/report/pdf', { startDate, endDate, reportType, kpiStyle }, { responseType: 'blob', timeout: 150_000 });
      const blob = response.data as Blob;
      if (blob.type === 'application/json') throw new Error(await blobErrorMessage(blob, 'PDF export failed'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `qa-report-${startDate}-to-${endDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
        throw new Error(await blobErrorMessage(err.response.data, 'PDF export failed'));
      }
      throw new Error(apiErrorMessage(err, 'PDF export failed'));
    }
  },
};
