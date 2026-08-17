import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('application wiring', () => {
  describe('GET /health', () => {
    it('reports a healthy service and a connected database', async () => {
      const response = await request(app).get('/health').expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: { status: 'ok', database: 'connected' },
      });
      expect(typeof response.body.data.uptimeSeconds).toBe('number');
    });

    it('needs no authentication', async () => {
      await request(app).get('/health').expect(200);
    });
  });

  describe('unmatched routes', () => {
    it('returns a 404 in the standard error envelope', async () => {
      const response = await request(app).get('/does-not-exist').expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatchObject({
        code: 'ROUTE_NOT_FOUND',
        message: expect.stringContaining('/does-not-exist'),
      });
    });

    it('applies to unsupported methods on known paths', async () => {
      const response = await request(app).patch('/auth/login').expect(404);
      expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    });
  });

  describe('malformed request bodies', () => {
    it('rejects unparseable JSON with a 400 rather than a 500', async () => {
      const response = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "a@b.c", ')
        .expect(400);

      expect(response.body.error.code).toBe('MALFORMED_JSON');
    });
  });

  describe('security headers', () => {
    it('sets helmet defaults and hides the framework', async () => {
      const response = await request(app).get('/health').expect(200);

      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    });
  });
});
