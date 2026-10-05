/** A connection to the `postgres` maintenance database, used to create and drop test databases. */
export const adminUrl = (): string =>
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://hireflow:hireflow-local-only@localhost:5432/postgres';

export const urlFor = (database: string): string => {
  const u = new URL(adminUrl());
  u.pathname = `/${database}`;
  return u.toString();
};

export const TEMPLATE_DB = 'hireflow_test_template';
