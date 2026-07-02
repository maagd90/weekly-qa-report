import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

function findRepoEnvFile(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function resolveEnvPath(): string | undefined {
  const root = (process.env.PROJECT_ROOT || '').trim();
  if (root) {
    const fromRoot = path.join(path.resolve(root), '.env');
    if (fs.existsSync(fromRoot)) return fromRoot;
  }
  return findRepoEnvFile(__dirname) ?? findRepoEnvFile(process.cwd());
}

const envPath = resolveEnvPath();
const result = envPath ? dotenv.config({ path: envPath }) : dotenv.config();

if (result.error) {
  console.warn(`[env] failed to load ${envPath ?? '.env'}: ${result.error.message}`);
} else if (envPath) {
  const keyOk = Boolean((process.env.ANTHROPIC_API_KEY || '').trim());
  const proxy =
    (process.env.ANTHROPIC_PROXY_URL || '').trim() ||
    (process.env.HTTPS_PROXY || '').trim() ||
    (process.env.HTTP_PROXY || '').trim();
  console.log(
    `[env] loaded ${envPath} (ANTHROPIC_API_KEY=${keyOk ? 'set' : 'missing'}, proxy=${proxy || 'none'})`,
  );
}
