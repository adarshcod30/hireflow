import request from 'supertest';
import { createTestApp, signedHeaders, TestApp } from './helpers/app';
import { apply, createJob, createUser } from './helpers/factories';

describe('internal API (signed requests from the workers)', () => {
  let t: TestApp;
  let secret: string;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    secret = t.config.internalHmacSecret;
  });
  afterEach(async () => {
    await t.db.query(
      'TRUNCATE notification_claims, outbox, application_events, applications, candidates, jobs, users CASCADE',
    );
  });
  afterAll(() => t.close());

  const get = (path: string, headers = signedHeaders(secret, 'GET', path)) => http().get(path).set(headers);
  const post = (path: string, body: object) => {
    const raw = JSON.stringify(body);
    return http()
      .post(path)
      .set(signedHeaders(secret, 'POST', path, raw))
      .set('Content-Type', 'application/json')
      .send(raw);
  };

  async function applicationWithJob() {
    const recruiter = await createUser(t, 'recruiter');
    const jobId = await createJob(t, recruiter.id, {
      title: 'Data Engineer',
      skills: ['sql', 'aws'],
    });
    const id = (await apply(t, jobId)).body.application.id as string;
    return { id, jobId, recruiter };
  }

  describe('signature check', () => {
    it('refuses an unsigned request, a user token and a malformed signature', async () => {
      const { id, recruiter } = await applicationWithJob();
      const path = `/v1/internal/applications/${id}/screening-context`;
      expect((await http().get(path)).status).toBe(401);
      expect((await http().get(path).set('Authorization', `Bearer ${recruiter.token}`)).status).toBe(401);
      expect(
        (await http().get(path).set('x-hireflow-timestamp', '1').set('x-hireflow-signature', 'not-hex!')).status,
      ).toBe(401);
    });

    it('refuses a signature made with the wrong secret', async () => {
      const { id } = await applicationWithJob();
      const path = `/v1/internal/applications/${id}/screening-context`;
      expect((await get(path, signedHeaders('some-other-secret-value-entirely-different', 'GET', path))).status).toBe(
        401,
      );
    });

    it('refuses a captured signature replayed against a different path, method or body', async () => {
      const { id } = await applicationWithJob();
      const path = `/v1/internal/applications/${id}/screening-context`;
      const stolen = signedHeaders(secret, 'GET', path);

      expect((await http().get(`/v1/internal/reports/stale-applications`).set(stolen)).status).toBe(401);
      expect((await http().get(`${path}?x=1`).set(stolen)).status).toBe(401);

      const body = JSON.stringify({ outcome: 'failed', error: 'x' });
      const postPath = `/v1/internal/applications/${id}/screening`;
      const signed = signedHeaders(secret, 'POST', postPath, body);
      const tampered = JSON.stringify({ outcome: 'done', fitScore: 100 });
      expect(
        (await http().post(postPath).set(signed).set('Content-Type', 'application/json').send(tampered)).status,
      ).toBe(401);
    });

    it('refuses a request signed too long ago or in the future', async () => {
      const { id } = await applicationWithJob();
      const path = `/v1/internal/applications/${id}/screening-context`;
      const now = Math.floor(Date.now() / 1000);
      expect((await get(path, signedHeaders(secret, 'GET', path, '', String(now - 600)))).status).toBe(401);
      expect((await get(path, signedHeaders(secret, 'GET', path, '', String(now + 600)))).status).toBe(401);
      expect((await get(path, signedHeaders(secret, 'GET', path, '', String(now - 60)))).status).toBe(200);
    });
  });

  describe('screening', () => {
    it('hands the worker the job it needs, and records that a resume now exists', async () => {
      const { id } = await applicationWithJob();
      const res = await get(`/v1/internal/applications/${id}/screening-context`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        applicationId: id,
        resumeKey: `resumes/${id}/resume.pdf`,
        alreadyScreened: false,
        job: { title: 'Data Engineer', requiredSkills: ['sql', 'aws'] },
      });
      const [row] = await t.db.query(
        `SELECT resume_key, screening_status, resume_uploaded_at FROM applications WHERE id = $1`,
        [id],
      );
      expect(row.resume_key).toBe(`resumes/${id}/resume.pdf`);
      expect(row.screening_status).toBe('processing');
      expect(row.resume_uploaded_at).not.toBeNull();
    });

    it('is safe to call again when the queue redelivers the message', async () => {
      const { id } = await applicationWithJob();
      const first = await get(`/v1/internal/applications/${id}/screening-context`);
      const [a] = await t.db.query(`SELECT resume_uploaded_at FROM applications WHERE id = $1`, [id]);
      const second = await get(`/v1/internal/applications/${id}/screening-context`);
      const [b] = await t.db.query(`SELECT resume_uploaded_at FROM applications WHERE id = $1`, [id]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(b.resume_uploaded_at).toEqual(a.resume_uploaded_at);
    });

    it('answers 404 for an unknown application so the worker can drop the message', async () => {
      expect(
        (await get('/v1/internal/applications/00000000-0000-4000-8000-000000000000/screening-context')).status,
      ).toBe(404);
    });

    it('stores a finished screening and reports it as already done on a later call', async () => {
      const { id } = await applicationWithJob();
      await get(`/v1/internal/applications/${id}/screening-context`);
      const res = await post(`/v1/internal/applications/${id}/screening`, {
        outcome: 'done',
        fitScore: 82,
        summary: 'Strong SQL and AWS background.',
        skills: ['SQL ', 'aws', 'sql'],
      });
      expect(res.status).toBe(200);

      const [row] = await t.db.query(
        `SELECT screening_status, fit_score, screening_summary, extracted_skills, screened_at FROM applications WHERE id = $1`,
        [id],
      );
      expect(row).toMatchObject({
        screening_status: 'done',
        fit_score: 82,
        extracted_skills: ['sql', 'aws'],
      });
      expect(row.screened_at).not.toBeNull();
      expect((await get(`/v1/internal/applications/${id}/screening-context`)).body.alreadyScreened).toBe(true);
    });

    it('records a failure with its reason, and a late failure never undoes a success', async () => {
      const { id } = await applicationWithJob();
      expect(
        (
          await post(`/v1/internal/applications/${id}/screening`, {
            outcome: 'failed',
            error: 'Not a readable PDF',
          })
        ).status,
      ).toBe(200);
      const [failed] = await t.db.query(`SELECT screening_status, screening_summary FROM applications WHERE id = $1`, [
        id,
      ]);
      expect(failed).toEqual({
        screening_status: 'failed',
        screening_summary: 'Not a readable PDF',
      });

      expect(
        (
          await post(`/v1/internal/applications/${id}/screening`, {
            outcome: 'done',
            fitScore: 70,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post(`/v1/internal/applications/${id}/screening`, {
            outcome: 'failed',
            error: 'late retry',
          })
        ).status,
      ).toBe(200);
      const [row] = await t.db.query(`SELECT screening_status, fit_score FROM applications WHERE id = $1`, [id]);
      expect(row).toEqual({ screening_status: 'done', fit_score: 70 });
    });

    it.each([
      ['a score above 100', { outcome: 'done', fitScore: 101 }],
      ['a negative score', { outcome: 'done', fitScore: -1 }],
      ['no score on a success', { outcome: 'done' }],
      ['an unknown outcome', { outcome: 'maybe' }],
    ])('rejects %s with 400', async (_label, body) => {
      const { id } = await applicationWithJob();
      expect((await post(`/v1/internal/applications/${id}/screening`, body)).status).toBe(400);
    });
  });

  describe('stale applications report', () => {
    it('lists open applications nobody has touched for N days, oldest first', async () => {
      const { id, jobId } = await applicationWithJob();
      const fresh = (await apply(t, jobId, 'fresh@example.com')).body.application.id as string;
      const done = (await apply(t, jobId, 'done@example.com')).body.application.id as string;
      await t.db.query(`UPDATE applications SET updated_at = now() - interval '10 days' WHERE id = $1`, [id]);
      await t.db.query(
        `UPDATE applications SET updated_at = now() - interval '30 days', status = 'hired' WHERE id = $1`,
        [done],
      );

      const res = await get('/v1/internal/reports/stale-applications?days=7');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({
        id,
        status: 'applied',
        jobTitle: 'Data Engineer',
        daysIdle: 10,
      });
      expect(res.body.items.map((i: { id: string }) => i.id)).not.toContain(fresh);
    });

    it('is not reset by automated screening, so an idle application still shows up as idle', async () => {
      const { id } = await applicationWithJob();
      await t.db.query(`UPDATE applications SET updated_at = now() - interval '10 days' WHERE id = $1`, [id]);

      // The worker starts screening and then reports a result
      expect((await get(`/v1/internal/applications/${id}/screening-context`)).status).toBe(200);
      const done = await post(`/v1/internal/applications/${id}/screening`, {
        outcome: 'done',
        fitScore: 77,
        summary: 'A decent match',
        skills: ['sql'],
      });
      expect(done.status).toBe(200);

      const [row] = await t.db.query(
        `SELECT fit_score, screening_status, updated_at < now() - interval '9 days' AS still_old FROM applications WHERE id = $1`,
        [id],
      );
      expect(row).toMatchObject({ fit_score: 77, screening_status: 'done', still_old: true });
      const report = await get('/v1/internal/reports/stale-applications?days=7');
      expect(report.body.total).toBe(1);
      expect(report.body.items[0]).toMatchObject({ id, daysIdle: 10 });
    });

    it('rejects an absurd window', async () => {
      expect((await get('/v1/internal/reports/stale-applications?days=0')).status).toBe(400);
      expect((await get('/v1/internal/reports/stale-applications?days=9999')).status).toBe(400);
    });
  });

  describe('notification claims (turning at-least-once into effectively-once)', () => {
    async function outboxId(): Promise<string> {
      const { id, recruiter } = await applicationWithJob();
      void id;
      void recruiter;
      const [row] = await t.db.query(`SELECT id FROM outbox ORDER BY id LIMIT 1`);
      return row.id as string;
    }

    it('gives exactly one caller the claim, however many ask at once', async () => {
      const claimId = await outboxId();
      const results = await Promise.all(
        Array.from({ length: 12 }, () => post('/v1/internal/notifications/claim', { outboxId: claimId })),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.claimed === true)).toHaveLength(1);
    });

    it('lets the message be claimed again after a failed send releases it', async () => {
      const claimId = await outboxId();
      expect((await post('/v1/internal/notifications/claim', { outboxId: claimId })).body.claimed).toBe(true);
      expect((await post('/v1/internal/notifications/claim', { outboxId: claimId })).body.claimed).toBe(false);

      const path = `/v1/internal/notifications/claim/${claimId}`;
      expect(
        (
          await http()
            .delete(path)
            .set(signedHeaders(secret, 'DELETE', path))
        ).status,
      ).toBe(204);
      expect((await post('/v1/internal/notifications/claim', { outboxId: claimId })).body.claimed).toBe(true);
    });

    it('says not claimed for a message that no longer exists, and rejects a malformed id', async () => {
      expect(
        (
          await post('/v1/internal/notifications/claim', {
            outboxId: '99999999',
          })
        ).body.claimed,
      ).toBe(false);
      expect((await post('/v1/internal/notifications/claim', { outboxId: 'abc' })).status).toBe(400);
    });
  });
});
