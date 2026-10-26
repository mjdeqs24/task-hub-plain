import { createApp } from './app.js';
import { config } from './config.js';
import { closePool, getPool } from './db/pool.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[server] TaskHub API listening on http://localhost:${config.port}/api`);
});

// Warm up the connection pool so configuration problems surface immediately.
// The server keeps running either way; requests will retry the connection.
getPool()
  .then(() => {
    const { server: host, database } = config.db;
    console.log(`[db] Connected to SQL Server ${host} (database: ${database})`);
  })
  .catch((err) => {
    console.error(`[db] Initial connection failed: ${err.message}`);
    console.error('[db] Check backend/.env and that SQL Server is running. Requests will retry.');
  });

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, shutting down…`);

  server.close(async () => {
    await closePool();
    process.exit(0);
  });

  // Force exit if connections don't close in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
