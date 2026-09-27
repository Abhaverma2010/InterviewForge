import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCrawlerDeps } from '@interviewforge/core';
import { createFakeLlm } from '../../../packages/core/test/helpers/fake-llm.js';
import { page, startSite } from '../../../packages/core/test/helpers/site-server.js';
import { createApp } from '../src/app.js';
import { hashInput } from '../src/routes/kits.js';
import { createGenerationQueue } from '../src/services/generation-queue.js';
import { createMemoryStore } from '../src/store/memory.js';

const JD = `Senior Backend Engineer

Requirements
- 5+ years with Go
- Strong PostgreSQL skills
- Experience with Kafka
- Clear written communication`;

let server;
let base;
let site;
let queue;
let store;
let llm;

before(async () => {
  site = await startSite({
    '/': page(
      'Acme',
      '<main><p>Acme builds rockets for satellite companies worldwide.</p><a href="/jobs">Jobs</a></main>',
    ),
    '/jobs': page(
      'Jobs',
      '<main><p>Our hiring process: a take-home, then a technical interview.</p></main>',
    ),
    '/search': { type: 'application/json', body: '{"hits":[]}' },
  });
  process.env.DISCUSSION_SEARCH_URL = `${site.origin}/search`;

  store = createMemoryStore();
  llm = createFakeLlm();
  const crawler = createCrawlerDeps({
    allowPrivate: true,
    minIntervalMs: 0,
    retries: 0,
    timeoutMs: 2000,
  });
  queue = createGenerationQueue({ store, llm, crawler });
  const app = createApp({
    store,
    queue,
    llm,
    crawler,
    config: { production: false, sessionSecret: 'test-secret', webOrigin: 'http://localhost:3000' },
    logger: { error() {} },
  });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await site.close();
  delete process.env.DISCUSSION_SEARCH_URL;
});

// A tiny browser: remembers the session cookie between requests.
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

async function signedIn(email = `user${Math.random().toString(36).slice(2)}@test.dev`) {
  const call = client();
  const res = await call('POST', '/api/auth/register', { email, password: 'correct horse' });
  assert.equal(res.status, 201);
  return call;
}

async function readyKit(call, input = { jd: JD, company_url: site.origin + '/', days: 3 }) {
  const created = await call('POST', '/api/kits', input);
  await queue.idle();
  const res = await call('GET', `/api/kits/${created.body.kit.id}`);
  assert.equal(res.body.kit.status, 'ready', JSON.stringify(res.body.kit.error));
  return res.body.kit;
}

