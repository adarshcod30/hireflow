import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/data-source';
import { adminUrl, TEMPLATE_DB, urlFor } from './admin-url';

// Build one template database with every migration applied. Each test file then
// clones it (CREATE DATABASE ... TEMPLATE), which takes milliseconds.
export default async function globalSetup(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB}`);
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }

  const ds = new DataSource(buildDataSourceOptions(urlFor(TEMPLATE_DB), false));
  await ds.initialize();
  try {
    await ds.runMigrations({ transaction: 'each' });
  } finally {
    await ds.destroy();
  }
}
