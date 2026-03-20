import type { NormalizedEmail } from './types/email';

const DEFAULT_KEYWORDS = [
  'urgente',
  'ação necessária',
  'prazo',
  'important',
  'action required',
  'deadline',
];

/**
 * Classifies whether an email is "important" based on three deterministic signals:
 * 1. Sender domain is in KNOWN_CONTACT_DOMAINS env var (comma-separated)
 * 2. Subject contains a keyword from IMPORTANT_KEYWORDS env var (comma-separated)
 * 3. Email is a reply (isReply === true)
 */
export function classifyImportance(email: NormalizedEmail): boolean {
  const knownDomains = parseEnvList(process.env.KNOWN_CONTACT_DOMAINS);
  const keywords =
    process.env.IMPORTANT_KEYWORDS !== undefined
      ? parseEnvList(process.env.IMPORTANT_KEYWORDS)
      : DEFAULT_KEYWORDS;

  // Signal 1: sender domain
  if (knownDomains.length > 0) {
    const fromDomain = email.from.split('@')[1]?.split('>')[0]?.trim().toLowerCase();
    if (fromDomain && knownDomains.some((d) => d.toLowerCase() === fromDomain)) {
      return true;
    }
  }

  // Signal 2: subject keyword
  if (keywords.length > 0) {
    const subjectLower = email.subject.toLowerCase();
    if (keywords.some((kw) => subjectLower.includes(kw.toLowerCase()))) {
      return true;
    }
  }

  // Signal 3: reply
  if (email.isReply) {
    return true;
  }

  return false;
}

function parseEnvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
