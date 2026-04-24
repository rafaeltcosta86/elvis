import { Router } from 'express';
import {
  startOfWeek,
  endOfWeek,
  startOfToday,
  endOfToday,
  addWeeks,
  startOfDay,
  endOfDay,
  addMinutes,
  parseISO,
  format,
} from 'date-fns';
import { utcToZonedTime, formatInTimeZone } from 'date-fns-tz';
import { getToken } from '../lib/oauthService';
import { graphGet, graphPost } from '../lib/graphClient';
import { sanitizeError } from '../lib/logger';

const router = Router();
const TIMEZONE = 'America/Sao_Paulo';

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  isOnlineMeeting: boolean;
}

/**
 * Helper: Format a date to ISO string in São Paulo timezone
 */
function formatDateTimeISO(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * Helper: Transform Microsoft Graph event to our format
 */
function transformEvent(event: any): CalendarEvent {
  return {
    id: event.id,
    title: event.subject,
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    location: event.location?.displayName,
    isOnlineMeeting: event.isOnlineMeeting || false,
  };
}

/**
 * GET /calendar/today
 * Returns events for today (São Paulo timezone)
 */
router.get('/calendar/today', async (_req, res) => {
  try {
    const token = await getToken();

    if (!token) {
      return res.status(503).json({ error: 'Microsoft OAuth not configured' });
    }

    // Get today's date in São Paulo timezone
    const now = utcToZonedTime(new Date(), TIMEZONE);
    const startOfTodayDate = startOfDay(now);
    const endOfTodayDate = endOfDay(now);

    const startDateTime = formatDateTimeISO(startOfTodayDate);
    const endDateTime = formatDateTimeISO(endOfTodayDate);

    // Get the date string (YYYY-MM-DD) for response
    const todayStr = formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd');

    // Call Microsoft Graph API
    const query = `/me/calendarView?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}`;
    const response = await graphGet(query);

    const events = (response.data.value || []).map(transformEvent);

    res.json({
      date: todayStr,
      events,
    });
  } catch (err) {
    console.error('GET /calendar/today error:', sanitizeError(err));
    res.status(502).json({ error: 'Failed to fetch calendar events' });
  }
});

/**
 * GET /calendar/week
 * Returns events for this week and next week (São Paulo timezone)
 */
router.get('/calendar/week', async (_req, res) => {
  try {
    const token = await getToken();

    if (!token) {
      return res.status(503).json({ error: 'Microsoft OAuth not configured' });
    }

    const now = utcToZonedTime(new Date(), TIMEZONE);

    // This week: Monday to Sunday
    const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday = 1
    const thisWeekEnd = endOfWeek(now, { weekStartsOn: 1 });

    // Next week: following Monday to Sunday
    const nextWeekStart = startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 });
    const nextWeekEnd = endOfWeek(addWeeks(now, 1), { weekStartsOn: 1 });

    const formatStart = formatDateTimeISO(thisWeekStart);
    const formatEnd = formatDateTimeISO(thisWeekEnd);
    const formatNextStart = formatDateTimeISO(nextWeekStart);
    const formatNextEnd = formatDateTimeISO(nextWeekEnd);

    // Fetch this week's events
    const thisWeekQuery = `/me/calendarView?startDateTime=${encodeURIComponent(formatStart)}&endDateTime=${encodeURIComponent(formatEnd)}`;
    const thisWeekResponse = await graphGet(thisWeekQuery);
    const this_week = (thisWeekResponse.data.value || []).map(transformEvent);

    // Fetch next week's events
    const nextWeekQuery = `/me/calendarView?startDateTime=${encodeURIComponent(formatNextStart)}&endDateTime=${encodeURIComponent(formatNextEnd)}`;
    const nextWeekResponse = await graphGet(nextWeekQuery);
    const next_week = (nextWeekResponse.data.value || []).map(transformEvent);

    res.json({
      this_week,
      next_week,
    });
  } catch (err) {
    console.error('GET /calendar/week error:', sanitizeError(err));
    res.status(502).json({ error: 'Failed to fetch calendar events' });
  }
});

/**
 * POST /calendar/events
 * Create or preview a calendar event
 * Body: { title, start (ISO), duration_min, dry_run? (default true), location?, reminders? (default [1440,120]) }
 */
router.post('/calendar/events', async (req, res) => {
  try {
    const token = await getToken();

    if (!token) {
      return res.status(503).json({ error: 'Microsoft OAuth not configured' });
    }

    const { title, start, duration_min, dry_run = true, location, reminders = [1440, 120] } = req.body;

    // Parse start as wall-clock time and add duration (no TZ conversion — Graph API handles TZ via timeZone field)
    const startDate = parseISO(start);
    const endDate = addMinutes(startDate, duration_min);

    const startISO = start; // Already ISO format from client
    const endISO = format(endDate, "yyyy-MM-dd'T'HH:mm:ss");

    // Check for conflicts using calendarView
    const conflictQuery = `/me/calendarView?startDateTime=${encodeURIComponent(startISO)}&endDateTime=${encodeURIComponent(endISO)}`;
    const conflictResponse = await graphGet(conflictQuery);
    const conflicts = (conflictResponse.data.value || []).map(transformEvent);

    // Build the event payload for Graph API
    const graphEventBody = {
      subject: title,
      start: {
        dateTime: startISO,
        timeZone: TIMEZONE,
      },
      end: {
        dateTime: endISO,
        timeZone: TIMEZONE,
      },
      ...(location && { location: { displayName: location } }),
      reminderMinutesBeforeStart: Math.min(...reminders),
      isReminderOn: true,
    };

    // Preview mode
    if (dry_run) {
      return res.json({
        preview: {
          title,
          start: startISO,
          end: endISO,
          duration_min,
          location,
        },
        action: 'dry_run',
        conflicts,
      });
    }

    // Create the event
    const createResponse = await graphPost('/me/events', graphEventBody);
    const createdEvent = transformEvent(createResponse.data);

    res.json({
      event: createdEvent,
      action: 'created',
      conflicts,
    });
  } catch (err) {
    console.error('POST /calendar/events error:', sanitizeError(err));
    res.status(502).json({ error: 'Failed to create calendar event' });
  }
});

export default router;
