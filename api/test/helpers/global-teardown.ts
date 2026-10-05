import { Client } from 'pg';
import { adminUrl, TEMPLATE_DB } from './admin-url';

export default async function globalTeardown(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
}
