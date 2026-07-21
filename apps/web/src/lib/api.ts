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
import { canonicalProjectOrAll, canonicalProjectOrUndefined, uniqueCanonicalProjects } from './projectKey';

const api = axios.create({ baseURL: '/api' });

const ANTHROPIC_KEY_STORAGE = 'qa_dashboard_anthropic_key';
const LLM_KEYS_STORAGE = 'qa_dashboard_llm_keys';
const JIRA_CONNECTIONS_STORAGE = 'qa_dashboard_jira_connections';
const QMETRY_CONNECTIONS_STORAGE = 'qa_dashboard_qmetry_connections';
const LLM_SELECTION_STORAGE = 'qa_dashboard_llm_selection';
const ACTIVE_PROJECT_STORAGE = 'qa_dashboard_active_project';
const ACTIVE_START_DATE_STORAGE = 'qa_dashboard_active_start_date';
const ACTIVE_END_DATE_STORAGE = 'qa_dashboard_active_end_date';
const REPORT_BRANDING_STORAGE = 'qa_dashboard_report_branding';

type RequestMeta = { requestId: string; startedAt: number };

export interface ReportBranding { logoUrl?: string; logoAlt?: string; title?: string; subtitle?: string }
export interface ProjectRecord { id: string; key: string; name: string; createdAt: string; updatedAt: string; fileCount?: number }
export interface ProjectFileRecord { id: string; projectId: string; originalName: string; storedName: string; size: number; uploadedAt: string; status: 'staged' | 'synced' | 'error'; detectedType?: 'test-execution' | 'jira' | 'odl' | 'unknown'; rows?: number; lastSyncId?: string; lastSyncedAt?: string }
export interface ImportRecordCounts { executions: number; stories: number; bugs: number; vendorBugs: number }
export interface ImportFileReport { fileId: string; filename: string; detectedType: 'test-execution' | 'jira' | 'odl' | 'unknown'; sheet: string; totalRowsFound: number; successfullyImportedRows: number; createdRecords: number; updatedRecords: number; duplicateOrSkippedRows: number; rejectedRows: number; rejections: Array<{ rowNumber: number; reference: string; reason: string }>; warnings: string[]; errors: string[] }
export interface ProjectSyncReport { id: string; project: Pick<ProjectRecord, 'id' | 'key' | 'name'>; initiatedBy: string; startedAt: string; completedAt: string; durationMs: number; status: 'Successful' | 'Partially Successful' | 'Failed'; filesProcessed: number; previousTotals: ImportRecordCounts; newTotals: ImportRecordCounts; rowCounts: { executions: number; issues: number; uat: number }; files: ImportFileReport[]; warnings: string[] }
export interface SyncInputResult { ok: boolean; rebuilt: boolean; rowCounts: { executions: number; issues: number; uat: number }; removed?: string[]; warnings?: string[]; projects?: string[]; reconciliation: ProjectSyncReport; error?: string }
export interface DashboardSearchResult { ok: boolean; dashboard: DashboardPayload; rowCounts: { executions: number; issues: number; uat: number }; warnings?: string[]; projects?: string[]; error?: string }
export interface GeneratedReportData {
  dashboard: DashboardPayload;
  markdown: string;
  meta: { generatedAt?: string; params?: { startDate?: string; endDate?: string; reportType?: ReportType; project?: string }; toolCalls?: { toolName: string; rowCount: number }[]; [key: string]: unknown };
}

export const LLM_MODELS: Record<LlmProvider, string[]> = {
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  openai: ['gpt-5.2', 'gpt-5.2-mini'],
  gemini: ['gemini-3.5-flash', 'gemini-3.5-pro'],
  'openai-compatible': ['custom-model'],
  template: ['template-v1'],
};

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  'openai-compatible': 'Custom OpenAI-compatible',
  template: 'Template (No AI)',
};

export const LLM_OFFICIAL_BASE_URLS: Partial<Record<LlmProvider, string>> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