describe('auth', () => {
  test('register, me, logout, login', async () => {
    const call = client();
    const email = 'Someone@Test.dev';
    assert.equal(
      (await call('POST', '/api/auth/register', { email, password: 'correct horse' })).status,
      201,
    );
    const me = await call('GET', '/api/auth/me');
    assert.equal(me.body.user.email, 'someone@test.dev');
    assert.equal(me.body.user.passwordHash, undefined);

    assert.equal((await call('POST', '/api/auth/logout')).status, 204);
    assert.equal((await call('GET', '/api/auth/me')).status, 401);

    const login = await call('POST', '/api/auth/login', { email, password: 'correct horse' });
    assert.equal(login.status, 200);
    assert.equal((await call('GET', '/api/auth/me')).status, 200);
  });

  test('rejects a wrong password and a duplicate email', async () => {
    const call = client();
    await call('POST', '/api/auth/register', { email: 'dup@test.dev', password: 'correct horse' });
    const again = await client()('POST', '/api/auth/register', {
      email: 'dup@test.dev',
      password: 'another one',
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'EMAIL_TAKEN');
    const wrong = await client()('POST', '/api/auth/login', {
      email: 'dup@test.dev',
      password: 'nope nope',
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('validates input with field-level messages', async () => {
    const res = await client()('POST', '/api/auth/register', {
      email: 'not-an-email',
      password: 'short',
    });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.details.map((d) => d.path).sort(), ['email', 'password']);
  });

  test('signed-out visitors cannot reach kit endpoints', async () => {
    const res = await client()('GET', '/api/kits');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  });
});

describe('kits', () => {
  test('a kit is generated in the background and can be read when ready', async () => {
    const call = await signedIn();
    const created = await call('POST', '/api/kits', { jd: JD, company_url: site.origin, days: 3 });
    assert.equal(created.status, 202);
    assert.ok(['queued', 'generating'].includes(created.body.kit.status));

    await queue.idle();
    const status = await call('GET', `/api/kits/${created.body.kit.id}/status`);
    assert.equal(status.body.status, 'ready');
    assert.ok(status.body.progress.steps.some((s) => s.step === 'coverage' && s.status === 'done'));

    const kit = (await call('GET', `/api/kits/${created.body.kit.id}`)).body.kit;
    assert.equal(kit.version, 1);
    assert.equal(kit.kit.schedule.days.length, 3);
    assert.equal(kit.input_hash, undefined);

    const list = await call('GET', '/api/kits');
    assert.equal(list.body.kits[0].title, 'Senior Backend Engineer');
  });

  test('the same posting and company is not generated twice', async () => {
    const call = await signedIn();
    const first = await readyKit(call, { jd: JD, company_url: `${site.origin}/`, days: 3 });
    const again = await call('POST', '/api/kits', {
      jd: `  ${JD.toUpperCase()}  `,
      company_url: site.origin,
      days: 5,
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.kit.id, first.id);
    const forced = await call('POST', '/api/kits', {
      jd: JD,
      company_url: site.origin,
      days: 5,
      force: true,
    });
    assert.equal(forced.status, 202);
    assert.notEqual(forced.body.kit.id, first.id);
    await queue.idle();
  });

  test('users only see their own kits', async () => {
    const alice = await signedIn();
    const kit = await readyKit(alice);
    const bob = await signedIn();
    assert.equal((await bob('GET', `/api/kits/${kit.id}`)).status, 404);
    assert.equal(
      (await bob('PATCH', `/api/kits/${kit.id}`, { version: 1, questions: [] })).status,
      404,
    );
    assert.equal((await bob('DELETE', `/api/kits/${kit.id}`)).status, 404);
    assert.deepEqual((await bob('GET', '/api/kits')).body.kits, []);
  });

  test('rejects invalid input with messages the form can show', async () => {
    const call = await signedIn();
    const res = await call('POST', '/api/kits', { jd: '', company_url: 'not a url', days: 0 });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.details.map((d) => d.path).sort(), [
      'company_url',
      'days',
      'jd',
    ]);
  });

  test('adds https:// to a bare domain', async () => {
    const call = await signedIn();
    const res = await call('POST', '/api/kits', {
      jd: 'Engineer\n- Go',
      company_url: 'acme.example',
      days: 2,
    });
    assert.equal(res.body.kit.company_url, 'https://acme.example');
    await queue.idle();
  });

  test('batch creation reports each item separately', async () => {
    const call = await signedIn();
    const res = await call('POST', '/api/kits/batch', {
      items: [
        { jd: 'Engineer\n- Go', company_url: site.origin, days: 2 },
        { jd: '', company_url: site.origin, days: 2 },
      ],
    });
    assert.equal(res.status, 202);
    assert.ok(res.body.results[0].kit.id);
    assert.equal(res.body.results[1].error.code, 'INVALID_ITEM');
    await queue.idle();
  });

  test('a failed generation is recorded and can be retried', async () => {
    const call = await signedIn();
    const original = llm.chatJson;
    llm.chatJson = async () => {
      throw Object.assign(new Error('model down'), { code: 'LLM_UNAVAILABLE' });
    };
    const created = await call('POST', '/api/kits', {
      jd: 'Engineer\n- Rust',
      company_url: site.origin,
      days: 2,
    });
    await queue.idle();
    const failed = await call('GET', `/api/kits/${created.body.kit.id}/status`);
    assert.equal(failed.body.status, 'failed');
    assert.equal(failed.body.error.code, 'LLM_UNAVAILABLE');

    llm.chatJson = original;
    assert.equal((await call('POST', `/api/kits/${created.body.kit.id}/retry`)).status, 202);
    await queue.idle();
    assert.equal(
      (await call('GET', `/api/kits/${created.body.kit.id}/status`)).body.status,
      'ready',
    );
  });
});

describe('editing', () => {
  test('saves edits and bumps the version; a stale version is refused', async () => {
    const call = await signedIn();
    const kit = await readyKit(call);
    const questions = kit.kit.questions.map((q, i) =>
      i === 0 ? { ...q, prompt: 'My own wording?' } : q,
    );

    const saved = await call('PATCH', `/api/kits/${kit.id}`, { version: 1, questions });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.kit.version, 2);
    assert.equal(saved.body.kit.kit.questions[0].edited, true);

    const stale = await call('PATCH', `/api/kits/${kit.id}`, { version: 1, questions });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
    assert.equal(stale.body.error.details.version, 2);
  });

  test('rejects an edit that would break the kit', async () => {
    const call = await signedIn();
    const kit = await readyKit(call);
    const questions = kit.kit.questions.map((q, i) => (i === 0 ? { ...q, prompt: '' } : q));
    const res = await call('PATCH', `/api/kits/${kit.id}`, { version: 1, questions });
    assert.equal(res.status, 400);
  });

  test('regenerating a category keeps edited, pinned and hand-written questions', async () => {
    const call = await signedIn();
    const kit = await readyKit(call);
    const technical = kit.kit.questions.filter((q) => q.category === 'technical');
    assert.ok(technical.length >= 3, `only ${technical.length} technical questions`);
    const [toEdit, toPin] = technical;

    const questions = kit.kit.questions.map((q) => {
      if (q.id === toEdit.id) return { ...q, prompt: 'Edited by hand?' };
      if (q.id === toPin.id) return { ...q, pinned: true };
      return q;
    });
    questions.push({
      id: 'new',
      category: 'technical',
      prompt: 'Written by hand?',
      answer_outline: '',
      difficulty: 2,
      requirement_ids: [],
    });
    const edited = await call('PATCH', `/api/kits/${kit.id}`, { version: 1, questions });
    assert.equal(edited.status, 200);

    const regenerated = await call('POST', `/api/kits/${kit.id}/regenerate`, {
      section: 'questions',
      category: 'technical',
    });
    assert.equal(regenerated.status, 200);
    const after = regenerated.body.kit.kit.questions;
    const prompts = after.map((q) => q.prompt);
    assert.ok(prompts.includes('Edited by hand?'));
    assert.ok(prompts.includes('Written by hand?'));
    assert.ok(after.some((q) => q.id === toPin.id));
    const untouched = technical.slice(2).map((q) => q.id);
    assert.ok(untouched.length > 0);
    for (const id of untouched)
      assert.ok(!after.some((q) => q.id === id), `${id} should be replaced`);
    // Other categories are untouched.
    const behaviouralBefore = kit.kit.questions
      .filter((q) => q.category === 'behavioural')
      .map((q) => q.id);
    for (const id of behaviouralBefore) assert.ok(after.some((q) => q.id === id));
    assert.equal(regenerated.body.kit.version, 3);
  });

  test('regenerates the schedule, optionally over a new number of days', async () => {
    const call = await signedIn();
    const kit = await readyKit(call);
    const res = await call('POST', `/api/kits/${kit.id}/regenerate`, {
      section: 'schedule',
      days: 6,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.kit.kit.schedule.days.length, 6);
  });

  test('a pinned brief is not regenerated', async () => {
    const call = await signedIn();
    const kit = await readyKit(call);
    await call('PATCH', `/api/kits/${kit.id}`, { version: 1, company_brief: { pinned: true } });
    const res = await call('POST', `/api/kits/${kit.id}/regenerate`, { section: 'brief' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PINNED');
  });

  test('regenerates the brief', async () => {
    const call = await signedIn();
    const kit = await readyKit(call);
    const res = await call('POST', `/api/kits/${kit.id}/regenerate`, { section: 'brief' });
    assert.equal(res.status, 200);
    assert.equal(res.body.kit.kit.company_brief.found, true);
  });
});

describe('practice', () => {
  test('records ratings and orders the next session by confidence', async () => {
    const call = await signedIn();
    const kit = await readyKit(call);
    const [first, second] = kit.kit.flashcards;

    const initial = await call('GET', `/api/kits/${kit.id}/practice`);
    assert.equal(initial.body.summary.reviewed, 0);

    await call('POST', `/api/kits/${kit.id}/practice`, { card_id: first.id, rating: 'easy' });
    const res = await call('POST', `/api/kits/${kit.id}/practice`, {
      card_id: second.id,
      rating: 'again',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.summary.reviewed, 2);
    assert.equal(res.body.order[0], second.id);
    assert.equal(res.body.order.at(-1), first.id);

    const bad = await call('POST', `/api/kits/${kit.id}/practice`, {
      card_id: 'f999',
      rating: 'good',
    });
    assert.equal(bad.status, 404);
  });
});

describe('hashInput', () => {
  test('ignores whitespace, case, www and a trailing slash', () => {
    assert.equal(
      hashInput({ jd: 'Engineer\n  Go', company_url: 'https://www.acme.com/' }),
      hashInput({ jd: 'engineer go', company_url: 'https://acme.com' }),
    );
    assert.notEqual(
      hashInput({ jd: 'Engineer Go', company_url: 'https://acme.com' }),
      hashInput({ jd: 'Engineer Rust', company_url: 'https://acme.com' }),
    );
  });
});

describe('errors', () => {
  test('unknown routes and bad JSON get structured errors', async () => {
    const notFound = await client()('GET', '/api/nope');
    assert.equal(notFound.body.error.code, 'NOT_FOUND');
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'INVALID_JSON');
  });
});
