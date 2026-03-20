import { getHours } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';

export function isQuietHours(timezone: string = 'America/Sao_Paulo'): boolean {
  const now = utcToZonedTime(new Date(), timezone);
  const hour = getHours(now);

  // Quiet hours: 22:00–07:00 (22 until 6:59)
  return hour >= 22 || hour < 7;
}
