import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { createJob, createUser } from './helpers/factories';

// Its own file, so its own app and its own throttle counters. Once a client is
// blocked it stays blocked for the window, which would poison any other test.
describe('rate limiting', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    process.env.RATE_LIMIT_LOGIN = '3';
    process.env.RATE_LIMIT_APPLY = '2';
  });
  afterAll(async () => {
    process.env.RATE_LIMIT_LOGIN = '100000';
    process.env.RATE_LIMIT_APPLY = '100000';
    await t.close();
  });

  it('stops repeated login attempts after the limit, with 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await http().post('/v1/auth/login').send({ email: 'x@y.co', password: 'bad' })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });

  it('limits public applications separately from logins', async () => {
    const recruiter = await createUser(t, 'recruiter').catch(() => null); // login is already blocked, only the row matters
    const [row] = await t.db.query(`SELECT id FROM users LIMIT 1`);
    const jobId = await createJob(t, (recruiter?.id ?? row.id) as string);

    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(
        (
          await http()
            .post(`/v1/public/jobs/${jobId}/applications`)
            .send({ email: `c${i}@example.com`, fullName: 'C' })
        ).status,
      );
    }
    expect(statuses).toEqual([201, 201, 429, 429]);
  });

  it('never limits the health endpoints a platform polls', async () => {
    for (let i = 0; i < 20; i += 1) expect((await http().get('/health')).status).toBe(200);
  });

  it('tells a blocked client how long to wait', async () => {
    const res = await http().post('/v1/auth/login').send({ email: 'x@y.co', password: 'bad' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
