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
    officeProxyUrl?: RuntimeConfigValue;
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

interface PackageJson {
  workspaces?: unknown;
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

function readPackageJson(dir: string): PackageJson | undefined {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJson;
  } catch {
    return undefined;
  }
}

function hasDirectory(dir: string, name: string): boolean {
  try {
    return fs.statSync(path.join(dir, name)).isDirectory();
  } catch {
    return false;
  }
}

function isRepoRootCandidate(dir: string, pkg: PackageJson): boolean {
  const hasApps = hasDirectory(dir, 'apps');
  const hasConfig = hasDirectory(dir, 'config');
  return Boolean(
    pkg.workspaces ||
    (hasApps && hasConfig)
  );
}

function findRootFrom(start: string): string | undefined {
  let dir = path.resolve(start);
  try {
    if (fs.existsSync(dir) && fs.statSync(dir).isFile()) dir = path.dirname(dir);
  } catch {
    // Keep the resolved start path and walk upward; this is only a best-effort root probe.
  }

  let firstPackageDir: string | undefined;
  for (let i = 0; i < 20; i++) {
    const pkg = readPackageJson(dir);
    if (pkg) {
      firstPackageDir = firstPackageDir || dir;
      if (isRepoRootCandidate(dir, pkg)) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return firstPackageDir;
}

function configuredProjectRoot(): string | undefined {
  const configured = process.env.PROJECT_ROOT?.trim();
  return configured ? path.resolve(normalizeEnvPath(configured)) : undefined;
}

function findRepoRoot(): string {
  return configuredProjectRoot()
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

  const officeProxyUrl = config.network?.officeProxyUrl;
  setEnv('HTTPS_PROXY', config.network?.httpsProxy || officeProxyUrl);
  setEnv('HTTP_PROXY', config.network?.httpProxy || officeProxyUrl);
  setEnv('ANTHROPIC_PROXY_URL', config.network?.anthropicProxyUrl || officeProxyUrl);
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
      repoRoot = process.env.PROJECT_ROOT || root;
      runtimeConfigPath = candidate;
      runtimeConfigLoaded = true;
      console.log(`[runtime-config] root=${repoRoot} loaded=${candidate}`);
    } catch (err) {
      runtimeLoadError = err instanceof Error ? err.message : String(err);
      console.warn(`[runtime-config] root=${root} failed to load ${candidate}: ${runtimeLoadError}`);
    }
    return;
  }

  applyPathNormalizations();
  repoRoot = process.env.PROJECT_ROOT || root;
  console.log(`[runtime-config] root=${repoRoot} no config/runtime.json found — using built-in defaults and browser Settings only`);
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
