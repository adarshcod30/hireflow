import request from 'supertest';
import { JobsService } from '../src/jobs/jobs.service';
import { createTestApp, TestApp } from './helpers/app';
import { createJob, createUser } from './helpers/factories';

describe('security and operations', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  describe('HTTP hardening', () => {
    it('sets security headers and does not announce the framework', async () => {
      const res = await http().get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows the configured web origin and no other', async () => {
      const allowed = await http().get('/health').set('Origin', 'http://localhost:5173');
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      const other = await http().get('/health').set('Origin', 'https://evil.example');
      expect(other.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('answers a preflight for the headers the web app really sends', async () => {
      const res = await http()
        .options('/v1/applications/x/status')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-application-token');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-methods']).toContain('PATCH');
      expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-application-token');
    });
  });

  describe('request ids and errors', () => {
    it('gives every response a request id, and echoes a sane one the caller sends', async () => {
      expect((await http().get('/health')).headers['x-request-id']).toMatch(/^[\w-]{8,}$/);
      expect((await http().get('/health').set('X-Request-Id', 'trace-abc-123')).headers['x-request-id']).toBe(
        'trace-abc-123',
      );
    });

    it('replaces an unsafe or oversized request id instead of reflecting it', async () => {
      const res = await http().get('/health').set('X-Request-Id', 'bad id\twith spaces');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect((await http().get('/health').set('X-Request-Id', 'x'.repeat(200))).headers['x-request-id']).toHaveLength(
        36,
      );
    });

    it('returns one error shape that carries the request id', async () => {
      const res = await http().get('/v1/auth/me').set('X-Request-Id', 'find-me-in-the-logs');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required',
        requestId: 'find-me-in-the-logs',
      });
    });

    it('answers unknown routes and malformed JSON with clean JSON errors', async () => {
      const missing = await http().get('/v1/does-not-exist');
      expect(missing.status).toBe(404);
      expect(missing.body.requestId).toBeDefined();

      const malformed = await http().post('/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ');
      expect(malformed.status).toBe(400);
      expect(malformed.body.message).not.toMatch(/\.js:\d+/);
    });

    it('refuses unknown properties instead of silently ignoring them', async () => {
      const recruiter = await createUser(t, 'recruiter');
      const res = await http().post('/v1/jobs').set('Authorization', `Bearer ${recruiter.token}`).send({
        title: 'Engineer',
        team: 'Core',
        description: 'A long enough description.',
        createdBy: recruiter.id,
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('createdBy');
    });

    it('shows the real message to a developer but hides it in production', async () => {
      jest
        .spyOn(JobsService.prototype, 'listPublic')
        .mockRejectedValue(new Error('connect ECONNREFUSED postgres://user:secret@db:5432'));

      const dev = await http().get('/v1/public/jobs');
      expect(dev.status).toBe(500);
      expect(dev.body.message).toContain('ECONNREFUSED');

      const prod = await createTestApp({ nodeEnv: 'production' });
      try {
        const res = await request(prod.app.getHttpServer()).get('/v1/public/jobs');
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Internal server error');
        expect(JSON.stringify(res.body)).not.toMatch(/secret|postgres:\/\//);
      } finally {
        await prod.close();
      }
    });
  });

  describe('injection', () => {
    it('treats SQL fragments in a search as text and in an id as a bad request', async () => {
      const user = await createUser(t, 'recruiter');
      await createJob(t, user.id, { title: 'Normal job' });

      const search = await http().get('/v1/public/jobs').query({ q: "' OR 1=1; DROP TABLE jobs; --" });
      expect(search.status).toBe(200);
      expect(search.body.items).toEqual([]);
      expect((await http().get("/v1/public/jobs/1' OR '1'='1")).status).toBe(400);
      expect((await http().get('/v1/public/jobs')).body.items).toHaveLength(1);
    });

    it('does not let a JSON operator stand in for a string', async () => {
      const res = await http()
        .post('/v1/auth/login')
        .send({ email: { $ne: null }, password: { $ne: null } });
      expect(res.status).toBe(400);
    });
  });

  describe('every protected route refuses an anonymous caller', () => {
    it.each([
      ['get', '/v1/jobs'],
      ['post', '/v1/jobs'],
      ['get', '/v1/jobs/00000000-0000-4000-8000-000000000000'],
      ['patch', '/v1/jobs/00000000-0000-4000-8000-000000000000'],
      ['get', '/v1/jobs/00000000-0000-4000-8000-000000000000/applications'],
      ['get', '/v1/applications/00000000-0000-4000-8000-000000000000'],
      ['patch', '/v1/applications/00000000-0000-4000-8000-000000000000/status'],
      ['get', '/v1/applications/00000000-0000-4000-8000-000000000000/resume-url'],
      ['get', '/v1/stats/pipeline'],
      ['get', '/v1/users'],
      ['post', '/v1/users'],
      ['get', '/v1/auth/me'],
      ['get', '/v1/internal/reports/stale-applications'],
      ['post', '/v1/internal/notifications/claim'],
    ])('%s %s answers 401', async (method, path) => {
      const res = await (http() as unknown as Record<string, (p: string) => request.Test>)[method](path).send({});
      expect(res.status).toBe(401);
    });
  });

  describe('API documentation', () => {
    it('serves the OpenAPI document outside production and keeps the internal endpoints out of it', async () => {
      const res = await http().get('/docs-json');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining(['/v1/jobs', '/v1/public/jobs', '/v1/auth/login']),
      );
      expect(Object.keys(res.body.paths).some((p) => p.includes('/internal/'))).toBe(false);
    });
  });
});
