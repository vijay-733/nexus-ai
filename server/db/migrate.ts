import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { connectDb, query, isConnected } from './pgClient.js';
import { logger } from '../utils/logger.js';

const _dir = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const ok = await connectDb();
  if (!ok) return;

  try {
    const sql = readFileSync(join(_dir, 'schema.sql'), 'utf-8');
    await query(sql);
    logger.info('migrate', 'Schema applied successfully');
  } catch (err) {
    logger.error('migrate', `Migration failed: ${err instanceof Error ? err.message : err}`);
    // Non-fatal — in-memory fallback is used if postgres is unavailable
  }
}

export async function auditLog(
  userId: string | null,
  action: string,
  resource: string,
  resourceId?: string,
  result = 'success',
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!isConnected()) return;
  try {
    await query(
      `INSERT INTO audit_log (user_id, action, resource, resource_id, result, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, action, resource, resourceId ?? null, result, metadata ? JSON.stringify(metadata) : null]
    );
  } catch {
    // Audit log failure must never break the main path
  }
}

export async function persistUsage(record: {
  userId: string;
  action: string;
  provider: string;
  status: string;
  durationMs: number;
  creditsUsed: number;
  tokensUsed?: number;
  promptPreview?: string;
  taskId?: string;
}): Promise<void> {
  if (!isConnected()) return;
  try {
    await query(
      `INSERT INTO usage_records
        (user_id, action, provider, status, duration_ms, credits_used, tokens_used, prompt_preview, task_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        record.userId, record.action, record.provider, record.status,
        record.durationMs, record.creditsUsed, record.tokensUsed ?? 0,
        record.promptPreview?.slice(0, 200) ?? null, record.taskId ?? null,
      ]
    );
  } catch {
    // Non-fatal
  }
}
