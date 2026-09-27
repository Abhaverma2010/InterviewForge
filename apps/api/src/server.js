// Starts the API: loads config, connects to MongoDB, resumes unfinished
// generations and listens.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import MongoStore from 'connect-mongo';
import { createCrawlerDeps, createLLMClientFromEnv } from '@interviewforge/core';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createGenerationQueue } from './services/generation-queue.js';
import { createMemoryStore } from './store/memory.js';
import { createMongoStore } from './store/mongo.js';

// Local development: read the repository's .env. Real environment variables win.
const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const llm = createLLMClientFromEnv();
const crawler = createCrawlerDeps({ allowPrivate: config.allowPrivateUrls });

let store;
let sessionStore;
if (config.mongoUri) {
  store = await createMongoStore(config.mongoUri);
  sessionStore = MongoStore.create({ client: store.connection.getClient(), ttl: 7 * 24 * 60 * 60 });
  console.log('Connected to MongoDB.');
} else {
  store = createMemoryStore();
  console.warn('MONGODB_URI is not set: using an in-memory store. Data is lost on restart.');
}

const queue = createGenerationQueue({
  store,
  llm,
  crawler,
  concurrency: config.generationConcurrency,
});
const resumed = await queue.resumeUnfinished();
if (resumed) console.log(`Resumed ${resumed} unfinished generation(s).`);

const app = createApp({ store, queue, llm, crawler, config, sessionStore });
const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close();
  await store.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
