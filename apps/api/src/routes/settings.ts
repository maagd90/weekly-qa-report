import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/schema';

const router = Router();

const ALGORITHM = 'aes-256-cbc';

function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || 'qa-dashboard-default-key-32bytes!';
  // Derive a 32-byte key from whatever string is provided
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(encoded: string): string {
  const [ivHex, encHex] = encoded.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  if (!row) return null;
  try { return decrypt(row.value); } catch { return null; }
}

function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
    .run(key, encrypt(value), new Date().toISOString());
}

export function getClaudeApiKey(): string | null {
  return getSetting('claude_api_key');
}

export interface JenkinsConfig {
  url: string;
  username: string;
  apiToken: string;
  pollIntervalMinutes: number;
}

export function getJenkinsConfig(): JenkinsConfig | null {
  const url      = getSetting('jenkins_url');
  const username = getSetting('jenkins_username');
  const apiToken = getSetting('jenkins_api_token');
  if (!url || !apiToken) return null;
  const pollStr = getSetting('jenkins_poll_interval');
  return { url: url.replace(/\/$/, ''), username: username || '', apiToken, pollIntervalMinutes: pollStr ? Number(pollStr) : 5 };
}

// GET /api/settings/ai — key configured status only
router.get('/ai', (_req: Request, res: Response) => {
  const key = getClaudeApiKey();
  res.json({ keyConfigured: !!key });
});

// POST /api/settings/ai — save key
router.post('/ai', (req: Request, res: Response) => {
  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey || apiKey.trim().length < 10) {
    return res.status(400).json({ error: 'Valid API key required' });
  }
  const db = getDb();
  const encrypted = encrypt(apiKey.trim());
  db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
    .run('claude_api_key', encrypted, new Date().toISOString());
  res.json({ ok: true, keyConfigured: true });
});

// DELETE /api/settings/ai — remove key
router.delete('/ai', (_req: Request, res: Response) => {
  const db = getDb();
  db.prepare(`DELETE FROM settings WHERE key = 'claude_api_key'`).run();
  res.json({ ok: true, keyConfigured: false });
});

// POST /api/settings/ai/test — verify key works
router.post('/ai/test', async (_req: Request, res: Response) => {
  const key = getClaudeApiKey();
  if (!key) return res.status(400).json({ error: 'No API key configured' });

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey: key });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
    });
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    res.json({ ok: true, response: text.trim() });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── Jenkins settings ──────────────────────────────────────────────────────

// GET /api/settings/jenkins
router.get('/jenkins', (_req: Request, res: Response) => {
  const cfg = getJenkinsConfig();
  const url = getSetting('jenkins_url');
  res.json({
    configured: !!cfg,
    url: url || '',
    username: getSetting('jenkins_username') || '',
    pollIntervalMinutes: cfg?.pollIntervalMinutes ?? 5,
  });
});

// POST /api/settings/jenkins
router.post('/jenkins', (req: Request, res: Response) => {
  const { url, username, apiToken, pollIntervalMinutes } = req.body as {
    url?: string; username?: string; apiToken?: string; pollIntervalMinutes?: number;
  };
  if (!url || !apiToken) return res.status(400).json({ error: 'url and apiToken are required' });
  setSetting('jenkins_url', url.trim());
  setSetting('jenkins_username', username?.trim() || '');
  setSetting('jenkins_api_token', apiToken.trim());
  setSetting('jenkins_poll_interval', String(pollIntervalMinutes ?? 5));

  // (Re)start the poller immediately with the new config
  const newCfg = getJenkinsConfig();
  if (newCfg) {
    const { startJenkinsPoller } = require('../services/jenkinsPoller');
    startJenkinsPoller(newCfg);
  }

  res.json({ ok: true, configured: true });
});

// DELETE /api/settings/jenkins
router.delete('/jenkins', (_req: Request, res: Response) => {
  const db = getDb();
  db.prepare(`DELETE FROM settings WHERE key IN ('jenkins_url','jenkins_username','jenkins_api_token','jenkins_poll_interval')`).run();
  res.json({ ok: true, configured: false });
});

// POST /api/settings/jenkins/test — ping Jenkins and list jobs
router.post('/jenkins/test', async (_req: Request, res: Response) => {
  const cfg = getJenkinsConfig();
  if (!cfg) return res.status(400).json({ error: 'Jenkins not configured' });
  try {
    const { testJenkinsConnection } = require('../services/jenkinsPoller');
    const result = await testJenkinsConnection(cfg);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

export default router;
