import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import healthRouter from '../health';

describe('CORS configuration', () => {
  it('should include CORS headers in the response', async () => {
    const app = express();
    app.use(cors());
    app.use('/', healthRouter);

    const res = await request(app).get('/health');

    // cors() default configuration allows all origins (*)
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('should handle preflight requests', async () => {
    const app = express();
    app.use(cors());
    app.use('/', healthRouter);

    const res = await request(app)
      .options('/health')
      .set('Origin', 'http://example.com')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
  });
});
