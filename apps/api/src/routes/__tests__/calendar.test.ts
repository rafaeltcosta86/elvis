import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import calendarRouter from '../calendar';
import * as oauthService from '../../lib/oauthService';
import * as graphClient from '../../lib/graphClient';

// Mock dependencies
vi.mock('../../lib/oauthService', () => ({
  getToken: vi.fn(),
}));

vi.mock('../../lib/graphClient', () => ({
  graphGet: vi.fn(),
}));

describe('Calendar Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh app instance for each test
    app = express();
    app.use(express.json());
    app.use('/', calendarRouter);
  });

  describe('GET /calendar/today', () => {
    it('should return 503 when no OAuth token is configured', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue(null);

      const response = await request(app).get('/calendar/today');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'Microsoft OAuth not configured' });
    });

    it('should return events for today', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');

      const mockEvents = {
        value: [
          {
            id: 'event-1',
            subject: 'Meeting',
            start: { dateTime: '2026-03-16T14:00:00', timeZone: 'America/Sao_Paulo' },
            end: { dateTime: '2026-03-16T15:00:00', timeZone: 'America/Sao_Paulo' },
            location: { displayName: 'Room 101' },
            isOnlineMeeting: false,
          },
        ],
      };

      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: mockEvents });

      const response = await request(app).get('/calendar/today');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('date');
      expect(response.body).toHaveProperty('events');
      expect(Array.isArray(response.body.events)).toBe(true);
      expect(graphClient.graphGet).toHaveBeenCalled();
    });

    it('should call graphGet with correct startDateTime and endDateTime parameters', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: { value: [] } });

      await request(app).get('/calendar/today');

      expect(graphClient.graphGet).toHaveBeenCalledTimes(1);
      const callArg = (graphClient.graphGet as any).mock.calls[0][0];
      expect(callArg).toContain('/me/calendarView');
      expect(callArg).toContain('startDateTime');
      expect(callArg).toContain('endDateTime');
    });

    it('should return 502 when graphGet fails', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi
        .fn()
        .mockRejectedValue(new Error('Graph API error'));

      const response = await request(app).get('/calendar/today');

      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: 'Failed to fetch calendar events' });
    });

    it('should transform event data correctly', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');

      const mockEvents = {
        value: [
          {
            id: 'event-1',
            subject: 'Team Sync',
            start: { dateTime: '2026-03-16T10:00:00' },
            end: { dateTime: '2026-03-16T10:30:00' },
            location: { displayName: 'Teams' },
            isOnlineMeeting: true,
          },
        ],
      };

      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: mockEvents });

      const response = await request(app).get('/calendar/today');

      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(1);
      const event = response.body.events[0];
      expect(event.id).toBe('event-1');
      expect(event.title).toBe('Team Sync');
      expect(event.isOnlineMeeting).toBe(true);
    });
  });

  describe('GET /calendar/week', () => {
    it('should return 503 when no OAuth token is configured', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue(null);

      const response = await request(app).get('/calendar/week');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'Microsoft OAuth not configured' });
    });

    it('should return this_week and next_week events', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');

      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: { value: [] } });

      const response = await request(app).get('/calendar/week');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('this_week');
      expect(response.body).toHaveProperty('next_week');
      expect(Array.isArray(response.body.this_week)).toBe(true);
      expect(Array.isArray(response.body.next_week)).toBe(true);
    });

    it('should call graphGet twice for this_week and next_week', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: { value: [] } });

      await request(app).get('/calendar/week');

      expect(graphClient.graphGet).toHaveBeenCalledTimes(2);
    });

    it('should return 502 when graphGet fails', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi
        .fn()
        .mockRejectedValue(new Error('Graph API error'));

      const response = await request(app).get('/calendar/week');

      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: 'Failed to fetch calendar events' });
    });

    it('should populate this_week with events from current week', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');

      const thisWeekEvents = {
        value: [
          {
            id: 'event-1',
            subject: 'Monday Meeting',
            start: { dateTime: '2026-03-16T14:00:00' },
            end: { dateTime: '2026-03-16T15:00:00' },
            location: { displayName: 'Office' },
            isOnlineMeeting: false,
          },
        ],
      };

      const nextWeekEvents = { value: [] };

      (graphClient.graphGet as any) = vi
        .fn()
        .mockResolvedValueOnce({ data: thisWeekEvents })
        .mockResolvedValueOnce({ data: nextWeekEvents });

      const response = await request(app).get('/calendar/week');

      expect(response.status).toBe(200);
      expect(response.body.this_week).toHaveLength(1);
      expect(response.body.this_week[0].title).toBe('Monday Meeting');
      expect(response.body.next_week).toHaveLength(0);
    });
  });

  describe('POST /calendar/events', () => {
    it('should return 503 when no OAuth token is configured', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue(null);

      const payload = {
        title: 'New Event',
        start: '2026-03-20T14:00:00',
        duration_min: 60,
      };

      const response = await request(app).post('/calendar/events').send(payload);

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'Microsoft OAuth not configured' });
    });

    it('should return dry_run preview when dry_run is true (default)', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: { value: [] } });

      const payload = {
        title: 'Team Meeting',
        start: '2026-03-20T14:00:00',
        duration_min: 60,
        dry_run: true,
      };

      const response = await request(app).post('/calendar/events').send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('preview');
      expect(response.body).toHaveProperty('action');
      expect(response.body.action).toBe('dry_run');
      expect(response.body).toHaveProperty('conflicts');
      expect(Array.isArray(response.body.conflicts)).toBe(true);
    });

    it('should create event when dry_run is false without conflicts', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: { value: [] } });

      const mockCreatedEvent = {
        id: 'new-event-1',
        subject: 'Team Meeting',
        start: { dateTime: '2026-03-20T14:00:00' },
        end: { dateTime: '2026-03-20T15:00:00' },
        isOnlineMeeting: false,
      };

      (graphClient.graphPost as any) = vi.fn().mockResolvedValue({ data: mockCreatedEvent });

      const payload = {
        title: 'Team Meeting',
        start: '2026-03-20T14:00:00',
        duration_min: 60,
        dry_run: false,
      };

      const response = await request(app).post('/calendar/events').send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('event');
      expect(response.body.action).toBe('created');
      expect(response.body.conflicts).toHaveLength(0);
      expect(graphClient.graphPost).toHaveBeenCalled();
    });

    it('should detect conflicts and include them in response', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');

      const conflictingEvent = {
        id: 'existing-event-1',
        subject: 'Existing Meeting',
        start: { dateTime: '2026-03-20T14:30:00' },
        end: { dateTime: '2026-03-20T15:30:00' },
        isOnlineMeeting: false,
      };

      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({
        data: { value: [conflictingEvent] },
      });

      const payload = {
        title: 'New Event',
        start: '2026-03-20T14:00:00',
        duration_min: 60,
        dry_run: true,
      };

      const response = await request(app).post('/calendar/events').send(payload);

      expect(response.status).toBe(200);
      expect(response.body.conflicts).toHaveLength(1);
      expect(response.body.conflicts[0].title).toBe('Existing Meeting');
    });

    it('should calculate end datetime correctly based on duration_min', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: { value: [] } });
      (graphClient.graphPost as any) = vi.fn().mockResolvedValue({
        data: {
          id: 'event-1',
          subject: 'Test Event',
          start: { dateTime: '2026-03-20T14:00:00' },
          end: { dateTime: '2026-03-20T15:30:00' },
          isOnlineMeeting: false,
        },
      });

      const payload = {
        title: 'Test Event',
        start: '2026-03-20T14:00:00',
        duration_min: 90,
        dry_run: false,
      };

      const response = await request(app).post('/calendar/events').send(payload);

      expect(response.status).toBe(200);
      expect(graphClient.graphPost).toHaveBeenCalled();
      const callArg = (graphClient.graphPost as any).mock.calls[0][1];
      expect(callArg.end.dateTime).toContain('15:30');
    });

    it('should return 502 when graphPost fails', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: { value: [] } });
      (graphClient.graphPost as any) = vi
        .fn()
        .mockRejectedValue(new Error('Graph API error'));

      const payload = {
        title: 'New Event',
        start: '2026-03-20T14:00:00',
        duration_min: 60,
        dry_run: false,
      };

      const response = await request(app).post('/calendar/events').send(payload);

      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: 'Failed to create calendar event' });
    });

    it('should handle reminders parameter correctly', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: { value: [] } });
      (graphClient.graphPost as any) = vi.fn().mockResolvedValue({
        data: { id: 'event-1', subject: 'Test' },
      });

      const payload = {
        title: 'Important Meeting',
        start: '2026-03-20T14:00:00',
        duration_min: 60,
        reminders: [1440, 120, 15],
        dry_run: false,
      };

      await request(app).post('/calendar/events').send(payload);

      expect(graphClient.graphPost).toHaveBeenCalled();
      const callArg = (graphClient.graphPost as any).mock.calls[0][1];
      // Should use minimum reminder value
      expect(callArg.reminderMinutesBeforeStart).toBe(15);
      expect(callArg.isReminderOn).toBe(true);
    });

    it('should use default reminders when not provided', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi.fn().mockResolvedValue({ data: { value: [] } });
      (graphClient.graphPost as any) = vi.fn().mockResolvedValue({
        data: { id: 'event-1', subject: 'Test' },
      });

      const payload = {
        title: 'Meeting',
        start: '2026-03-20T14:00:00',
        duration_min: 60,
        dry_run: false,
      };

      await request(app).post('/calendar/events').send(payload);

      const callArg = (graphClient.graphPost as any).mock.calls[0][1];
      // Default reminders: [1440, 120], min is 120
      expect(callArg.reminderMinutesBeforeStart).toBe(120);
    });

    it('should return 502 when conflict check fails', async () => {
      (oauthService.getToken as any) = vi.fn().mockResolvedValue('test_token');
      (graphClient.graphGet as any) = vi
        .fn()
        .mockRejectedValue(new Error('Graph API error'));

      const payload = {
        title: 'New Event',
        start: '2026-03-20T14:00:00',
        duration_min: 60,
      };

      const response = await request(app).post('/calendar/events').send(payload);

      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: 'Failed to create calendar event' });
    });
  });
});
