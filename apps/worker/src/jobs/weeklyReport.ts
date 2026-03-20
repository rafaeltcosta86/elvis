import prisma from '../lib/prisma';
import { sendMessage } from '../lib/messenger';
import { subDays } from 'date-fns';

const TIMEZONE = 'America/Sao_Paulo';

export interface WeeklyStats {
  done: number;
  postponed: number;
  created: number;
}

export async function computeWeeklyStats(): Promise<WeeklyStats> {
  const since = subDays(new Date(), 7);

  const events = await prisma.auditLog.findMany({
    where: {
      action: { in: ['task.done', 'task.postponed', 'task.created'] },
      ts: { gte: since },
    },
  });

  return {
    done: events.filter((e) => e.action === 'task.done').length,
    postponed: events.filter((e) => e.action === 'task.postponed').length,
    created: events.filter((e) => e.action === 'task.created').length,
  };
}

export function formatWeeklyReport(
  stats: WeeklyStats,
  profile: {
    proactivity_level: number;
    inferred_prefs: object | null;
  }
): string {
  const inferred = (profile.inferred_prefs ?? {}) as Record<string, unknown>;
  const period = inferred.preferred_period as string | undefined;
  const categories = (inferred.top_categories ?? []) as string[];

  const periodLabels: Record<string, string> = {
    morning: 'manhã',
    afternoon: 'tarde',
    evening: 'noite',
  };

  let learnedLines = '';
  if (period && period !== 'unknown') {
    learnedLines += `• Você completa mais tarefas pela ${periodLabels[period] ?? period}\n`;
  }
  if (categories.length > 0) {
    learnedLines += `• Categorias favoritas: ${categories.slice(0, 3).join(', ')}\n`;
  }

  return (
    `📊 Relatório semanal:\n` +
    `✅ ${stats.done} tarefas concluídas\n` +
    `⏭️ ${stats.postponed} adiadas\n` +
    `📝 ${stats.created} criadas\n` +
    (learnedLines ? `\nAprendi:\n${learnedLines}` : '') +
    `\nMudanças: proatividade mantida em nível ${profile.proactivity_level}/5\n` +
    `\nComandos: /mais-proativo · /menos-proativo · /corrigir`
  );
}

export async function weeklyReportJob(): Promise<void> {
  const ownerPhone = process.env.OWNER_PHONE || '551199999999';

  const [stats, profile] = await Promise.all([
    computeWeeklyStats(),
    prisma.userProfile.findFirst(),
  ]);

  const effectiveProfile = profile
    ? { proactivity_level: profile.proactivity_level, inferred_prefs: profile.inferred_prefs as object | null }
    : { proactivity_level: 3, inferred_prefs: {} };

  const text = formatWeeklyReport(stats, effectiveProfile);

  await sendMessage(ownerPhone, text);

  console.log('[weeklyReportJob] relatório semanal enviado');
}
