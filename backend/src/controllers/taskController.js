import * as taskRepository from '../repositories/taskRepository.js';
import { HttpError } from '../utils/HttpError.js';
import {
  createTaskSchema,
  listTasksQuerySchema,
  taskIdParamsSchema,
  updateTaskSchema,
} from '../validators/taskValidators.js';

// Express 5 forwards rejected promises from async handlers to the error
// middleware automatically, so no try/catch wrappers are needed here.
// Zod `parse` throws a ZodError which the error handler turns into a 400.

const taskNotFound = (id) => HttpError.notFound(`Task ${id} not found`);

/** GET /api/tasks?search=&status=all|completed|incomplete */
export async function listTasks(req, res) {
  const filters = listTasksQuerySchema.parse(req.query);
  const tasks = await taskRepository.findAll(filters);
  res.json({ data: tasks, meta: { count: tasks.length, ...filters } });
}

/** GET /api/tasks/:id */
export async function getTask(req, res) {
  const { id } = taskIdParamsSchema.parse(req.params);
  const task = await taskRepository.findById(id);
  if (!task) throw taskNotFound(id);
  res.json({ data: task });
}

/** POST /api/tasks */
export async function createTask(req, res) {
  const input = createTaskSchema.parse(req.body ?? {});
  const task = await taskRepository.create(input);
  res.status(201).location(`${req.baseUrl}/${task.id}`).json({ data: task });
}

/** PATCH /api/tasks/:id */
export async function updateTask(req, res) {
  const { id } = taskIdParamsSchema.parse(req.params);
  const changes = updateTaskSchema.parse(req.body ?? {});
  const task = await taskRepository.update(id, changes);
  if (!task) throw taskNotFound(id);
  res.json({ data: task });
}

/** DELETE /api/tasks/:id */
export async function deleteTask(req, res) {
  const { id } = taskIdParamsSchema.parse(req.params);
  const deleted = await taskRepository.remove(id);
  if (!deleted) throw taskNotFound(id);
  res.status(204).end();
}
