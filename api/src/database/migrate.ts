// Run pending migrations with plain node (no ts-node), for the deploy script:
//   DATABASE_URL=... node dist/database/migrate.js
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const ds = new DataSource(buildDataSourceOptions(url, process.env.DATABASE_SSL === 'true'));
  await ds.initialize();
  try {
    const ran = await ds.runMigrations({ transaction: 'each' });
    console.log(ran.length ? `Applied: ${ran.map((m) => m.name).join(', ')}` : 'Database is up to date');
  } finally {
    await ds.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
