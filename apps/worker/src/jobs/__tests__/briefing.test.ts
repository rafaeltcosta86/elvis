import { describe, it, expect, beforeEach, vi } from 'vitest';
import { briefingJob } from '../briefing';
import prisma from '../../lib/prisma';
import { sendMessage } from '../../lib/messenger';
import { getToken } from '../../lib/oauthService';
import { getCalendarEventsForToday } from '@shared';

vi.mock('../../lib/prisma', () => ({
  default: {
    userProfile: {
      findFirst: vi.fn(),
    },
    auditLog: {
      count: vi.fn(),
      create: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../lib/messenger', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('../../lib/quietHours', () => ({
  isQuietHours: vi.fn(() => false),
}));

vi.mock('../../lib/oauthService', () => ({
  getToken: vi.fn(),
}));

vi.mock('@shared', () => ({
  getCalendarEventsForToday: vi.fn(),
}));

describe('briefingJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // 2024-01-01 07:30 BRT
    vi.setSystemTime(new Date('2024-01-01T10:30:00Z'));

    process.env.OWNER_PHONE = '551199999999';
    process.env.OAUTH_ENC_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

    (prisma.userProfile.findFirst as any).mockResolvedValue({
      daily_nudge_limit: 5,
    });
    (prisma.auditLog.count as any).mockResolvedValue(0);
    (prisma.task.findMany as any).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC1: sends briefing with events when token and events exist', async () => {
    (getToken as any).mockResolvedValue('valid-token');

    (getCalendarEventsForToday as any).mockResolvedValue([
      {
        title: 'Reunião com cliente',
        start: '2024-01-01T12:00:00Z', // 09:00 BRT
        end: '2024-01-01T13:00:00Z',
        durationText: '1h',
      },
      {
        title: 'Almoço com João',
        start: '2024-01-01T17:00:00Z', // 14:00 BRT
        end: '2024-01-01T18:00:00Z',
        durationText: '1h',
      },
    ]);

    const today = new Date('2024-01-01T10:30:00Z');
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    (prisma.task.findMany as any).mockResolvedValue([
      { id: '1', title: 'Revisar proposta', priority: 'URGENT', status: 'PENDING', due_at: null },
      { id: '2', title: 'Confirmar reunião', priority: 'HIGH', status: 'PENDING', due_at: today },
      { id: '3', title: 'Longe', priority: 'LOW', status: 'PENDING', due_at: tomorrow },
    ]);

    await briefingJob();

    expect(sendMessage).toHaveBeenCalledWith(
      '551199999999',
      expect.stringContaining('📅 Compromissos de hoje:')
    );
    expect(sendMessage).toHaveBeenCalledWith(
      '551199999999',
      expect.stringContaining('• 09:00 — Reunião com cliente (1h)')
    );
    expect(sendMessage).toHaveBeenCalledWith(
      '551199999999',
      expect.stringContaining('• 14:00 — Almoço com João (1h)')
    );
    expect(sendMessage).toHaveBeenCalledWith(
      '551199999999',
      expect.stringContaining('✅ Tarefas: 0 atrasadas · 2 urgentes')
    );
    expect(sendMessage).toHaveBeenCalledWith(
      '551199999999',
      expect.stringContaining('Top 3: Revisar proposta · Confirmar reunião')
    );
  });

  it('AC2: omits calendar section when no events exist', async () => {
    (getToken as any).mockResolvedValue('valid-token');
    (getCalendarEventsForToday as any).mockResolvedValue([]);

    await briefingJob();

    const text = (sendMessage as any).mock.calls[0][1];
    expect(text).not.toContain('📅 Compromissos de hoje:');
    expect(text).toContain('✅ Tarefas:');
  });

  it('AC3: sends briefing with warning when token is missing', async () => {
    (getToken as any).mockResolvedValue(null);

    await briefingJob();

    const text = (sendMessage as any).mock.calls[0][1];
    expect(text).toContain('📅 Calendário não configurado. Execute o OAuth bootstrap no servidor para habilitar.');
    expect(text).toContain('✅ Tarefas:');
  });

  it('AC3 Fallback: sends briefing with warning when graphClient throws error', async () => {
    (getToken as any).mockResolvedValue('valid-token');
    (getCalendarEventsForToday as any).mockRejectedValue(new Error('OAuth error'));

    await briefingJob();

    const text = (sendMessage as any).mock.calls[0][1];
    expect(text).toContain('📅 Calendário não configurado. Execute o OAuth bootstrap no servidor para habilitar.');
    expect(text).toContain('✅ Tarefas:');
  });
});
