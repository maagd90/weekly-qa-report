'use strict';

/**
 * Load repo-root .env on Mac, Windows, and Linux.
 * Preload with: node -r ./scripts/loadRepoEnv.cjs …
 * (used by npm dev scripts so env is set before any app code runs)
 */
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const REPO_PKG_NAME = 'qa-dashboard';
const PATH_ENV_KEYS = [
  'PUPPETEER_EXECUTABLE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'INPUT_DIR',
  'OUTPUT_DIR',
  'CONFIG_DIR',
];

let loaded = false;
let lastLoad = {
  repoRoot: undefined,
  envPath: undefined,
  searched: [],
  error: undefined,
};

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isRepoRoot(dir) {
  const pkg = readJsonSafe(path.join(dir, 'package.json'));
  return Boolean(pkg && pkg.name === REPO_PKG_NAME && Array.isArray(pkg.workspaces));
}

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 12; depth++) {
    lastLoad.searched.push(dir);
    if (isRepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function stripQuotes(value) {
  const v = String(value || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function normalizeEnvPath(value) {
  if (!value) return value;
  let p = stripQuotes(String(value).trim());
  if (process.platform === 'win32') {
    p = p.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
  }
  return path.normalize(p);
}

function applyPathNormalizations(parsed) {
  if (!parsed) return;
  for (const key of PATH_ENV_KEYS) {
    const raw = parsed[key];
    if (raw && typeof raw === 'string' && raw.trim()) {
      const normalized = normalizeEnvPath(raw);
      parsed[key] = normalized;
      process.env[key] = normalized;
    }
  }
}

function readEnvFile(envPath) {
  let content = fs.readFileSync(envPath, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }
  return dotenv.parse(content);
}

function resolveRepoRoot() {
  lastLoad.searched = [];

  const explicit = stripQuotes(process.env.PROJECT_ROOT || '');
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (isRepoRoot(resolved) || fs.existsSync(path.join(resolved, '.env'))) {
      return resolved;
    }
  }

  const fromScript = findRepoRoot(path.join(__dirname, '..'));
  if (fromScript) return fromScript;

  if (process.env.INIT_CWD) {
    const fromInit = findRepoRoot(process.env.INIT_CWD);
    if (fromInit) return fromInit;
  }

  return findRepoRoot(process.cwd());
}

function loadRepoEnv() {
  if (loaded) return lastLoad;
  loaded = true;

  const repoRoot = resolveRepoRoot();
  lastLoad.repoRoot = repoRoot;

  if (repoRoot) {
    process.env.PROJECT_ROOT = process.env.PROJECT_ROOT || repoRoot;
  }

  const envPath = repoRoot ? path.join(repoRoot, '.env') : undefined;
  lastLoad.envPath = envPath;

  try {
    if (envPath && fs.existsSync(envPath)) {
      const parsed = readEnvFile(envPath);
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
      applyPathNormalizations(parsed);
      lastLoad.error = undefined;
    } else {
      const result = dotenv.config();
      applyPathNormalizations(result.parsed);
      if (result.error) lastLoad.error = result.error.message;
    }
  } catch (err) {
    lastLoad.error = err instanceof Error ? err.message : String(err);
    console.warn(`[env] failed to load ${envPath || '.env'}: ${lastLoad.error}`);
    return lastLoad;
  }

  const loadedFrom =
    envPath && fs.existsSync(envPath) ? envPath : path.join(process.cwd(), '.env');
  const keyOk = Boolean((process.env.ANTHROPIC_API_KEY || '').trim());
  const proxy =
    (process.env.ANTHROPIC_PROXY_URL || '').trim() ||
    (process.env.HTTPS_PROXY || '').trim() ||
    (process.env.HTTP_PROXY || '').trim();

  console.log(
    `[env] loaded ${loadedFrom} (ANTHROPIC_API_KEY=${keyOk ? 'set' : 'missing'}, proxy=${proxy || 'none'})`,
  );

  if (!keyOk && envPath && fs.existsSync(envPath)) {
    console.warn(
      '[env] ANTHROPIC_API_KEY is empty in .env — add your key on its own line (no spaces around =).',
    );
  }

  if (!envPath || !fs.existsSync(envPath)) {
    console.warn(
      `[env] no .env at repo root${repoRoot ? ` (${repoRoot})` : ''}. Copy .env.example to .env and add your keys.`,
    );
  }

  return lastLoad;
}

function getEnvStatus() {
  const proxy =
    (process.env.ANTHROPIC_PROXY_URL || '').trim() ||
    (process.env.HTTPS_PROXY || '').trim() ||
    (process.env.HTTP_PROXY || '').trim();
  return {
    platform: process.platform,
    cwd: process.cwd(),
    repoRoot: lastLoad.repoRoot || process.env.PROJECT_ROOT || null,
    envPath: lastLoad.envPath || null,
    envFileExists: Boolean(lastLoad.envPath && fs.existsSync(lastLoad.envPath)),
    apiKeyConfigured: Boolean((process.env.ANTHROPIC_API_KEY || '').trim()),
    proxyConfigured: Boolean(proxy),
    proxySource: proxy
      ? (process.env.ANTHROPIC_PROXY_URL || '').trim()
        ? 'ANTHROPIC_PROXY_URL'
        : (process.env.HTTPS_PROXY || '').trim()
          ? 'HTTPS_PROXY'
          : 'HTTP_PROXY'
      : 'none',
    loadError: lastLoad.error || null,
    searched: lastLoad.searched,
  };
}

module.exports = { loadRepoEnv, getEnvStatus, normalizeEnvPath, findRepoRoot, resolveRepoRoot };

loadRepoEnv();
