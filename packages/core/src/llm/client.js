// LLM client for any OpenAI-compatible chat-completions endpoint.
//
// Everything that talks to the model goes through chatJson(), which adds:
//   - a requests-per-minute limiter per endpoint, so we slow ourselves down
//     before the provider has to tell us to
//   - retries with exponential backoff on 429 / 5xx / network errors,
//     honouring the provider's Retry-After hint when it sends one
//   - failover to optional fallback models when the primary is overloaded or
//     out of quota; a failed endpoint then cools down so later calls go
//     straight to the fallback instead of re-paying the retries
//   - JSON parsing and schema validation, with one repair attempt that sends
//     the model its broken output and the validation error

import { LLMError } from './errors.js';
import { createRateLimiter } from './rate-limiter.js';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
// Failures another model might not have. Invalid JSON is not one of them.
const FAILOVER_CODES = new Set([
  'LLM_UNAVAILABLE',
  'LLM_RATE_LIMITED',
  'LLM_QUOTA_EXHAUSTED',
  'LLM_MODEL_NOT_FOUND',
  'LLM_AUTH',
]);

/**
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {number} [opts.requestsPerMinute]
 * @param {Array<{ baseUrl?: string, apiKey?: string, model: string, requestsPerMinute?: number }>} [opts.fallbacks]
 *   tried in order when the primary fails; baseUrl and apiKey default to the primary's
 */
export function createLLMClient({
  baseUrl,
  apiKey,
  model,
  requestsPerMinute = 10,
  fallbacks = [],
  maxRetries = 5,
  failoverRetries = 2,
  cooldownMs = 5 * 60_000,
  quotaCooldownMs = 60 * 60_000,
  baseDelayMs = 2000,
  maxDelayMs = 60000,
  timeoutMs = 90000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  onEvent = () => {},
}) {
  const endpoints = [
    { baseUrl, apiKey, model, requestsPerMinute },
    ...fallbacks.map((f) => ({
      baseUrl: f.baseUrl || baseUrl,
      apiKey: f.apiKey || apiKey,
      model: f.model,
      requestsPerMinute: f.requestsPerMinute || requestsPerMinute,
    })),
  ].map((endpoint, index) => {
    checkConfig(endpoint, index === 0 ? 'LLM' : 'LLM_FALLBACK');
    return {
      ...endpoint,
      coolUntil: 0,
      limiter: createRateLimiter({
        requestsPerMinute: endpoint.requestsPerMinute,
        sleep,
        now,
        onWait: (delayMs) => onEvent({ type: 'throttle', model: endpoint.model, delayMs }),
      }),
    };
  });

  // Tries each endpoint in turn: those not cooling down first, in configured order.
  async function complete(messages, { temperature }) {
    const t = now();
    const order = [
      ...endpoints.filter((e) => e.coolUntil <= t),
      ...endpoints.filter((e) => e.coolUntil > t),
    ];
    for (let i = 0; i < order.length; i++) {
      const endpoint = order[i];
      const isLast = i === order.length - 1;
      try {
        return await completeOn(endpoint, messages, {
          temperature,
          retries: isLast ? maxRetries : failoverRetries,
        });
      } catch (err) {
        if (isLast || !FAILOVER_CODES.has(err.code)) throw err;
        endpoint.coolUntil =
          now() + (err.code === 'LLM_QUOTA_EXHAUSTED' ? quotaCooldownMs : cooldownMs);
        onEvent({
          type: 'failover',
          from: endpoint.model,
          to: order[i + 1].model,
          reason: err.code,
        });
      }
    }
    throw new LLMError('LLM_UNAVAILABLE', 'No LLM endpoint available.');
  }

  // One HTTP round trip to one endpoint, retried on transient failures.
  async function completeOn(endpoint, messages, { temperature, retries }) {
    for (let attempt = 0; ; attempt++) {
      await endpoint.limiter.acquire();

      let res;
      try {
        res = await fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${endpoint.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: endpoint.model,
            messages,
            temperature,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // Network failure or timeout: treat like a 503.
        if (attempt >= retries) {
          throw new LLMError('LLM_UNAVAILABLE', `LLM request failed: ${err.message}`, {
            cause: err,
          });
        }
        const delayMs = backoffDelay(attempt, null);
        onEvent({
          type: 'retry',
          model: endpoint.model,
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
      const details = { status: res.status, body: body.slice(0, 500) };
      if (res.status === 429 && isDailyQuota(body)) {
        // Waiting minutes will not bring back a daily quota.
        throw new LLMError(
          'LLM_QUOTA_EXHAUSTED',
          `Daily quota for ${endpoint.model} is used up.`,
          details,
        );
      }
      if (!RETRYABLE_STATUS.has(res.status)) {
        throw new LLMError(
          errorCodeFor(res.status),
          `LLM request to ${endpoint.model} failed with HTTP ${res.status}.`,
          details,
        );
      }
      if (attempt >= retries) {
        throw new LLMError(
          res.status === 429 ? 'LLM_RATE_LIMITED' : 'LLM_UNAVAILABLE',
          `${endpoint.model} still failing with HTTP ${res.status} after ${retries} retries.`,
          details,
        );
      }
      const delayMs = backoffDelay(attempt, retryAfterMs(res, body));
      onEvent({
        type: 'retry',
        model: endpoint.model,
        reason: `HTTP ${res.status}`,
        attempt: attempt + 1,
        delayMs,
      });
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

  return { chatJson, model, models: endpoints.map((e) => e.model) };
}

export function createLLMClientFromEnv(env = process.env, overrides = {}) {
  const fallbacks = env.LLM_FALLBACK_MODEL
    ? [
        {
          baseUrl: env.LLM_FALLBACK_BASE_URL,
          apiKey: env.LLM_FALLBACK_API_KEY,
          model: env.LLM_FALLBACK_MODEL,
          requestsPerMinute: Number(env.LLM_FALLBACK_REQUESTS_PER_MINUTE) || undefined,
        },
      ]
    : [];
  return createLLMClient({
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
    requestsPerMinute: Number(env.LLM_REQUESTS_PER_MINUTE) || undefined,
    fallbacks,
    ...overrides,
  });
}

function checkConfig({ baseUrl, apiKey, model }, prefix) {
  if (!baseUrl || !apiKey || !model) {
    throw new LLMError(
      'LLM_CONFIG',
      prefix === 'LLM'
        ? 'LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must all be set.'
        : 'LLM_FALLBACK_MODEL is set but no base URL or API key is available for it.',
    );
  }
  // A malformed base URL would otherwise surface as a "network error" and be retried.
  if (!URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol)) {
    throw new LLMError('LLM_CONFIG', `${prefix}_BASE_URL is not a valid http(s) URL: ${baseUrl}`);
  }
}

// Gemini reports quota ids like "GenerateRequestsPerDayPerProjectPerModel-FreeTier".
function isDailyQuota(body) {
  return /per ?day|daily/i.test(body);
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
