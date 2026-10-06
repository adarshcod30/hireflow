import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a candidate wants to know before applying: the kind of contract, where the
 * work happens and what it pays. Every column has a default, so existing rows stay
 * valid and an old client that sends none of them keeps working.
 */
export class JobDetails1790000000001 implements MigrationInterface {
  name = 'JobDetails1790000000001';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE employment_type AS ENUM ('full_time', 'part_time', 'contract', 'internship')`);
    await q.query(`CREATE TYPE work_mode AS ENUM ('remote', 'hybrid', 'onsite')`);
    await q.query(`
      ALTER TABLE jobs
        ADD COLUMN employment_type employment_type NOT NULL DEFAULT 'full_time',
        ADD COLUMN work_mode       work_mode        NOT NULL DEFAULT 'remote',
        ADD COLUMN salary_min      integer CHECK (salary_min >= 0),
        ADD COLUMN salary_max      integer CHECK (salary_max >= 0),
        ADD COLUMN salary_currency char(3) NOT NULL DEFAULT 'USD' CHECK (salary_currency ~ '^[A-Z]{3}$'),
        ADD COLUMN salary_period   text NOT NULL DEFAULT 'year' CHECK (salary_period IN ('hour', 'month', 'year')),
        ADD CONSTRAINT jobs_salary_range CHECK (salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min)
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE jobs
        DROP CONSTRAINT jobs_salary_range,
        DROP COLUMN salary_period,
        DROP COLUMN salary_currency,
        DROP COLUMN salary_max,
        DROP COLUMN salary_min,
        DROP COLUMN work_mode,
        DROP COLUMN employment_type
    `);
    await q.query(`DROP TYPE work_mode`);
    await q.query(`DROP TYPE employment_type`);
  }
}
