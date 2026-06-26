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

export function getClaudeApiKey(): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'claude_api_key'`).get() as { value: string } | undefined;
  if (!row) return null;
  try {
    return decrypt(row.value);
  } catch {
    return null;
  }
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

export default router;
