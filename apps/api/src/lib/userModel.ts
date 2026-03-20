import prisma from './prisma';
import { type UserProfile } from '@prisma/client';
import { subDays } from 'date-fns';

export interface AuditEvent {
  id: string;
  ts: Date;
  action: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  category?: string; // enriched by updateInferredPrefs via Task join
}

export interface InferredPrefs {
  preferred_hours: number[];
  preferred_period: 'morning' | 'afternoon' | 'evening' | 'unknown';
  top_categories: string[];
  completion_rate: number;
  avg_postponements: number;
}

export interface ConfidenceData {
  data_points: number;
  last_updated: string; // ISO
  sufficient: boolean;  // data_points >= 5
}

// --- Pure functions ---

export function inferPreferences(auditEvents: AuditEvent[]): InferredPrefs {
  const doneEvents = auditEvents.filter((e) => e.action === 'task.done');
  const postponedEvents = auditEvents.filter((e) => e.action === 'task.postponed');

  // preferred_hours: top-3 hours from task.done events
  const hourCounts: Record<number, number> = {};
  for (const e of doneEvents) {
    const h = e.ts.getHours();
    hourCounts[h] = (hourCounts[h] ?? 0) + 1;
  }
  const preferred_hours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => Number(h));

  // preferred_period: majority period of done events
  let morning = 0, afternoon = 0, evening = 0;
  for (const e of doneEvents) {
    const h = e.ts.getHours();
    if (h >= 6 && h <= 11) morning++;
    else if (h >= 12 && h <= 17) afternoon++;
    else if (h >= 18 && h <= 22) evening++;
  }
  let preferred_period: InferredPrefs['preferred_period'] = 'unknown';
  if (morning > 0 || afternoon > 0 || evening > 0) {
    const max = Math.max(morning, afternoon, evening);
    if (max === morning) preferred_period = 'morning';
    else if (max === afternoon) preferred_period = 'afternoon';
    else preferred_period = 'evening';
  }

  // top_categories: top-3 categories from task.done events (enriched)
  const catCounts: Record<string, number> = {};
  for (const e of doneEvents) {
    if (e.category) {
      catCounts[e.category] = (catCounts[e.category] ?? 0) + 1;
    }
  }
  const top_categories = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  // completion_rate
  const total = doneEvents.length + postponedEvents.length;
  const completion_rate = total > 0 ? doneEvents.length / total : 0;

  // avg_postponements: total postponements / number of done tasks
  const avg_postponements =
    doneEvents.length > 0 ? postponedEvents.length / doneEvents.length : 0;

  return { preferred_hours, preferred_period, top_categories, completion_rate, avg_postponements };
}

export function computeConfidence(auditEvents: AuditEvent[]): ConfidenceData {
  const relevant = auditEvents.filter(
    (e) => e.action === 'task.done' || e.action === 'task.postponed'
  );
  const data_points = relevant.length;
  return {
    data_points,
    last_updated: new Date().toISOString(),
    sufficient: data_points >= 5,
  };
}

// --- DB functions ---

export async function getOrCreateProfile(): Promise<UserProfile> {
  const existing = await prisma.userProfile.findFirst();
  if (existing) return existing;
  return prisma.userProfile.create({ data: {} });
}

export async function updateInferredPrefs(): Promise<void> {
  const profile = await getOrCreateProfile();
  const since = subDays(new Date(), 30);

  // Fetch relevant audit events from last 30 days
  const rawEvents = await prisma.auditLog.findMany({
    where: {
      action: { in: ['task.done', 'task.postponed'] },
      ts: { gte: since },
    },
  });

  // Collect task IDs to enrich with category
  const taskIds = [
    ...new Set(rawEvents.map((e) => e.entity_id).filter((id): id is string => !!id)),
  ];

  const tasks = taskIds.length > 0
    ? await prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, category: true },
      })
    : [];

  const categoryById: Record<string, string> = {};
  for (const t of tasks) {
    categoryById[t.id] = t.category;
  }

  // Enrich events with category
  const events: AuditEvent[] = rawEvents.map((e) => ({
    id: e.id,
    ts: e.ts,
    action: e.action,
    entity_id: e.entity_id,
    metadata: (e.metadata ?? {}) as Record<string, unknown>,
    category: e.entity_id ? categoryById[e.entity_id] : undefined,
  }));

  const inferred_prefs = inferPreferences(events);
  const confidence = computeConfidence(events);

  await prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      inferred_prefs: inferred_prefs as any,
      confidence: confidence as any,
    },
  });
}
