import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWhatsAppService } from '../whatsappService';
import type { RateLimitStore } from '../whatsappService';

// Controllable in-memory store for tests
function makeStore(counts: Record<string, number> = {}): RateLimitStore {
  const data: Record<string, number> = { ...counts };
  return {
    async increment(key: string): Promise<number> {
      data[key] = (data[key] ?? 0) + 1;
      return data[key];
    },
  };
}

const consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset env vars to safe defaults
  delete process.env.WHATSAPP_ENABLED;
  delete process.env.WHATSAPP_PROVIDER;
  delete process.env.WHATSAPP_ALLOWLIST;
  delete process.env.WHATSAPP_RATE_LIMIT_HOUR;
  delete process.env.WHATSAPP_RATE_LIMIT_DAY;
  process.env.OWNER_PHONE = '5511999990000';
});

describe('kill switch', () => {
  it('mocks send when WHATSAPP_ENABLED is not set', async () => {
    const svc = createWhatsAppService(makeStore());
    await svc.send('5511999990000', 'hello');
    expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[MOCK WhatsApp]'));
  });

  it('mocks send when WHATSAPP_ENABLED=false', async () => {
    process.env.WHATSAPP_ENABLED = 'false';
    const svc = createWhatsAppService(makeStore());
    await svc.send('5511999990000', 'hello');
    expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[MOCK WhatsApp]'));
  });

  it('uses adapter when WHATSAPP_ENABLED=true and provider=mock', async () => {
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_PROVIDER = 'mock';
    const svc = createWhatsAppService(makeStore());
    await svc.send('5511999990000', 'hello');
    expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[MOCK WhatsApp]'));
  });
});

describe('allowlist', () => {
  beforeEach(() => {
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_PROVIDER = 'mock';
  });

  it('allows OWNER_PHONE when allowlist is empty', async () => {
    const svc = createWhatsAppService(makeStore());
    await svc.send('5511999990000', 'hi');
    expect(consoleSpy.warn).not.toHaveBeenCalledWith(expect.stringContaining('blocked'));
  });

  it('blocks numbers not in allowlist', async () => {
    const svc = createWhatsAppService(makeStore());
    await svc.send('5511888880000', 'hi');
    expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('blocked'));
  });

  it('allows extra numbers in WHATSAPP_ALLOWLIST', async () => {
    process.env.WHATSAPP_ALLOWLIST = '5511888880000';
    const svc = createWhatsAppService(makeStore());
    await svc.send('5511888880000', 'hi');
    expect(consoleSpy.warn).not.toHaveBeenCalledWith(expect.stringContaining('blocked'));
  });

  it('allows all when WHATSAPP_ALLOWLIST=*', async () => {
    process.env.WHATSAPP_ALLOWLIST = '*';
    const svc = createWhatsAppService(makeStore());
    await svc.send('5519999999999', 'hi');
    expect(consoleSpy.warn).not.toHaveBeenCalledWith(expect.stringContaining('blocked'));
  });
});

describe('rate limit', () => {
  beforeEach(() => {
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_PROVIDER = 'mock';
    process.env.WHATSAPP_RATE_LIMIT_HOUR = '3';
    process.env.WHATSAPP_RATE_LIMIT_DAY = '10';
  });

  it('allows sends within hour limit', async () => {
    const store = makeStore();
    const svc = createWhatsAppService(store);
    await svc.send('5511999990000', 'msg1');
    await svc.send('5511999990000', 'msg2');
    await svc.send('5511999990000', 'msg3');
    expect(consoleSpy.warn).not.toHaveBeenCalledWith(expect.stringContaining('rate limit'));
  });

  it('blocks send when hour limit exceeded', async () => {
    // Pre-fill store so next send is the 4th (> limit of 3)
    const hourKey = `wapp:rl:h:${new Date().toISOString().slice(0, 13)}`;
    const store = makeStore({ [hourKey]: 3 });
    const svc = createWhatsAppService(store);
    await svc.send('5511999990000', 'over limit');
    expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('rate limit (hour)'));
  });

  it('blocks send when day limit exceeded', async () => {
    const dayKey = `wapp:rl:d:${new Date().toISOString().slice(0, 10)}`;
    const store = makeStore({ [dayKey]: 10 });
    const svc = createWhatsAppService(store);
    await svc.send('5511999990000', 'over daily limit');
    expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('rate limit (day)'));
  });
});

describe('error handling', () => {
  it('never throws even when adapter throws', async () => {
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_PROVIDER = 'mock';
    const store: RateLimitStore = {
      async increment() { throw new Error('redis down'); },
    };
    const svc = createWhatsAppService(store);
    await expect(svc.send('5511999990000', 'test')).resolves.toBeUndefined();
  });
});
