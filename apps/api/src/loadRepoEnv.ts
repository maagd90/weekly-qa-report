import fs from 'fs';
import path from 'path';

const PATH_ENV_KEYS = [
  'PUPPETEER_EXECUTABLE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'INPUT_DIR',
  'OUTPUT_DIR',
  'CONFIG_DIR',
  'PROJECT_ROOT',
];

type RuntimeConfigValue = string | number | boolean | null | undefined;

interface RuntimeConfig {
  env?: Record<string, RuntimeConfigValue>;
  paths?: {
    projectRoot?: RuntimeConfigValue;
    inputDir?: RuntimeConfigValue;
    outputDir?: RuntimeConfigValue;
    configDir?: RuntimeConfigValue;
    puppeteerExecutablePath?: RuntimeConfigValue;
    pdfPrintUrl?: RuntimeConfigValue;
  };
  network?: {
    httpsProxy?: RuntimeConfigValue;
    httpProxy?: RuntimeConfigValue;
    anthropicProxyUrl?: RuntimeConfigValue;
    nodeExtraCaCerts?: RuntimeConfigValue;
    integrationAllowSelfSignedCerts?: RuntimeConfigValue;
    jiraAllowSelfSigned?: RuntimeConfigValue;
  };
  llm?: {
    provider?: RuntimeConfigValue;
    model?: RuntimeConfigValue;
    anthropicModel?: RuntimeConfigValue;
    openaiModel?: RuntimeConfigValue;
    geminiModel?: RuntimeConfigValue;
    customLlmModel?: RuntimeConfigValue;
    customLlmBaseUrl?: RuntimeConfigValue;
    anthropicApiKey?: RuntimeConfigValue;
    openaiApiKey?: RuntimeConfigValue;
    geminiApiKey?: RuntimeConfigValue;
    customLlmApiKey?: RuntimeConfigValue;
  };
  jira?: {
    email?: RuntimeConfigValue;
    apiToken?: RuntimeConfigValue;
    cloudEmail?: RuntimeConfigValue;
    cloudSecret?: RuntimeConfigValue;
    onPremSecret?: RuntimeConfigValue;
    sessionHeader?: RuntimeConfigValue;
    sessionId?: RuntimeConfigValue;
    xsrfToken?: RuntimeConfigValue;
  };
  qmetry?: {
    basicAuth?: RuntimeConfigValue;
  };
}

let runtimeConfigPath: string | undefined;
let runtimeConfigLoaded = false;
let runtimeLoadError: string | undefined;
let repoRoot: string | undefined;

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function normalizeEnvPath(value: string): string {
  let p = stripQuotes(value);
  if (process.platform === 'win32') {
    p = p.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
  }
  return path.normalize(p);
}

function applyPathNormalizations(): void {
  for (const key of PATH_ENV_KEYS) {
    const raw = process.env[key];
    if (raw?.trim()) process.env[key] = normalizeEnvPath(raw);
  }
}

function asEnvString(value: RuntimeConfigValue): string | undefined {
  if (value === undefined || value === null) return undefined;
  const rendered = String(value).trim();
  return rendered ? rendered : undefined;
}

function setEnv(key: string, value: RuntimeConfigValue): void {
  const rendered = asEnvString(value);
  if (rendered !== undefined) process.env[key] = rendered;
}

function applyMap(values: Record<string, RuntimeConfigValue> | undefined): void {
  if (!values) return;
  for (const [key, value] of Object.entries(values)) setEnv(key, value);
}

