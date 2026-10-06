// Fills a database with a believable hiring platform: recruiters, a dozen jobs, about 130 applications
// at every stage, their history, and (against AWS) a PDF resume for each one.
//
//   DATABASE_URL=... node dist/scripts/seed-mock.js            add the demo data
//   DATABASE_URL=... node dist/scripts/seed-mock.js --reset    remove it again, then add it fresh
//
// With STORAGE_DRIVER=s3 the resumes are uploaded to the resume bucket and left unscreened: the real
// pipeline (S3, SQS, Lambda, Bedrock) then scores every one of them, which is the point. Without S3,
// local runs store a plausible score and summary directly so the screens have something to show.
//
// Everything is invented. Candidates use example.com, and no outbox rows are written, so seeding
// never sends an email.
import 'dotenv/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { resumeKeyFor } from '../storage/storage.port';
import { buildDataSourceOptions } from '../database/data-source';
import { buildPdf } from './pdf';
import { buildMockPlan } from './mock-plan';

const DEMO_ADMIN_JOB_TITLES = ['Software Engineer, New Grad', 'Backend Engineer, Data Pipeline', 'Product Designer'];

async function reset(db: EntityManager): Promise<void> {
  await db.query(`DELETE FROM jobs WHERE created_by IN (SELECT id FROM users WHERE email LIKE '%@hireflow.example')`);
  await db.query(`DELETE FROM candidates WHERE email LIKE '%@example.com'`);
  await db.query(`DELETE FROM users WHERE email LIKE '%@hireflow.example'`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const wantsReset = process.argv.includes('--reset');

  const ds = new DataSource(buildDataSourceOptions(url, process.env.DATABASE_SSL === 'true'));
  await ds.initialize();
  const upload = process.env.STORAGE_DRIVER === 's3' && Boolean(process.env.RESUME_BUCKET);
  const plan = buildMockPlan(new Date());

  const created: { id: string; index: number }[] = [];
  try {
    await ds.transaction(async (db) => {
      if (wantsReset) await reset(db);

      const [{ n }] = await db.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM users WHERE email LIKE '%@hireflow.example'`,
      );
      if (n > 0) {
        console.log('Demo data is already present. Run again with --reset to replace it.');
        return;
      }

      // The three sample jobs from seed-demo would sit next to their richer twins. Drop them if untouched.
      await db.query(
        `DELETE FROM jobs j WHERE j.title = ANY($1) AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)`,
        [DEMO_ADMIN_JOB_TITLES],
      );

      // These people can appear in a history but cannot sign in: nobody ever knows these passwords
      const recruiterIds: string[] = [];
      for (const r of plan.recruiters) {
        const hash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
        const [row] = await db.query<{ id: string }[]>(
          `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, 'recruiter') RETURNING id`,
          [r.email, hash, r.name],
        );
        recruiterIds.push(row.id);
      }

      const jobIds: string[] = [];
      for (const j of plan.jobs) {
        const [row] = await db.query<{ id: string }[]>(
          `INSERT INTO jobs (title, team, location, description, required_skills, status, employment_type, work_mode,
                             salary_min, salary_max, salary_currency, salary_period, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12, $13, $14, $14) RETURNING id`,
          [
            j.title,
            j.team,
            j.location,
            j.description,
            j.skills,
            j.status,
            j.employmentType,
            j.workMode,
            j.salaryMin,
            j.salaryMax,
            j.salaryCurrency,
            j.salaryPeriod,
            recruiterIds[0],
            j.createdAt,
          ],
        );
        jobIds.push(row.id);
      }

      const candidateIds = new Map<string, string>();
      for (const a of plan.applications) {
        if (candidateIds.has(a.email)) continue;
        const [row] = await db.query<{ id: string }[]>(
          `INSERT INTO candidates (email, full_name, created_at) VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
          [a.email, a.fullName, a.createdAt],
        );
        candidateIds.set(a.email, row.id);
      }

      for (const [index, a] of plan.applications.entries()) {
        const s = a.synthetic;
        const [row] = await db.query<{ id: string }[]>(
          `INSERT INTO applications (job_id, candidate_id, status, version, created_at, updated_at,
                                     screening_status, fit_score, screening_summary, extracted_skills, screened_at)
           VALUES ($1, $2, $3::application_status, $4, $5, $6, $7, $8, $9, $10::text[], $11) RETURNING id`,
          [
            jobIds[a.jobIndex],
            candidateIds.get(a.email),
            a.status,
            a.version,
            a.createdAt,
            a.updatedAt,
            // Against AWS the pipeline fills these in. Locally there is no pipeline, so store a result.
            upload ? 'pending' : 'done',
            upload ? null : s.fitScore,
            upload ? null : s.summary,
            upload ? [] : s.skills,
            upload ? null : new Date(a.createdAt.getTime() + 60_000),
          ],
        );
        for (const e of a.events) {
          await db.query(
            `INSERT INTO application_events (application_id, from_status, to_status, actor_id, note, created_at)
             VALUES ($1, $2::application_status, $3::application_status, $4, $5, $6)`,
            [row.id, e.from, e.to, e.actor === null ? null : recruiterIds[e.actor], e.note, e.at],
          );
        }
        created.push({ id: row.id, index });
      }
    });

    if (created.length === 0) return;

    if (upload) {
      const bucket = process.env.RESUME_BUCKET as string;
      const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });
      let done = 0;
      const queue = [...created];
      // A handful at a time: each upload fires an event that starts a screening
      const worker = async (): Promise<void> => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          const a = plan.applications[item.index];
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: resumeKeyFor(item.id),
              Body: buildPdf(a.resumeLines),
              ContentType: 'application/pdf',
            }),
          );
          done += 1;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      console.log(`Uploaded ${done} resumes to ${bucket}. Screening runs in the background.`);
    }

    console.log(
      `Seeded ${plan.recruiters.length} recruiters, ${plan.jobs.length} jobs and ${created.length} applications` +
        (upload ? ' (resumes screening on AWS).' : ' (synthetic screening scores).'),
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
