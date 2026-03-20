import { z } from 'zod';

export const PostPlanSchema = z.object({
  items: z.array(
    z.object({
      task_id: z.string().uuid(),
      order: z.number().int().positive(),
    })
  ),
});

export const PostponeSchema = z.object({
  to: z.enum(['tomorrow', 'next_week']).or(z.string().datetime()),
});

export type PostPlanInput = z.infer<typeof PostPlanSchema>;
export type PostponeInput = z.infer<typeof PostponeSchema>;
