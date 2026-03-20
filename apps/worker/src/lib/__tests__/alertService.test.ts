import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../messenger', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('../quietHours', () => ({
  isQuietHours: vi.fn(() => false),
}));

vi.mock('../scheduler', () => ({
  schedulerQueue: {
    getJobCounts: vi.fn(),
  },
}));

import { sendAlert, onJobFailed, checkQueueHealth } from '../alertService';
import { sendMessage } from '../messenger';
import { isQuietHours } from '../quietHours';
import { schedulerQueue } from '../scheduler';

describe('alertService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OWNER_PHONE = '5511999990000';
    vi.mocked(isQuietHours).mockReturnValue(false);
  });

  describe('sendAlert', () => {
    it('sends WhatsApp alert to owner', async () => {
      await sendAlert('something broke');
      expect(sendMessage).toHaveBeenCalledWith(
        '5511999990000',
        expect.stringContaining('something broke')
      );
    });

    it('suppresses alert during quiet hours', async () => {
      vi.mocked(isQuietHours).mockReturnValue(true);
      await sendAlert('night issue');
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('onJobFailed', () => {
    it('sends alert with job name and error message', async () => {
      await onJobFailed('briefing', new Error('timeout'));
      expect(sendMessage).toHaveBeenCalledWith(
        '5511999990000',
        expect.stringContaining('"briefing"')
      );
      expect(sendMessage).toHaveBeenCalledWith(
        '5511999990000',
        expect.stringContaining('timeout')
      );
    });

    it('handles undefined job name gracefully', async () => {
      await onJobFailed(undefined, new Error('crash'));
      expect(sendMessage).toHaveBeenCalledWith(
        '5511999990000',
        expect.stringContaining('"unknown"')
      );
    });
  });

  describe('checkQueueHealth', () => {
    it('does not alert when queue is healthy', async () => {
      vi.mocked(schedulerQueue.getJobCounts).mockResolvedValue({ waiting: 0, active: 1, failed: 0 } as any);
      await checkQueueHealth();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('alerts when stuck jobs exceed threshold', async () => {
      vi.mocked(schedulerQueue.getJobCounts).mockResolvedValue({ waiting: 15, active: 10, failed: 0 } as any);
      process.env.QUEUE_STUCK_THRESHOLD = '20';
      await checkQueueHealth();
      expect(sendMessage).toHaveBeenCalledWith(
        '5511999990000',
        expect.stringContaining('Fila travada')
      );
    });

    it('alerts when there are failed jobs', async () => {
      vi.mocked(schedulerQueue.getJobCounts).mockResolvedValue({ waiting: 0, active: 0, failed: 3 } as any);
      await checkQueueHealth();
      expect(sendMessage).toHaveBeenCalledWith(
        '5511999990000',
        expect.stringContaining('3 job(s)')
      );
    });
  });
});
