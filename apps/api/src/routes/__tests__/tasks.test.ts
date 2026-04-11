import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../lib/prisma', () => ({
  default: {
    task: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import tasksRouter from '../tasks';
import prisma from '../../lib/prisma';

const app = express();
app.use(express.json());
app.use('/', tasksRouter);

describe('Tasks Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /tasks', () => {
    it('creates a task successfully', async () => {
      const newTask = {
        title: 'New Task',
        category: 'casa',
        priority: 'MEDIUM',
      };
      (prisma.task.create as any).mockResolvedValue({ id: '1', ...newTask });

      const res = await request(app).post('/tasks').send(newTask);

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New Task');
    });

    it('returns 400 on validation error', async () => {
      const res = await request(app).post('/tasks').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation error');
    });
  });

  describe('GET /tasks', () => {
    it('lists tasks successfully', async () => {
      const mockTasks = [{ id: '1', title: 'Task 1' }];
      (prisma.task.findMany as any).mockResolvedValue(mockTasks);

      const res = await request(app).get('/tasks');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockTasks);
    });

    it('returns 400 on invalid query parameters', async () => {
      const res = await request(app).get('/tasks').query({ status: 'INVALID' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid query parameters');
    });
  });

  describe('PATCH /tasks/:id', () => {
    it('updates a task successfully', async () => {
      const mockTask = { id: '1', title: 'Old Title' };
      (prisma.task.findUnique as any).mockResolvedValue(mockTask);
      (prisma.task.update as any).mockResolvedValue({ ...mockTask, title: 'New Title' });

      const res = await request(app).patch('/tasks/1').send({ title: 'New Title' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('New Title');
    });

    it('returns 404 when task is not found', async () => {
      (prisma.task.findUnique as any).mockResolvedValue(null);

      const res = await request(app).patch('/tasks/nonexistent').send({ title: 'New Title' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Task not found');
    });

    it('returns 400 on validation error', async () => {
      const res = await request(app).patch('/tasks/1').send({ title: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation error');
    });
  });

  describe('POST /tasks/:id/done', () => {
    it('marks a task as done successfully', async () => {
      const mockTask = { id: '1', title: 'Test Task', status: 'PENDING' };
      (prisma.task.findUnique as any).mockResolvedValue(mockTask);
      (prisma.task.update as any).mockResolvedValue({ ...mockTask, status: 'DONE' });

      const res = await request(app).post('/tasks/1/done');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DONE');
      expect(prisma.task.findUnique).toHaveBeenCalledWith({ where: { id: '1' } });
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'DONE' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('returns 404 when task is not found', async () => {
      (prisma.task.findUnique as any).mockResolvedValue(null);

      const res = await request(app).post('/tasks/nonexistent/done');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Task not found');
    });

    it('returns 500 when an error occurs during update', async () => {
      const mockTask = { id: '1', title: 'Test Task' };
      (prisma.task.findUnique as any).mockResolvedValue(mockTask);
      (prisma.task.update as any).mockRejectedValue(new Error('Prisma error'));

      const res = await request(app).post('/tasks/1/done');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });

  describe('POST /tasks/:id/postpone', () => {
    it('postpones a task successfully', async () => {
      const mockTask = { id: '1', title: 'Test Task' };
      (prisma.task.findUnique as any).mockResolvedValue(mockTask);
      (prisma.task.update as any).mockResolvedValue({ ...mockTask, status: 'PENDING' });

      const res = await request(app).post('/tasks/1/postpone').send({ to: 'tomorrow' });

      expect(res.status).toBe(200);
      expect(prisma.task.update).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('returns 404 when task is not found', async () => {
      (prisma.task.findUnique as any).mockResolvedValue(null);

      const res = await request(app).post('/tasks/nonexistent/postpone').send({ to: 'tomorrow' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Task not found');
    });

    it('returns 400 on validation error', async () => {
      const res = await request(app).post('/tasks/1/postpone').send({ to: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation error');
    });
  });
});
