import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createLLMClient, parseAndValidate } from '../src/llm/client.js';

// A fake fetch that plays back scripted responses and records the requests.
function scriptedFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error('fake fetch: no more scripted responses');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

const reply = (content) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const failure = (status, body = '{}', headers = {}) => new Response(body, { status, headers });

function makeClient(responses, overrides = {}) {
  const { fetchImpl, calls } = scriptedFetch(responses);
  const sleeps = [];
  const client = createLLMClient({
    baseUrl: 'https://llm.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    requestsPerMinute: 1000,
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
    ...overrides,
  });
  return { client, calls, sleeps };
}

const schema = z.object({ answer: z.number() });

test('returns parsed JSON on success', async () => {
  const { client, calls } = makeClient([reply('{"answer": 42}')]);
  assert.deepEqual(await client.chatJson({ system: 's', user: 'u', schema }), { answer: 42 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://llm.test/v1/chat/completions');
  assert.equal(calls[0].body.model, 'test-model');
});

test('retries a 503 and then succeeds', async () => {
  const { client, calls, sleeps } = makeClient([
    failure(503),
    failure(503),
    reply('{"answer": 1}'),
  ]);
  assert.deepEqual(await client.chatJson({ system: 's', user: 'u', schema }), { answer: 1 });
  assert.equal(calls.length, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1] > sleeps[0], 'backoff should grow between attempts');
});

test('retries network errors', async () => {
  const { client } = makeClient([new TypeError('fetch failed'), reply('{"answer": 2}')]);
  assert.deepEqual(await client.chatJson({ system: 's', user: 'u', schema }), { answer: 2 });
});

test('waits at least as long as the Retry-After header asks', async () => {
  const { client, sleeps } = makeClient([
    failure(429, '{}', { 'retry-after': '20' }),
    reply('{"answer": 3}'),
  ]);
  await client.chatJson({ system: 's', user: 'u', schema });
  assert.ok(sleeps[0] >= 20000, `slept ${sleeps[0]}ms, expected >= 20000`);
});

test("honours Gemini's retryDelay in the error body", async () => {
  const body = JSON.stringify([{ error: { details: [{ retryDelay: '31s' }] } }]);
  const { client, sleeps } = makeClient([failure(429, body), reply('{"answer": 4}')]);
  await client.chatJson({ system: 's', user: 'u', schema });
  assert.ok(sleeps[0] >= 31000, `slept ${sleeps[0]}ms, expected >= 31000`);
});

test('gives up after maxRetries with LLM_RATE_LIMITED', async () => {
  const { client, calls } = makeClient([failure(429), failure(429), failure(429)], {
    maxRetries: 2,
  });
  await assert.rejects(client.chatJson({ system: 's', user: 'u', schema }), {
    code: 'LLM_RATE_LIMITED',
  });
  assert.equal(calls.length, 3);
});

test('does not retry errors that will never succeed', async () => {
  const { client, calls } = makeClient([failure(404), reply('{"answer": 5}')]);
  await assert.rejects(client.chatJson({ system: 's', user: 'u', schema }), {
    code: 'LLM_MODEL_NOT_FOUND',
  });
  assert.equal(calls.length, 1);
});

test('repairs invalid JSON with one follow-up request', async () => {
  const { client, calls } = makeClient([reply('{"answer": oops}'), reply('{"answer": 6}')]);
  assert.deepEqual(await client.chatJson({ system: 's', user: 'u', schema }), { answer: 6 });
  const repairMessages = calls[1].body.messages;
  assert.equal(repairMessages.at(-2).role, 'assistant');
  assert.match(repairMessages.at(-1).content, /not valid JSON/);
});

test('repairs JSON that has the wrong shape', async () => {
  const { client, calls } = makeClient([reply('{"answer": "six"}'), reply('{"answer": 6}')]);
  assert.deepEqual(await client.chatJson({ system: 's', user: 'u', schema }), { answer: 6 });
  assert.match(calls[1].body.messages.at(-1).content, /answer: /);
});

test('fails with LLM_INVALID_JSON when the repair is also invalid', async () => {
  const { client } = makeClient([reply('nope'), reply('still nope')]);
  await assert.rejects(client.chatJson({ system: 's', user: 'u', schema }), {
    code: 'LLM_INVALID_JSON',
  });
});

test('rejects missing or malformed configuration up front', () => {
  assert.throws(() => createLLMClient({ baseUrl: '', apiKey: 'k', model: 'm' }), {
    code: 'LLM_CONFIG',
  });
  assert.throws(() => createLLMClient({ baseUrl: 'not a url', apiKey: 'k', model: 'm' }), {
    code: 'LLM_CONFIG',
  });
});

test('parseAndValidate strips a ```json fence', () => {
  assert.deepEqual(parseAndValidate('```json\n{"answer": 7}\n```', schema), {
    ok: true,
    value: { answer: 7 },
  });
});

test('rate limiter spaces out requests beyond the per-minute budget', async () => {
  let clock = 0;
  const { client, sleeps } = makeClient([reply('{"answer": 1}'), reply('{"answer": 2}')], {
    requestsPerMinute: 1,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  await client.chatJson({ system: 's', user: 'u', schema });
  await client.chatJson({ system: 's', user: 'u', schema });
  assert.deepEqual(sleeps, [60000]);
});

test('reports retries and throttling through onEvent', async () => {
  const events = [];
  let clock = 0;
  const { client } = makeClient([failure(503), reply('{"answer": 1}'), reply('{"answer": 2}')], {
    requestsPerMinute: 2,
    onEvent: (e) => events.push(e.type),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  await client.chatJson({ system: 's', user: 'u', schema });
  await client.chatJson({ system: 's', user: 'u', schema });
  assert.deepEqual(events, ['retry', 'throttle']);
});
