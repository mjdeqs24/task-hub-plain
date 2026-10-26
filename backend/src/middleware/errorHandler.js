import { ZodError } from 'zod';
import { sql } from '../db/pool.js';
import { HttpError } from '../utils/HttpError.js';

/** Network/login-level failures that mean "the database is unreachable". */
const DB_UNAVAILABLE_CODES = new Set([
  'ESOCKET',
  'ELOGIN',
  'ETIMEOUT',
  'ECONNCLOSED',
  'ENOTOPEN',
  'EINSTLOOKUP',
]);

function isDatabaseUnavailable(err) {
  return err instanceof sql.ConnectionError || DB_UNAVAILABLE_CODES.has(err?.code);
}

/** 404 for any route that didn't match. */
export function notFoundHandler(req, _res, next) {
  next(HttpError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

/**
 * Central error handler. Always responds with:
 *   { error: { message: string, details?: Array<{ field, message }> } }
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Internal server error';
  let details;

  if (err instanceof ZodError) {
    status = 400;
    message = 'Validation failed';
    details = err.issues.map((issue) => ({
      field: issue.path.join('.') || null,
      message: issue.message,
    }));
  } else if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
    details = err.details;
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    message = 'Request body must be valid JSON';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large';
  } else if (isDatabaseUnavailable(err)) {
    status = 503;
    message = 'Database is unavailable. Please try again later.';
  }

  if (status === 503) {
    console.warn(`[db] ${req.method} ${req.originalUrl}: ${err.message}`);
  } else if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  }

  if (res.headersSent) return;

  res.status(status).json({ error: { message, ...(details ? { details } : {}) } });
}
