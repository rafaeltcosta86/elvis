import type { WhatsAppAdapter } from './types';
import { MockAdapter } from './adapters/mockAdapter';
import { NanoclawAdapter } from './adapters/nanoclawAdapter';
import { BaileysAdapter } from './adapters/baileysAdapter';

export interface RateLimitStore {
  increment(key: string, ttlSeconds: number): Promise<number>;
}

// In-memory fallback (per-process, resets on restart)
class InMemoryRateLimitStore implements RateLimitStore {
  private counts: Map<string, { value: number; expiresAt: number }> = new Map();

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const entry = this.counts.get(key);
    if (!entry || entry.expiresAt < now) {
      this.counts.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }
}

export interface WhatsAppService {
  send(to: string, text: string): Promise<void>;
}

export function createWhatsAppService(store?: RateLimitStore): WhatsAppService {
  const enabled = process.env.WHATSAPP_ENABLED === 'true';
  const provider = process.env.WHATSAPP_PROVIDER ?? 'mock';
  const ownerPhone = process.env.OWNER_PHONE ?? '';
  const allowlistRaw = process.env.WHATSAPP_ALLOWLIST ?? '';
  const limitHour = parseInt(process.env.WHATSAPP_RATE_LIMIT_HOUR ?? '10', 10);
  const limitDay = parseInt(process.env.WHATSAPP_RATE_LIMIT_DAY ?? '30', 10);

  // Allowlist: empty → only OWNER_PHONE; '*' → all
  const allowAll = allowlistRaw === '*';
  const allowlist: Set<string> = allowAll
    ? new Set()
    : new Set([ownerPhone, ...allowlistRaw.split(',').map((p) => p.trim()).filter(Boolean)]);

  const rateLimitStore: RateLimitStore = store ?? new InMemoryRateLimitStore();

  function selectAdapter(): WhatsAppAdapter {
    if (!enabled) return new MockAdapter();
    if (provider === 'nanoclaw') {
      const apiUrl = process.env.NANOCLAW_API_URL ?? '';
      const apiKey = process.env.NANOCLAW_API_KEY ?? '';
      if (!apiUrl || !apiKey) {
        console.warn('[WhatsApp] NANOCLAW_API_URL/KEY not set — falling back to mock');
        return new MockAdapter();
      }
      return new NanoclawAdapter(apiUrl, apiKey);
    }
    if (provider === 'baileys') {
      return new BaileysAdapter();
    }
    return new MockAdapter();
  }

  const adapter = selectAdapter();

  return {
    async send(to: string, text: string): Promise<void> {
      try {
        // Kill switch
        if (!enabled) {
          console.log(`[MOCK WhatsApp] → ${to}: ${text}`);
          return;
        }

        // Allowlist
        if (!allowAll && !allowlist.has(to)) {
          console.warn(`[WhatsApp] blocked: ${to} not in allowlist`);
          return;
        }

        // Rate limit
        const now = new Date();
        const hourKey = `wapp:rl:h:${now.toISOString().slice(0, 13)}`;
        const dayKey = `wapp:rl:d:${now.toISOString().slice(0, 10)}`;

        const [hourCount, dayCount] = await Promise.all([
          rateLimitStore.increment(hourKey, 3600),
          rateLimitStore.increment(dayKey, 86400),
        ]);

        if (hourCount > limitHour) {
          console.warn(`[WhatsApp] rate limit (hour): ${hourCount}/${limitHour} — skipping`);
          return;
        }
        if (dayCount > limitDay) {
          console.warn(`[WhatsApp] rate limit (day): ${dayCount}/${limitDay} — skipping`);
          return;
        }

        await adapter.send(to, text);
      } catch (err) {
        console.error('[WhatsApp] send error:', err instanceof Error ? err.message : err);
        // Never throw — callers (jobs, webhook) must not fail because of send errors
      }
    },
  };
}
