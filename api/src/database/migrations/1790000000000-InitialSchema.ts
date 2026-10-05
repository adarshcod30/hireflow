import { MigrationInterface, QueryRunner } from 'typeorm';

// Hand-written SQL rather than generated, so every constraint, index and
// design decision is visible in one reviewable place.
export class InitialSchema1790000000000 implements MigrationInterface {
  name = 'InitialSchema1790000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS citext`);

    await q.query(`CREATE TYPE user_role AS ENUM ('admin', 'recruiter')`);
    await q.query(`CREATE TYPE job_status AS ENUM ('draft', 'open', 'paused', 'closed')`);
    await q.query(`
      CREATE TYPE application_status AS ENUM
        ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')
    `);

    await q.query(`
      CREATE TABLE users (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email         citext NOT NULL UNIQUE,
        password_hash text NOT NULL,
        full_name     text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 200),
        role          user_role NOT NULL DEFAULT 'recruiter',
        is_active     boolean NOT NULL DEFAULT true,
        created_at    timestamptz(3) NOT NULL DEFAULT now(),
        updated_at    timestamptz(3) NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE TABLE jobs (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title           text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
        team            text NOT NULL,
        location        text NOT NULL DEFAULT 'Remote',
        description     text NOT NULL,
        required_skills text[] NOT NULL DEFAULT '{}',
        status          job_status NOT NULL DEFAULT 'draft',
        created_by      uuid NOT NULL REFERENCES users(id),
        created_at      timestamptz(3) NOT NULL DEFAULT now(),
        updated_at      timestamptz(3) NOT NULL DEFAULT now(),
        -- Full-text document kept in step with the row by the database itself
        search          tsvector GENERATED ALWAYS AS (
                          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                          setweight(to_tsvector('english', coalesce(description, '')), 'B')
                        ) STORED
      )
    `);
    await q.query(`CREATE INDEX jobs_search_idx ON jobs USING GIN (search)`);
    await q.query(`CREATE INDEX jobs_skills_idx ON jobs USING GIN (required_skills)`);
    // The public listing only ever reads open jobs, newest first: a partial index
    // keeps it small and ordered exactly as the keyset query wants.
    await q.query(`CREATE INDEX jobs_open_page_idx ON jobs (created_at DESC, id DESC) WHERE status = 'open'`);
    await q.query(`CREATE INDEX jobs_page_idx ON jobs (created_at DESC, id DESC)`);

    await q.query(`
      CREATE TABLE candidates (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email      citext NOT NULL UNIQUE,
        full_name  text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 200),
        created_at timestamptz(3) NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE TABLE applications (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id             uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        candidate_id       uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        status             application_status NOT NULL DEFAULT 'applied',
        resume_key         text,
        resume_uploaded_at timestamptz(3),
        screening_status   text NOT NULL DEFAULT 'pending'
                           CHECK (screening_status IN ('pending', 'processing', 'done', 'failed')),
        fit_score          smallint CHECK (fit_score BETWEEN 0 AND 100),
        screening_summary  text,
        extracted_skills   text[] NOT NULL DEFAULT '{}',
        screened_at        timestamptz(3),
        version            integer NOT NULL DEFAULT 1,
        created_at         timestamptz(3) NOT NULL DEFAULT now(),
        updated_at         timestamptz(3) NOT NULL DEFAULT now(),
        -- One application per candidate per job. This is what makes applying idempotent.
        CONSTRAINT applications_job_candidate_key UNIQUE (job_id, candidate_id),
        -- A finished screening always has a score
        CONSTRAINT applications_screened_has_score CHECK (screening_status <> 'done' OR fit_score IS NOT NULL)
      )
    `);
    // Serves "applications for this job, optionally one status, newest first, next page"
    await q.query(`CREATE INDEX applications_job_page_idx ON applications (job_id, status, created_at DESC, id DESC)`);
    await q.query(`CREATE INDEX applications_job_all_page_idx ON applications (job_id, created_at DESC, id DESC)`);
    await q.query(`CREATE INDEX applications_candidate_idx ON applications (candidate_id)`);
    // The digest looks for open applications nobody has touched
    await q.query(`
      CREATE INDEX applications_stale_idx ON applications (updated_at)
      WHERE status IN ('applied', 'screening', 'interview', 'offer')
    `);

    await q.query(`
      CREATE TABLE application_events (
        id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        from_status    text,
        to_status      text NOT NULL,
        actor_id       uuid REFERENCES users(id),
        note           text,
        created_at     timestamptz(3) NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX application_events_application_idx ON application_events (application_id, id)`);

    // Transactional outbox: a domain change and the message about it are written
    // in one transaction, and a relay publishes unsent rows afterwards.
    await q.query(`
      CREATE TABLE outbox (
        id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        topic        text NOT NULL,
        payload      jsonb NOT NULL,
        created_at   timestamptz(3) NOT NULL DEFAULT now(),
        published_at timestamptz(3),
        attempts     integer NOT NULL DEFAULT 0,
        last_error   text
      )
    `);
    await q.query(`CREATE INDEX outbox_unpublished_idx ON outbox (id) WHERE published_at IS NULL`);

    // One row per message a consumer has taken responsibility for. The primary
    // key is what turns at-least-once delivery into effectively-once sending.
    await q.query(`
      CREATE TABLE notification_claims (
        outbox_id  bigint PRIMARY KEY REFERENCES outbox(id) ON DELETE CASCADE,
        claimed_at timestamptz(3) NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS notification_claims`);
    await q.query(`DROP TABLE IF EXISTS outbox`);
    await q.query(`DROP TABLE IF EXISTS application_events`);
    await q.query(`DROP TABLE IF EXISTS applications`);
    await q.query(`DROP TABLE IF EXISTS candidates`);
    await q.query(`DROP TABLE IF EXISTS jobs`);
    await q.query(`DROP TABLE IF EXISTS users`);
    await q.query(`DROP TYPE IF EXISTS application_status`);
    await q.query(`DROP TYPE IF EXISTS job_status`);
    await q.query(`DROP TYPE IF EXISTS user_role`);
  }
}
