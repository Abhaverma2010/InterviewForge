// Ranks links by how likely they are to lead to a hiring or about page.
//
// We can't hard-code paths: companies put hiring information under /careers,
// /jobs, /handbook/hiring, /company/people/interviewing and so on. So each
// link is scored on the words in its path and its anchor text. The crawler
// fetches the best-scoring links first.

const RULES = [
  // Hiring process: what we most want to find.
  {
    kind: 'hiring',
    weight: 14,
    pattern:
      /\b(how we (hire|interview)|hiring process|interview(ing)? process|recruitment process|interview guide)\b/,
  },
  { kind: 'hiring', weight: 10, pattern: /\b(interview|interviews|interviewing)\b/ },
  { kind: 'hiring', weight: 8, pattern: /\b(hiring|recruit|recruiting|recruitment)\b/ },
  {
    kind: 'hiring',
    weight: 10,
    pattern:
      /\b(careers?|jobs?|join( us| the team)?|work with us|working (at|here)|open (roles|positions))\b/,
  },
  { kind: 'hiring', weight: 5, pattern: /\b(handbook|people|talent|candidates?)\b/ },
  // About the company.
  { kind: 'about', weight: 8, pattern: /\b(about( us)?|who we are|what we do|our story)\b/ },
  { kind: 'about', weight: 5, pattern: /\b(company|mission|values|culture|manifesto)\b/ },
  {
    kind: 'about',
    weight: 3,
    pattern: /\b(engineering|team|product|products|customers|platform)\b/,
  },
];

// Pages that are never useful and often endless.
const USELESS =
  /\b(log ?in|sign ?(in|up)|regist(er|ers|ration|rations)|trials?|demo|contact sales|download|account|privacy|terms|legal|cookies?|gdpr|pricing|cart|checkout|status|press kit|unsubscribe)\b/;
// Below this, hiring words are too weak ("handbook", "people") to call a link a hiring link.
const STRONG_HIRING = 8;
// Individual blog posts, tag pages and pagination dilute the crawl.
const LOW_VALUE = /\b(blog|news|posts?|tags?|category|page \d+|events?|webinars?)\b/;

/**
 * @param {{ url: string, text: string }} link
 * @param {object} [opts]
 * @param {string} [opts.pathPrefix]  directory the crawl started in, e.g. "/acme/"
 * @returns {{ score: number, kind: 'hiring' | 'about' | null }}
 */
export function scoreLink(link, { pathPrefix = '/' } = {}) {
  const url = new URL(link.url);
  // Only the path: query strings are mostly tracking (?utm_source=...jobs) and mislead.
  const pathWords = words(decodeSafe(url.pathname));
  const textWords = words(link.text);
  const haystack = `${pathWords} ${textWords}`;

  const totals = { hiring: 0, about: 0 };
  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) totals[rule.kind] += rule.weight;
  }

  let score = totals.hiring + totals.about;
  if (USELESS.test(haystack)) score -= 20;
  if (LOW_VALUE.test(pathWords) && totals.hiring === 0) score -= 4;

  // Prefer shallow pages: /careers over /blog/2023/05/some-post.
  const depth = url.pathname.split('/').filter(Boolean).length;
  score -= Math.max(0, depth - 3);

  // A crawl that starts at /acme/ should stay under /acme/ when it can: on a
  // shared host, pages outside that prefix may belong to someone else.
  if (!url.pathname.startsWith(pathPrefix)) score -= 4;

  let kind = null;
  if (totals.hiring >= STRONG_HIRING && totals.hiring >= totals.about) kind = 'hiring';
  else if (totals.about > 0) kind = 'about';
  return { score, kind };
}

/**
 * Whether the text of a fetched page describes how the company hires. Used
 * when a page reached through an innocent link ("Company") turns out to hold
 * the interview process.
 */
export function looksLikeHiringProcess(text) {
  return hiringSignalCount(text) >= 2;
}

/** How many distinct hiring-process signals a page's text contains. */
export function hiringSignalCount(text) {
  return HIRING_SIGNALS.filter((signal) => signal.test(text)).length;
}

const HIRING_SIGNALS = [
  /interview (process|stages?|rounds?|loop)/i,
  /\b(technical|coding|system design|behaviou?ral|onsite|on-site|final|phone|screening) (interview|round|screen)/i,
  /\btake[- ]home\b/i,
  /\b(hiring|recruitment|recruiting) process\b/i,
  /\bhow we (hire|interview)\b/i,
  /\b(recruiter|hiring manager) (call|screen|chat|interview)\b/i,
  /\b(pair programming|code review|technical) (exercise|task|challenge|session)\b/i,
];

// "/company/how-we_hire" → "company how we hire"
function words(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function decodeSafe(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
