import { Router } from 'express';
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from '../controllers/taskController.js';

const router = Router();

router.route('/').get(listTasks).post(createTask);

router.route('/:id').get(getTask).patch(updateTask).delete(deleteTask);

export default router;
