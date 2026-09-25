// Fetches one page from the open web, defensively:
//   - every URL, including every redirect hop, passes validateUrl()
//   - per-host politeness delay, so we never hammer a site
//   - timeout, size cap and content-type allow-list
//   - retries with backoff on 429 / 5xx / network errors, never on 4xx
// Failures are thrown as FetchError with a stable code.

import { FetchError } from './errors.js';
import { validateUrl } from './url-safety.js';

export const HTML_TYPES = ['text/html', 'application/xhtml+xml'];
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function createFetcher({
  allowPrivate = false,
  userAgent = 'InterviewForgeBot/0.1 (+https://github.com/Abhaverma2010/InterviewForge)',
  timeoutMs = 10_000,
  maxBytes = 2_000_000,
  maxRedirects = 5,
  retries = 2,
  minIntervalMs = 500,
  fetchImpl = fetch,
  lookupImpl,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  const nextSlotByHost = new Map();

  // Reserve the next request slot for this host and wait for it.
  async function politeWait(host) {
    const t = now();
    const slot = Math.max(t, nextSlotByHost.get(host) ?? 0);
    nextSlotByHost.set(host, slot + minIntervalMs);
    if (slot > t) await sleep(slot - t);
  }

  /**
   * @param {string | URL} input
   * @param {object} [opts]
   * @param {string[]} [opts.accept]  allowed content types
   * @returns {Promise<{ url: string, status: number, contentType: string, body: string }>}
   */
  async function fetchText(input, { accept = HTML_TYPES } = {}) {
    let url = await validateUrl(input, { allowPrivate, lookupImpl });

    for (let hop = 0; ; hop++) {
      const res = await requestWithRetries(url);

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel();
        if (hop >= maxRedirects) {
          throw new FetchError('TOO_MANY_REDIRECTS', `More than ${maxRedirects} redirects.`, {
            url: url.href,
          });
        }
        // Re-validate: a public page could redirect us to a private address.
        url = await validateUrl(new URL(res.headers.get('location'), url), {
          allowPrivate,
          lookupImpl,
        });
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel();
        const code = res.status === 404 || res.status === 410 ? 'NOT_FOUND' : 'HTTP_ERROR';
        throw new FetchError(code, `HTTP ${res.status} from ${url.href}`, {
          url: url.href,
          status: res.status,
        });
      }

      const contentType = (res.headers.get('content-type') ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (contentType && !accept.includes(contentType)) {
        await res.body?.cancel();
        throw new FetchError('UNSUPPORTED_CONTENT_TYPE', `Skipped ${contentType} content.`, {
          url: url.href,
          status: res.status,
        });
      }

      const body = await readCapped(res, url);
      return { url: url.href, status: res.status, contentType, body };
    }
  }

  async function requestWithRetries(url) {
    for (let attempt = 0; ; attempt++) {
      await politeWait(url.host);
      let res;
      try {
        res = await fetchImpl(url, {
          redirect: 'manual', // we follow redirects ourselves so each hop is validated
          headers: {
            'User-Agent': userAgent,
            Accept: 'text/html,application/xhtml+xml,text/plain',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
        if (attempt < retries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new FetchError(
          timedOut ? 'TIMEOUT' : 'NETWORK',
          timedOut
            ? `Timed out after ${timeoutMs}ms: ${url.href}`
            : `Could not connect to ${url.host}: ${err.cause?.code ?? err.message}`,
          { url: url.href, cause: err },
        );
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        await res.body?.cancel();
        const retryAfter = Number(res.headers.get('retry-after'));
        const hint = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
        await sleep(Math.min(10_000, Math.max(backoff(attempt), hint)));
        continue;
      }
      return res;
    }
  }

  async function readCapped(res, url) {
    const declared = Number(res.headers.get('content-length'));
    if (declared > maxBytes) {
      await res.body?.cancel();
      throw tooLarge(url);
    }
    if (!res.body) return '';

    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw tooLarge(url);
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  }

  function tooLarge(url) {
    return new FetchError('TOO_LARGE', `Page larger than ${maxBytes} bytes: ${url.href}`, {
      url: url.href,
    });
  }

  return { fetchText, userAgent };
}

// 1s, 2s, 4s...
function backoff(attempt) {
  return 1000 * 2 ** attempt;
}
