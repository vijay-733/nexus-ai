import { Pool, type PoolClient, type QueryResult } from 'pg';
import { logger } from '../utils/logger.js';

let pool: Pool | null = null;
let connected = false;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      max:              20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.NODE_ENV === 'production' && !process.env.POSTGRES_URL?.includes('localhost')
        ? { rejectUnauthorized: false }
        : false,
    });

    pool.on('error', (err) => {
      logger.error('pg', `Pool error: ${err.message}`);
    });
  }
  return pool;
}

export async function connectDb(): Promise<boolean> {
  if (!process.env.POSTGRES_URL) {
    logger.info('pg', 'POSTGRES_URL not set — skipping PostgreSQL');
    return false;
  }
  try {
    const p = getPool();
    const client = await p.connect();
    client.release();
    connected = true;
    logger.info('pg', 'PostgreSQL connected');
    return true;
  } catch (err) {
    logger.error('pg', `Connection failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export function isConnected(): boolean { return connected; }

export async function query<R = unknown>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<R>> {
  return getPool().query<R>(sql, params);
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
