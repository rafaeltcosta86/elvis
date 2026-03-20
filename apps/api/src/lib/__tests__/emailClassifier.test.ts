import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyImportance } from '../emailClassifier';
import type { NormalizedEmail } from '../types/email';

function makeEmail(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    id: 'msg-1',
    from: 'someone@unknown.com',
    subject: 'Hello',
    receivedAt: '2026-03-19T10:00:00.000Z',
    isReply: false,
    snippet: 'Just a message',
    ...overrides,
  };
}

describe('classifyImportance', () => {
  beforeEach(() => {
    delete process.env.KNOWN_CONTACT_DOMAINS;
    delete process.env.IMPORTANT_KEYWORDS;
  });

  afterEach(() => {
    delete process.env.KNOWN_CONTACT_DOMAINS;
    delete process.env.IMPORTANT_KEYWORDS;
  });

  it('returns false for an email with no signals', () => {
    expect(classifyImportance(makeEmail())).toBe(false);
  });

  it('returns true when from domain is in KNOWN_CONTACT_DOMAINS', () => {
    process.env.KNOWN_CONTACT_DOMAINS = 'trusted.com,work.org';
    expect(classifyImportance(makeEmail({ from: 'boss@trusted.com' }))).toBe(true);
  });

  it('returns false when domain is not in KNOWN_CONTACT_DOMAINS', () => {
    process.env.KNOWN_CONTACT_DOMAINS = 'trusted.com';
    expect(classifyImportance(makeEmail({ from: 'spam@other.com' }))).toBe(false);
  });

  it('returns true when subject contains a keyword from IMPORTANT_KEYWORDS', () => {
    process.env.IMPORTANT_KEYWORDS = 'urgente,prazo';
    expect(classifyImportance(makeEmail({ subject: 'Prazo amanhã' }))).toBe(true);
  });

  it('is case-insensitive for keyword matching', () => {
    process.env.IMPORTANT_KEYWORDS = 'urgente';
    expect(classifyImportance(makeEmail({ subject: 'URGENTE: responder hoje' }))).toBe(true);
  });

  it('returns true when isReply is true', () => {
    expect(classifyImportance(makeEmail({ isReply: true }))).toBe(true);
  });

  it('returns false when isReply is false and no other signals match', () => {
    expect(classifyImportance(makeEmail({ isReply: false }))).toBe(false);
  });

  it('returns true when multiple signals match', () => {
    process.env.KNOWN_CONTACT_DOMAINS = 'trusted.com';
    process.env.IMPORTANT_KEYWORDS = 'urgente';
    expect(
      classifyImportance(makeEmail({ from: 'x@trusted.com', subject: 'urgente', isReply: true }))
    ).toBe(true);
  });

  it('handles empty KNOWN_CONTACT_DOMAINS gracefully', () => {
    process.env.KNOWN_CONTACT_DOMAINS = '';
    expect(classifyImportance(makeEmail())).toBe(false);
  });

  it('handles empty IMPORTANT_KEYWORDS gracefully', () => {
    process.env.IMPORTANT_KEYWORDS = '';
    expect(classifyImportance(makeEmail())).toBe(false);
  });

  it('uses default keywords when IMPORTANT_KEYWORDS is not set', () => {
    // Default includes 'urgente'
    expect(classifyImportance(makeEmail({ subject: 'urgente: responder agora' }))).toBe(true);
  });
});
