import { Router } from 'express';
import { ZodError } from 'zod';
import { addDays, nextMonday, format } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import prisma from '../lib/prisma';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  ListTasksQuerySchema,
} from '../schemas/task';
import { PostponeSchema } from '../schemas/today';

const router = Router();

// POST /tasks
router.post('/tasks', async (req, res) => {
  try {
    const input = CreateTaskSchema.parse(req.body);
    const task = await prisma.task.create({
      data: {
        title: input.title,
        description: input.description,
        category: input.category,
        priority: input.priority,
        due_at: input.due_at,
        source_channel: input.source_channel,
      },
    });
    res.status(201).json(task);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: err.errors,
      });
    }
    console.error('POST /tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /tasks
router.get('/tasks', async (req, res) => {
  try {
    const query = ListTasksQuerySchema.parse(req.query);
    const tasks = await prisma.task.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.category && { category: query.category }),
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(tasks);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: err.errors,
      });
    }
    console.error('GET /tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /tasks/:id
router.patch('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const input = UpdateTaskSchema.parse(req.body);

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updated = await prisma.task.update({
      where: { id },
      data: input,
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: err.errors,
      });
    }
    console.error('PATCH /tasks/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /tasks/:id/done
router.post('/tasks/:id/done', async (req, res) => {
  try {
    const { id } = req.params;

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updated = await prisma.task.update({
      where: { id },
      data: { status: 'DONE' },
    });

    await prisma.auditLog.create({
      data: {
        actor: 'user',
        action: 'task.done',
        entity_type: 'Task',
        entity_id: id,
        summary: `Task marked as done: ${task.title}`,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error('POST /tasks/:id/done error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /tasks/:id/postpone
router.post('/tasks/:id/postpone', async (req, res) => {
  try {
    const { id } = req.params;
    const input = PostponeSchema.parse(req.body);

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const TIMEZONE = 'America/Sao_Paulo';
    const now = utcToZonedTime(new Date(), TIMEZONE);
    let newDueAt: Date;

    if (input.to === 'tomorrow') {
      newDueAt = addDays(now, 1);
    } else if (input.to === 'next_week') {
      newDueAt = nextMonday(now);
    } else {
      newDueAt = new Date(input.to);
    }

    const updated = await prisma.task.update({
      where: { id },
      data: { due_at: newDueAt, status: 'PENDING' },
    });

    await prisma.auditLog.create({
      data: {
        actor: 'user',
        action: 'task.postponed',
        entity_type: 'Task',
        entity_id: id,
        summary: `Task postponed to ${format(newDueAt, 'yyyy-MM-dd')}`,
      },
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: err.errors,
      });
    }
    console.error('POST /tasks/:id/postpone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
