/**
 * Applies `schema.sql` to the configured SQL Server instance.
 *
 *   npm run db:init
 *
 * The script connects to the `master` database (the target database may not
 * exist yet), splits the file on `GO` batch separators and runs each batch
 * sequentially on a single connection so `USE taskhub;` carries over.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { config } from '../config.js';
import { buildSqlConfig } from './pool.js';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

async function main() {
  if (config.db.database.toLowerCase() !== 'taskhub') {
    console.warn(
      `[db:init] Warning: DB_NAME is "${config.db.database}" but schema.sql creates "taskhub".`,
    );
  }

  const script = await readFile(schemaPath, 'utf8');
  const batches = script
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
  const pool = new sql.ConnectionPool(
    buildSqlConfig({ database: 'master', pool: { max: 1, min: 1 } }),
  );

  console.log(`[db:init] Connecting to ${config.db.server}…`);
  await pool.connect();

  try {
    for (const [index, batch] of batches.entries()) {
      await pool.request().batch(batch);
      console.log(`[db:init] Batch ${index + 1}/${batches.length} OK`);
    }
    console.log('[db:init] Schema applied successfully.');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('[db:init] Failed:', err.message);
  process.exitCode = 1;
});
