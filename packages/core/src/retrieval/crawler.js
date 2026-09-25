// Crawls a company website to find what the company does and how it hires.
//
// Best-first search: fetch the homepage, score every link on it, then keep
// fetching the highest-scoring link we haven't visited yet, adding the links
// found on each new page, until we hit the page budget or run out of
// promising links. Nothing here throws for an unreachable site or a broken
// link: failures are recorded and returned so the kit can report them.

import { extractLinks, extractPageContent } from './extract.js';
import { FetchError } from './errors.js';
import { looksLikeHiringProcess, scoreLink } from './link-scoring.js';

/**
 * @typedef {object} CrawledPage
 * @property {string} url
 * @property {'home' | 'hiring' | 'about' | 'other'} kind
 * @property {number} depth  clicks from the homepage
 * @property {string} title
 * @property {string} description
 * @property {string} text
 *
 * @typedef {object} CrawlResult
 * @property {string} startUrl
 * @property {boolean} reachable  false when even the homepage failed
 * @property {{ code: string, message: string } | null} error  why it was unreachable
 * @property {CrawledPage[]} pages
 * @property {Array<{ url: string, code: string, message: string }>} skipped
 * @property {string | null} hiringPage  best hiring-process page found, if any
 * @property {string | null} aboutPage
 */

/**
 * @param {string} startUrl
 * @param {object} deps
 * @param {ReturnType<import('./fetcher.js').createFetcher>} deps.fetcher
 * @param {ReturnType<import('./robots.js').createRobotsCache>} deps.robots
 * @param {object} [opts]
 * @param {number} [opts.maxPages]  total pages to fetch, homepage included
 * @param {number} [opts.maxDepth]  clicks away from the homepage
 * @param {number} [opts.minScore]  links scoring below this are not followed
 * @param {(event: object) => void} [opts.onEvent]  progress reporting
 * @returns {Promise<CrawlResult>}
 */
export async function crawlCompany(
  startUrl,
  { fetcher, robots, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) },
  { maxPages = 8, maxDepth = 2, minScore = 3, onEvent = () => {} } = {},
) {
  const result = {
    startUrl,
    reachable: false,
    error: null,
    pages: [],
    skipped: [],
    hiringPage: null,
    aboutPage: null,
  };

  let start;
  try {
    start = new URL(startUrl);
  } catch {
    result.error = { code: 'INVALID_URL', message: `Not a valid URL: ${startUrl}` };
    return result;
  }
  // The directory the crawl started in: "/acme/" for http://host/acme/ or /acme/index.html.
  const pathPrefix = start.pathname.slice(0, start.pathname.lastIndexOf('/') + 1);

  const seen = new Set();
  const frontier = []; // candidate links, not yet fetched

  const home = await visit({ url: start.href, kind: 'home', depth: 0, score: Infinity });
  if (!home) {
    const failure = result.skipped[0];
    result.error = failure
      ? { code: failure.code, message: failure.message }
      : { code: 'NETWORK', message: 'Homepage could not be fetched.' };
    return result;
  }
  result.reachable = true;

  while (result.pages.length < maxPages && frontier.length) {
    // Highest score first; on a tie, the shallower page.
    frontier.sort((a, b) => b.score - a.score || a.depth - b.depth);
    await visit(frontier.shift());
  }

  result.hiringPage = result.pages.find((p) => p.kind === 'hiring')?.url ?? null;
  result.aboutPage = result.pages.find((p) => p.kind === 'about')?.url ?? null;
  return result;

  // Fetches one candidate and queues its links. Returns the page, or null.
  async function visit(candidate) {
    const url = new URL(candidate.url);
    seen.add(url.href);

    const rules = await robots.forUrl(url);
    if (!rules.isAllowed(url.pathname + url.search)) {
      skip(url.href, 'ROBOTS_DISALLOWED', 'robots.txt asks bots not to fetch this page.');
      return null;
    }
    if (rules.crawlDelayMs && result.pages.length) await sleep(rules.crawlDelayMs);

    onEvent({ type: 'fetch', url: url.href });
    let response;
    try {
      response = await fetcher.fetchText(url);
    } catch (err) {
      if (!(err instanceof FetchError)) throw err;
      skip(url.href, err.code, err.message);
      return null;
    }

    // Redirects can land on a page we already have.
    if (response.url !== url.href) {
      if (seen.has(response.url)) return null;
      seen.add(response.url);
    }

    const content = extractPageContent(response.body);
    let kind = candidate.kind ?? 'other';
    if (kind !== 'home' && looksLikeHiringProcess(content.text)) kind = 'hiring';

    const page = { url: response.url, kind, depth: candidate.depth, ...content };
    result.pages.push(page);
    onEvent({ type: 'page', url: page.url, kind });

    if (candidate.depth < maxDepth) queueLinks(response.body, response.url, candidate.depth + 1);
    return page;
  }

  function queueLinks(html, pageUrl, depth) {
    for (const link of extractLinks(html, pageUrl)) {
      if (seen.has(link.url) || !isSameSite(new URL(link.url), start)) continue;
      const { score, kind } = scoreLink(link, { pathPrefix });
      if (score < minScore) continue;

      const queued = frontier.find((c) => c.url === link.url);
      if (queued) {
        queued.score = Math.max(queued.score, score);
        continue;
      }
      frontier.push({ url: link.url, kind: kind ?? 'other', depth, score });
    }
  }

  function skip(url, code, message) {
    result.skipped.push({ url, code, message });
    onEvent({ type: 'skipped', url, code });
  }
}

/**
 * Same company site: same host (ignoring "www."), or a sibling subdomain of
 * the same registrable domain, e.g. about.gitlab.com and handbook.gitlab.com.
 * IP addresses and localhost must match exactly, port included.
 */
export function isSameSite(url, start) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^www\./, '');
  const startHost = start.hostname.replace(/^www\./, '');
  if (isIpOrLocal(startHost)) return url.host === start.host;
  return host === startHost || registrableDomain(host) === registrableDomain(startHost);
}

function isIpOrLocal(host) {
  return (
    host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')
  );
}

// Approximation of the public-suffix rules: last two labels, or three for
// common two-part suffixes like co.uk and com.au.
function registrableDomain(host) {
  const labels = host.split('.');
  const twoPartSuffix =
    /^(co|com|org|net|ac|gov|edu)$/.test(labels.at(-2) ?? '') && labels.at(-1).length === 2;
  return labels.slice(twoPartSuffix ? -3 : -2).join('.');
}
