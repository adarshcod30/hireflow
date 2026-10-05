import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import type { TestApp } from './app';

export const PASSWORD = 'correct-horse-battery-1';

let counter = 0;
const next = (): number => ++counter;

export async function createUser(
  t: TestApp,
  role: 'admin' | 'recruiter' = 'recruiter',
  overrides: { email?: string; isActive?: boolean } = {},
): Promise<{ id: string; email: string; token: string }> {
  const email = overrides.email ?? `${role}${next()}@hireflow.test`;
  const [row] = await t.db.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [email, await bcrypt.hash(PASSWORD, 4), `${role} ${email}`, role, overrides.isActive ?? true],
  );
  const login = await request(t.app.getHttpServer()).post('/v1/auth/login').send({ email, password: PASSWORD });
  return {
    id: row.id as string,
    email,
    token: (login.body.accessToken as string) ?? '',
  };
}

export const bearer = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

export async function createJob(
  t: TestApp,
  createdBy: string,
  overrides: Partial<{
    title: string;
    status: string;
    description: string;
    skills: string[];
    createdAt: Date;
  }> = {},
): Promise<string> {
  const [row] = await t.db.query(
    `INSERT INTO jobs (title, team, description, required_skills, status, created_by, created_at)
     VALUES ($1, 'Core', $2, $3::text[], $4, $5, COALESCE($6, now())) RETURNING id`,
    [
      overrides.title ?? `Engineer ${next()}`,
      overrides.description ?? 'Build and ship features across the stack.',
      overrides.skills ?? ['typescript'],
      overrides.status ?? 'open',
      createdBy,
      overrides.createdAt ?? null,
    ],
  );
  return row.id as string;
}

export async function apply(
  t: TestApp,
  jobId: string,
  email = `candidate${next()}@example.com`,
  fullName = 'Asha Rao',
) {
  return request(t.app.getHttpServer()).post(`/v1/public/jobs/${jobId}/applications`).send({ email, fullName });
}
