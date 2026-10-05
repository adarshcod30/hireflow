// Sample jobs for a demo. Needs an admin to exist (create-admin.ts).
//   DATABASE_URL=... ts-node src/scripts/seed-demo.ts
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../database/data-source';

const JOBS = [
  {
    title: 'Software Engineer, New Grad',
    team: 'Core Platform',
    description:
      'Build internal tools and services end to end across a React front end, a NestJS API and PostgreSQL. You will own features, write tests and learn how production systems behave.',
    skills: ['react', 'typescript', 'node.js', 'nestjs', 'postgresql', 'aws'],
  },
  {
    title: 'Backend Engineer, Data Pipeline',
    team: 'Data',
    description:
      'Design schemas and queries for an event-driven pipeline on AWS. SQS, Lambda and PostgreSQL experience is a plus; careful thinking about retries and idempotency is essential.',
    skills: ['postgresql', 'sql', 'aws', 'sqs', 'lambda', 'typescript'],
  },
  {
    title: 'Product Designer',
    team: 'Design',
    description:
      'Shape the recruiter and candidate experience. You will prototype, test with users and work closely with engineers.',
    skills: ['figma', 'prototyping', 'user research'],
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const ds = new DataSource(buildDataSourceOptions(url, process.env.DATABASE_SSL === 'true'));
  await ds.initialize();
  try {
    const [admin] = await ds.query<{ id: string }[]>(
      `SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`,
    );
    if (!admin) throw new Error('Create an admin first (create-admin)');
    for (const job of JOBS) {
      await ds.query(
        `INSERT INTO jobs (title, team, description, required_skills, status, created_by)
         SELECT $1, $2, $3, $4::text[], 'open', $5
         WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE title = $1)`,
        [job.title, job.team, job.description, job.skills, admin.id],
      );
    }
    console.log(`Seeded ${JOBS.length} demo jobs (existing titles are left alone)`);
  } finally {
    await ds.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
