'use strict';

/**
 * Load repo-root .env on Mac, Windows, and Linux without shell `source`.
 * Resolves the monorepo root via package.json (name: qa-dashboard), then
 * normalizes file-path env vars for the current OS.
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
  'PROJECT_ROOT',
];

let loaded = false;

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

/** Normalize a filesystem path from .env for the current OS. */
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

function resolveRepoRoot() {
  const explicit = stripQuotes(process.env.PROJECT_ROOT || '');
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (isRepoRoot(resolved) || fs.existsSync(path.join(resolved, '.env'))) {
      return resolved;
    }
  }

  // This file lives in scripts/ — parent directory is the repo root.
  const fromScript = findRepoRoot(path.join(__dirname, '..'));
  if (fromScript) return fromScript;

  if (process.env.INIT_CWD) {
    const fromInit = findRepoRoot(process.env.INIT_CWD);
    if (fromInit) return fromInit;
  }

  return findRepoRoot(process.cwd());
}

function loadRepoEnv() {
  if (loaded) return { alreadyLoaded: true };
  loaded = true;

  const repoRoot = resolveRepoRoot();
  const envPath = repoRoot ? path.join(repoRoot, '.env') : undefined;

  let result;
  if (envPath && fs.existsSync(envPath)) {
    result = dotenv.config({ path: envPath });
    applyPathNormalizations(result.parsed);
  } else {
    result = dotenv.config();
    applyPathNormalizations(result.parsed);
  }

  if (result.error) {
    console.warn(`[env] failed to load ${envPath || '.env'}: ${result.error.message}`);
  } else {
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
  }

  return { repoRoot, envPath, ...result };
}

module.exports = { loadRepoEnv, normalizeEnvPath, findRepoRoot, resolveRepoRoot };

loadRepoEnv();
