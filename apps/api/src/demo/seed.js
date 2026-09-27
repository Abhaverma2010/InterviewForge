// Creates (or resets) the demo account and fills it with ready-made kits.
// Safe to run repeatedly: the demo user's existing kits are replaced.

import bcrypt from 'bcryptjs';
import { hashInput } from '../routes/kits.js';
import { demoKits, FAILED_DEMO_INPUT } from './demo-kits.js';

export const DEMO_EMAIL = 'demo@interviewforge.dev';
export const DEMO_PASSWORD = 'demo-password-2026';

const DONE_STEPS = [
  'extract',
  'crawl',
  'discussion',
  'brief',
  'hiring-process',
  'questions:technical',
  'coverage',
  'flashcards',
  'complete',
];

/**
 * @param {object} store
 * @param {object} [opts]
 * @param {boolean} [opts.onlyIfMissing]  leave an existing demo account alone
 *   (for servers that seed on every start: visitors' edits survive restarts)
 * @returns {Promise<{ email: string, password: string, seeded: boolean }>}
 */
export async function seedDemo(store, { log = console.log, onlyIfMissing = false } = {}) {
  let user = await store.users.findByEmail(DEMO_EMAIL);
  if (user && onlyIfMissing) {
    log(`Demo user ${DEMO_EMAIL} already exists; left as it is`);
    return { email: DEMO_EMAIL, password: DEMO_PASSWORD, seeded: false };
  }
  if (!user) {
    user = await store.users.create({
      email: DEMO_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
    });
    log(`Created demo user ${DEMO_EMAIL}`);
  } else {
    log(`Demo user ${DEMO_EMAIL} exists; resetting its kits`);
  }

  for (const existing of await store.kits.listByOwner(user.id)) {
    await store.kits.remove(existing.id);
  }

  // Oldest first, so the list shows the richest kit at the top.
  const failed = await store.kits.create({
    owner: user.id,
    input_hash: hashInput(FAILED_DEMO_INPUT),
    input: FAILED_DEMO_INPUT,
    status: 'failed',
    progress: {
      current: 'extract',
      steps: [
        {
          step: 'extract',
          status: 'failed',
          detail: 'Daily quota for the model is used up.',
          at: new Date().toISOString(),
        },
      ],
    },
    error: {
      code: 'LLM_QUOTA_EXHAUSTED',
      message:
        'extract failed: Daily quota for the model is used up. (Demo: press Try again to run it for real.)',
    },
    kit: null,
    version: 0,
    practice: { cards: {} },
  });
  log(`  failed kit: ${failed.id}`);

  for (const { input, kit, practice } of demoKits().reverse()) {
    await new Promise((r) => setTimeout(r, 5)); // distinct created_at for ordering
    const record = await store.kits.create({
      owner: user.id,
      input_hash: hashInput(input),
      input,
      status: 'ready',
      progress: {
        current: 'complete',
        steps: DONE_STEPS.map((step) => ({ step, status: 'done', at: kit.source.researched_at })),
      },
      error: null,
      kit,
      version: 1,
      practice: { cards: practice },
    });
    log(`  ${kit.role.title} at ${kit.source.company}: ${record.id}`);
  }
  return { email: DEMO_EMAIL, password: DEMO_PASSWORD, seeded: true };
}
