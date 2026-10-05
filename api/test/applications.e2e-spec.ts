import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { apply, bearer, createJob, createUser } from './helpers/factories';

describe('applications', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.db.query(
      'TRUNCATE notification_claims, outbox, application_events, applications, candidates, jobs, users CASCADE',
    );
  });
  afterAll(() => t.close());

  async function setup() {
    const recruiter = await createUser(t, 'recruiter');
    const jobId = await createJob(t, recruiter.id, {
      status: 'open',
      title: 'Platform Engineer',
    });
    return { recruiter, jobId };
  }

  describe('applying (public)', () => {
    it('creates the application, returns an upload ticket and a candidate token, and queues a confirmation', async () => {
      const { jobId } = await setup();
      const res = await apply(t, jobId, 'asha@example.com', 'Asha Rao');

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(true);
      expect(res.body.application.status).toBe('applied');
      expect(res.body.applicationToken).toEqual(expect.any(String));
      expect(res.body.resumeUpload.key).toBe(`resumes/${res.body.application.id}/resume.pdf`);
      expect(res.body.resumeUpload.maxBytes).toBe(5 * 1024 * 1024);

      const [outbox] = await t.db.query(`SELECT topic, payload FROM outbox`);
      expect(outbox.topic).toBe('application.submitted');
      expect(outbox.payload).toMatchObject({
        candidateEmail: 'asha@example.com',
        jobTitle: 'Platform Engineer',
      });
      const history = await t.db.query(`SELECT to_status FROM application_events`);
      expect(history.map((h: { to_status: string }) => h.to_status)).toEqual(['applied']);
    });

    it('is idempotent: applying again returns the same application with 200 and no ticket', async () => {
      const { jobId } = await setup();
      const first = await apply(t, jobId, 'asha@example.com');
      const second = await apply(t, jobId, 'ASHA@example.com');

      expect(second.status).toBe(200);
      expect(second.body.created).toBe(false);
      expect(second.body.application.id).toBe(first.body.application.id);
      // Without this, anyone who knew a candidate's email could replace their resume
      expect(second.body.applicationToken).toBeUndefined();
      expect(second.body.resumeUpload).toBeUndefined();
      expect(await t.db.query('SELECT 1 FROM outbox')).toHaveLength(1);
    });

    it('survives twenty identical requests at once: one application, one message, one history row', async () => {
      const { jobId } = await setup();
      const results = await Promise.all(Array.from({ length: 20 }, () => apply(t, jobId, 'rush@example.com')));

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 200)).toHaveLength(19);
      expect(new Set(results.map((r) => r.body.application.id)).size).toBe(1);
      expect(await t.db.query('SELECT 1 FROM applications')).toHaveLength(1);
      expect(await t.db.query('SELECT 1 FROM outbox')).toHaveLength(1);
      expect(await t.db.query('SELECT 1 FROM application_events')).toHaveLength(1);
    });

    it('keeps one candidate record per email across different jobs, without overwriting their name', async () => {
      const { recruiter, jobId } = await setup();
      const other = await createJob(t, recruiter.id, { status: 'open' });
      await apply(t, jobId, 'asha@example.com', 'Asha Rao');
      await apply(t, other, 'asha@example.com', 'Someone Else');

      const candidates = await t.db.query('SELECT full_name FROM candidates');
      expect(candidates).toEqual([{ full_name: 'Asha Rao' }]);
      expect(await t.db.query('SELECT 1 FROM applications')).toHaveLength(2);
    });

    it.each(['draft', 'paused', 'closed'])('treats a %s job as not found', async (status) => {
      const recruiter = await createUser(t, 'recruiter');
      const jobId = await createJob(t, recruiter.id, { status });
      expect((await apply(t, jobId)).status).toBe(404);
    });

    it.each([
      ['an invalid email', { email: 'nope', fullName: 'A' }],
      ['an empty name', { email: 'a@b.co', fullName: '' }],
      ['an extra field that tries to set a status', { email: 'a@b.co', fullName: 'A', status: 'hired' }],
    ])('rejects %s with 400', async (_label, body) => {
      const { jobId } = await setup();
      expect((await http().post(`/v1/public/jobs/${jobId}/applications`).send(body)).status).toBe(400);
    });
  });

  describe('resume upload tickets', () => {
    it('reissues a ticket to the candidate holding the application token', async () => {
      const { jobId } = await setup();
      const first = await apply(t, jobId);
      const res = await http()
        .post(`/v1/public/applications/${first.body.application.id}/resume-upload-url`)
        .set('X-Application-Token', first.body.applicationToken);
      expect(res.status).toBe(200);
      expect(res.body.resumeUpload.key).toContain(first.body.application.id);
    });

    it("refuses a missing, garbage, expired or someone else's token", async () => {
      const { jobId } = await setup();
      const mine = await apply(t, jobId, 'mine@example.com');
      const theirs = await apply(t, jobId, 'theirs@example.com');
      const jwt = t.app.get(JwtService);
      const expired = await jwt.signAsync({ sub: mine.body.application.id, typ: 'application' }, { expiresIn: -5 });
      const accessType = await jwt.signAsync({
        sub: mine.body.application.id,
        typ: 'access',
      });
      const url = `/v1/public/applications/${mine.body.application.id}/resume-upload-url`;

      expect((await http().post(url)).status).toBe(401);
      expect((await http().post(url).set('X-Application-Token', 'garbage')).status).toBe(401);
      expect((await http().post(url).set('X-Application-Token', expired)).status).toBe(401);
      expect((await http().post(url).set('X-Application-Token', accessType)).status).toBe(401);
      expect((await http().post(url).set('X-Application-Token', theirs.body.applicationToken)).status).toBe(401);
    });
  });

  describe('recruiter views', () => {
    it('lists applications newest first with the candidate, filters by status and pages with a cursor', async () => {
      const { recruiter, jobId } = await setup();
      for (let i = 0; i < 7; i += 1) await apply(t, jobId, `c${i}@example.com`, `Candidate ${i}`);
      await t.db.query(
        `UPDATE applications SET status = 'interview' WHERE id IN (SELECT id FROM applications LIMIT 2)`,
      );

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res: request.Response = await http()
          .get(`/v1/jobs/${jobId}/applications`)
          .query({ limit: 3, ...(cursor ? { cursor } : {}) })
          .set(bearer(recruiter.token));
        expect(res.status).toBe(200);
        seen.push(...res.body.items.map((a: { id: string }) => a.id));
        cursor = res.body.nextCursor;
      } while (cursor);
      expect(new Set(seen).size).toBe(7);

      const interview = await http()
        .get(`/v1/jobs/${jobId}/applications?status=interview`)
        .set(bearer(recruiter.token));
      expect(interview.body.items).toHaveLength(2);
      expect(interview.body.items[0]).toMatchObject({
        candidateEmail: expect.any(String),
        hasResume: false,
      });
    });

    it('shows one application with its history and the moves allowed next', async () => {
      const { recruiter, jobId } = await setup();
      const created = await apply(t, jobId);
      const res = await http().get(`/v1/applications/${created.body.application.id}`).set(bearer(recruiter.token));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'applied',
        version: 1,
        jobTitle: 'Platform Engineer',
      });
      expect(res.body.allowedNext).toEqual(['screening', 'interview', 'rejected', 'withdrawn']);
      expect(res.body.history).toHaveLength(1);
    });

    it('is closed to anonymous callers and answers 404 for unknown ids', async () => {
      const { recruiter, jobId } = await setup();
      const created = await apply(t, jobId);
      expect((await http().get(`/v1/applications/${created.body.application.id}`)).status).toBe(401);
      expect(
        (await http().get('/v1/applications/00000000-0000-4000-8000-000000000000').set(bearer(recruiter.token))).status,
      ).toBe(404);
    });

    it('offers a resume link only once a resume exists', async () => {
      const { recruiter, jobId } = await setup();
      const created = await apply(t, jobId);
      const id = created.body.application.id;
      expect((await http().get(`/v1/applications/${id}/resume-url`).set(bearer(recruiter.token))).status).toBe(404);

      await t.db.query(`UPDATE applications SET resume_key = $2 WHERE id = $1`, [id, `resumes/${id}/resume.pdf`]);
      const res = await http().get(`/v1/applications/${id}/resume-url`).set(bearer(recruiter.token));
      expect(res.status).toBe(200);
      expect(res.body.url).toContain(`resumes/${id}/resume.pdf`);
    });
  });

  describe('moving through the pipeline', () => {
    const move = (token: string, id: string, to: string, version: number, note?: string) =>
      http()
        .patch(`/v1/applications/${id}/status`)
        .set(bearer(token))
        .send({ to, version, ...(note ? { note } : {}) });

    it('moves a legal step, bumps the version, records who and why, and tells the candidate', async () => {
      const { recruiter, jobId } = await setup();
      const id = (await apply(t, jobId, 'asha@example.com', 'Asha Rao')).body.application.id;
      await t.db.query('TRUNCATE outbox CASCADE');

      const res = await move(recruiter.token, id, 'interview', 1, 'Strong portfolio');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'interview', version: 2 });
      expect(res.body.history.at(-1)).toMatchObject({
        from: 'applied',
        to: 'interview',
        note: 'Strong portfolio',
      });
      expect(res.body.history.at(-1).by).toContain('recruiter');

      const [message] = await t.db.query(`SELECT topic, payload FROM outbox`);
      expect(message.topic).toBe('application.status_changed');
      expect(message.payload).toMatchObject({
        candidateEmail: 'asha@example.com',
        from: 'applied',
        to: 'interview',
      });
    });

    it('stays quiet about internal moves the candidate does not need to hear about', async () => {
      const { recruiter, jobId } = await setup();
      const id = (await apply(t, jobId)).body.application.id;
      await t.db.query('TRUNCATE outbox CASCADE');
      expect((await move(recruiter.token, id, 'screening', 1)).status).toBe(200);
      expect(await t.db.query('SELECT 1 FROM outbox')).toHaveLength(0);
    });

    it.each([
      ['applied', 'hired'],
      ['applied', 'offer'],
      ['screening', 'offer'],
      ['interview', 'applied'],
      ['hired', 'rejected'],
      ['rejected', 'interview'],
      ['withdrawn', 'applied'],
    ])('refuses to move from %s to %s, says what is allowed, and changes nothing', async (from, to) => {
      const { recruiter, jobId } = await setup();
      const id = (await apply(t, jobId)).body.application.id;
      await t.db.query(`UPDATE applications SET status = $2 WHERE id = $1`, [id, from]);

      const res = await move(recruiter.token, id, to, 1);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain(`${from} to ${to}`);
      const [row] = await t.db.query(`SELECT status, version FROM applications WHERE id = $1`, [id]);
      expect(row).toEqual({ status: from, version: 1 });
    });

    it('walks the whole happy path to hired, then refuses anything further', async () => {
      const { recruiter, jobId } = await setup();
      const id = (await apply(t, jobId)).body.application.id;
      let version = 1;
      for (const step of ['screening', 'interview', 'offer', 'hired']) {
        const res = await move(recruiter.token, id, step, version);
        expect(res.status).toBe(200);
        version = res.body.version;
      }
      expect(version).toBe(5);
      expect((await move(recruiter.token, id, 'rejected', version)).status).toBe(409);
    });

    it('refuses a stale version, so one recruiter cannot silently overwrite another', async () => {
      const { recruiter, jobId } = await setup();
      const id = (await apply(t, jobId)).body.application.id;
      expect((await move(recruiter.token, id, 'screening', 1)).status).toBe(200);

      const stale = await move(recruiter.token, id, 'interview', 1);
      expect(stale.status).toBe(409);
      expect(stale.body.message).toMatch(/changed by someone else/);
    });

    it('lets exactly one of several simultaneous moves win', async () => {
      const { recruiter, jobId } = await setup();
      const second = await createUser(t, 'recruiter');
      const id = (await apply(t, jobId)).body.application.id;

      const results = await Promise.all([
        move(recruiter.token, id, 'interview', 1),
        move(second.token, id, 'rejected', 1),
        move(recruiter.token, id, 'screening', 1),
        move(second.token, id, 'withdrawn', 1),
      ]);

      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      const [row] = await t.db.query(`SELECT version FROM applications WHERE id = $1`, [id]);
      expect(row.version).toBe(2);
      // one move means one history row (plus the original) and at most one message
      expect(await t.db.query(`SELECT 1 FROM application_events WHERE application_id = $1`, [id])).toHaveLength(2);
    });

    it.each([
      ['an unknown status', { to: 'promoted', version: 1 }],
      ['no version', { to: 'interview' }],
      ['a zero version', { to: 'interview', version: 0 }],
      ['a note that is far too long', { to: 'interview', version: 1, note: 'x'.repeat(1001) }],
    ])('rejects %s with 400', async (_label, body) => {
      const { recruiter, jobId } = await setup();
      const id = (await apply(t, jobId)).body.application.id;
      expect((await http().patch(`/v1/applications/${id}/status`).set(bearer(recruiter.token)).send(body)).status).toBe(
        400,
      );
    });

    it('answers 404 for an unknown application and 401 without a token', async () => {
      const { recruiter, jobId } = await setup();
      const id = (await apply(t, jobId)).body.application.id;
      expect((await move(recruiter.token, '00000000-0000-4000-8000-000000000000', 'interview', 1)).status).toBe(404);
      expect((await http().patch(`/v1/applications/${id}/status`).send({ to: 'interview', version: 1 })).status).toBe(
        401,
      );
    });
  });

  describe('statistics', () => {
    it('counts applications per status for every job in one query', async () => {
      const { recruiter, jobId } = await setup();
      for (let i = 0; i < 3; i += 1) await apply(t, jobId, `c${i}@example.com`);
      await t.db.query(
        `UPDATE applications SET status = 'interview', fit_score = 80 WHERE id IN (SELECT id FROM applications LIMIT 1)`,
      );
      await t.db.query(
        `UPDATE applications SET fit_score = 60 WHERE status = 'applied' AND id IN (SELECT id FROM applications WHERE status = 'applied' LIMIT 1)`,
      );

      const res = await http().get('/v1/stats/pipeline').set(bearer(recruiter.token));
      expect(res.status).toBe(200);
      const job = res.body.jobs.find((j: { id: string }) => j.id === jobId);
      expect(job.total).toBe(3);
      expect(job.byStatus).toMatchObject({
        applied: 2,
        interview: 1,
        hired: 0,
      });
      expect(job.avgFitScore).toBe(70);
    });

    it('includes jobs that have no applications yet', async () => {
      const { recruiter, jobId } = await setup();
      const res = await http().get('/v1/stats/pipeline').set(bearer(recruiter.token));
      expect(res.body.jobs.find((j: { id: string }) => j.id === jobId)).toMatchObject({ total: 0, avgFitScore: null });
    });
  });
});
