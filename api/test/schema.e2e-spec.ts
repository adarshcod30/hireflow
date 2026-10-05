import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../src/database/data-source';
import { createTestApp, TestApp } from './helpers/app';
import { createJob, createUser } from './helpers/factories';

describe('database schema', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const sqlState = async (sql: string, params: unknown[] = []): Promise<string | undefined> => {
    try {
      await t.db.query(sql, params);
      return undefined;
    } catch (error) {
      return (error as { driverError?: { code?: string } }).driverError?.code;
    }
  };

  async function applicationId(): Promise<string> {
    const user = await createUser(t, 'recruiter');
    const jobId = await createJob(t, user.id);
    const [c] = await t.db.query(`INSERT INTO candidates (email, full_name) VALUES ($1, 'C') RETURNING id`, [
      `c${Math.random()}@x.co`,
    ]);
    const [a] = await t.db.query(`INSERT INTO applications (job_id, candidate_id) VALUES ($1, $2) RETURNING id`, [
      jobId,
      c.id,
    ]);
    return a.id as string;
  }

  describe('constraints that keep bad data out whatever the application does', () => {
    it('allows one application per candidate per job', async () => {
      const user = await createUser(t, 'recruiter');
      const jobId = await createJob(t, user.id);
      const [c] = await t.db.query(`INSERT INTO candidates (email, full_name) VALUES ('dup@x.co', 'D') RETURNING id`);
      await t.db.query(`INSERT INTO applications (job_id, candidate_id) VALUES ($1, $2)`, [jobId, c.id]);
      expect(await sqlState(`INSERT INTO applications (job_id, candidate_id) VALUES ($1, $2)`, [jobId, c.id])).toBe(
        '23505',
      );
    });

    it('treats emails as case-insensitive (citext)', async () => {
      await t.db.query(`INSERT INTO candidates (email, full_name) VALUES ('Case@Example.com', 'A')`);
      expect(await sqlState(`INSERT INTO candidates (email, full_name) VALUES ('case@example.COM', 'B')`)).toBe(
        '23505',
      );
    });

    it('rejects a fit score outside 0 to 100', async () => {
      const id = await applicationId();
      expect(await sqlState(`UPDATE applications SET fit_score = 101 WHERE id = $1`, [id])).toBe('23514');
      expect(await sqlState(`UPDATE applications SET fit_score = -1 WHERE id = $1`, [id])).toBe('23514');
      expect(await sqlState(`UPDATE applications SET fit_score = 100 WHERE id = $1`, [id])).toBeUndefined();
    });

    it('does not allow a finished screening without a score, nor an unknown screening state', async () => {
      const id = await applicationId();
      expect(await sqlState(`UPDATE applications SET screening_status = 'done' WHERE id = $1`, [id])).toBe('23514');
      expect(await sqlState(`UPDATE applications SET screening_status = 'weird' WHERE id = $1`, [id])).toBe('23514');
      expect(
        await sqlState(`UPDATE applications SET screening_status = 'done', fit_score = 50 WHERE id = $1`, [id]),
      ).toBeUndefined();
    });

    it('rejects an unknown application status through the enum type', async () => {
      const id = await applicationId();
      expect(await sqlState(`UPDATE applications SET status = 'promoted' WHERE id = $1`, [id])).toBe('22P02');
    });

    it('refuses an application for a job or candidate that does not exist', async () => {
      expect(
        await sqlState(
          `INSERT INTO applications (job_id, candidate_id) VALUES ('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001')`,
        ),
      ).toBe('23503');
    });

    it('removes dependent rows when a job is deleted', async () => {
      const id = await applicationId();
      await t.db.query(`INSERT INTO application_events (application_id, to_status) VALUES ($1, 'applied')`, [id]);
      const [{ job_id }] = await t.db.query(`SELECT job_id FROM applications WHERE id = $1`, [id]);
      await t.db.query(`DELETE FROM jobs WHERE id = $1`, [job_id]);
      expect(await t.db.query(`SELECT 1 FROM applications WHERE id = $1`, [id])).toHaveLength(0);
      expect(await t.db.query(`SELECT 1 FROM application_events WHERE application_id = $1`, [id])).toHaveLength(0);
    });

    it('limits job titles to a sensible length', async () => {
      const user = await createUser(t, 'recruiter');
      expect(
        await sqlState(`INSERT INTO jobs (title, team, description, created_by) VALUES ('ab', 'T', 'D', $1)`, [
          user.id,
        ]),
      ).toBe('23514');
    });
  });

  describe('timestamps', () => {
    it('stores millisecond precision, so a value survives a round trip through a JavaScript Date', async () => {
      const user = await createUser(t, 'recruiter');
      const jobId = await createJob(t, user.id);
      const [row] = await t.db.query(`SELECT created_at, to_char(created_at, 'US') AS micros FROM jobs WHERE id = $1`, [
        jobId,
      ]);
      expect(row.micros.endsWith('000')).toBe(true); // microseconds are always .xxx000
      expect(new Date(row.created_at.toISOString()).getTime()).toBe(row.created_at.getTime());
    });
  });

  describe('generated full-text column', () => {
    it('follows the title and description by itself, with no application code involved', async () => {
      const user = await createUser(t, 'recruiter');
      const jobId = await createJob(t, user.id, {
        title: 'Plumber',
        description: 'Fixes pipes and taps in buildings.',
      });
      const hits = (q: string) =>
        t.db.query(`SELECT 1 FROM jobs WHERE id = $1 AND search @@ websearch_to_tsquery('english', $2)`, [jobId, q]);

      expect(await hits('plumber')).toHaveLength(1);
      expect(await hits('astronaut')).toHaveLength(0);
      await t.db.query(`UPDATE jobs SET title = 'Astronaut' WHERE id = $1`, [jobId]);
      expect(await hits('astronaut')).toHaveLength(1);
      expect(await hits('plumber')).toHaveLength(0);
    });
  });

  describe('the indexes are really used by the queries they were made for', () => {
    const plan = async (sql: string, params: unknown[] = []): Promise<string> => {
      const runner = t.db.createQueryRunner();
      try {
        // Tiny tables make Postgres prefer a sequential scan, so switch it off to prove an index is usable
        await runner.query('SET enable_seqscan = off');
        const rows = (await runner.query(`EXPLAIN ${sql}`, params)) as {
          'QUERY PLAN': string;
        }[];
        return rows.map((r) => r['QUERY PLAN']).join('\n');
      } finally {
        await runner.query('RESET enable_seqscan');
        await runner.release();
      }
    };

    it('serves the public job listing from the partial index on open jobs', async () => {
      const text = await plan(`SELECT * FROM jobs WHERE status = 'open' ORDER BY created_at DESC, id DESC LIMIT 20`);
      expect(text).toMatch(/jobs_open_page_idx/);
    });

    it('serves the applications page for one job and status from its composite index', async () => {
      const text = await plan(
        `SELECT * FROM applications WHERE job_id = '00000000-0000-4000-8000-000000000000' AND status = 'applied'
         ORDER BY created_at DESC, id DESC LIMIT 20`,
      );
      expect(text).toMatch(/applications_job_page_idx/);
    });

    it('finds unpublished outbox rows through the partial index', async () => {
      const text = await plan(`SELECT id FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 25`);
      expect(text).toMatch(/outbox_unpublished_idx/);
    });

    it('searches job text through the GIN index', async () => {
      const text = await plan(`SELECT * FROM jobs WHERE search @@ websearch_to_tsquery('english', 'react')`);
      expect(text).toMatch(/jobs_search_idx/);
    });
  });
});

describe('migrations', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('can be undone and applied again without leaving anything behind', async () => {
    const ds = new DataSource(buildDataSourceOptions(process.env.DATABASE_URL as string, false));
    await ds.initialize();
    try {
      await ds.undoLastMigration({ transaction: 'each' });
      const tables = await ds.query<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      );
      expect(tables.map((r) => r.tablename).filter((n) => n !== 'migrations')).toEqual([]);
      const types = await ds.query(
        `SELECT typname FROM pg_type WHERE typname IN ('user_role', 'job_status', 'application_status')`,
      );
      expect(types).toEqual([]);

      await ds.runMigrations({ transaction: 'each' });
      const back = await ds.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`,
      );
      expect(back[0].n).toBeGreaterThan(5);
    } finally {
      await ds.destroy();
    }
  });
});