function nextRequestId(): string { return `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function shouldRedactField(key: string): boolean { const lower = key.toLowerCase(); return lower.includes('key') || lower.includes('token') || lower.includes('credential') || lower.includes('password') || lower.includes('cookie') || lower.includes('session') || lower.includes('xsrf') || lower.includes('jsession'); }
function safeJson(value: unknown): unknown { if (!value || typeof value !== 'object') return value; if (Array.isArray(value)) return value.map(safeJson); const copy: Record<string, unknown> = {}; for (const [key, raw] of Object.entries(value as Record<string, unknown>)) { if (typeof raw === 'string' && raw.startsWith('data:image/')) copy[key] = '***image-data-url-redacted***'; else if (shouldRedactField(key)) copy[key] = raw ? '***redacted***' : raw; else copy[key] = safeJson(raw); } return copy; }
function logApi(event: string, data: Record<string, unknown>): void { console.log(`[web-api] ${event}`, data); }
function normalizeProvider(value: unknown): LlmProvider { return value === 'openai' || value === 'gemini' || value === 'openai-compatible' || value === 'anthropic' || value === 'template' ? value : 'template'; }
function readStoredObject<T>(key: string, fallback: T): T { try { const raw = window.localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } }
function writeStoredObject<T>(key: string, value: T): void { try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }
function projectJql(keys: string[]): string { return keys.length ? `project in (${keys.join(',')}) AND issuetype in (Story, Bug) ORDER BY updated DESC` : ''; }
function canonicalizeJql(jql?: string): string { return (jql || '').replace(/DN4_FT\s*-\s*Supply\s*&\s*DMC/gi, 'DLM').replace(/Supply\s*&\s*DMC/gi, 'DLM').trim(); }
function normalizeJiraConnection(c: JiraConnectionInput): JiraConnectionInput { const projectKeys = uniqueCanonicalProjects(c.projectKeys || []); const jql = canonicalizeJql(c.jql) || projectJql(projectKeys); return { ...c, workspaceProjectId: c.workspaceProjectId?.trim() || undefined, deploymentType: c.deploymentType || 'on-prem', enabled: c.enabled !== false, syncIssues: c.syncIssues !== false, projectKeys, jql }; }
function normalizeQmetryConnection(c: QmetryConnectionInput): QmetryConnectionInput { return { ...c, workspaceProjectId: c.workspaceProjectId?.trim() || undefined, enabled: c.enabled !== false, syncExecutions: c.syncExecutions !== false, projectKey: canonicalProjectOrUndefined(c.projectKey) || '', cycleIds: [] }; }
function normalizeFilter(filter?: Partial<FilterParams>): Partial<FilterParams> | undefined { if (!filter) return undefined; return { ...filter, project: canonicalProjectOrUndefined(filter.project) }; }
function normalizeGenerate(params: GenerateParams): GenerateParams { return { ...params, project: canonicalProjectOrUndefined(params.project) }; }
function validDate(value?: string): string { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value! : ''; }
function browserConnectionsForHeader(): UserConnections { return { jira: getJiraConnections(), qmetry: getQmetryConnections() }; }
function shouldAttachConnectionsHeader(url = '', method = 'get'): boolean { const cleanUrl = url.split('?')[0]; const cleanMethod = method.toLowerCase(); if (cleanUrl === '/integrations/test-connection') return false; if (cleanUrl.startsWith('/cycles/')) return true; if (cleanMethod === 'post' && (cleanUrl === '/generate' || cleanUrl === '/dashboard/search' || cleanUrl === '/integrations/sync' || cleanUrl === '/integrations/test')) return true; return false; }
function modelForSelection(provider: LlmProvider, rawModel?: string, baseUrl?: string): string { const clean = (rawModel || '').trim(); const customEndpoint = provider === 'openai-compatible' || Boolean((baseUrl || '').trim()); if (customEndpoint) return clean || LLM_MODELS[provider][0]; return clean && LLM_MODELS[provider].includes(clean) ? clean : LLM_MODELS[provider][0]; }

export function getReportBranding(): ReportBranding { return readStoredObject<ReportBranding>(REPORT_BRANDING_STORAGE, { logoUrl: '', logoAlt: 'Report logo', title: 'QA Sprint Report', subtitle: '' }); }
export function setReportBranding(branding: ReportBranding): void { writeStoredObject(REPORT_BRANDING_STORAGE, { logoUrl: branding.logoUrl?.trim() || '', logoAlt: branding.logoAlt?.trim() || 'Report logo', title: branding.title?.trim() || 'QA Sprint Report', subtitle: branding.subtitle?.trim() || '' }); }
export function getActiveProject(): string { try { return canonicalProjectOrAll(window.localStorage.getItem(ACTIVE_PROJECT_STORAGE) || 'all'); } catch { return 'all'; } }
export function setActiveProject(project: string): void { try { window.localStorage.setItem(ACTIVE_PROJECT_STORAGE, canonicalProjectOrAll(project)); } catch { /* storage unavailable */ } }
export function getActiveDateRange(): { startDate?: string; endDate?: string } { try { const startDate = validDate(window.localStorage.getItem(ACTIVE_START_DATE_STORAGE) || ''); const endDate = validDate(window.localStorage.getItem(ACTIVE_END_DATE_STORAGE) || ''); return { ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) }; } catch { return {}; } }
export function setActiveDateRange(startDate?: string, endDate?: string): void { try { if (validDate(startDate)) window.localStorage.setItem(ACTIVE_START_DATE_STORAGE, startDate!); if (validDate(endDate)) window.localStorage.setItem(ACTIVE_END_DATE_STORAGE, endDate!); } catch { /* storage unavailable */ } }
export function getUserLlmKey(provider: LlmProvider): string { const keys = readStoredObject<Record<string, string>>(LLM_KEYS_STORAGE, {}); if (keys[provider]) return keys[provider]; if (provider === 'anthropic') { try { return window.localStorage.getItem(ANTHROPIC_KEY_STORAGE) || ''; } catch { return ''; } } return ''; }
export function setUserLlmKey(provider: LlmProvider, value: string): void { const keys = readStoredObject<Record<string, string>>(LLM_KEYS_STORAGE, {}); const clean = value.trim(); if (clean) keys[provider] = clean; else delete keys[provider]; writeStoredObject(LLM_KEYS_STORAGE, keys); if (provider === 'anthropic') { try { if (clean) window.localStorage.setItem(ANTHROPIC_KEY_STORAGE, clean); else window.localStorage.removeItem(ANTHROPIC_KEY_STORAGE); } catch { /* storage unavailable */ } } }
export function getUserLlmSelection(): LlmSelectionInput { const stored = readStoredObject<Partial<LlmSelectionInput>>(LLM_SELECTION_STORAGE, {}); const provider = normalizeProvider(stored.provider); const baseUrl = (stored.baseUrl || '').trim(); const model = modelForSelection(provider, stored.model, baseUrl); const apiKey = getUserLlmKey(provider); return { provider, model, baseUrl: baseUrl || undefined, apiKey: apiKey || undefined }; }
export function setUserLlmSelection(selection: LlmSelectionInput): void { const provider = normalizeProvider(selection.provider); const baseUrl = (selection.baseUrl || '').trim(); const model = modelForSelection(provider, selection.model, baseUrl); writeStoredObject(LLM_SELECTION_STORAGE, { provider, model, baseUrl }); setUserLlmKey(provider, selection.apiKey || ''); }
export function getUserAnthropicKey(): string { return getUserLlmKey('anthropic'); }
export function setUserAnthropicKey(key: string): void { setUserLlmKey('anthropic', key); }

function readConnections<T>(key: string): T[] { return readStoredObject<T[]>(key, []); }
function writeConnections<T>(key: string, value: T[]): void { writeStoredObject(key, value); }
function assertUniqueProjectAssignments(connections: Array<{ workspaceProjectId?: string }>, label: 'JIRA' | 'QMetry'): void { const assigned = new Set<string>(); for (const connection of connections) { const projectId = connection.workspaceProjectId?.trim(); if (!projectId) throw new Error(`Every ${label} connection must be assigned to an existing project.`); if (assigned.has(projectId)) throw new Error(`Only one ${label} connection is allowed per project.`); assigned.add(projectId); } }
export const getJiraConnections = (): JiraConnectionInput[] => readConnections<JiraConnectionInput>(JIRA_CONNECTIONS_STORAGE).map(normalizeJiraConnection);
export const setJiraConnections = (conns: JiraConnectionInput[]): void => { const normalized = conns.map(normalizeJiraConnection); assertUniqueProjectAssignments(normalized, 'JIRA'); writeConnections(JIRA_CONNECTIONS_STORAGE, normalized); };
export const getQmetryConnections = (): QmetryConnectionInput[] => readConnections<QmetryConnectionInput>(QMETRY_CONNECTIONS_STORAGE).map(normalizeQmetryConnection);
export const setQmetryConnections = (conns: QmetryConnectionInput[]): void => { const normalized = conns.map(normalizeQmetryConnection); assertUniqueProjectAssignments(normalized, 'QMetry'); writeConnections(QMETRY_CONNECTIONS_STORAGE, normalized); };
export function newConnectionId(): string { return `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`; }

api.interceptors.request.use((config) => { const meta: RequestMeta = { requestId: nextRequestId(), startedAt: Date.now() }; (config as typeof config & { metadata?: RequestMeta }).metadata = meta; config.headers = config.headers || {}; config.headers['x-request-id'] = meta.requestId; const selectedLlm = getUserLlmSelection(); const anthropicKey = getUserAnthropicKey(); if (anthropicKey) config.headers['x-anthropic-key'] = anthropicKey; const jira = getJiraConnections(); const qmetry = getQmetryConnections(); if (shouldAttachConnectionsHeader(config.url || '', config.method || 'get') && (jira.length || qmetry.length)) config.headers['x-user-connections'] = JSON.stringify(browserConnectionsForHeader()); logApi('request', { requestId: meta.requestId, method: (config.method || 'GET').toUpperCase(), url: `${config.baseURL || ''}${config.url || ''}`, activeProject: getActiveProject(), activeDateRange: getActiveDateRange(), llmProvider: selectedLlm.provider, llmEndpoint: selectedLlm.baseUrl || 'official', hasSelectedLlmKey: Boolean(selectedLlm.apiKey), hasReportLogo: Boolean(getReportBranding().logoUrl), jiraConnections: jira.length, qmetryConnections: qmetry.length, params: safeJson(config.params), body: safeJson(config.data) }); return config; });
api.interceptors.response.use((response) => { const meta = (response.config as typeof response.config & { metadata?: RequestMeta }).metadata; logApi('response', { requestId: meta?.requestId, method: (response.config.method || 'GET').toUpperCase(), url: response.config.url, status: response.status, elapsedMs: meta ? Date.now() - meta.startedAt : undefined }); return response; }, (error) => { if (axios.isAxiosError(error)) { const meta = (error.config as typeof error.config & { metadata?: RequestMeta } | undefined)?.metadata; console.error('[web-api] error', { requestId: meta?.requestId, method: (error.config?.method || 'GET').toUpperCase(), url: error.config?.url, status: error.response?.status, elapsedMs: meta ? Date.now() - meta.startedAt : undefined, response: safeJson(error.response?.data), message: error.message }); } else console.error('[web-api] non-axios error', error); return Promise.reject(error); });

function apiErrorMessage(err: unknown, fallback: string): string { if (axios.isAxiosError(err)) { const data = err.response?.data as { error?: string; message?: string; warnings?: string[] } | undefined; if (data?.error) return data.error; if (data?.message) return data.message; if (data?.warnings?.length) return data.warnings.join('; '); if (err.response?.status) return `${fallback}: HTTP ${err.response.status}`; if (err.code === 'ECONNABORTED') return 'Report generation timed out. Full reports can take 1-2 minutes - please try again.'; return err.message || fallback; } return err instanceof Error ? err.message : fallback; }
async function blobErrorMessage(blob: Blob, fallback: string): Promise<string> { try { const text = await blob.text(); if (!text) return fallback; const payload = JSON.parse(text) as { error?: string; message?: string; warnings?: string[] }; return payload.error || payload.message || payload.warnings?.join('; ') || text.slice(0, 500); } catch { return fallback; } }

export { apiErrorMessage };
export type { DashboardPayload, FilterParams, ReportType, GenerateParams, GenerateResult, LlmSelectionInput, LlmProvider };

export interface IntegrationsStatus { jira: { enabled: boolean; baseUrl: string; configured: boolean; profiles?: unknown[] }; qmetry: { enabled: boolean; baseUrl: string; configured: boolean; cycleIds?: number }; config: { jira: { enabled: boolean; projectKeys: string[]; jql: string }; qmetry: { enabled: boolean; projectKey: string; cycleIds?: string[]; projectId?: string | null } }; userConnections?: { jira: { id: string; name: string; baseUrl: string }[]; qmetry: { id: string; name: string; baseUrl: string }[] } }
export interface CycleFolder { id: string; name: string; parentId?: string; path?: string }
export interface CycleHealth { key: string; name: string; total: number; pass: number; fail: number; blocked: number; ne: number; na: number; passPct: number; coverage: number; status: string }
export interface CycleFoldersResult { source: 'qmetry-live' | 'imported'; connection?: string; connectionId?: string; folders: CycleFolder[]; cycles: CycleFolder[] }
export interface FolderCycleHealthResult { source: 'qmetry-live' | 'imported'; connection?: string; connectionId?: string; folderId: string; cycles: CycleHealth[]; warnings?: string[] }

export const batchApi = {
  getStatus: () => api.get('/status').then((r) => r.data as { apiKeyConfigured: boolean; jiraConfigured: boolean; llmProvidersConfigured?: Record<string, boolean> }),
  testLlm: (selection: LlmSelectionInput) => api.post('/llm/test', selection, { timeout: 35_000 }).then((r) => r.data as { ok: boolean; provider?: LlmProvider; providerLabel?: string; model?: string; route?: 'direct' | 'proxy'; elapsedMs?: number; error?: string; logs?: string[] }).catch((err) => { throw new Error(apiErrorMessage(err, 'LLM connectivity test failed')); }),
  testAnthropic: () => api.get('/anthropic/test', { timeout: 35_000 }).then((r) => r.data as { ok: boolean; model?: string; route?: 'direct' | 'proxy'; elapsedMs?: number; error?: string; logs?: string[] }).catch((err) => { throw new Error(apiErrorMessage(err, 'Anthropic connectivity test failed')); }),
  generate: (params: GenerateParams) => { const llm = params.llm || getUserLlmSelection(); return api.post<GenerateResult>('/generate', normalizeGenerate({ ...params, llm }), { timeout: 300_000 }).then((r) => r.data).catch((err) => { throw new Error(apiErrorMessage(err, 'Report generation failed')); }); },
  getDashboard: (filter?: Partial<FilterParams>) => { const clean = normalizeFilter(filter); const params = clean ? { startDate: clean.startDate, endDate: clean.endDate, search: clean.search, result: clean.result, project: clean.project } : undefined; return api.get('/dashboard', { params }).then((r) => r.data as DashboardPayload).catch((err) => { if (axios.isAxiosError(err) && err.response?.status === 404) return null; throw err; }); },
  searchDashboardByDates: (filter: Partial<FilterParams>) => api.post('/dashboard/search', normalizeFilter(filter), { timeout: 240_000 }).then((r) => (r.data as DashboardSearchResult).dashboard).catch((err) => { throw new Error(apiErrorMessage(err, 'Dashboard API search failed')); }),
  getReport: () => api.get('/report').then((r) => r.data as GeneratedReportData).catch((err) => { if (axios.isAxiosError(err) && err.response?.status === 404) return null; throw err; }),
  listProjects: () => api.get('/projects').then((r) => r.data as ProjectRecord[]),
  createProject: (input: { key: string; name: string }) => api.post('/projects', input).then((r) => (r.data as { project: ProjectRecord }).project).catch((err) => { throw new Error(apiErrorMessage(err, 'Project creation failed')); }),
  upload: (projectId: string, file: File) => { const form = new FormData(); form.append('file', file); return api.post(`/projects/${encodeURIComponent(projectId)}/files`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data).catch((err) => { throw new Error(apiErrorMessage(err, 'Upload failed')); }); },
  syncInputFiles: (projectId: string, filter?: Partial<FilterParams>) => api.post(`/projects/${encodeURIComponent(projectId)}/imports/sync`, normalizeFilter(filter) || {}, { timeout: 180_000 }).then((r) => r.data as SyncInputResult).catch((err) => { throw new Error(apiErrorMessage(err, 'Import sync failed')); }),
  syncLiveData: (filter?: Partial<FilterParams>) => api.post('/integrations/sync', normalizeFilter(filter) || {}, { timeout: 240_000 }).then((r) => r.data as SyncInputResult).catch((err) => { throw new Error(apiErrorMessage(err, 'JIRA/QMetry sync failed')); }),
  listInputFiles: (projectId: string) => api.get(`/projects/${encodeURIComponent(projectId)}/files`).then((r) => r.data as ProjectFileRecord[]),
  deleteInputFile: (projectId: string, fileId: string) => api.delete(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`).then((r) => r.data as SyncInputResult),
  downloadImportReconciliation: async (projectId: string, syncId: string) => {
    const response = await api.get(`/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(syncId)}/report.csv`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data as Blob);
    const link = document.createElement('a'); link.href = url; link.download = `import-reconciliation-${syncId}.csv`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  },
  getIntegrations: () => api.get('/integrations').then((r) => r.data as IntegrationsStatus),
  testIntegrations: () => api.post('/integrations/test').then((r) => r.data),
  testConnection: (type: 'jira' | 'qmetry', connection: JiraConnectionInput | QmetryConnectionInput) => api.post('/integrations/test-connection', { type, connection: type === 'jira' ? normalizeJiraConnection(connection as JiraConnectionInput) : normalizeQmetryConnection(connection as QmetryConnectionInput) }, { timeout: 35_000 }).then((r) => r.data as { ok: boolean; count?: number; error?: string }).catch((err) => ({ ok: false, error: apiErrorMessage(err, 'Connection test failed') })),
  getCycleFolders: (connectionId?: unknown) => { const id = typeof connectionId === 'string' ? connectionId : undefined; return api.get('/cycles/folders', { params: { connectionId: id }, timeout: 45_000 }).then((r) => r.data as CycleFoldersResult); },
  getCyclesByFolder: (folderId: string, connectionId?: string, filter?: Partial<FilterParams>) => { const clean = normalizeFilter(filter); return api.get('/cycles/by-folder', { params: { folderId, connectionId, startDate: clean?.startDate, endDate: clean?.endDate, project: clean?.project }, timeout: 180_000 }).then((r) => r.data as FolderCycleHealthResult); },
  downloadReportPdf: async ({ startDate, endDate, reportType, kpiStyle, project, branding }: { startDate: string; endDate: string; reportType: ReportType; kpiStyle: string; project?: string; branding?: ReportBranding }) => {
    const cleanProject = canonicalProjectOrUndefined(project);
    try {
      const selectedBranding = branding || getReportBranding();
      const response = await api.post('/report/pdf', { startDate, endDate, reportType, kpiStyle, project: cleanProject, branding: selectedBranding }, { responseType: 'blob', timeout: 150_000 });
      const blob = response.data as Blob;
      if (blob.type === 'application/json') throw new Error(await blobErrorMessage(blob, 'PDF export failed'));
      const url = URL.createObjectURL(blob);
      const suffix = cleanProject ? `-${cleanProject}` : '';
      const link = document.createElement('a'); link.href = url; link.download = `qa-report${suffix}-${startDate}-to-${endDate}.pdf`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (err) { if (axios.isAxiosError(err) && err.response?.data instanceof Blob) throw new Error(await blobErrorMessage(err.response.data, 'PDF export failed')); throw new Error(apiErrorMessage(err, 'PDF export failed')); }
  },
};
