import { Router } from 'express';
import { ZodError } from 'zod';
import {
  startOfDay,
  endOfDay,
  startOfToday,
  addDays,
  nextMonday,
  format,
} from 'date-fns';
import { utcToZonedTime, formatInTimeZone } from 'date-fns-tz';
import { type Task } from '@prisma/client';
import prisma from '../lib/prisma';
import { PostPlanSchema, PostponeSchema } from '../schemas/today';
import { getOrCreateProfile, updateInferredPrefs, type InferredPrefs } from '../lib/userModel';

const router = Router();
const TIMEZONE = 'America/Sao_Paulo';

// Helper: get today in São Paulo timezone
function getTodayString(): string {
  const now = utcToZonedTime(new Date(), TIMEZONE);
  return format(now, 'yyyy-MM-dd');
}

function getTodayDate(): Date {
  const todayStr = getTodayString();
  return new Date(`${todayStr}T00:00:00`);
}

// GET /today
router.get('/today', async (_req, res) => {
  try {
    const todayStr = getTodayString();
    const today = getTodayDate();
    const tomorrow = addDays(today, 1);

    const allTasks = await prisma.task.findMany({
      where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
    });

    const overdue = allTasks.filter(
      (t: Task) => t.due_at && t.due_at < today && t.status !== 'DONE'
    );

    const urgent = allTasks.filter(
      (t: Task) =>
        !overdue.includes(t) &&
        (t.priority === 'URGENT' ||
          (t.due_at &&
            t.due_at >= today &&
            t.due_at < tomorrow &&
            t.status !== 'DONE'))
    );

    const suggestionsSet = new Set([...overdue, ...urgent].map((t: Task) => t.id));
    const suggestions = allTasks
      .filter((t: Task) => !suggestionsSet.has(t.id))
      .sort((a: Task, b: Task) => {
        const priorityOrder: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        const priorityDiff =
          (priorityOrder[a.priority] ?? 3) -
          (priorityOrder[b.priority] ?? 3);
        if (priorityDiff !== 0) return priorityDiff;
        if (a.due_at && b.due_at) return a.due_at.getTime() - b.due_at.getTime();
        return a.created_at.getTime() - b.created_at.getTime();
      })
      .slice(0, 7);

    // recommendations
    await updateInferredPrefs();
    const profile = await getOrCreateProfile();
    const confidence = profile.confidence as { sufficient?: boolean } | null;
    const inferredPrefs = profile.inferred_prefs as Partial<InferredPrefs> | null;
    const sufficient = confidence?.sufficient === true;

    const periodLabels: Record<string, string> = {
      morning: 'manhã',
      afternoon: 'tarde',
      evening: 'noite',
    };

    let recommendations: {
      active: boolean;
      message: string | null;
      preferred_period: string;
      top_categories: string[];
    };

    if (!sufficient || !inferredPrefs) {
      recommendations = {
        active: false,
        message: null,
        preferred_period: 'unknown',
        top_categories: [],
      };
    } else {
      const period = inferredPrefs.preferred_period ?? 'unknown';
      const periodLabel = periodLabels[period] ?? period;
      const cats = inferredPrefs.top_categories ?? [];
      const message =
        `Você tende a completar mais tarefas pela ${periodLabel}` +
        (cats.length > 0 ? `. Foco em: ${cats.slice(0, 2).join(', ')}` : '');
      recommendations = {
        active: true,
        message,
        preferred_period: period,
        top_categories: cats,
      };
    }

    res.json({
      date: todayStr,
      overdue,
      urgent,
      suggestions,
      recommendations,
    });
  } catch (err) {
    console.error('GET /today error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /today/plan
router.post('/today/plan', async (req, res) => {
  try {
    const input = PostPlanSchema.parse(req.body);
    const todayStr = getTodayString();

    const dailyPlan = await prisma.dailyPlan.upsert({
      where: { date: todayStr },
      update: { items: input.items },
      create: { date: todayStr, items: input.items },
    });

    res.json(dailyPlan);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: err.errors,
      });
    }
    console.error('POST /today/plan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
