// Looks for public discussion of how a company interviews.
//
// Source: the Hacker News search API run by Algolia (hn.algolia.com). It is a
// public API meant for programmatic use, so no scraping and no key. Sites like
// Glassdoor and Reddit are deliberately not used: their terms forbid
// automated access without an agreement.
//
// Everything returned here is untrusted text written by strangers. It is
// passed on as quoted material for the model to weigh, never as instructions.
// Finding nothing is a normal result, not an error.

import * as cheerio from 'cheerio';
import { FetchError } from './errors.js';

const HN_SEARCH = 'https://hn.algolia.com/api/v1/search';
const INTERVIEW_WORDS =
  /\b(interview(s|ed|ing|er)?|hiring|recruit(er|ing|ment)?|take[- ]home|onsite|on-site|offer|leetcode|coding (test|challenge|exercise)|system design)\b/i;
// Phrases that are clearly about a candidate's hiring experience. A hit needs
// at least one; results are ranked by how many distinct ones they contain.
const HIRING_EXPERIENCE = [
  /\binterview(ed|ing)? (at|with|for)\b/i,
  /\b(interview|hiring) (process|loop|stages?|rounds?)\b/i,
  /\b(technical|coding|system design|behaviou?ral|final|phone|onsite|on-site) (interview|round|screen)\b/i,
  /\b(take[- ]home|work trial|trial (work )?day|super ?day|paid trial)\b/i,
  /\b(recruiter|hiring manager)\b/i,
  /\b(got|received|accepted|declined|rejected) (an |the )?offer\b|\brejection\b/i,
  /\b(leetcode|coding (test|challenge|exercise)|pair programming)\b/i,
];
// "User interviews" and friends are product research, not hiring.
const NOT_HIRING = /\b(user|customer|podcast|press|media|founder) interviews?\b/gi;

/**
 * @typedef {object} DiscussionResult
 * @property {string} query
 * @property {string} source
 * @property {Array<{ url: string, title: string, excerpt: string, date: string }>} results
 * @property {{ code: string, message: string } | null} error  set when the search itself failed
 */

/**
 * @param {string} companyName
 * @param {object} deps
 * @param {ReturnType<import('./fetcher.js').createFetcher>} deps.fetcher
 * @param {object} [opts]
 * @param {number} [opts.maxResults]
 * @returns {Promise<DiscussionResult>}
 */
export async function searchPublicDiscussion(companyName, { fetcher }, { maxResults = 8 } = {}) {
  const query = `${companyName} interview`;
  const result = { query, source: 'Hacker News (hn.algolia.com)', results: [], error: null };

  const url = new URL(HN_SEARCH);
  url.searchParams.set('query', query);
  url.searchParams.set('tags', '(story,comment)');
  url.searchParams.set('hitsPerPage', '40');

  let data;
  try {
    const res = await fetcher.fetchText(url, { accept: ['application/json'] });
    data = JSON.parse(res.body);
  } catch (err) {
    if (err instanceof FetchError) {
      result.error = { code: err.code, message: err.message };
      return result;
    }
    if (err instanceof SyntaxError) {
      result.error = { code: 'BAD_RESPONSE', message: 'Search API returned invalid JSON.' };
      return result;
    }
    throw err;
  }

  // Algolia matches loosely; keep only hits that name the company AND describe
  // a hiring experience, so "Stripe" doesn't return every post about stripes
  // and "user interviews" doesn't count. Best-matching first.
  const seen = new Set();
  const scored = [];
  for (const hit of data?.hits ?? []) {
    const item = toResult(hit);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    const haystack = `${item.title} ${item.fullText}`.replace(NOT_HIRING, ' ');
    if (!mentions(haystack, companyName)) continue;
    const relevance = HIRING_EXPERIENCE.filter((p) => p.test(haystack)).length;
    if (relevance === 0) continue;
    const { fullText, ...rest } = item;
    scored.push({ ...rest, relevance });
  }
  scored.sort((a, b) => b.relevance - a.relevance);
  result.results = scored.slice(0, maxResults).map(({ relevance, ...rest }) => rest);
  return result;
}

function toResult(hit) {
  if (!hit?.objectID) return null;
  const body = htmlToText(hit.comment_text ?? hit.story_text ?? '');
  return {
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    title: hit.title ?? hit.story_title ?? '',
    excerpt: excerptAround(body, INTERVIEW_WORDS, 600),
    fullText: body,
    date: hit.created_at ?? '',
  };
}

function htmlToText(html) {
  return cheerio.load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

function mentions(text, companyName) {
  const escaped = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

// Up to `length` characters centred on the first match, so long comments are
// cut down to the part about interviewing.
export function excerptAround(text, pattern, length) {
  if (text.length <= length) return text;
  const index = Math.max(0, text.search(pattern));
  const start = Math.max(0, Math.min(index - length / 3, text.length - length));
  const slice = text.slice(start, start + length).trim();
  return `${start > 0 ? '…' : ''}${slice}${start + length < text.length ? '…' : ''}`;
}
