import axios from 'axios';

export interface CalendarEvent {
  title: string;
  start: string;
  end: string;
  durationText: string;
}

/**
 * Fetches calendar events for the current day from Microsoft Graph.
 * @param accessToken Microsoft OAuth access token
 * @returns List of events with title, start, end, and duration
 */
export async function getCalendarEventsForToday(accessToken: string): Promise<CalendarEvent[]> {
  const now = new Date();

  // Brazil/Sao Paulo is UTC-3
  const offset = -3;
  const brNow = new Date(now.getTime() + (offset * 60 * 60 * 1000));

  const startOfDay = new Date(brNow);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startDateTime = new Date(startOfDay.getTime() - (offset * 60 * 60 * 1000)).toISOString();

  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const endDateTime = new Date(endOfDay.getTime() - (offset * 60 * 60 * 1000)).toISOString();

  const response = await axios.get('https://graph.microsoft.com/v1.0/me/calendarview', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      // We don't set outlook.timezone Prefer header to get UTC times
    },
    params: {
      startDateTime,
      endDateTime,
      '$select': 'subject,start,end',
      '$orderby': 'start/dateTime',
    },
  });

  return response.data.value.map((event: any) => {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    const durationMs = end.getTime() - start.getTime();
    const durationMin = Math.round(durationMs / (1000 * 60));
    const hours = Math.floor(durationMin / 60);
    const minutes = durationMin % 60;

    let durationText = '';
    if (hours > 0) {
      durationText += `${hours}h`;
    }
    if (minutes > 0 || (hours === 0)) {
      durationText += `${minutes}min`;
    }

    if (durationText.endsWith('0min') && hours > 0) {
      durationText = durationText.replace('0min', '');
    }

    // graph.microsoft.com/v1.0/me/calendarview returns UTC by default if no Prefer header is present
    // but to be safe we ensure the date objects are correctly initialized from the response strings
    return {
      title: event.subject,
      start: event.start.dateTime.endsWith('Z') ? event.start.dateTime : `${event.start.dateTime}Z`,
      end: event.end.dateTime.endsWith('Z') ? event.end.dateTime : `${event.end.dateTime}Z`,
      durationText
    };
  });
}
