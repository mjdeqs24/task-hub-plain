import { z } from 'zod';

/** Canonical GUID format, e.g. 3f2504e0-4f89-11d3-9a0c-0305e82c3301 */
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TITLE_MAX_LENGTH = 255;
export const DESCRIPTION_MAX_LENGTH = 10_000;
export const TASK_STATUSES = /** @type {const} */ (['all', 'completed', 'incomplete']);

/**
 * Build a required, trimmed, non-empty string schema with friendly messages.
 * @param {string} label
 * @param {number} max
 */
function requiredText(label, max) {
  return z
    .string({
      error: (issue) =>
        issue.input === undefined ? `${label} is required` : `${label} must be a string`,
    })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);
}

const titleSchema = requiredText('Title', TITLE_MAX_LENGTH);
const descriptionSchema = requiredText('Description', DESCRIPTION_MAX_LENGTH);
const completedSchema = z.boolean({ error: 'Completed must be a boolean' });

/** `:id` route parameter. */
export const taskIdParamsSchema = z.object({
  id: z
    .string()
    .regex(GUID_PATTERN, 'Task id must be a valid UUID')
    .transform((id) => id.toLowerCase()),
});

/** POST /api/tasks body. */
export const createTaskSchema = z.strictObject({
  title: titleSchema,
  description: descriptionSchema,
});

/** PATCH /api/tasks/:id body — at least one field required. */
export const updateTaskSchema = z
  .strictObject({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    completed: completedSchema.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one of: title, description, completed',
  });

/** GET /api/tasks query string. */
export const listTasksQuerySchema = z.object({
  search: z
    .string({ error: 'Search must be a single string' })
    .trim()
    .max(TITLE_MAX_LENGTH, `Search must be at most ${TITLE_MAX_LENGTH} characters`)
    .default(''),
  status: z
    .enum(TASK_STATUSES, { error: `Status must be one of: ${TASK_STATUSES.join(', ')}` })
    .default('all'),
});