function findRootFrom(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function findRepoRoot(): string {
  return process.env.PROJECT_ROOT
    || findRootFrom(process.cwd())
    || findRootFrom(__dirname)
    || process.cwd();
}

function candidateRuntimeConfigPaths(root: string): string[] {
  const configured = process.env.RUNTIME_CONFIG_PATH?.trim();
  const configDir = process.env.CONFIG_DIR?.trim() || path.join(root, 'config');
  return [...new Set([
    ...(configured ? [configured] : []),
    path.join(configDir, 'runtime.json'),
    path.join(root, 'config', 'runtime.json'),
  ].map((p) => path.resolve(p)))];
}

function applyRuntimeConfig(config: RuntimeConfig): void {
  applyMap(config.env);

  setEnv('PROJECT_ROOT', config.paths?.projectRoot);
  setEnv('INPUT_DIR', config.paths?.inputDir);
  setEnv('OUTPUT_DIR', config.paths?.outputDir);
  setEnv('CONFIG_DIR', config.paths?.configDir);
  setEnv('PUPPETEER_EXECUTABLE_PATH', config.paths?.puppeteerExecutablePath);
  setEnv('PDF_PRINT_URL', config.paths?.pdfPrintUrl);

  setEnv('HTTPS_PROXY', config.network?.httpsProxy);
  setEnv('HTTP_PROXY', config.network?.httpProxy);
  setEnv('ANTHROPIC_PROXY_URL', config.network?.anthropicProxyUrl);
  setEnv('NODE_EXTRA_CA_CERTS', config.network?.nodeExtraCaCerts);
  setEnv('INTEGRATION_ALLOW_SELF_SIGNED_CERTS', config.network?.integrationAllowSelfSignedCerts);
  setEnv('JIRA_ALLOW_SELF_SIGNED', config.network?.jiraAllowSelfSigned);

  setEnv('LLM_PROVIDER', config.llm?.provider);
  setEnv('LLM_MODEL', config.llm?.model);
  setEnv('ANTHROPIC_MODEL', config.llm?.anthropicModel);
  setEnv('OPENAI_MODEL', config.llm?.openaiModel);
  setEnv('GEMINI_MODEL', config.llm?.geminiModel);
  setEnv('CUSTOM_LLM_MODEL', config.llm?.customLlmModel);
  setEnv('CUSTOM_LLM_BASE_URL', config.llm?.customLlmBaseUrl);
  setEnv('ANTHROPIC_API_KEY', config.llm?.anthropicApiKey);
  setEnv('OPENAI_API_KEY', config.llm?.openaiApiKey);
  setEnv('GEMINI_API_KEY', config.llm?.geminiApiKey);
  setEnv('CUSTOM_LLM_API_KEY', config.llm?.customLlmApiKey);

  setEnv('JIRA_EMAIL', config.jira?.email);
  setEnv('JIRA_API_TOKEN', config.jira?.apiToken);
  setEnv('JIRA_CLOUD_EMAIL', config.jira?.cloudEmail);
  setEnv('JIRA_CLOUD_SECRET', config.jira?.cloudSecret);
  setEnv('JIRA_ONPREM_SECRET', config.jira?.onPremSecret);
  setEnv('JIRA_SESSION_HEADER', config.jira?.sessionHeader);
  setEnv('JIRA_SESSION_ID', config.jira?.sessionId);
  setEnv('JIRA_XSRF_TOKEN', config.jira?.xsrfToken);

  setEnv('QMETRY_BASIC_AUTH', config.qmetry?.basicAuth);
}

(function loadRuntimeConfig() {
  const root = findRepoRoot();
  repoRoot = root;
  process.env.PROJECT_ROOT = process.env.PROJECT_ROOT || root;
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || path.join(root, 'config');

  for (const candidate of candidateRuntimeConfigPaths(root)) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const config = JSON.parse(fs.readFileSync(candidate, 'utf8')) as RuntimeConfig;
      applyRuntimeConfig(config);
      applyPathNormalizations();
      runtimeConfigPath = candidate;
      runtimeConfigLoaded = true;
      console.log(`[runtime-config] loaded ${candidate}`);
    } catch (err) {
      runtimeLoadError = err instanceof Error ? err.message : String(err);
      console.warn(`[runtime-config] failed to load ${candidate}: ${runtimeLoadError}`);
    }
    return;
  }

  applyPathNormalizations();
  console.log('[runtime-config] no config/runtime.json found — using built-in defaults and browser Settings only');
})();

export function getEnvStatus() {
  const proxy =
    (process.env.ANTHROPIC_PROXY_URL || '').trim() ||
    (process.env.HTTPS_PROXY || '').trim() ||
    (process.env.HTTP_PROXY || '').trim();
  return {
    platform: process.platform,
    cwd: process.cwd(),
    repoRoot: repoRoot || process.env.PROJECT_ROOT || null,
    runtimeConfigPath: runtimeConfigPath || null,
    runtimeConfigLoaded,
    envPath: null,
    envFileExists: false,
    apiKeyConfigured: Boolean((process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.CUSTOM_LLM_API_KEY || '').trim()),
    proxyConfigured: Boolean(proxy),
    proxySource: proxy
      ? (process.env.ANTHROPIC_PROXY_URL || '').trim()
        ? 'ANTHROPIC_PROXY_URL'
        : (process.env.HTTPS_PROXY || '').trim()
          ? 'HTTPS_PROXY'
          : 'HTTP_PROXY'
      : 'none',
    integrationAllowSelfSigned: process.env.INTEGRATION_ALLOW_SELF_SIGNED_CERTS || null,
    jiraAllowSelfSigned: process.env.JIRA_ALLOW_SELF_SIGNED || null,
    loadError: runtimeLoadError || null,
  };
}
