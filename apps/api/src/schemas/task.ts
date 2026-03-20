import { z } from 'zod';

const TaskCategoryEnum = z.enum([
  'casa',
  'trabalho',
  'pessoas',
  'investimentos',
  'saude',
  'outros',
]);

const TaskPriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const TaskStatusEnum = z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED']);

export const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: TaskCategoryEnum,
  priority: TaskPriorityEnum.optional().default('MEDIUM'),
  due_at: z
    .string()
    .datetime()
    .transform((val) => new Date(val))
    .optional(),
  source_channel: z.string().optional(),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  category: TaskCategoryEnum.optional(),
  priority: TaskPriorityEnum.optional(),
  status: TaskStatusEnum.optional(),
  due_at: z
    .string()
    .datetime()
    .transform((val) => new Date(val))
    .optional(),
  source_channel: z.string().optional(),
});

export const ListTasksQuerySchema = z.object({
  status: TaskStatusEnum.optional(),
  category: TaskCategoryEnum.optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;
