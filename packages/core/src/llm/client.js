// LLM client for any OpenAI-compatible chat-completions endpoint.
//
// Everything that talks to the model goes through chatJson(), which adds:
//   - a requests-per-minute limiter, so we slow ourselves down before the
//     provider has to tell us to
//   - retries with exponential backoff on 429 / 5xx / network errors,
//     honouring the provider's Retry-After hint when it sends one
//   - JSON parsing and schema validation, with one repair attempt that sends
//     the model its broken output and the validation error

import { LLMError } from './errors.js';
import { createRateLimiter } from './rate-limiter.js';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function createLLMClient({
  baseUrl,
  apiKey,
  model,
  requestsPerMinute = 10,
  maxRetries = 5,
  baseDelayMs = 2000,
  maxDelayMs = 60000,
  timeoutMs = 90000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  onEvent = () => {},
}) {
  if (!baseUrl || !apiKey || !model) {
    throw new LLMError('LLM_CONFIG', 'LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must all be set.');
  }
  // A malformed base URL would otherwise surface as a "network error" and be retried.
  if (!URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol)) {
    throw new LLMError('LLM_CONFIG', `LLM_BASE_URL is not a valid http(s) URL: ${baseUrl}`);
  }

  const limiter = createRateLimiter({
    requestsPerMinute,
    sleep,
    now,
    onWait: (delayMs) => onEvent({ type: 'throttle', delayMs }),
  });

  // One HTTP round trip, retried on transient failures. Returns the reply text.
  async function complete(messages, { temperature }) {
    for (let attempt = 0; ; attempt++) {
      await limiter.acquire();

      let res;
      try {
        res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // Network failure or timeout: treat like a 503.
        if (attempt >= maxRetries) {
          throw new LLMError('LLM_UNAVAILABLE', `LLM request failed: ${err.message}`, {
            cause: err,
          });
        }
        const delayMs = backoffDelay(attempt, null);
        onEvent({
          type: 'retry',
          reason: err.name === 'TimeoutError' ? 'timeout' : 'network error',
          attempt: attempt + 1,
          delayMs,
        });
        await sleep(delayMs);
        continue;
      }

      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== 'string') {
          throw new LLMError('LLM_BAD_RESPONSE', 'LLM response had no message content.');
        }
        return text;
      }

      const body = await res.text();
      if (!RETRYABLE_STATUS.has(res.status)) {
        throw new LLMError(
          errorCodeFor(res.status),
          `LLM request failed with HTTP ${res.status}.`,
          {
            status: res.status,
            body: body.slice(0, 500),
          },
        );
      }
      if (attempt >= maxRetries) {
        throw new LLMError(
          res.status === 429 ? 'LLM_RATE_LIMITED' : 'LLM_UNAVAILABLE',
          `LLM still failing with HTTP ${res.status} after ${maxRetries} retries.`,
          { status: res.status, body: body.slice(0, 500) },
        );
      }
      const delayMs = backoffDelay(attempt, retryAfterMs(res, body));
      onEvent({ type: 'retry', reason: `HTTP ${res.status}`, attempt: attempt + 1, delayMs });
      await sleep(delayMs);
    }
  }

  // Exponential backoff with jitter: ~2s, 4s, 8s, 16s... capped at maxDelayMs.
  // If the provider told us how long to wait, wait at least that long.
  function backoffDelay(attempt, hintMs) {
    const exponential = baseDelayMs * 2 ** attempt;
    const jitter = Math.random() * baseDelayMs;
    return Math.min(maxDelayMs, Math.max(exponential + jitter, hintMs ?? 0));
  }

  /**
   * Asks the model for a JSON object and returns it parsed and validated.
   *
   * @param {object} opts
   * @param {string} opts.system   rules for the model
   * @param {string} opts.user     the task input
   * @param {import('zod').ZodTypeAny} [opts.schema]  validates the parsed JSON
   * @param {number} [opts.temperature]
   */
  async function chatJson({ system, user, schema, temperature = 0.2 }) {
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    const first = await complete(messages, { temperature });
    const firstResult = parseAndValidate(first, schema);
    if (firstResult.ok) return firstResult.value;

    // One repair attempt: show the model what it sent and what was wrong.
    const repaired = await complete(
      [
        ...messages,
        { role: 'assistant', content: first },
        {
          role: 'user',
          content:
            `Your previous reply was not valid: ${firstResult.error}\n` +
            'Reply again with only the corrected JSON object.',
        },
      ],
      { temperature: 0 },
    );
    const secondResult = parseAndValidate(repaired, schema);
    if (secondResult.ok) return secondResult.value;

    throw new LLMError(
      'LLM_INVALID_JSON',
      `LLM returned invalid output twice: ${secondResult.error}`,
    );
  }

  return { chatJson, model };
}

export function createLLMClientFromEnv(env = process.env, overrides = {}) {
  return createLLMClient({
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
    requestsPerMinute: Number(env.LLM_REQUESTS_PER_MINUTE) || undefined,
    ...overrides,
  });
}

// Exported for tests.
export function parseAndValidate(text, schema) {
  let value;
  try {
    value = JSON.parse(stripCodeFence(text));
  } catch (err) {
    return { ok: false, error: `not valid JSON (${err.message})` };
  }
  if (!schema) return { ok: true, value };

  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false, error: `JSON did not match the expected shape (${issues})` };
}

// Models sometimes wrap JSON in ```json ... ``` even in JSON mode.
function stripCodeFence(text) {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

// How long the provider asked us to wait, in ms, or null.
// Standard Retry-After header (seconds), or Gemini's "retryDelay": "17s" in the body.
function retryAfterMs(res, body) {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const match = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return match ? Number(match[1]) * 1000 : null;
}

function errorCodeFor(status) {
  if (status === 401 || status === 403) return 'LLM_AUTH';
  if (status === 404) return 'LLM_MODEL_NOT_FOUND';
  return 'LLM_REQUEST_REJECTED';
}
