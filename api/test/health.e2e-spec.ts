import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';

describe('health checks', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('reports liveness without touching the database', async () => {
    const res = await request(t.app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports readiness while the database answers', async () => {
    const res = await request(t.app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.details.database.status).toBe('up');
  });

  it('turns unready with 503 once the database is gone, while liveness stays green', async () => {
    await t.db.destroy();
    const ready = await request(t.app.getHttpServer()).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.statusCode).toBe(503);
    expect((await request(t.app.getHttpServer()).get('/health')).status).toBe(200);
    // so a platform restarting on liveness does not restart a healthy process during a database outage
    await t.db.initialize();
  });
});
