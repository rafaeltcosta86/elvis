import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockAdapter } from '../mockAdapter';

describe('MockAdapter', () => {
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    consoleSpy.mockClear();
  });

  it('should log the message to the console', async () => {
    const adapter = new MockAdapter();
    const to = '5511999990000';
    const text = 'Hello from MockAdapter';

    await adapter.send(to, text);

    expect(consoleSpy).toHaveBeenCalledWith(`[MOCK WhatsApp] → ${to}: ${text}`);
  });
});
