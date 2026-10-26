import { getPool, sql } from '../db/pool.js';

const SELECT_COLUMNS = 'id, title, description, completed, created_at, updated_at';
const OUTPUT_COLUMNS =
  'INSERTED.id, INSERTED.title, INSERTED.description, INSERTED.completed, INSERTED.created_at, INSERTED.updated_at';

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {boolean} completed
 * @property {string} createdAt  ISO-8601 UTC timestamp
 * @property {string} updatedAt  ISO-8601 UTC timestamp
 */

/**
 * Map a snake_case database row to a camelCase Task object.
 * @returns {Task}
 */
function toTask(row) {
  return {
    id: String(row.id).toLowerCase(),
    title: row.title,
    description: row.description,
    completed: Boolean(row.completed),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Escape LIKE wildcards so user input is matched literally.
 * Used together with `ESCAPE '\'` in the query.
 * @param {string} value
 */
function escapeLike(value) {
  return value.replace(/[\\%_[]/g, '\\$&');
}

/**
 * List tasks, newest first, optionally filtered by title and status.
 * @param {{ search?: string, status?: 'all' | 'completed' | 'incomplete' }} [filters]
 * @returns {Promise<Task[]>}
 */
export async function findAll({ search = '', status = 'all' } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const conditions = [];

  if (search) {
    request.input('search', sql.NVarChar(1024), `%${escapeLike(search)}%`);
    conditions.push("title LIKE @search ESCAPE '\\'");
  }

  if (status === 'completed' || status === 'incomplete') {
    request.input('completed', sql.Bit, status === 'completed');
    conditions.push('completed = @completed');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await request.query(
    `SELECT ${SELECT_COLUMNS}
       FROM dbo.tasks
       ${where}
      ORDER BY created_at DESC, id;`,
  );

  return result.recordset.map(toTask);
}

/**
 * @param {string} id
 * @returns {Promise<Task | null>}
 */
export async function findById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .query(`SELECT ${SELECT_COLUMNS} FROM dbo.tasks WHERE id = @id;`);

  const row = result.recordset[0];
  return row ? toTask(row) : null;
}

/**
 * @param {{ title: string, description: string }} data
 * @returns {Promise<Task>}
 */
export async function create({ title, description }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('title', sql.NVarChar(255), title)
    .input('description', sql.NVarChar(sql.MAX), description)
    .query(
      `INSERT INTO dbo.tasks (title, description)
       OUTPUT ${OUTPUT_COLUMNS}
       VALUES (@title, @description);`,
    );

  return toTask(result.recordset[0]);
}

/**
 * Partially update a task. Only provided fields are changed;
 * `updated_at` is always refreshed.
 * @param {string} id
 * @param {{ title?: string, description?: string, completed?: boolean }} changes
 * @returns {Promise<Task | null>} the updated task, or null if not found
 */
export async function update(id, changes) {
  const pool = await getPool();
  const request = pool.request().input('id', sql.UniqueIdentifier, id);
  const assignments = [];

  if (changes.title !== undefined) {
    request.input('title', sql.NVarChar(255), changes.title);
    assignments.push('title = @title');
  }
  if (changes.description !== undefined) {
    request.input('description', sql.NVarChar(sql.MAX), changes.description);
    assignments.push('description = @description');
  }
  if (changes.completed !== undefined) {
    request.input('completed', sql.Bit, changes.completed);
    assignments.push('completed = @completed');
  }

  assignments.push('updated_at = SYSUTCDATETIME()');

  const result = await request.query(
    `UPDATE dbo.tasks
        SET ${assignments.join(', ')}
     OUTPUT ${OUTPUT_COLUMNS}
      WHERE id = @id;`,
  );

  const row = result.recordset[0];
  return row ? toTask(row) : null;
}

/**
 * @param {string} id
 * @returns {Promise<boolean>} true if a row was deleted
 */
export async function remove(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .query('DELETE FROM dbo.tasks WHERE id = @id;');

  return result.rowsAffected[0] > 0;
}

/** Lightweight connectivity check used by the health endpoint. */
export async function ping() {
  const pool = await getPool();
  await pool.request().query('SELECT 1 AS ok;');
}
