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
        process.env.PROJECT_ROOT = process.env.PROJECT_ROOT || dir;
        const keyOk = Boolean((parsed.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim());
        console.log(`[env] loaded ${candidate} (ANTHROPIC_API_KEY=${keyOk ? 'set' : 'missing'})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[env] failed to load ${candidate}: ${msg}`);
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const result = dotenv.config();
  applyPathNormalizations(result.parsed || {});
  console.warn('[env] no repo-root .env found — using process environment only');
})();
