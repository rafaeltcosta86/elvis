import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reminderJob } from '../reminderJob';
import prisma from '../../../../api/src/lib/prisma';
import { sendWhatsApp } from '../../../../api/src/lib/nanoclawClient';
import Redis from 'ioredis';

vi.mock('../../../../api/src/lib/prisma', () => ({
  default: {
    reminder: {
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../../../api/src/lib/nanoclawClient', () => ({
  sendWhatsApp: vi.fn(),
}));

vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
    })),
  };
});

describe('reminderJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OWNER_PHONE = '551199999999';
  });

  it('deve disparar lembretes devidos e salvar snooze no redis', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 1000);

    (prisma.reminder.findMany as any).mockResolvedValue([
      {
        id: 'r1',
        task_id: 't1',
        remind_at: past,
        task: { title: 'Tarefa Teste' },
      },
    ]);

    await reminderJob();

    expect(prisma.reminder.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'FIRED' },
    });

    expect(sendWhatsApp).toHaveBeenCalledWith(
      '551199999999',
      expect.stringContaining('Tarefa Teste')
    );

    expect(sendWhatsApp).toHaveBeenCalledWith(
      '551199999999',
      expect.stringContaining('Como quer adiar?')
    );
  });

  it('não deve disparar se não houver lembretes devidos', async () => {
    (prisma.reminder.findMany as any).mockResolvedValue([]);

    await reminderJob();

    expect(prisma.reminder.update).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });
});
