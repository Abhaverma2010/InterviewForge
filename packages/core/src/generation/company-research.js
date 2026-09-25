// Turns what the crawler and discussion search found into two things:
//   - the company brief (what they do), from the homepage and about pages
//   - the hiring process (interview stages), from the hiring page and public
//     discussion
//
// Each is a separate step that only runs when there is material for it. With
// nothing found, no model call is made and the result says so plainly: an
// honest "we couldn't find this" beats a fabricated brief.

import { z } from 'zod';
import { UNTRUSTED_RULES, clip, wrapUntrusted } from './untrusted.js';

const PAGE_BUDGET = { hiring: 7000, about: 3500, home: 3000, other: 2000 };
const DISCUSSION_BUDGET = 3500;

// ─── Company brief ───────────────────────────────────────────────────────────

const briefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  source_urls: z.array(z.string()).default([]),
  found_enough: z.boolean().default(true),
});

const BRIEF_PROMPT = `You write a short, factual company brief for someone preparing for a job interview.

${UNTRUSTED_RULES}

Use only the pages provided. Do not add facts from general knowledge. If the pages say
little, write a short brief that says what is known and set "found_enough" to false.

Return JSON:
{
  "summary": string,       // 2-4 sentences: who they are and anything notable for a candidate
  "what_they_do": string,  // 1-3 sentences: products or services and customers
  "source_urls": string[], // urls of the pages you actually used
  "found_enough": boolean
}`;

/**
 * @param {object} input
 * @param {string} input.company
 * @param {import('../retrieval/crawler.js').CrawlResult} input.crawl
 * @param {{ llm: { chatJson: Function } }} deps
 * @returns {Promise<{ summary: string, what_they_do: string, sources: string[], found: boolean }>}
 */
export async function buildCompanyBrief({ company, crawl }, { llm }) {
  const pages = crawl.pages.filter((p) => p.kind === 'home' || p.kind === 'about');
  const usable = pages.filter((p) => p.text.trim().length > 50);
  if (!crawl.reachable || !usable.length) return unknownCompanyBrief(company, crawl);

  const material = usable
    .slice(0, 4)
    .map((p) =>
      wrapUntrusted('source', clip(pageText(p), PAGE_BUDGET[p.kind] ?? 2000), { url: p.url }),
    )
    .join('\n\n');

  const result = await llm.chatJson({
    system: BRIEF_PROMPT,
    user: `Company: ${company}\n\n${material}`,
    schema: briefSchema,
    temperature: 0.2,
  });

  const provided = new Set(usable.map((p) => p.url));
  const sources = result.source_urls.filter((u) => provided.has(u));
  return {
    summary: result.summary.trim(),
    what_they_do: result.what_they_do.trim(),
    sources: sources.length ? sources : usable.map((p) => p.url),
    found: result.found_enough,
  };
}

function unknownCompanyBrief(company, crawl) {
  const why = crawl.reachable
    ? `${crawl.startUrl} was reachable but had no page describing the company`
    : `${crawl.startUrl} could not be retrieved (${crawl.error?.code ?? 'unknown error'})`;
  return {
    summary: `We could not find reliable information about ${company}: ${why}. This kit is based on the job description alone.`,
    what_they_do: 'Unknown: not stated on any page we could retrieve.',
    sources: [],
    found: false,
  };
}

// ─── Hiring process ──────────────────────────────────────────────────────────

const STAGE_TYPES = [
  'recruiter-screen',
  'technical-screen',
  'take-home',
  'live-coding',
  'system-design',
  'behavioural',
  'pair-programming',
  'work-trial',
  'onsite',
  'final',
  'other',
];

const hiringSchema = z.object({
  stages: z
    .array(
      z.object({
        name: z.string(),
        type: z.preprocess(
          (v) => (typeof v === 'string' && STAGE_TYPES.includes(v) ? v : 'other'),
          z.enum(STAGE_TYPES),
        ),
        description: z.string().default(''),
        source_url: z.string().default(''),
      }),
    )
    .default([]),
  notes: z.array(z.string()).default([]),
});

const HIRING_PROMPT = `You describe a company's interview process for a candidate.

${UNTRUSTED_RULES}

Use only the material provided. The company's own pages are authoritative; forum comments
are anecdotes, so mention them as "candidates report ..." in notes, not as stages, unless
the company's pages are silent. If the material does not describe a process, return
empty arrays. Never invent stages.

Return JSON:
{
  "stages": [
    { "name": string, "type": one of ${STAGE_TYPES.map((t) => `"${t}"`).join(', ')},
      "description": string, "source_url": string }
  ],
  "notes": string[]   // other useful facts: timeline, tips, what they value
}`;

/**
 * @returns {Promise<{ found: boolean, stages: object[], notes: string[], sources: string[] }>}
 */
export async function extractHiringProcess({ company, crawl, discussion }, { llm }) {
  const hiringPages = crawl.pages
    .filter((p) => p.kind === 'hiring' || p.hiringSignals >= 2)
    .sort((a, b) => b.hiringSignals - a.hiringSignals)
    .slice(0, 3);
  const threads = discussion?.results ?? [];
  if (!hiringPages.length && !threads.length) {
    return { found: false, stages: [], notes: [], sources: [] };
  }

  const blocks = hiringPages.map((p) =>
    wrapUntrusted('source', clip(pageText(p), PAGE_BUDGET.hiring), { url: p.url }),
  );
  if (threads.length) {
    const comments = threads.map((t) => `- ${t.title}: ${t.excerpt} (${t.url})`).join('\n');
    blocks.push(wrapUntrusted('discussion', clip(comments, DISCUSSION_BUDGET)));
  }

  const result = await llm.chatJson({
    system: HIRING_PROMPT,
    user: `Company: ${company}\n\n${blocks.join('\n\n')}`,
    schema: hiringSchema,
    temperature: 0.1,
  });

  const provided = new Set([...hiringPages.map((p) => p.url), ...threads.map((t) => t.url)]);
  const stages = result.stages.map((s) => ({
    ...s,
    source_url: provided.has(s.source_url) ? s.source_url : '',
  }));
  return {
    found: stages.length > 0,
    stages,
    notes: result.notes,
    sources: [...provided],
  };
}

function pageText(page) {
  return [page.title, page.description, page.text].filter(Boolean).join('\n');
}
