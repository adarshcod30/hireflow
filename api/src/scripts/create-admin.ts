// Create the first admin account. Works without booting the whole app, so it can
// run on the server straight after the migrations:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... node dist/scripts/create-admin.js
// Without ADMIN_PASSWORD a random one is generated and printed once.
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../database/data-source';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (!url) throw new Error('DATABASE_URL is not set');
  if (!email) throw new Error('ADMIN_EMAIL is not set');

  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');

  const ds = new DataSource(buildDataSourceOptions(url, process.env.DATABASE_SSL === 'true'));
  await ds.initialize();
  try {
    const rows = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, await bcrypt.hash(password, 12), process.env.ADMIN_NAME ?? 'Administrator'],
    );
    if (rows.length === 0) {
      console.log(`Admin ${email} already exists, nothing changed`);
    } else if (generated) {
      console.log(`Created admin ${email}. Generated password (shown once): ${password}`);
    } else {
      console.log(`Created admin ${email}`);
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
