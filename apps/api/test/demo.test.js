import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKit } from '@interviewforge/core';
import { createApp } from '../src/app.js';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemo } from '../src/demo/seed.js';
import { createMemoryStore } from '../src/store/memory.js';

test('the demo seed creates a working account with valid kits, and can be re-run', async () => {
  const store = createMemoryStore();
  await seedDemo(store, { log: () => {} });
  await seedDemo(store, { log: () => {} }); // resets rather than duplicating

  const user = await store.users.findByEmail(DEMO_EMAIL);
  const kits = await store.kits.listByOwner(user.id);
  assert.equal(kits.length, 4);
  assert.deepEqual(kits.map((k) => k.status).sort(), ['failed', 'ready', 'ready', 'ready']);
  for (const record of kits.filter((k) => k.status === 'ready')) {
    assert.deepEqual(validateKit(record.kit), { ok: true }, record.kit.role.title);
  }
  const thin = kits.find((k) => k.kit?.role.thin);
  assert.equal(thin.kit.schedule.days.length, 1);

  // And the credentials work through the real login endpoint.
  const app = createApp({
    store,
    queue: { enqueue() {}, position: () => -1 },
    config: { production: false, sessionSecret: 'x', webOrigin: '' },
  });
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});
