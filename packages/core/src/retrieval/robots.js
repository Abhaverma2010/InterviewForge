// robots.txt support: sites list paths that bots should not visit, and we obey.
//
// Rules are grouped by User-agent. We use the group naming our bot if there is
// one, otherwise the "*" group. Within a group the longest matching rule wins,
// and Allow beats Disallow on a tie (RFC 9309).

import { FetchError } from './errors.js';

const MAX_CRAWL_DELAY_MS = 5000;

/**
 * @param {string} text  contents of robots.txt
 * @param {string} userAgent  our full User-Agent string
 */
export function parseRobots(text, userAgent) {
  const token = userAgent.split('/')[0].toLowerCase(); // "interviewforgebot"
  const groups = [];
  let current = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group.
      if (!lastWasAgent) {
        current = { agents: [], rules: [], crawlDelayMs: 0 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;

    if (field === 'allow' || field === 'disallow') {
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) current.crawlDelayMs = seconds * 1000;
    }
  }

  const group =
    groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a))) ??
    groups.find((g) => g.agents.includes('*'));
  const rules = group?.rules ?? [];

  return {
    crawlDelayMs: Math.min(group?.crawlDelayMs ?? 0, MAX_CRAWL_DELAY_MS),
    /** @param {string} path  path plus query, e.g. "/jobs?team=eng" */
    isAllowed(path) {
      let best = null;
      for (const rule of rules) {
        if (!matches(rule.pattern, path)) continue;
        const better =
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow);
        if (better) best = rule;
      }
      return best ? best.allow : true;
    },
  };
}

// Supports the two robots.txt wildcards: * (anything) and $ (end of path).
function matches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${regex}${anchored ? '$' : ''}`).test(path);
}

const ALLOW_ALL = { crawlDelayMs: 0, isAllowed: () => true };

/**
 * Fetches and caches robots.txt per origin.
 * A missing or unreadable robots.txt means no restrictions, which is the
 * standard behaviour for a 4xx. If the whole site is down, the page fetch
 * will fail on its own and be reported there.
 */
export function createRobotsCache(fetcher) {
  const cache = new Map();

  async function load(origin) {
    try {
      const res = await fetcher.fetchText(new URL('/robots.txt', origin), {
        accept: ['text/plain'],
      });
      return parseRobots(res.body, fetcher.userAgent);
    } catch (err) {
      if (err instanceof FetchError) return ALLOW_ALL;
      throw err;
    }
  }

  return {
    /** @param {URL} url */
    async forUrl(url) {
      if (!cache.has(url.origin)) cache.set(url.origin, load(url.origin));
      return cache.get(url.origin);
    },
  };
}
