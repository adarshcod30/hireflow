import { DataSource, DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';
import { InitialSchema1790000000000 } from './migrations/1790000000000-InitialSchema';

export const MIGRATIONS = [InitialSchema1790000000000];

export function buildDataSourceOptions(url: string, ssl: boolean): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    // RDS presents a certificate from the AWS CA. The deploy script installs the
    // RDS bundle; without it, verification is relaxed only when SSL is on.
    ssl: ssl ? { rejectUnauthorized: false } : false,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    // Schema changes go through reviewed migrations, never through synchronize
    synchronize: false,
    migrationsRun: false,
  };
}

// Used by the migration CLI scripts
export default new DataSource(
  buildDataSourceOptions(process.env.DATABASE_URL ?? '', process.env.DATABASE_SSL === 'true'),
);
