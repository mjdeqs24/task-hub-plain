import sql from 'mssql';
import { config } from '../config.js';

/**
 * Build an `mssql` configuration object from the app config.
 * @param {Partial<import('mssql').config>} [overrides]
 * @returns {import('mssql').config}
 */
export function buildSqlConfig(overrides = {}) {
  const { db } = config;
  return {
    server: db.server,
    ...(db.port ? { port: db.port } : {}),
    user: db.user,
    password: db.password,
    database: db.database,
    options: {
      encrypt: db.encrypt,
      trustServerCertificate: db.trustServerCertificate,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
    connectionTimeout: 15_000,
    requestTimeout: 15_000,
    ...overrides,
  };
}

/** @type {Promise<import('mssql').ConnectionPool> | null} */
let poolPromise = null;

/**
 * Lazily create (once) and return the shared connection pool.
 * If the initial connection fails, the cached promise is cleared so the
 * next request retries instead of failing forever.
 */
export function getPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(buildSqlConfig());

    pool.on('error', (err) => {
      console.error('[db] Connection pool error:', err.message);
    });

    poolPromise = pool.connect().catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

/** Close the shared pool (used on graceful shutdown). */
export async function closePool() {
  if (!poolPromise) return;
  const pending = poolPromise;
  poolPromise = null;
  try {
    const pool = await pending;
    await pool.close();
  } catch {
    // Pool never connected — nothing to close.
  }
}

export { sql };
