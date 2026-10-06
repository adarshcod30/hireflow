import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { bearer, createJob, createUser } from './helpers/factories';

describe('jobs', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.db.query('TRUNCATE jobs, users CASCADE');
  });
  afterAll(() => t.close());

  const validJob = (over: Record<string, unknown> = {}) => ({
    title: 'Backend Engineer',
    team: 'Platform',
    description: 'Design and build reliable services on PostgreSQL and AWS.',
    requiredSkills: ['PostgreSQL ', 'aws', 'postgresql'],
    ...over,
  });

  describe('creating and editing', () => {
    it('creates a draft job and normalises skills to unique lowercase words', async () => {
      const user = await createUser(t, 'recruiter');
      const res = await http().post('/v1/jobs').set(bearer(user.token)).send(validJob());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'draft',
        location: 'Remote',
        requiredSkills: ['postgresql', 'aws'],
      });
    });

    it('is closed to anonymous callers', async () => {
      expect((await http().post('/v1/jobs').send(validJob())).status).toBe(401);
    });

    it('defaults the contract details, so a client that sends none still works', async () => {
      const user = await createUser(t, 'recruiter');
      const res = await http().post('/v1/jobs').set(bearer(user.token)).send(validJob());
      expect(res.body).toMatchObject({
        employmentType: 'full_time',
        workMode: 'remote',
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: 'USD',
        salaryPeriod: 'year',
      });
    });

    it('filters the public board by work mode and employment type', async () => {
      const user = await createUser(t, 'recruiter');
      const post = (over: Record<string, unknown>) =>
        http()
          .post('/v1/jobs')
          .set(bearer(user.token))
          .send(validJob({ status: 'open', ...over }));
      await post({ title: 'Remote contractor', workMode: 'remote', employmentType: 'contract' });
      await post({ title: 'Hybrid employee', workMode: 'hybrid', employmentType: 'full_time' });
      await post({ title: 'Onsite intern', workMode: 'onsite', employmentType: 'internship' });

      const titles = async (query: Record<string, string>) =>
        ((await http().get('/v1/public/jobs').query(query)).body.items as { title: string }[]).map((j) => j.title);
      expect(await titles({ workMode: 'remote' })).toEqual(['Remote contractor']);
      expect(await titles({ employmentType: 'internship' })).toEqual(['Onsite intern']);
      expect(await titles({ workMode: 'hybrid', employmentType: 'full_time' })).toEqual(['Hybrid employee']);
      expect(await titles({ workMode: 'remote', employmentType: 'internship' })).toEqual([]);
      expect(await titles({})).toHaveLength(3);
      expect((await http().get('/v1/public/jobs').query({ workMode: 'underwater' })).status).toBe(400);
    });

    it('stores compensation and work details, and shows them on the public board once the job is open', async () => {
      const user = await createUser(t, 'recruiter');
      const created = await http()
        .post('/v1/jobs')
        .set(bearer(user.token))
        .send(
          validJob({
            status: 'open',
            employmentType: 'contract',
            workMode: 'hybrid',
            salaryMin: 40,
            salaryMax: 90,
            salaryCurrency: 'EUR',
            salaryPeriod: 'hour',
          }),
        );
      expect(created.status).toBe(201);

      const publicJob = await http().get(`/v1/public/jobs/${created.body.id}`);
      expect(publicJob.body).toMatchObject({
        employmentType: 'contract',
        workMode: 'hybrid',
        salaryMin: 40,
        salaryMax: 90,
        salaryCurrency: 'EUR',
        salaryPeriod: 'hour',
      });
    });

    it('updates one detail without disturbing the others', async () => {
      const user = await createUser(t, 'recruiter');
      const created = await http()
        .post('/v1/jobs')
        .set(bearer(user.token))
        .send(validJob({ workMode: 'onsite', salaryMin: 100, salaryMax: 150 }));
      const updated = await http()
        .patch(`/v1/jobs/${created.body.id}`)
        .set(bearer(user.token))
        .send({ salaryMax: 180 });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ workMode: 'onsite', salaryMin: 100, salaryMax: 180 });
    });

    it.each([
      ['a maximum below the minimum', { salaryMin: 100, salaryMax: 50 }],
      ['an unknown employment type', { employmentType: 'volunteer' }],
      ['an unknown work mode', { workMode: 'underwater' }],
      ['a negative salary', { salaryMin: -1 }],
      ['a currency that is not a three letter code', { salaryCurrency: 'dollars' }],
      ['a fractional salary', { salaryMin: 10.5 }],
    ])('rejects %s with 400', async (_label, over) => {
      const user = await createUser(t, 'recruiter');
      const res = await http().post('/v1/jobs').set(bearer(user.token)).send(validJob(over));
      expect(res.status).toBe(400);
    });

    it('refuses an update that would leave the maximum below the stored minimum', async () => {
      const user = await createUser(t, 'recruiter');
      const created = await http()
        .post('/v1/jobs')
        .set(bearer(user.token))
        .send(validJob({ salaryMin: 100, salaryMax: 150 }));
      const res = await http().patch(`/v1/jobs/${created.body.id}`).set(bearer(user.token)).send({ salaryMax: 20 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/salaryMax/);
    });

    it.each([
      ['a short title', { title: 'ab' }],
      ['a short description', { description: 'too short' }],
      ['an unknown status', { status: 'archived' }],
      ['too many skills', { requiredSkills: Array.from({ length: 31 }, (_, i) => `skill${i}`) }],
      ['an unexpected field', { createdBy: 'someone-else' }],
    ])('rejects %s with 400', async (_label, over) => {
      const user = await createUser(t, 'recruiter');
      expect((await http().post('/v1/jobs').set(bearer(user.token)).send(validJob(over))).status).toBe(400);
    });

    it('updates only the fields sent and publishes by changing the status', async () => {
      const user = await createUser(t, 'recruiter');
      const created = await http().post('/v1/jobs').set(bearer(user.token)).send(validJob());
      const updated = await http()
        .patch(`/v1/jobs/${created.body.id}`)
        .set(bearer(user.token))
        .send({ status: 'open' });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        status: 'open',
        title: 'Backend Engineer',
      });
      expect(new Date(updated.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.body.updatedAt).getTime(),
      );
    });

    it('answers 404 for an unknown job and 400 for a malformed id', async () => {
      const user = await createUser(t, 'recruiter');
      expect((await http().get('/v1/jobs/00000000-0000-4000-8000-000000000000').set(bearer(user.token))).status).toBe(
        404,
      );
      expect((await http().get('/v1/jobs/nope').set(bearer(user.token))).status).toBe(400);
    });
  });

  describe('public visibility', () => {
    it('shows open jobs only, and a draft or closed job does not exist to the public', async () => {
      const user = await createUser(t, 'recruiter');
      const open = await createJob(t, user.id, {
        title: 'Open role',
        status: 'open',
      });
      const draft = await createJob(t, user.id, {
        title: 'Draft role',
        status: 'draft',
      });
      const closed = await createJob(t, user.id, {
        title: 'Closed role',
        status: 'closed',
      });

      const list = await http().get('/v1/public/jobs');
      expect(list.body.items.map((j: { title: string }) => j.title)).toEqual(['Open role']);
      expect((await http().get(`/v1/public/jobs/${open}`)).status).toBe(200);
      expect((await http().get(`/v1/public/jobs/${draft}`)).status).toBe(404);
      expect((await http().get(`/v1/public/jobs/${closed}`)).status).toBe(404);
    });

    it('lets recruiters see every status and filter by one', async () => {
      const user = await createUser(t, 'recruiter');
      await createJob(t, user.id, { status: 'open' });
      await createJob(t, user.id, { status: 'draft' });

      const all = await http().get('/v1/jobs').set(bearer(user.token));
      expect(all.body.items).toHaveLength(2);
      const drafts = await http().get('/v1/jobs?status=draft').set(bearer(user.token));
      expect(drafts.body.items).toHaveLength(1);
    });
  });

  describe('search', () => {
    it('finds jobs by words in the title or description, ranking nothing out of order', async () => {
      const user = await createUser(t, 'recruiter');
      await createJob(t, user.id, {
        title: 'Rust Systems Engineer',
        description: 'Low level services in Rust.',
      });
      await createJob(t, user.id, {
        title: 'React Developer',
        description: 'Build interfaces with React and TypeScript.',
      });
      await createJob(t, user.id, {
        title: 'Data Analyst',
        description: 'Dashboards and SQL.',
      });

      const res = await http().get('/v1/public/jobs?q=react');
      expect(res.body.items.map((j: { title: string }) => j.title)).toEqual(['React Developer']);
    });

    it('handles stemming and whatever a person types, including quotes and symbols', async () => {
      const user = await createUser(t, 'recruiter');
      await createJob(t, user.id, {
        title: 'Platform Engineer',
        description: 'We are engineering reliable platforms.',
      });

      expect((await http().get('/v1/public/jobs?q=engineers')).body.items).toHaveLength(1);
      for (const q of ['"unbalanced', "'; DROP TABLE jobs; --", '(((', '-', 'a:b | c & !d']) {
        const res = await http().get('/v1/public/jobs').query({ q });
        expect(res.status).toBe(200);
      }
    });
  });

  describe('keyset pagination', () => {
    it('walks every job exactly once, in a stable order, across pages', async () => {
      const user = await createUser(t, 'recruiter');
      const base = Date.now() - 100_000;
      const ids: string[] = [];
      for (let i = 0; i < 12; i += 1) ids.push(await createJob(t, user.id, { createdAt: new Date(base + i * 1000) }));

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await http()
          .get('/v1/public/jobs')
          .query({ limit: 5, ...(cursor ? { cursor } : {}) });
        expect(res.status).toBe(200);
        seen.push(...res.body.items.map((j: { id: string }) => j.id));
        cursor = res.body.nextCursor;
        pages += 1;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toHaveLength(12);
      expect(new Set(seen).size).toBe(12);
      expect(seen).toEqual([...ids].reverse()); // newest first
    });

    it('does not skip or repeat rows that share the same timestamp, because the id breaks ties', async () => {
      const user = await createUser(t, 'recruiter');
      const sameInstant = new Date(Date.now() - 50_000);
      for (let i = 0; i < 9; i += 1) await createJob(t, user.id, { createdAt: sameInstant });

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res: request.Response = await http()
          .get('/v1/public/jobs')
          .query({ limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...res.body.items.map((j: { id: string }) => j.id));
        cursor = res.body.nextCursor;
      } while (cursor);

      expect(seen).toHaveLength(9);
      expect(new Set(seen).size).toBe(9);
    });

    it('is not disturbed by a job inserted between two page requests', async () => {
      const user = await createUser(t, 'recruiter');
      const base = Date.now() - 100_000;
      for (let i = 0; i < 6; i += 1) await createJob(t, user.id, { createdAt: new Date(base + i * 1000) });

      const first = await http().get('/v1/public/jobs').query({ limit: 3 });
      await createJob(t, user.id, {
        title: 'Brand new',
        createdAt: new Date(),
      }); // newest of all
      const second = await http().get('/v1/public/jobs').query({ limit: 3, cursor: first.body.nextCursor });

      const firstIds = first.body.items.map((j: { id: string }) => j.id);
      const secondIds = second.body.items.map((j: { id: string }) => j.id);
      expect(secondIds.filter((id: string) => firstIds.includes(id))).toEqual([]); // OFFSET paging would repeat one
      expect(secondIds).toHaveLength(3);
    });

    it.each([
      'not-base64!!',
      Buffer.from('[]').toString('base64url'),
      Buffer.from('["nope","also-nope"]').toString('base64url'),
    ])('rejects the cursor %s with 400', async (cursor) => {
      expect((await http().get('/v1/public/jobs').query({ cursor })).status).toBe(400);
    });

    it.each(['0', '101', 'abc', '-3'])('rejects limit=%s with 400', async (limit) => {
      expect((await http().get('/v1/public/jobs').query({ limit })).status).toBe(400);
    });
  });
});
