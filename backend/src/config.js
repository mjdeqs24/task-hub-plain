import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load backend/.env regardless of the current working directory.
dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
});

/**
 * Parse a boolean-ish environment variable ("true", "1", "yes", "on").
 * @param {string | undefined} value
 * @param {boolean} fallback
 */
function toBool(value, fallback) {
  if (value === undefined || value.trim() === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Parse an integer environment variable.
 * @param {string | undefined} value
 * @param {number | undefined} fallback
 */
function toInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Parse CORS_ORIGIN: "*" allows any origin, otherwise a comma-separated list.
 * @param {string | undefined} value
 */
function toCorsOrigin(value) {
  if (!value || value.trim() === '*') return '*';
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const config = Object.freeze({
  port: toInt(process.env.PORT, 5000),
  corsOrigin: toCorsOrigin(process.env.CORS_ORIGIN),
  db: Object.freeze({
    server: process.env.DB_SERVER || 'localhost',
    // Leave DB_PORT empty to connect to a named instance via SQL Server Browser.
    port: toInt(process.env.DB_PORT, undefined),
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'taskhub',
    encrypt: toBool(process.env.DB_ENCRYPT, false),
    trustServerCertificate: toBool(process.env.DB_TRUST_SERVER_CERT, true),
  }),
});
