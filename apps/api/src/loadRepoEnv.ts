import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const PATH_ENV_KEYS = [
  'PUPPETEER_EXECUTABLE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'INPUT_DIR',
  'OUTPUT_DIR',
  'CONFIG_DIR',
];

let envPath: string | undefined;
let repoRoot: string | undefined;
let loadError: string | undefined;

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

function applyPathNormalizations(parsed: Record<string, string>): void {
  for (const key of PATH_ENV_KEYS) {
    const raw = parsed[key];
    if (raw?.trim()) {
      const normalized = normalizeEnvPath(raw);
      parsed[key] = normalized;
      process.env[key] = normalized;
    }
  }
}

(function loadRepoEnv() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      try {
        let content = fs.readFileSync(candidate, 'utf8');
        if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
        const parsed = dotenv.parse(content);
        for (const [k, v] of Object.entries(parsed)) {
          if (process.env[k] === undefined) process.env[k] = v;
        }
        applyPathNormalizations(parsed);
        envPath = candidate;
        repoRoot = dir;
        process.env.PROJECT_ROOT = process.env.PROJECT_ROOT || dir;
        const keyOk = Boolean((parsed.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim());
        const proxy =
          (parsed.HTTPS_PROXY || process.env.HTTPS_PROXY || '').trim() ||
          (parsed.ANTHROPIC_PROXY_URL || process.env.ANTHROPIC_PROXY_URL || '').trim();
        console.log(
          `[env] loaded ${candidate} (ANTHROPIC_API_KEY=${keyOk ? 'set' : 'missing'}, proxy=${proxy || 'none'})`,
        );
        if (!keyOk) {
          console.warn('[env] ANTHROPIC_API_KEY is empty in .env — add your key on its own line.');
        }
      } catch (err) {
        loadError = err instanceof Error ? err.message : String(err);
        console.warn(`[env] failed to load ${candidate}: ${loadError}`);
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const result = dotenv.config();
  applyPathNormalizations(result.parsed || {});
  if (result.error) loadError = result.error.message;
  console.warn('[env] no repo-root .env found — using process environment only');
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
    envPath: envPath || null,
    envFileExists: Boolean(envPath && fs.existsSync(envPath)),
    apiKeyConfigured: Boolean((process.env.ANTHROPIC_API_KEY || '').trim()),
    proxyConfigured: Boolean(proxy),
    proxySource: proxy
      ? (process.env.ANTHROPIC_PROXY_URL || '').trim()
        ? 'ANTHROPIC_PROXY_URL'
        : (process.env.HTTPS_PROXY || '').trim()
          ? 'HTTPS_PROXY'
          : 'HTTP_PROXY'
      : 'none',
    loadError: loadError || null,
  };
}
