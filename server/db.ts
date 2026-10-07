import fs from 'node:fs';
import pg, { Pool, type PoolClient } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set.');
}

// node-postgres's defaults don't match our app's wire format: BIGINT (oid 20)
// comes back as a string (to avoid silent precision loss above 2^53), but our
// MAX_CENTS (10 billion) is well within Number.MAX_SAFE_INTEGER, and every
// `amountCents`-shaped field in the app expects a plain number. DATE/TIMESTAMPTZ
// (1082/1184) come back as JS Date objects by default; the app works with
// plain ISO strings (`YYYY-MM-DD` / full ISO timestamp) everywhere else.
pg.types.setTypeParser(20, (val) => parseInt(val, 10));
pg.types.setTypeParser(1082, (val) => val);
pg.types.setTypeParser(1184, (val) => new Date(val).toISOString());

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? {
          rejectUnauthorized: true,
          ca: process.env.DATABASE_CA_PATH ? fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8') : undefined,
        }
      : undefined,
});

/** Runs `callback` inside BEGIN/COMMIT, rolling back and rethrowing on any error. */
export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
