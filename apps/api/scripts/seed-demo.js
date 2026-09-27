// npm run seed:demo
// Creates the demo account in the database from MONGODB_URI, with ready-made
// kits (no LLM calls). Running it again resets the demo account's kits.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedDemo } from '../src/demo/seed.js';
import { createMongoStore } from '../src/store/mongo.js';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

if (!process.env.MONGODB_URI) {
  console.error(
    'MONGODB_URI is not set. Add it to .env, or start the API with SEED_DEMO=true to seed its in-memory store.',
  );
  process.exit(1);
}

const store = await createMongoStore(process.env.MONGODB_URI);
try {
  const { email, password } = await seedDemo(store);
  console.log(`\nDemo account ready.\n  Email:    ${email}\n  Password: ${password}`);
} finally {
  await store.close();
}
